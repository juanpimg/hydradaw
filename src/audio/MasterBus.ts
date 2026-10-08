export class MasterBus {
  readonly context: BaseAudioContext;
  readonly inputNode: GainNode;
  readonly limiterNode: DynamicsCompressorNode;
  readonly ceilingGain: GainNode;
  readonly volumeNode: GainNode;
  readonly muteNode: GainNode;
  readonly analyserNode: AnalyserNode;
  // Fix(waveA): reusable meter buffer — avoids per-frame Float32Array alloc in getMeterLevels.
  private meterBuffer: Float32Array<ArrayBuffer> | null = null;

  constructor(context: BaseAudioContext) {
    this.context = context;

    this.inputNode = context.createGain();

    // Studio Brickwall Limiter to avoid digital clipping
    this.limiterNode = context.createDynamicsCompressor();
    this.limiterNode.threshold.value = -1.0;
    this.limiterNode.knee.value = 0.0;
    this.limiterNode.ratio.value = 20.0;
    this.limiterNode.attack.value = 0.001;
    this.limiterNode.release.value = 0.05;

    // Ceiling at -0.1 dBFS
    this.ceilingGain = context.createGain();
    this.ceilingGain.gain.value = Math.pow(10, -0.1 / 20);

    // Master fader & mute
    this.volumeNode = context.createGain();
    this.muteNode = context.createGain();

    // High resolution analyser for master LUFS/peak
    this.analyserNode = context.createAnalyser();
    this.analyserNode.fftSize = 512;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // Chain: input -> volume -> limiter -> ceiling -> mute -> analyser
    // Master volume feeds into the brickwall limiter & ceiling, ensuring
    // output peaks can NEVER exceed 0 dBFS (strictly clamped to -0.1 dBFS ceiling)
    this.inputNode.connect(this.volumeNode);
    this.volumeNode.connect(this.limiterNode);
    this.limiterNode.connect(this.ceilingGain);
    this.ceilingGain.connect(this.muteNode);
    this.muteNode.connect(this.analyserNode);

    // Connect to audio output: realtime AudioContext uses the physical
    // output; OfflineAudioContext uses its own destination, which is what
    // startRendering() captures. WITHOUT the offline branch every export
    // renders silence (the graph was never connected to the render target).
    // Fix: connect in both cases.
    // Fix(waveA): duck-typing instead of fragile `instanceof` (breaks under
    // Safari webkit prefixes / polyfills where the global constructor differs
    // from the context's realm). Any context exposing `.destination` gets the
    // analyser wired to it; headless mocks without destination stay unwired.
    const dest = (context as unknown as { destination?: AudioNode }).destination;
    if (dest) {
      this.analyserNode.connect(dest);
    }
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

  setVolume(volume: number) {
    // Fix(waveA): clamp 0..1.5 (matches AudioTrack.volume range).
    const val = Math.min(1.5, Math.max(0, volume));
    // Fix(waveA): direct assignment offline — currentTime is frozen during
    // OfflineAudioContext setup, so setTargetAtTime ramps would mis-schedule
    // the export start; direct .value applies deterministically.
    if (this.isOfflineContext()) {
      this.volumeNode.gain.value = val;
      return;
    }
    try {
      this.volumeNode.gain.setTargetAtTime(val, this.context.currentTime, 0.02);
    } catch (_) {
      this.volumeNode.gain.value = val;
    }
  }

  setMute(mute: boolean) {
    const val = mute ? 0 : 1.0;
    // Fix(waveA): direct assignment offline (same frozen-currentTime reason).
    if (this.isOfflineContext()) {
      this.muteNode.gain.value = val;
      return;
    }
    try {
      this.muteNode.gain.setTargetAtTime(val, this.context.currentTime, 0.02);
    } catch (_) {
      this.muteNode.gain.value = val;
    }
  }

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
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
      sum += abs * abs;
    }
    const rms = Math.sqrt(sum / data.length);
    return { rms: Math.min(1, rms * 1.4), peak: Math.min(1, peak) };
  }

  dispose() {
    try { this.inputNode.disconnect(); } catch (_) {}
    try { this.volumeNode.disconnect(); } catch (_) {}
    try { this.limiterNode.disconnect(); } catch (_) {}
    try { this.ceilingGain.disconnect(); } catch (_) {}
    try { this.muteNode.disconnect(); } catch (_) {}
    try { this.analyserNode.disconnect(); } catch (_) {}
  }
}
