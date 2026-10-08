import { describe, it, expect } from 'vitest';
import { encodeWav } from '../audio/WavExporter';

/**
 * Mock AudioBuffer for node / headless test runner
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
      this.channelData = customData as unknown as Float32Array<ArrayBuffer>[];
    } else {
      this.channelData = [];
      for (let c = 0; c < numberOfChannels; c++) {
        const data = new Float32Array(length) as unknown as Float32Array<ArrayBuffer>;
        for (let i = 0; i < length; i++) {
          data[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.7;
        }
        this.channelData.push(data);
      }
    }
  }

  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    return this.channelData[channel];
  }

  copyFromChannel(destination: Float32Array, channelNumber: number, bufferOffset?: number): void {
    const src = this.channelData[channelNumber];
    const offset = bufferOffset || 0;
    destination.set(src.subarray(offset, offset + destination.length));
  }

  copyToChannel(source: Float32Array, channelNumber: number, bufferOffset?: number): void {
    const dst = this.channelData[channelNumber];
    const offset = bufferOffset || 0;
    dst.set(source, offset);
  }
}

/**
 * Specification 32-bit IEEE Float WAV Encoder
 * Used to verify the reference binary contract for 32-bit audio bouncing
 */
export function encode32BitFloatWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 4;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  function writeAscii(offset: number, text: string) {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  // RIFF chunk
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');

  // fmt chunk
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // 3 = IEEE Float format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 32, true); // 32 bits per sample

  // data chunk
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write 32-bit float samples
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = buffer.getChannelData(c)[i];
      view.setFloat32(offset, sample, true);
      offset += 4;
    }
  }

  return new Uint8Array(arrayBuffer);
}

