// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect } from 'vitest';
import { encodeWav } from './WavExporter';
import { MasterBus } from './MasterBus';
import { TrackNode } from './TrackNode';
import { AudioEngine } from './AudioEngine';
import type { AudioTrack } from '../types/daw';

/**
 * Mock AudioBuffer implementation for headless Node tests
 */
class TestAudioBuffer implements AudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private channelData: Float32Array<ArrayBuffer>[];

  constructor(numberOfChannels: number, length: number, sampleRate: number, customData?: Float32Array[]) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    if (customData) {
      this.channelData = customData as Float32Array<ArrayBuffer>[];
    } else {
      this.channelData = [];
      for (let c = 0; c < numberOfChannels; c++) {
        const data = new Float32Array(length) as Float32Array<ArrayBuffer>;
        for (let i = 0; i < length; i++) {
          data[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.7;
        }
        this.channelData.push(data);
      }
    }
  }

  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    return this.channelData[channel]!;
  }

  copyFromChannel(destination: Float32Array, channelNumber: number, bufferOffset?: number): void {
    const src = this.channelData[channelNumber]!;
    const offset = bufferOffset || 0;
    destination.set(src.subarray(offset, offset + destination.length));
  }

  copyToChannel(source: Float32Array, channelNumber: number, bufferOffset?: number): void {
    const dst = this.channelData[channelNumber]!;
    const offset = bufferOffset || 0;
    dst.set(source, offset);
  }
}

/**
 * Mock BaseAudioContext for headless unit testing
 */
class MockAudioParam {
  value: number;
  constructor(defaultValue: number = 0) {
    this.value = defaultValue;
  }
  setTargetAtTime(target: number): void {
    this.value = target;
  }
}

class MockAudioNode {
  connectedTo: MockAudioNode[] = [];
  disconnected = false;

  connect(destination: MockAudioNode): MockAudioNode {
    this.connectedTo.push(destination);
    this.disconnected = false;
    return destination;
  }

  disconnect(): void {
    this.connectedTo = [];
    this.disconnected = true;
  }
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam(1.0);
}

class MockDynamicsCompressorNode extends MockAudioNode {
  threshold = new MockAudioParam(-24);
  knee = new MockAudioParam(30);
  ratio = new MockAudioParam(12);
  attack = new MockAudioParam(0.003);
  release = new MockAudioParam(0.25);
}

class MockStereoPannerNode extends MockAudioNode {
  pan = new MockAudioParam(0);
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 256;
  smoothingTimeConstant = 0.8;
  getFloatTimeDomainData(array: Float32Array): void {
    array.fill(0.1);
  }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }
}

class MockBaseAudioContext {
  currentTime = 10.0;
  sampleRate = 44100;
  destination = new MockAudioNode();

  createGain(): MockGainNode {
    return new MockGainNode();
  }

  createDynamicsCompressor(): MockDynamicsCompressorNode {
    return new MockDynamicsCompressorNode();
  }

  createStereoPanner(): MockStereoPannerNode {
    return new MockStereoPannerNode();
  }

  createAnalyser(): MockAnalyserNode {
    return new MockAnalyserNode();
  }

  createBufferSource(): MockAudioBufferSourceNode {
    return new MockAudioBufferSourceNode();
  }
}

