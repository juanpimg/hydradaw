import type { AudioTrack } from '../types/daw';
import { pluginHost } from './PluginHost';
import type { ActiveDSPNode } from './PluginHost';

export class TrackNode {
  readonly trackId: string;
  readonly context: BaseAudioContext;

  readonly inputNode: GainNode;
  readonly pannerNode: StereoPannerNode;
  readonly volumeNode: GainNode;
  readonly muteNode: GainNode;
  readonly analyserNode: AnalyserNode;

  private activeDSPNodes: ActiveDSPNode[] = [];
  private activeSourceNodes: AudioBufferSourceNode[] = [];
  // Fix(waveA): guard flag — prevents double connect() (+6 dB summing when
  // the analyser is wired twice to the same destination).
  private connectedDestinations = new Set<AudioNode>();
  // Fix(waveA): reusable meter buffer — avoids per-frame Float32Array alloc in getMeterLevels.
  private meterBuffer: Float32Array<ArrayBuffer> | null = null;

  constructor(context: BaseAudioContext, track: AudioTrack) {
    this.trackId = track.id;
    this.context = context;

    this.inputNode = context.createGain();
    this.pannerNode = context.createStereoPanner();
    this.volumeNode = context.createGain();
    this.muteNode = context.createGain();

    this.analyserNode = context.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.8;

    this.updateTrackState(track);
    this.rebuildEffectsChain(track);
  }

  // Fix(waveA): offline detection without fragile instanceof — true for real
  // OfflineAudioContext (instanceof fast path) or any context exposing
  // startRendering (polyfills / fakes that mimic the offline API).
  private isOfflineContext(): boolean {
    try {
      if (
        typeof OfflineAudioContext !== 'undefined' &&
        this.context instanceof OfflineAudioContext
      ) {
        return true;
      }
    } catch (_) {
      // Fall through to duck-typing.
    }
    return (
      typeof (this.context as unknown as { startRendering?: unknown })
        .startRendering === 'function'
    );
  }

  /**
   * Rebuilds the track's DSP insert effects chain
   */
  rebuildEffectsChain(track: AudioTrack) {
    // 1. Cleanup old DSP nodes and sever connections
    // Fix(waveA): dsp.cleanup?.() hook runs first so stateful plugins can
    // release non-graph resources (timers, workers, WASM handles). The
    // builtins below currently expose no cleanup: disconnect() severs the
    // external graph refs and the internal nodes are left to GC — including
    // the delay's wet feedback island (delayNode <-> filterNode <->
    // feedbackNode cycle). A pure JS reference cycle with no path from a GC
    // root is still collectable, so the island is reclaimed once input/output
    // are disconnected; no timers exist in the builtins to clear. Custom
    // plugins that DO hold timers must provide cleanup, otherwise the timer
    // (a GC root) would pin their nodes alive.
    for (const dsp of this.activeDSPNodes) {
      try {
        dsp.cleanup?.();
        dsp.inputNode.disconnect();
        dsp.outputNode.disconnect();
      } catch (_) {}
    }
    this.activeDSPNodes = [];

    // Disconnect downstream connections before rewiring
    try { this.inputNode.disconnect(); } catch (_) {}
    try { this.pannerNode.disconnect(); } catch (_) {}
    try { this.volumeNode.disconnect(); } catch (_) {}
    try { this.muteNode.disconnect(); } catch (_) {}

    let lastNode: AudioNode = this.inputNode;

    // 2. Chain enabled plugins
    for (const pluginInst of track.plugins) {
      if (!pluginInst.enabled) continue;

      const dspNode = pluginHost.createInstanceNode(this.context, pluginInst);
      if (dspNode) {
        lastNode.connect(dspNode.inputNode);
        lastNode = dspNode.outputNode;
        this.activeDSPNodes.push(dspNode);
      }
    }

    // 3. Connect to Pan -> Volume -> Mute -> Analyser
    lastNode.connect(this.pannerNode);
    this.pannerNode.connect(this.volumeNode);
    this.volumeNode.connect(this.muteNode);
    this.muteNode.connect(this.analyserNode);
  }