describe('HydraDAW RIFF WAV Encoding & Binary Formats', () => {
  const textDecoder = new TextDecoder('ascii');

  describe('Tier 1: Feature Coverage (16-bit PCM WAV)', () => {
    it('writes exact 44-byte RIFF/WAVE header fields for 16-bit stereo 44.1 kHz', () => {
      const sampleRate = 44100;
      const length = 44100; // 1 second
      const mockBuffer = new TestAudioBuffer(2, length, sampleRate);
      const wav = encodeWav(mockBuffer, 16);

      expect(textDecoder.decode(wav.subarray(0, 4))).toBe('RIFF');
      expect(textDecoder.decode(wav.subarray(8, 12))).toBe('WAVE');
      expect(textDecoder.decode(wav.subarray(12, 16))).toBe('fmt ');
      expect(textDecoder.decode(wav.subarray(36, 40))).toBe('data');

      const view = new DataView(wav.buffer);
      // chunkSize = 36 + dataSize
      const expectedDataSize = length * 2 * 2; // 176400 bytes
      expect(view.getUint32(4, true)).toBe(36 + expectedDataSize);
      expect(view.getUint32(16, true)).toBe(16); // fmt subchunk size
      expect(view.getUint16(20, true)).toBe(1);  // PCM format code
      expect(view.getUint16(22, true)).toBe(2);  // Channels
      expect(view.getUint32(24, true)).toBe(44100); // Sample rate
      expect(view.getUint32(28, true)).toBe(44100 * 2 * 2); // Byte rate
      expect(view.getUint16(32, true)).toBe(4);  // Block align (2 ch * 2 bytes)
      expect(view.getUint16(34, true)).toBe(16); // Bits per sample
      expect(view.getUint32(40, true)).toBe(expectedDataSize);
    });

    it('encodes positive and negative full-scale 16-bit samples correctly', () => {
      // Create DC buffer with exact 1.0 and -1.0 samples
      const ch0 = new Float32Array([1.0, -1.0]);
      const ch1 = new Float32Array([0.0, 0.5]);
      const mockBuffer = new TestAudioBuffer(2, 2, 44100, [ch0, ch1]);
      const wav = encodeWav(mockBuffer, 16);

      const view = new DataView(wav.buffer);
      // Sample 0: L = 1.0 -> 0x7FFF (32767), R = 0.0 -> 0
      expect(view.getInt16(44, true)).toBe(32767);
      expect(view.getInt16(46, true)).toBe(0);

      // Sample 1: L = -1.0 -> -32768, R = 0.5 -> ~16383
      expect(view.getInt16(48, true)).toBe(-32768);
      expect(view.getInt16(50, true)).toBeCloseTo(16383, -1);
    });

    it('interleaves stereo samples in strict [L0, R0, L1, R1] sequence', () => {
      const ch0 = new Float32Array([0.2, 0.4]);
      const ch1 = new Float32Array([0.6, 0.8]);
      const mockBuffer = new TestAudioBuffer(2, 2, 48000, [ch0, ch1]);
      const wav = encodeWav(mockBuffer, 16);

      const view = new DataView(wav.buffer);
      const l0 = view.getInt16(44, true);
      const r0 = view.getInt16(46, true);
      const l1 = view.getInt16(48, true);
      const r1 = view.getInt16(50, true);

      expect(l0).toBeCloseTo(0.2 * 32767, -1);
      expect(r0).toBeCloseTo(0.6 * 32767, -1);
      expect(l1).toBeCloseTo(0.4 * 32767, -1);
      expect(r1).toBeCloseTo(0.8 * 32767, -1);
    });

    it('clamps overs (> 1.0 or < -1.0) to prevent integer wraparound distortion', () => {
      const ch0 = new Float32Array([2.5, -3.8]);
      const ch1 = new Float32Array([0.0, 0.0]);
      const mockBuffer = new TestAudioBuffer(2, 2, 44100, [ch0, ch1]);
      const wav = encodeWav(mockBuffer, 16);

      const view = new DataView(wav.buffer);
      expect(view.getInt16(44, true)).toBe(32767); // Clamped to +1.0 max
      expect(view.getInt16(48, true)).toBe(-32768); // Clamped to -1.0 min
    });

    it('computes exact total file length: 44 bytes header + sample payload', () => {
      const samples = 1200;
      const mockBuffer = new TestAudioBuffer(2, samples, 44100);
      const wav = encodeWav(mockBuffer, 16);
      expect(wav.length).toBe(44 + samples * 2 * 2);
    });
  });

  describe('Tier 1: Feature Coverage (24-bit Studio PCM WAV)', () => {
    it('writes 24-bit RIFF/WAVE header with blockAlign = 6 and bitsPerSample = 24', () => {
      const sampleRate = 48000;
      const length = 500;
      const mockBuffer = new TestAudioBuffer(2, length, sampleRate);
      const wav = encodeWav(mockBuffer, 24);

      const view = new DataView(wav.buffer);
      expect(view.getUint16(20, true)).toBe(1); // PCM
      expect(view.getUint16(22, true)).toBe(2); // Stereo
      expect(view.getUint32(24, true)).toBe(48000);
      expect(view.getUint16(32, true)).toBe(6);  // 2 channels * 3 bytes
      expect(view.getUint16(34, true)).toBe(24); // 24-bit
      expect(view.getUint32(40, true)).toBe(length * 2 * 3); // 3000 bytes data
    });

    it('packs 24-bit signed integers in 3-byte little-endian format', () => {
      // 1.0 in 24-bit = 0x7FFFFF (8388607) => bytes: 0xFF, 0xFF, 0x7F
      const ch0 = new Float32Array([1.0]);
      const ch1 = new Float32Array([0.0]);
      const mockBuffer = new TestAudioBuffer(2, 1, 44100, [ch0, ch1]);
      const wav = encodeWav(mockBuffer, 24);

      expect(wav[44]).toBe(0xFF);
      expect(wav[45]).toBe(0xFF);
      expect(wav[46]).toBe(0x7F);

      // Channel 1: 0.0 => 0, 0, 0
      expect(wav[47]).toBe(0x00);
      expect(wav[48]).toBe(0x00);
      expect(wav[49]).toBe(0x00);
    });

    it('packs negative full-scale 24-bit sample (-1.0 -> 0x800000)', () => {
      const ch0 = new Float32Array([-1.0]);
      const ch1 = new Float32Array([0.0]);
      const mockBuffer = new TestAudioBuffer(2, 1, 44100, [ch0, ch1]);
      const wav = encodeWav(mockBuffer, 24);

      // -8388608 in 24-bit two's complement = 0x800000 => bytes: 0x00, 0x00, 0x80
      expect(wav[44]).toBe(0x00);
      expect(wav[45]).toBe(0x00);
      expect(wav[46]).toBe(0x80);
    });

    it('computes exact total file length for 24-bit audio', () => {
      const length = 2000;
      const mockBuffer = new TestAudioBuffer(2, length, 48000);
      const wav = encodeWav(mockBuffer, 24);
      expect(wav.length).toBe(44 + length * 2 * 3);
    });
  });

  describe('Tier 1: Feature Coverage (32-bit Float Audio Contract)', () => {
    it('writes valid 32-bit IEEE float WAV header (format code = 3)', () => {
      const sampleRate = 96000;
      const length = 100;
      const mockBuffer = new TestAudioBuffer(2, length, sampleRate);
      const wav = encode32BitFloatWav(mockBuffer);

      const view = new DataView(wav.buffer);
      expect(textDecoder.decode(wav.subarray(0, 4))).toBe('RIFF');
      expect(textDecoder.decode(wav.subarray(8, 12))).toBe('WAVE');
      expect(view.getUint16(20, true)).toBe(3); // IEEE Float
      expect(view.getUint16(22, true)).toBe(2);
      expect(view.getUint32(24, true)).toBe(96000);
      expect(view.getUint16(32, true)).toBe(8); // 2 channels * 4 bytes
      expect(view.getUint16(34, true)).toBe(32);
      expect(view.getUint32(40, true)).toBe(length * 2 * 4);
    });

    it('stores 32-bit float samples without truncation or clipping', () => {
      const ch0 = new Float32Array([0.75, 1.25]); // 1.25 retains headroom above 0 dBFS!
      const ch1 = new Float32Array([-0.5, -2.0]);
      const mockBuffer = new TestAudioBuffer(2, 2, 44100, [ch0, ch1]);
      const wav = encode32BitFloatWav(mockBuffer);

      const view = new DataView(wav.buffer);
      expect(view.getFloat32(44, true)).toBeCloseTo(0.75, 6);
      expect(view.getFloat32(48, true)).toBeCloseTo(-0.5, 6);
      expect(view.getFloat32(52, true)).toBeCloseTo(1.25, 6);
      expect(view.getFloat32(56, true)).toBeCloseTo(-2.0, 6);
    });
  });

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('encodes an empty AudioBuffer (0 samples) producing a clean 44-byte WAV header', () => {
      const mockBuffer = new TestAudioBuffer(2, 0, 44100, [new Float32Array(0), new Float32Array(0)]);
      const wav = encodeWav(mockBuffer, 16);

      expect(wav.length).toBe(44);
      const view = new DataView(wav.buffer);
      expect(view.getUint32(4, true)).toBe(36); // 36 + 0
      expect(view.getUint32(40, true)).toBe(0); // 0 bytes data
    });

    it('encodes a mono AudioBuffer (1 channel) correctly', () => {
      const length = 100;
      const ch0 = new Float32Array(length);
      const mockBuffer = new TestAudioBuffer(1, length, 44100, [ch0]);
      const wav = encodeWav(mockBuffer, 16);

      const view = new DataView(wav.buffer);
      expect(view.getUint16(22, true)).toBe(1); // 1 channel
      expect(view.getUint16(32, true)).toBe(2); // blockAlign = 1 * 2 bytes = 2
      expect(view.getUint32(40, true)).toBe(length * 2); // 200 bytes
      expect(wav.length).toBe(44 + length * 2);
    });

    it('supports 96 kHz high-resolution sampling rate', () => {
      const mockBuffer = new TestAudioBuffer(2, 960, 96000);
      const wav = encodeWav(mockBuffer, 24);

      const view = new DataView(wav.buffer);
      expect(view.getUint32(24, true)).toBe(96000);
      expect(view.getUint32(28, true)).toBe(96000 * 2 * 3); // 576000 bytes/sec
    });
  });
});
