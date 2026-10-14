import { describe, it, expect } from 'vitest';
import {
  measureLoudness,
  designHighShelf,
  designHighPass,
  computeNormalizeGain,
  applyGainInPlace,
  NORMALIZE_TARGET_LUFS,
  type LoudnessInput,
} from './loudness';

// Fix(waveC): buffer duck-typed mínimo (sin instanceof AudioBuffer).
function makeMonoSine(
  sampleRate: number,
  seconds: number,
  freqHz: number,
  peakAmp: number,
): LoudnessInput {
  const length = Math.round(sampleRate * seconds);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * peakAmp;
  }
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    getChannelData: (ch: number) => {
      if (ch !== 0) throw new Error('canal fuera de rango');
      return data as unknown as { length: number; [index: number]: number };
    },
  };
}

function makeSilence(sampleRate: number, seconds: number, channels = 1): LoudnessInput {
  const length = Math.round(sampleRate * seconds);
  const datas = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData: (ch: number) => {
      const d = datas[ch];
      if (!d) throw new Error('canal fuera de rango');
      return d as unknown as { length: number; [index: number]: number };
    },
  };
}

describe('loudness BS.1770 (K + gating)', () => {
  it('seno 997Hz a -3.01dBFS RMS → integrada ≈ -3.7 LUFS (±0.5)', () => {
    // Pico 1.0 → RMS = 1/sqrt(2) = -3.01 dBFS; K a 1kHz ≈ +0dB → LUFS ≈ -0.691 - 3.01.
    const buf = makeMonoSine(48000, 2, 997, 1.0);
    const m = measureLoudness(buf);
    expect(m.integratedLUFS).toBeGreaterThan(-4.2);
    expect(m.integratedLUFS).toBeLessThan(-3.2);
    expect(m.peak).toBeCloseTo(1.0, 2);
    // True peak ESTIMADO por sobremuestreo lineal ×4: cercano al pico.
    expect(m.truePeakEstimate).toBeGreaterThanOrEqual(m.peak - 1e-6);
    expect(m.truePeakEstimate).toBeLessThan(1.05);
  });

  it('misma señal a 44100Hz da el mismo orden de magnitud (coefs por sampleRate)', () => {
    const m48 = measureLoudness(makeMonoSine(48000, 2, 997, 1.0));
    const m44 = measureLoudness(makeMonoSine(44100, 2, 997, 1.0));
    expect(Math.abs(m48.integratedLUFS - m44.integratedLUFS)).toBeLessThan(1.0);
    // Los coeficientes se diseñan por sampleRate, no hardcodeados a 48k.
    const s48 = designHighShelf(48000);
    const s44 = designHighShelf(44100);
    expect(s48.b0).not.toBeCloseTo(s44.b0, 6);
    const h48 = designHighPass(48000);
    const h44 = designHighPass(44100);
    expect(h48.b0).not.toBeCloseTo(h44.b0, 6);
  });

  it('gating: segmentos de silencio no hunden la integrada', () => {
    const sineOnly = makeMonoSine(48000, 2, 997, 1.0);
    const ref = measureLoudness(sineOnly);
    // 2s seno + 2s silencio: sin gating caería ~3dB; con gating queda cerca.
    const sr = 48000;
    const lenSine = sr * 2;
    const lenTotal = sr * 4;
    const data = new Float32Array(lenTotal);
    for (let i = 0; i < lenSine; i++) {
      data[i] = Math.sin((2 * Math.PI * 997 * i) / sr);
    }
    const mixed: LoudnessInput = {
      sampleRate: sr,
      numberOfChannels: 1,
      length: lenTotal,
      getChannelData: () => data as unknown as { length: number; [index: number]: number },
    };
    const m = measureLoudness(mixed);
    expect(Math.abs(m.integratedLUFS - ref.integratedLUFS)).toBeLessThan(1.0);
  });

  it('silencio → -Infinity, pico 0', () => {
    const m = measureLoudness(makeSilence(48000, 1));
    expect(m.integratedLUFS).toBe(-Infinity);
    expect(m.peak).toBe(0);
    expect(m.truePeakEstimate).toBe(0);
  });

  it('acepta AudioBuffer real vía duck-typing (sin numberOfChannels)', () => {
    const inner = makeMonoSine(44100, 1, 997, 0.5);
    const duck = {
      sampleRate: 44100,
      getChannelData: (ch: number) => inner.getChannelData(ch),
    };
    const m = measureLoudness(duck);
    expect(Number.isFinite(m.integratedLUFS)).toBe(true);
  });
});

describe('normalización a -14 LUFS', () => {
  it('ganancia = target − medida (caso atenuación)', () => {
    const plan = computeNormalizeGain(-10, 0.5, NORMALIZE_TARGET_LUFS, 12);
    expect(plan.gainDb).toBeCloseTo(-4, 9);
    expect(plan.gainLinear).toBeCloseTo(Math.pow(10, -4 / 20), 6);
    expect(plan.limitedByCap).toBe(false);
    expect(plan.wouldClip).toBe(false);
  });

  it('tope +12dB y aviso de clipping', () => {
    const plan = computeNormalizeGain(-30, 0.5);
    expect(plan.limitedByCap).toBe(true);
    expect(plan.gainDb).toBeCloseTo(12, 9);
    expect(plan.wouldClip).toBe(true);
    // Sin riesgo de clip si el pico es bajo.
    const safe = computeNormalizeGain(-20, 0.1);
    expect(safe.gainDb).toBeCloseTo(6, 9);
    expect(safe.wouldClip).toBe(false);
  });

  it('silencio no se normaliza (ganancia 0)', () => {
    const plan = computeNormalizeGain(-Infinity, 0);
    expect(plan.gainDb).toBe(0);
    expect(plan.gainLinear).toBe(1);
  });

  it('applyGainInPlace multiplica antes de codificar', () => {
    const buf = makeMonoSine(44100, 0.1, 997, 0.5);
    const before = measureLoudness(buf);
    applyGainInPlace(buf, 2);
    const after = measureLoudness(buf);
    expect(after.peak).toBeCloseTo(before.peak * 2, 5);
    expect(after.integratedLUFS).toBeCloseTo(before.integratedLUFS + 6.0206, 1);
  });

  it('detecta inter-sample peaks (True Peak > pico de muestra digital)', () => {
    // Señal a fs/4 (12000Hz a 48kHz) con desfase pi/4: muestras pico ≈ 0.7071
    // La onda continua subyacente tiene pico analógico de 1.0 (+3 dB sobre las muestras)
    const sr = 48000;
    const length = 4800;
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = Math.sin((2 * Math.PI * 12000 * i) / sr + Math.PI / 4);
    }
    const buf: LoudnessInput = {
      sampleRate: sr,
      numberOfChannels: 1,
      length,
      getChannelData: () => data as unknown as { length: number; [index: number]: number },
    };
    const m = measureLoudness(buf);
    expect(m.peak).toBeCloseTo(Math.SQRT1_2, 2); // ~0.7071
    // El interpolador polifase BS.1770 debe reconstruir el pico analógico cercano a 1.0 (> 0.90)
    expect(m.truePeakEstimate).toBeGreaterThan(m.peak + 0.15);
    expect(m.truePeakEstimate).toBeLessThanOrEqual(1.05);
  });
});
