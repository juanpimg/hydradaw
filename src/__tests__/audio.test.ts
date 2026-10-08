import { describe, it, expect } from 'vitest';
import { encodeWav } from '../audio/WavExporter';
import { generateWaveformPeaks } from '../audio/waveformUtils';
import { BUILTIN_PLUGINS } from '../audio/builtinPlugins';
import { pluginHost } from '../audio/PluginHost';

// Simple mock for AudioBuffer in headless node environment
class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private channelData: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channelData = [];
    for (let c = 0; c < numberOfChannels; c++) {
      const data = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        data[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
      }
      this.channelData.push(data);
    }
  }

  getChannelData(channel: number): Float32Array {
    return this.channelData[channel];
  }
}

describe('HydraDAW Audio Architecture Tests', () => {
  it('encodes a 16-bit PCM WAV with standard RIFF header', () => {
    const mockBuffer = new MockAudioBuffer(2, 44100, 44100) as unknown as AudioBuffer;
    const wavBytes = encodeWav(mockBuffer, 16);

    expect(wavBytes).toBeInstanceOf(Uint8Array);
    // Header should be 44 bytes + (44100 * 2 channels * 2 bytes = 176400 bytes) = 176444 bytes
    expect(wavBytes.length).toBe(44 + 44100 * 2 * 2);

    // Verify RIFF header text
    const textDecoder = new TextDecoder('ascii');
    expect(textDecoder.decode(wavBytes.subarray(0, 4))).toBe('RIFF');
    expect(textDecoder.decode(wavBytes.subarray(8, 12))).toBe('WAVE');
    expect(textDecoder.decode(wavBytes.subarray(12, 16))).toBe('fmt ');
    expect(textDecoder.decode(wavBytes.subarray(36, 40))).toBe('data');

    // Check DataView fields
    const view = new DataView(wavBytes.buffer);
    expect(view.getUint16(20, true)).toBe(1); // PCM format
    expect(view.getUint16(22, true)).toBe(2); // Stereo 2 channels
    expect(view.getUint32(24, true)).toBe(44100); // 44.1 kHz
    expect(view.getUint16(34, true)).toBe(16); // 16 bits
  });

  it('encodes a 24-bit PCM studio WAV', () => {
    const mockBuffer = new MockAudioBuffer(2, 1000, 48000) as unknown as AudioBuffer;
    const wavBytes = encodeWav(mockBuffer, 24);

    const view = new DataView(wavBytes.buffer);
    expect(view.getUint16(22, true)).toBe(2); // Stereo
    expect(view.getUint32(24, true)).toBe(48000); // 48 kHz
    expect(view.getUint16(34, true)).toBe(24); // 24 bits
    // Data size = 1000 samples * 2 channels * 3 bytes = 6000 bytes
    expect(view.getUint32(40, true)).toBe(6000);
  });

  it('generates waveform peak bins for 60 FPS Canvas rendering', () => {
    const mockBuffer = new MockAudioBuffer(2, 8000, 44100) as unknown as AudioBuffer;
    const targetPoints = 400;
    const peaks = generateWaveformPeaks(mockBuffer, targetPoints);

    expect(peaks).toBeInstanceOf(Float32Array);
    expect(peaks.length).toBe(targetPoints * 2);

    // Verify min <= 0 and max >= 0 bounds
    for (let i = 0; i < targetPoints; i++) {
      const min = peaks[i * 2];
      const max = peaks[i * 2 + 1];
      expect(min).toBeLessThanOrEqual(0.001);
      expect(max).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it('defines the 6 built-in studio plugins with valid parameters', () => {
    const pluginIds = ['eq3', 'compressor', 'delay', 'reverb', 'limiter', 'saturator'];
    for (const id of pluginIds) {
      const plugin = BUILTIN_PLUGINS[id];
      expect(plugin).toBeDefined();
      expect(plugin.name).toBeTruthy();
      expect(plugin.parameters.length).toBeGreaterThan(0);
      for (const param of plugin.parameters) {
        expect(param.id).toBeTruthy();
        expect(param.min).toBeLessThanOrEqual(param.max);
        expect(param.defaultValue).toBeGreaterThanOrEqual(param.min);
        expect(param.defaultValue).toBeLessThanOrEqual(param.max);
      }
    }
  });

  it('allows registering and discovering custom local plugins in PluginHost', () => {
    const customCode = `
      var customPlugin = {
        id: 'flanger_test',
        name: 'Stereo Flanger',
        category: 'spatial',
        description: 'Test custom flanger',
        parameters: [
          { id: 'rate', name: 'Rate', min: 0.1, max: 10, step: 0.1, defaultValue: 1.0 }
        ],
        createDSPNode: (context, params) => {
          return {
            inputNode: null,
            outputNode: null,
            updateParameter: () => {}
          };
        }
      };
    `;

    const registered = pluginHost.registerCustomPlugin(customCode);
    expect(registered.id).toBe('flanger_test');
    expect(registered.name).toBe('Stereo Flanger');

    const retrieved = pluginHost.getPluginDefinition('flanger_test');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('flanger_test');
  });
});
