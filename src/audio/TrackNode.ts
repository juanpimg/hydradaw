import { AudioTrack } from '../types/daw';
import { pluginHost, ActiveDSPNode } from './PluginHost';

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

  /**
   * Rebuilds the track's DSP insert effects chain
   */
  rebuildEffectsChain(track: AudioTrack) {
    // 1. Cleanup old DSP nodes and sever connections
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

    // Pan
    try {
      this.pannerNode.pan.setTargetAtTime(track.pan, time, 0.02);
    } catch (_) {
      this.pannerNode.pan.value = track.pan;
    }

    // Volume
    try {
      this.volumeNode.gain.setTargetAtTime(track.volume, time, 0.02);
    } catch (_) {
      this.volumeNode.gain.value = track.volume;
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

    try {
      this.muteNode.gain.setTargetAtTime(isAudible ? 1.0 : 0.0, time, 0.02);
    } catch (_) {
      this.muteNode.gain.value = isAudible ? 1.0 : 0.0;
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
    try {
      this.analyserNode.connect(destination);
    } catch (_) {}
  }

  /**
   * Registers a playing AudioBufferSourceNode for stopping/cleanup
   */
  addActiveSource(source: AudioBufferSourceNode) {
    this.activeSourceNodes.push(source);
    source.onended = () => {
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
    const data = new Float32Array(this.analyserNode.fftSize);
    this.analyserNode.getFloatTimeDomainData(data);

    let sum = 0;
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
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
    for (const dsp of this.activeDSPNodes) {
      try {
        dsp.cleanup?.();
        dsp.inputNode.disconnect();
        dsp.outputNode.disconnect();
      } catch (_) {}
    }
    this.activeDSPNodes = [];
    try { this.inputNode.disconnect(); } catch (_) {}
    try { this.pannerNode.disconnect(); } catch (_) {}
    try { this.volumeNode.disconnect(); } catch (_) {}
    try { this.muteNode.disconnect(); } catch (_) {}
    try { this.analyserNode.disconnect(); } catch (_) {}
  }
}