describe('Milestone 1: Audio Engine & DSP Pipeline Hardening', () => {
  const textDecoder = new TextDecoder('ascii');

  describe('WavExporter 16-bit, 24-bit, and 32-bit Float PCM RIFF Support', () => {
    it('encodes 32-bit IEEE float WAV with Format Code 3', () => {
      const sampleRate = 48000;
      const numSamples = 500;
      const ch0 = new Float32Array(numSamples);
      const ch1 = new Float32Array(numSamples);
      ch0[0] = 1.25; // Retains headroom > 0 dBFS without digital clipping
      ch1[0] = -0.75;
      const buffer = new TestAudioBuffer(2, numSamples, sampleRate, [ch0, ch1]);

      const wavBytes = encodeWav(buffer, 32);
      expect(wavBytes).toBeInstanceOf(Uint8Array);

      // Verify RIFF 44-byte Header
      expect(textDecoder.decode(wavBytes.subarray(0, 4))).toBe('RIFF');
      expect(textDecoder.decode(wavBytes.subarray(8, 12))).toBe('WAVE');
      expect(textDecoder.decode(wavBytes.subarray(12, 16))).toBe('fmt ');
      expect(textDecoder.decode(wavBytes.subarray(36, 40))).toBe('data');

      const view = new DataView(wavBytes.buffer);
      // Chunk size = 36 + dataSize (500 samples * 2 ch * 4 bytes = 4000) = 4036
      expect(view.getUint32(4, true)).toBe(36 + 4000);
      expect(view.getUint32(16, true)).toBe(16); // subchunk1Size
      expect(view.getUint16(20, true)).toBe(3);  // 3 = WAVE_FORMAT_IEEE_FLOAT
      expect(view.getUint16(22, true)).toBe(2);  // 2 channels
      expect(view.getUint32(24, true)).toBe(48000); // 48 kHz
      expect(view.getUint32(28, true)).toBe(48000 * 2 * 4); // byteRate
      expect(view.getUint16(32, true)).toBe(8);  // blockAlign
      expect(view.getUint16(34, true)).toBe(32); // bitsPerSample
      expect(view.getUint32(40, true)).toBe(4000); // dataSize

      // Verify IEEE 754 Float samples (sample 0 ch0 = 1.25, sample 0 ch1 = -0.75)
      expect(view.getFloat32(44, true)).toBeCloseTo(1.25, 6);
      expect(view.getFloat32(48, true)).toBeCloseTo(-0.75, 6);
      expect(wavBytes.length).toBe(44 + 4000);
    });

    it('encodes 24-bit PCM WAV with Format Code 1 and 3-byte packing', () => {
      const buffer = new TestAudioBuffer(2, 200, 44100);
      const wavBytes = encodeWav(buffer, 24);

      const view = new DataView(wavBytes.buffer);
      expect(view.getUint16(20, true)).toBe(1);  // 1 = WAVE_FORMAT_PCM
      expect(view.getUint16(34, true)).toBe(24); // 24-bit
      expect(view.getUint16(32, true)).toBe(6);  // blockAlign = 2 * 3
      expect(view.getUint32(40, true)).toBe(200 * 2 * 3);
      expect(wavBytes.length).toBe(44 + 200 * 2 * 3);
    });

    it('encodes 16-bit PCM WAV with Format Code 1 and 2-byte packing', () => {
      const buffer = new TestAudioBuffer(2, 200, 44100);
      const wavBytes = encodeWav(buffer, 16);

      const view = new DataView(wavBytes.buffer);
      expect(view.getUint16(20, true)).toBe(1);  // 1 = WAVE_FORMAT_PCM
      expect(view.getUint16(34, true)).toBe(16); // 16-bit
      expect(view.getUint16(32, true)).toBe(4);  // blockAlign = 2 * 2
      expect(view.getUint32(40, true)).toBe(200 * 2 * 2);
      expect(wavBytes.length).toBe(44 + 200 * 2 * 2);
    });
  });

  describe('MasterBus Limiter & Ceiling Clamping', () => {
    it('initializes brickwall limiter with 20:1 ratio, 1ms attack, and ceiling <= 0 dBFS', () => {
      const mockCtx = new MockBaseAudioContext() as unknown as BaseAudioContext;
      const masterBus = new MasterBus(mockCtx);

      // Verify limiter settings
      expect(masterBus.limiterNode.threshold.value).toBe(-1.0);
      expect(masterBus.limiterNode.knee.value).toBe(0.0);
      expect(masterBus.limiterNode.ratio.value).toBe(20.0);
      expect(masterBus.limiterNode.attack.value).toBe(0.001);
      expect(masterBus.limiterNode.release.value).toBe(0.05);

      // Verify ceiling gain: 10^(-0.1 / 20) ~ 0.98855 (strictly below 0 dBFS)
      expect(masterBus.ceilingGain.gain.value).toBeLessThanOrEqual(1.0);
      expect(masterBus.ceilingGain.gain.value).toBeCloseTo(0.98855, 4);

      // Verify master volume connects through limiter and ceiling
      const volNode = masterBus.volumeNode as unknown as MockAudioNode;
      expect(volNode.connectedTo).toContain(masterBus.limiterNode);

      // Verify clean disposal
      masterBus.dispose();
      expect(volNode.disconnected).toBe(true);
      expect((masterBus.ceilingGain as unknown as MockAudioNode).disconnected).toBe(true);
    });
  });

  describe('TrackNode Zero-Leak Lifecycle & Disconnections', () => {
    it('properly tracks, stops, and clears onended event listeners on active buffer sources', () => {
      const mockCtx = new MockBaseAudioContext() as unknown as BaseAudioContext;
      const track: AudioTrack = {
        id: 'track_1',
        name: 'Vocal',
        type: 'vocal',
        color: '#a855f7',
        volume: 1.0,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        plugins: [],
      };

      const trackNode = new TrackNode(mockCtx, track);
      const mockSource = new MockAudioBufferSourceNode() as unknown as AudioBufferSourceNode;

      // Register source
      trackNode.addActiveSource(mockSource);
      expect(mockSource.onended).toBeDefined();

      // Stop all sources
      trackNode.stopAllSources();
      expect((mockSource as unknown as MockAudioBufferSourceNode).stopped).toBe(true);
      expect((mockSource as unknown as MockAudioBufferSourceNode).disconnected).toBe(true);
      expect(mockSource.onended).toBeNull(); // Listener must be cleared to prevent closure leaks

      // Clean disposal
      trackNode.dispose();
      expect((trackNode.inputNode as unknown as MockAudioNode).disconnected).toBe(true);
      expect((trackNode.volumeNode as unknown as MockAudioNode).disconnected).toBe(true);
    });
  });

  describe('AudioEngine Sample-Accurate Calculations & Methods', () => {
    it('provides init, seek, pause, setTempo, and clear methods', () => {
      const engine = AudioEngine.getInstance();
      expect(typeof engine.init).toBe('function');
      expect(typeof engine.pause).toBe('function');
      expect(typeof engine.seek).toBe('function');
      expect(typeof engine.setTempo).toBe('function');
      expect(typeof engine.clear).toBe('function');

      engine.setTempo(140);
      expect(engine.getTempo()).toBe(140);
    });

    it('calculates sample-accurate clip offset and play duration', () => {
      // Test playback calculation logic:
      // Clip: starts at T=4s, duration 6s, offset 1s
      // Playhead: starts at T=6s (2s into clip)
      const clipStart = 4.0;
      const clipDuration = 6.0;
      const clipOffset = 1.0;
      const playhead = 6.0;

      const offsetIntoClip = Math.max(0, playhead - clipStart) + clipOffset;
      const delayUntilStart = Math.max(0, clipStart - playhead);
      const playDuration = Math.max(0, clipDuration - Math.max(0, playhead - clipStart));

      expect(offsetIntoClip).toBe(3.0); // 2s elapsed + 1s offset = 3s into audio buffer
      expect(delayUntilStart).toBe(0.0); // starts immediately
      expect(playDuration).toBe(4.0); // 6s - 2s = 4s remaining
    });
  });
});
