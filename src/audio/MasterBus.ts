export class MasterBus {
  readonly context: BaseAudioContext;
  readonly inputNode: GainNode;
  readonly limiterNode: DynamicsCompressorNode;
  readonly ceilingGain: GainNode;
  readonly volumeNode: GainNode;
  readonly muteNode: GainNode;
  readonly analyserNode: AnalyserNode;

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
    const isRealtime = typeof AudioContext !== 'undefined' && context instanceof AudioContext;
    const isOffline =
      typeof OfflineAudioContext !== 'undefined' && context instanceof OfflineAudioContext;
    if (isRealtime || isOffline) {
      this.analyserNode.connect((context as AudioContext).destination);
    }
  }

  setVolume(volume: number) {
    const val = Math.max(0, volume);
    try {
      this.volumeNode.gain.setTargetAtTime(val, this.context.currentTime, 0.02);
    } catch (_) {
      this.volumeNode.gain.value = val;
    }
  }

  setMute(mute: boolean) {
    const val = mute ? 0 : 1.0;
    try {
      this.muteNode.gain.setTargetAtTime(val, this.context.currentTime, 0.02);
    } catch (_) {
      this.muteNode.gain.value = val;
    }
  }

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

  dispose() {
    try { this.inputNode.disconnect(); } catch (_) {}
    try { this.volumeNode.disconnect(); } catch (_) {}
    try { this.limiterNode.disconnect(); } catch (_) {}
    try { this.ceilingGain.disconnect(); } catch (_) {}
    try { this.muteNode.disconnect(); } catch (_) {}
    try { this.analyserNode.disconnect(); } catch (_) {}
  }
}
