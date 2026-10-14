/**
 * Medición de sonoridad integrada estilo ITU-R BS.1770 (K-weighting + gating).
 * TS puro, sin dependencias, testeable en Node.
 */

// Fix(waveC): constantes del algoritmo BS.1770 (bloques 400ms, solape 75%, gating).
export const LOUDNESS_BLOCK_SECONDS = 0.4;
export const LOUDNESS_HOP_SECONDS = 0.1;
export const LOUDNESS_ABSOLUTE_GATE_LUFS = -70;
export const LOUDNESS_RELATIVE_GATE_LU = 10;
export const LOUDNESS_K_SHELF_F0 = 1681;
export const LOUDNESS_K_SHELF_GAIN_DB = 4;
export const LOUDNESS_K_SHELF_SLOPE_S = 1.2;
export const LOUDNESS_RLB_HIGHPASS_F0 = 60;
export const LOUDNESS_RLB_HIGHPASS_Q = 0.70710678;

// Fix(waveC): objetivo de normalización para el modal de export.
export const NORMALIZE_TARGET_LUFS = -14;
export const NORMALIZE_MAX_BOOST_DB = 12;

/** Entrada mínima (duck-typing: acepta AudioBuffer real sin instanceof). */
export interface LoudnessInput {
  sampleRate: number;
  numberOfChannels?: number;
  length?: number;
  getChannelData(channel: number): { length: number; [index: number]: number };
}

export interface LoudnessResult {
  /** Sonoridad integrada en LUFS (-Infinity si silencio/ningún bloque pasa el gate). */
  integratedLUFS: number;
  /** Pico lineal (max abs) del material original, sin ponderar. */
  peak: number;
  /** Estimación de true peak por sobremuestreo lineal ×4 (etiquetar como estimado en UI). */
  truePeakEstimate: number;
}

/** Coeficientes biquad normalizados (a0 = 1). */
export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

