import { describe, it, expect } from 'vitest';
import { generateWaveformPeaks } from '../audio/waveformUtils';
import {
  dbToLinear,
  secondsToSamples,
  samplesToSeconds,
  calculateLinearPan,
  calculateConstantPowerPan,
  calculatePeakAndRMS,
} from '../audio/audioMath';
import {
  splitClipOperation,
  trimLeftOperation,
  trimRightOperation,
} from '../audio/timelineOps';
import { muxAdtsFrame, parseAdtsHeader } from '../audio/aacExporter';
import type { AudioClip } from '../types/daw';

function mockAudioBuffer(): AudioBuffer {
  const data = new Float32Array([0.1, -0.5, 0.8, -0.2]);
  return {
    numberOfChannels: 1,
    length: data.length,
    sampleRate: 44100,
    duration: data.length / 44100,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

function mockClip(): AudioClip {
  return {
    id: 'c1',
    trackId: 't1',
    name: 'Clip',
    startTime: 0,
    duration: 4,
    offset: 0,
    audioBuffer: null,
    peaks: new Float32Array(0),
  };
}

describe('guardas numéricas (DSP-07/08/09/10, AUD-12, AAC-06)', () => {
  it('G1: generateWaveformPeaks(buf, -4) devuelve vacío sin lanzar (DSP-07)', () => {
    let out: Float32Array | undefined;
    expect(() => {
      out = generateWaveformPeaks(mockAudioBuffer(), -4);
    }).not.toThrow();
    expect(out!.length).toBe(0);
    expect(generateWaveformPeaks(mockAudioBuffer(), 0).length).toBe(0);
  });

  it('G2: dbToLinear(NaN) y secondsToSamples(NaN, sr) devuelven finitos (DSP-08)', () => {
    expect(Number.isFinite(dbToLinear(NaN))).toBe(true);
    expect(Number.isFinite(secondsToSamples(NaN, 44100))).toBe(true);
    expect(secondsToSamples(NaN, 44100)).toBe(0);
  });

  it('G2b: guardas hermanas (samplesToSeconds, linear pan) también devuelven finitos', () => {
    expect(samplesToSeconds(NaN, 44100)).toBe(0);
    expect(samplesToSeconds(100, NaN)).toBe(0);
    expect(calculateLinearPan(NaN)).toEqual({ left: 0.5, right: 0.5 });
  });

  it('G3: calculatePeakAndRMS salta muestras no-finitas sin envenenar el RMS (DSP-09)', () => {
    const { peak, rms } = calculatePeakAndRMS(new Float32Array([0.5, NaN, 0.5]));
    expect(peak).toBeCloseTo(0.5, 6);
    expect(Number.isFinite(rms)).toBe(true);
    expect(rms).toBeCloseTo(0.5, 6);
    expect(calculatePeakAndRMS(new Float32Array([NaN, Infinity])).rms).toBe(0);
  });

  it('G4: calculateConstantPowerPan(NaN) devuelve las ganancias de pan 0 (DSP-10)', () => {
    // Pan 0 (centro, potencia constante): left == right == √½. Con NaN el
    // cálculo daba {NaN, NaN} y la pista enmudecía sin error.
    const nan = calculateConstantPowerPan(NaN);
    const center = calculateConstantPowerPan(0);
    expect(nan.left).toBeCloseTo(Math.SQRT1_2, 6);
    expect(nan.right).toBeCloseTo(Math.SQRT1_2, 6);
    expect(nan).toEqual(center);
  });

  it('G5: splitClipOperation(clip, NaN) devuelve null (AUD-12)', () => {
    expect(splitClipOperation(mockClip(), NaN)).toBeNull();
  });

  it('G6: trimLeft/RightOperation(clip, NaN) devuelven el clip intacto (AUD-12)', () => {
    const clip = mockClip();
    expect(trimLeftOperation(clip, NaN)).toEqual(clip);
    expect(trimRightOperation(clip, NaN)).toEqual(clip);
  });

  it('G7: el muxor ADTS mapea 8 canales a channel_config 7 (AAC-06)', () => {
    const payload = new Uint8Array([9, 9, 9]);
    const frame = muxAdtsFrame(payload, { sampleRate: 44100, numberOfChannels: 8 });
    const h = parseAdtsHeader(frame);
    expect(h.channels).toBe(8);
    // Config cruda en cabecera: 7 (el valor 0 anterior era reservado/inválido).
    const rawCfg = (((frame[2] ?? 0) & 0x01) << 2) | (((frame[3] ?? 0) >> 6) & 0x03);
    expect(rawCfg).toBe(7);
  });
});