  /**
   * Updates track parameters (volume, pan, mute, solo)
   */
  updateTrackState(track: AudioTrack, anyTrackSoloed: boolean = false) {
    const time = this.context.currentTime;
    // Fix(waveA): clamp before scheduling (pan [-1,1], volume [0,1.5]).
    const pan = Math.min(1, Math.max(-1, track.pan));
    const vol = Math.min(1.5, Math.max(0, track.volume));
    // Fix(waveA): direct assignment offline — currentTime is frozen during
    // OfflineAudioContext setup, so setTargetAtTime ramps would mis-schedule
    // the export start; direct .value applies deterministically.
    const offline = this.isOfflineContext();

    // Pan
    if (offline) {
      this.pannerNode.pan.value = pan;
    } else {
      try {
        this.pannerNode.pan.setTargetAtTime(pan, time, 0.02);
      } catch (_) {
        this.pannerNode.pan.value = pan;
      }
    }

    // Volume
    if (offline) {
      this.volumeNode.gain.value = vol;
    } else {
      try {
        this.volumeNode.gain.setTargetAtTime(vol, time, 0.02);
      } catch (_) {
        this.volumeNode.gain.value = vol;
      }
    }

    // Mute & Solo logic:
    // If ANY track is soloed, this track only plays if it is soloed.
    // If this track is muted, it does not play.
    let isAudible = true;
    if (track.mute) {
      isAudible = false;
    } else if (anyTrackSoloed && !track.solo) {
      isAudible = false;
    }

    if (offline) {
      this.muteNode.gain.value = isAudible ? 1.0 : 0.0;
    } else {
      try {
        this.muteNode.gain.setTargetAtTime(isAudible ? 1.0 : 0.0, time, 0.02);
      } catch (_) {
        this.muteNode.gain.value = isAudible ? 1.0 : 0.0;
      }
    }
  }

  /**
   * Updates a single plugin parameter in real-time
   */
  updatePluginParameter(instanceId: string, paramId: string, value: number) {
    const dsp = this.activeDSPNodes.find(n => n.instanceId === instanceId);
    if (dsp) {
      dsp.updateParameter(paramId, value);
    }
  }

  /**
   * Connects this track's output to a destination node (e.g. Master Bus)
   */
  connect(destination: AudioNode) {
    // Fix(waveA): idempotent connect — skip destinations already wired to
    // avoid double-connection gain buildup (~+6 dB per duplicate wire).
    if (this.connectedDestinations.has(destination)) return;
    try {
      this.analyserNode.connect(destination);
      this.connectedDestinations.add(destination);
    } catch (_) {}
  }

  /**
   * Registers a playing AudioBufferSourceNode for stopping/cleanup.
   * Fix(AUD-06): optional cleanup runs in onended before disconnecting the
   * source, so per-clip helper nodes (e.g. fade clipGain) don't leak.
   */
  addActiveSource(source: AudioBufferSourceNode, cleanup?: () => void) {
    this.activeSourceNodes.push(source);
    source.onended = () => {
      try {
        cleanup?.();
      } catch (_) {}
      try {
        source.disconnect();
      } catch (_) {}
      source.onended = null;
      this.activeSourceNodes = this.activeSourceNodes.filter(s => s !== source);
    };
  }

  /**
   * Stops and disconnects all running audio sources on this track
   */
  stopAllSources() {
    for (const source of this.activeSourceNodes) {
      try {
        source.onended = null;
        source.stop(0);
        source.disconnect();
      } catch (_) {
        // Source already stopped or disconnected
      }
    }
    this.activeSourceNodes = [];
  }

  /**
   * Gets current RMS and peak levels (0..1)
   */
  getMeterLevels(): { rms: number; peak: number } {
    // Fix(waveA): reuse instance buffer instead of allocating per call/frame.
    const size = this.analyserNode.fftSize;
    if (!this.meterBuffer || this.meterBuffer.length !== size) {
      this.meterBuffer = new Float32Array(size);
    }
    const data = this.meterBuffer;
    this.analyserNode.getFloatTimeDomainData(data);

    let sum = 0;
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      // Fix(waveB-ts): noUncheckedIndexedAccess → data[i] es number|undefined.
      const abs = Math.abs(data[i] ?? 0);
      if (abs > peak) peak = abs;
      sum += abs * abs;
    }
    const rms = Math.sqrt(sum / data.length);
    return { rms: Math.min(1, rms * 1.4), peak: Math.min(1, peak) };
  }

  /**
   * Cleans up all audio nodes
   */
  dispose() {
    this.stopAllSources();
    // Fix(waveA): dsp.cleanup?.() hook runs first (see rebuildEffectsChain
    // for GC semantics of builtin internals incl. the delay feedback cycle:
    // disconnect severs external refs, internal island incl. the cycle is left
    // to GC; builtins hold no timers, custom timed plugins must use cleanup).
    for (const dsp of this.activeDSPNodes) {
      try {
        dsp.cleanup?.();
        dsp.inputNode.disconnect();
        dsp.outputNode.disconnect();
      } catch (_) {}
    }
    this.activeDSPNodes = [];
    this.connectedDestinations.clear();
    try { this.inputNode.disconnect(); } catch (_) {}
    try { this.pannerNode.disconnect(); } catch (_) {}
    try { this.volumeNode.disconnect(); } catch (_) {}
    try { this.muteNode.disconnect(); } catch (_) {}
    try { this.analyserNode.disconnect(); } catch (_) {}
  }
}