// Fix(waveC): high-shelf +4dB estilo K (RBJ cookbook) diseñado para el sampleRate dado.
export function designHighShelf(
  sampleRate: number,
  f0: number = LOUDNESS_K_SHELF_F0,
  gainDb: number = LOUDNESS_K_SHELF_GAIN_DB,
  shelfSlopeS: number = LOUDNESS_K_SHELF_SLOPE_S,
): BiquadCoeffs {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`[loudness] sampleRate inválido: ${sampleRate}`);
  }
  if (!Number.isFinite(f0) || f0 <= 0 || f0 >= sampleRate / 2) {
    throw new Error(`[loudness] f0 de shelf inválida: ${f0} @ ${sampleRate}Hz`);
  }
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const sinW0 = Math.sin(w0);
  const cosW0 = Math.cos(w0);
  const sqrtA = Math.sqrt(A);
  const alpha =
    (sinW0 / 2) * Math.sqrt((A + 1 / A) * (1 / shelfSlopeS - 1) + 2);
  const b0 = A * (A + 1 + (A - 1) * cosW0 + 2 * sqrtA * alpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
  const b2 = A * (A + 1 + (A - 1) * cosW0 - 2 * sqrtA * alpha);
  const a0 = A + 1 - (A - 1) * cosW0 + 2 * sqrtA * alpha;
  const a1 = 2 * (A - 1 - (A + 1) * cosW0);
  const a2 = A + 1 - (A - 1) * cosW0 - 2 * sqrtA * alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// Fix(waveC): high-pass RLB (~60Hz, Butterworth Q≈0.707) diseñado para el sampleRate dado.
export function designHighPass(
  sampleRate: number,
  f0: number = LOUDNESS_RLB_HIGHPASS_F0,
  q: number = LOUDNESS_RLB_HIGHPASS_Q,
): BiquadCoeffs {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`[loudness] sampleRate inválido: ${sampleRate}`);
  }
  if (!Number.isFinite(f0) || f0 <= 0 || f0 >= sampleRate / 2) {
    throw new Error(`[loudness] f0 de high-pass inválida: ${f0} @ ${sampleRate}Hz`);
  }
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);
  const b0 = (1 + cosW0) / 2;
  const b1 = -(1 + cosW0);
  const b2 = (1 + cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// Fix(waveC): biquad Direct Form I in-place (estado cero por canal).
export function filterBiquadInPlace(data: Float32Array, c: BiquadCoeffs): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x0 = data[i] ?? 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    data[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
}

function resolveChannelCount(input: LoudnessInput): number {
  if (
    typeof input.numberOfChannels === 'number' &&
    Number.isFinite(input.numberOfChannels) &&
    input.numberOfChannels > 0
  ) {
    return Math.floor(input.numberOfChannels);
  }
  // Duck-typing: prueba canales hasta que falle.
  let count = 0;
  for (let ch = 0; ch < 32; ch++) {
    try {
      const d = input.getChannelData(ch);
      if (!d || typeof d.length !== 'number') break;
      count++;
    } catch {
      break;
    }
  }
  return count;
}

function blockPowerToLufs(power: number): number {
  if (!(power > 0)) return -Infinity;
  return -0.691 + 10 * Math.log10(power);
}

// Fix(waveC): medición integrada BS.1770 con pre-filtro K por canal + gating en dos pasadas.
export function measureLoudness(buffer: LoudnessInput): LoudnessResult {
  const sampleRate = buffer.sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`[loudness] sampleRate inválido: ${String(sampleRate)}`);
  }
  const numChannels = resolveChannelCount(buffer);
  if (numChannels <= 0) {
    return { integratedLUFS: -Infinity, peak: 0, truePeakEstimate: 0 };
  }

  const channels: Float32Array[] = [];
  let totalFrames = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const raw = buffer.getChannelData(ch) as unknown as Float32Array;
    const copy = raw instanceof Float32Array ? raw : Float32Array.from(raw as ArrayLike<number>);
    channels.push(copy);
    if (ch === 0) totalFrames = copy.length;
    else totalFrames = Math.min(totalFrames, copy.length);
  }
  if (totalFrames <= 0) {
    return { integratedLUFS: -Infinity, peak: 0, truePeakEstimate: 0 };
  }
  // Recorta vistas al mínimo común (canales con longitudes dispares).
  const trimmed = channels.map((c) => c.subarray(0, totalFrames));

  // Medición de True Peak según ITU-R BS.1770-4 (Anexo 2) mediante filtro polifase FIR x4
  let peak = 0;
  for (const data of trimmed) {
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i] ?? 0);
      if (v > peak) peak = v;
    }
  }

  // Coeficientes polifase de 12 taps por sub-fase con ventana Hann/Hamming
  const TAPS = 12;
  const halfTaps = 6;
  const polyphase: number[][] = [[], [], [], []];
  for (let phase = 0; phase < 4; phase++) {
    const offset = phase / 4;
    polyphase[phase] = new Array(TAPS);
    for (let k = 0; k < TAPS; k++) {
      const t = k - halfTaps + 1 - offset;
      if (Math.abs(t) < 1e-7) {
        polyphase[phase]![k] = 1.0;
      } else {
        const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
        const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * (k + 0.5)) / TAPS);
        polyphase[phase]![k] = sinc * win;
      }
    }
  }

  let truePeakEstimate = peak;
  for (const data of trimmed) {
    const len = data.length;
    for (let i = 0; i < len; i++) {
      for (let p = 1; p < 4; p++) {
        const coeffs = polyphase[p]!;
        let sum = 0;
        for (let k = 0; k < TAPS; k++) {
          const sampleIdx = i + (k - halfTaps + 1);
          if (sampleIdx >= 0 && sampleIdx < len) {
            sum += (data[sampleIdx] ?? 0) * coeffs[k]!;
          }
        }
        const absVal = Math.abs(sum);
        if (absVal > truePeakEstimate) truePeakEstimate = absVal;
      }
    }
  }

  // Filtrado K por canal (copia para no mutar el buffer original).
  const shelf = designHighShelf(sampleRate);
  const hp = designHighPass(sampleRate);
  const filtered: Float32Array[] = trimmed.map((c) => {
    const work = new Float32Array(c);
    filterBiquadInPlace(work, shelf);
    filterBiquadInPlace(work, hp);
    return work;
  });

  const blockSize = Math.max(1, Math.round(LOUDNESS_BLOCK_SECONDS * sampleRate));
  const hop = Math.max(1, Math.round(LOUDNESS_HOP_SECONDS * sampleRate));

  const blockPowers: number[] = [];
  if (totalFrames < blockSize) {
    let sum = 0;
    for (const f of filtered) {
      for (let i = 0; i < totalFrames; i++) {
        const v = f[i] ?? 0;
        sum += v * v;
      }
    }
    blockPowers.push(sum / Math.max(1, totalFrames));
  } else {
    const numBlocks = 1 + Math.floor((totalFrames - blockSize) / hop);
    for (let b = 0; b < numBlocks; b++) {
      const start = b * hop;
      let sum = 0;
      for (const f of filtered) {
        for (let i = start; i < start + blockSize; i++) {
          const v = f[i] ?? 0;
          sum += v * v;
        }
      }
      // Suma de medias cuadráticas por canal (G = 1.0 para L/R; estéreo del DAW).
      blockPowers.push(sum / blockSize);
    }
  }

  const absThreshold = Math.pow(10, (LOUDNESS_ABSOLUTE_GATE_LUFS + 0.691) / 10);
  const absGated = blockPowers.filter((p) => p > absThreshold);
  if (absGated.length === 0) {
    return { integratedLUFS: -Infinity, peak, truePeakEstimate };
  }
  const meanAbs = absGated.reduce((a, b) => a + b, 0) / absGated.length;
  const gatedLufs = blockPowerToLufs(meanAbs);
  const relThresholdLufs = gatedLufs - LOUDNESS_RELATIVE_GATE_LU;
  const relThresholdPower = Math.pow(10, (relThresholdLufs + 0.691) / 10);
  const relGated = absGated.filter((p) => blockPowerToLufs(p) > relThresholdLufs);
  const finalPowers = relGated.length > 0 ? relGated : absGated;
  // Evita variable no usada bajo noUnusedLocals (relThresholdPower documenta el umbral lineal).
  void relThresholdPower;
  const meanFinal =
    finalPowers.reduce((a, b) => a + b, 0) / Math.max(1, finalPowers.length);
  return { integratedLUFS: blockPowerToLufs(meanFinal), peak, truePeakEstimate };
}

