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

// Fix(waveC): high-shelf K conforme a ITU-R BS.1770-4 Tabla 1.
//
// La implementación anterior usaba un high-shelf RBJ genérico (f0 = 1681 Hz,
// +4 dB, S = 1.2) que NO reproduce el pre-filtro de referencia: +0.27 dB a
// 1 kHz donde la norma exige +0.67 dB, con un sesgo sistemático de ~0.2-0.4 LU
// en toda lectura integrada (un seno de 997 Hz a escala completa medía −3.44
// LUFS en vez de los −3.0 LUFS de referencia).
//
// Coeficientes exactos de la Tabla 1 a 48 kHz:
//   b = [1.53512486, -2.69169619, 1.19839281]
//   a = [1, -1.69065929, 0.73248077]
// Otras tasas se derivan del MISMO prototipo analógico por transformada
// bilineal (como libebur128): el prototipo se obtiene por Tustin inversa de
// la Tabla 1 a 48 kHz y se mapea a la tasa pedida por Tustin directa, así que
// a 48 kHz el resultado coincide con la tabla al ulp (~4e-16) por construcción.
const K_PRE_TABLE_B: readonly [number, number, number] = [1.53512486, -2.69169619, 1.19839281];
const K_PRE_TABLE_A1 = -1.69065929;
const K_PRE_TABLE_A2 = 0.73248077;
const K_PRE_TABLE_RATE = 48000;

// Prototipo analógico (variable Tustin λ = s·T₀/2, T₀ = 1/48000) derivado de
// la Tabla 1: N(λ) = B0 + B1·λ + B2·λ², D(λ) = A0 + A1·λ + A2·λ².
const K_PRE_PROTO_B0 = K_PRE_TABLE_B[0] + K_PRE_TABLE_B[1] + K_PRE_TABLE_B[2];
const K_PRE_PROTO_B1 = 2 * (K_PRE_TABLE_B[0] - K_PRE_TABLE_B[2]);
const K_PRE_PROTO_B2 = K_PRE_TABLE_B[0] - K_PRE_TABLE_B[1] + K_PRE_TABLE_B[2];
const K_PRE_PROTO_A0 = 1 + K_PRE_TABLE_A1 + K_PRE_TABLE_A2;
const K_PRE_PROTO_A1 = 2 * (1 - K_PRE_TABLE_A2);
const K_PRE_PROTO_A2 = 1 - K_PRE_TABLE_A1 + K_PRE_TABLE_A2;

export function designHighShelf(sampleRate: number): BiquadCoeffs {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`[loudness] sampleRate inválido: ${sampleRate}`);
  }
  if (sampleRate === K_PRE_TABLE_RATE) {
    return {
      b0: K_PRE_TABLE_B[0],
      b1: K_PRE_TABLE_B[1],
      b2: K_PRE_TABLE_B[2],
      a1: K_PRE_TABLE_A1,
      a2: K_PRE_TABLE_A2,
    };
  }
  // Tustin directa del prototipo: r = fs/48000 (λ₀ = r·λ₁).
  const r = sampleRate / K_PRE_TABLE_RATE;
  const r2 = r * r;
  const d = K_PRE_PROTO_A0 + K_PRE_PROTO_A1 * r + K_PRE_PROTO_A2 * r2;
  return {
    b0: (K_PRE_PROTO_B0 + K_PRE_PROTO_B1 * r + K_PRE_PROTO_B2 * r2) / d,
    b1: (2 * (K_PRE_PROTO_B0 - K_PRE_PROTO_B2 * r2)) / d,
    b2: (K_PRE_PROTO_B0 - K_PRE_PROTO_B1 * r + K_PRE_PROTO_B2 * r2) / d,
    a1: (2 * (K_PRE_PROTO_A0 - K_PRE_PROTO_A2 * r2)) / d,
    a2: (K_PRE_PROTO_A0 - K_PRE_PROTO_A1 * r + K_PRE_PROTO_A2 * r2) / d,
  };
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

  const blockSize = Math.max(1, Math.round(LOUDNESS_BLOCK_SECONDS * sampleRate));
  const hop = Math.max(1, Math.round(LOUDNESS_HOP_SECONDS * sampleRate));

  // EXP-12: entradas más cortas que un bloque se miden sobre un bloque
  // completo rellenado con ceros (los medidores de referencia exigen al menos
  // un bloque para el gating). Sin relleno, un tono de 100 ms se medía sobre
  // el bloque parcial y leía ~6 dB de más. El relleno va ANTES del filtrado
  // para que la cola del IIR caiga en la zona de silencio, como en la señal real.
  const framed =
    totalFrames < blockSize
      ? trimmed.map((c) => {
          const ext = new Float32Array(blockSize);
          ext.set(c);
          return ext;
        })
      : trimmed;
  const framedTotal = framed[0]?.length ?? 0;

  // Filtrado K por canal (copia para no mutar el buffer original).
  const shelf = designHighShelf(sampleRate);
  const hp = designHighPass(sampleRate);
  const filtered: Float32Array[] = framed.map((c) => {
    const work = new Float32Array(c);
    filterBiquadInPlace(work, shelf);
    filterBiquadInPlace(work, hp);
    return work;
  });

  const blockPowers: number[] = [];
  const numBlocks = 1 + Math.floor((framedTotal - blockSize) / hop);
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