export interface NormalizePlan {
  gainDb: number;
  gainLinear: number;
  limitedByCap: boolean;
  wouldClip: boolean;
}

// Fix(waveC): ganancia de normalización = target − medida, con tope +12dB.
export function computeNormalizeGain(
  measuredLUFS: number,
  peakLinear: number,
  targetLUFS: number = NORMALIZE_TARGET_LUFS,
  maxBoostDb: number = NORMALIZE_MAX_BOOST_DB,
): NormalizePlan {
  if (!Number.isFinite(measuredLUFS)) {
    // Silencio (−Infinity): no hay nada que normalizar; ganancia 0.
    return { gainDb: 0, gainLinear: 1, limitedByCap: false, wouldClip: false };
  }
  const rawGainDb = targetLUFS - measuredLUFS;
  const limitedByCap = rawGainDb > maxBoostDb;
  const gainDb = limitedByCap ? maxBoostDb : rawGainDb;
  const gainLinear = Math.pow(10, gainDb / 20);
  const peak = Number.isFinite(peakLinear) ? Math.max(0, peakLinear) : 0;
  const wouldClip = peak * gainLinear > 1.0;
  return { gainDb, gainLinear, limitedByCap, wouldClip };
}

// Fix(waveC): aplica ganancia in-place sobre el buffer renderizado antes de codificar.
export function applyGainInPlace(buffer: LoudnessInput, gainLinear: number): void {
  if (!(gainLinear > 0) || !Number.isFinite(gainLinear) || gainLinear === 1) return;
  const numChannels = resolveChannelCount(buffer);
  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch) as unknown as Float32Array;
    for (let i = 0; i < data.length; i++) {
      data[i] = (data[i] ?? 0) * gainLinear;
    }
  }
}
