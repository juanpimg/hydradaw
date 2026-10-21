/**
 * High-performance audio waveform utilities
 */

/**
 * M4: presupuesto de importación de audio (mismo patrón que
 * `MAX_IMPORT_FILE_BYTES` en `App.tsx`): `decodeAudioFile` rechaza blobs por
 * encima de 25 MB ANTES de `arrayBuffer()` (leerlos enteros a memoria y
 * decodificarlos congelaría la pestaña). `importAudioFiles` ya convierte el
 * rechazo en clip fallido con toast, sin interrumpir el lote.
 */
export const MAX_AUDIO_FILE_BYTES = 25 * 1024 * 1024;

// Fix(waveA): PRNG determinista para el ruido de la demo (demo reproducible).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fix(waveA): pico objetivo tras normalizar la demo (evita clipeo por acumulación).
export const DEMO_TARGET_PEAK = 0.89;

// Fix(waveA): semilla fija del ruido de la demo (misma entrada -> mismo buffer).
export const DEMO_NOISE_SEED = 0x2f6e2b1;

/**
 * Computes min/max peak pairs for rendering at 60 FPS
 * @param buffer AudioBuffer to extract peaks from
 * @param targetPoints Number of peak pairs to generate (e.g. 1000 for standard timeline clip)
 *
 * Fix(waveA): aproximación stride-4 — dentro de cada bloque solo se muestrea 1 de
 * cada 4 muestras para ir ~4x más rápido. Es una aproximación visual: puede pasar
 * por alto transitorios estrechos (< 4 muestras), aceptable para render 60 FPS
 * pero no para medición de pico real.
 */
export function generateWaveformPeaks(buffer: AudioBuffer, targetPoints: number = 800): Float32Array {
  // DSP-07: la guarda va ANTES de asignar — `new Float32Array(n * 2)` con
  // n negativo lanzaba RangeError y un solo número malo tumbaba el proyecto.
  if (!Number.isFinite(targetPoints) || targetPoints <= 0) {
    return new Float32Array(0);
  }
  const points = Math.floor(targetPoints);
  const peaks = new Float32Array(points * 2);
  const channels = buffer.numberOfChannels;
  const channelData: Float32Array[] = [];

  for (let c = 0; c < channels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  const length = buffer.length;
  if (length <= 0) {
    return peaks;
  }

  // Fix(waveA): blockSize = max(1, ...) para que los clips cortos (length < targetPoints)
  // no devuelvan ceros por el early-return anterior.
  const blockSize = Math.max(1, Math.floor(length / points));

  for (let i = 0; i < points; i++) {
    let start = i * blockSize;
    // Fix(waveA): saturar los bins que caen más allá del buffer al último sample
    // para no dejar ceros en la cola de clips cortos.
    if (start >= length) {
      start = length - 1;
    }
    // Fix(waveA): el último bin absorbe el resto parcial final (length no múltiplo de blockSize).
    let end = Math.min(start + blockSize, length);
    if (i === points - 1) {
      end = length;
    }

    let min = 1.0;
    let max = -1.0;

    for (let c = 0; c < channels; c++) {
      // Fix(waveB-ts): c < channels por construcción; guard solo para el tipo.
      const data = channelData[c];
      if (data === undefined) continue;
      for (let j = start; j < end; j += 4) { // stride 4 for ultra-fast approximation
        const val = data[j] ?? 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }

    if (min > 0) min = 0;
    if (max < 0) max = 0;

    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }

  return peaks;
}

/**
 * Decodes an audio File / Blob into an AudioBuffer
 */
export async function decodeAudioFile(file: Blob, audioContext: BaseAudioContext): Promise<AudioBuffer> {
  // M4: puerta de tamaño antes de leer nada a memoria.
  if (typeof file.size === 'number' && file.size > MAX_AUDIO_FILE_BYTES) {
    throw new Error(
      `El archivo de audio es demasiado grande (límite ${MAX_AUDIO_FILE_BYTES / 1048576} MB).`,
    );
  }
  const arrayBuffer = await file.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

/**
 * Generates synthetic high-quality demo audio stems (Drums, Bass, Chords, Vocal Lead)
 * allows instant testing without needing external sample downloads
 *
 * Fix(waveA): ruido determinista (semilla fija) + normalización del pico final a
 * ~0.89 para que la acumulación de capas no clipee (>= 1.0).
 */
export function generateDemoTrackBuffer(
  context: BaseAudioContext,
  type: 'drums' | 'bass' | 'chords' | 'lead',
  durationSec: number = 8,
  bpm: number = 120
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const buffer = context.createBuffer(2, totalSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Fix(waveA): RNG con semilla fija — la demo es reproducible entre sesiones.
  const rng = mulberry32(DEMO_NOISE_SEED);

  const beatDuration = 60 / bpm;
  const totalBeats = Math.floor(durationSec / beatDuration);

  for (let beat = 0; beat < totalBeats; beat++) {
    const beatStart = Math.floor(beat * beatDuration * sampleRate);

    if (type === 'drums') {
      // Kick on 0, 2, 4... Snare on 1, 3...
      const isKick = beat % 2 === 0;
      const soundLength = Math.floor((isKick ? 0.3 : 0.2) * sampleRate);
      for (let i = 0; i < soundLength && beatStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * (isKick ? 15 : 25));
        let sample = 0;
        if (isKick) {
          const freq = 120 * Math.exp(-t * 20) + 45;
          sample = Math.sin(2 * Math.PI * freq * t) * env * 0.9;
        } else {
          // Snare: noise + body tone
          const noise = (rng() * 2 - 1) * 0.7;
          const tone = Math.sin(2 * Math.PI * 180 * t) * 0.5;
          sample = (noise + tone) * env * 0.7;
        }
        // Fix(waveB-ts): noUncheckedIndexedAccess → lectura indexada es number|undefined.
        left[beatStart + i] = (left[beatStart + i] ?? 0) + sample;
        right[beatStart + i] = (right[beatStart + i] ?? 0) + sample;
      }

      // Hi-hat on every 8th note
      const eighthStart = beatStart + Math.floor((beatDuration / 2) * sampleRate);
      const hatLength = Math.floor(0.05 * sampleRate);
      for (let i = 0; i < hatLength && eighthStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 80);
        const hat = (rng() * 2 - 1) * env * 0.3;
        // Fix(waveB-ts): noUncheckedIndexedAccess → lectura indexada es number|undefined.
        left[eighthStart + i] = (left[eighthStart + i] ?? 0) + hat;
        right[eighthStart + i] = (right[eighthStart + i] ?? 0) + hat;
      }
    } else if (type === 'bass') {
      // 808 / Synth Bass line
      const notes = [55, 55, 65.4, 73.4, 49]; // A1, C2, D2, G1
      // Fix(waveB-ts): índice siempre en rango; ?? 55 solo para el tipo.
      const freq = notes[beat % notes.length] ?? 55;
      const soundLength = Math.floor(beatDuration * 0.9 * sampleRate);
      for (let i = 0; i < soundLength && beatStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 50) * Math.exp(-t * 1.5);
        // Sawtooth + sub sine
        const sub = Math.sin(2 * Math.PI * (freq / 2) * t) * 0.5;
        const main = (2 * ((freq * t) % 1) - 1) * 0.3;
        const sample = (sub + main) * env * 0.7;
        // Fix(waveB-ts): noUncheckedIndexedAccess → lectura indexada es number|undefined.
        left[beatStart + i] = (left[beatStart + i] ?? 0) + sample;
        right[beatStart + i] = (right[beatStart + i] ?? 0) + sample;
      }
    } else if (type === 'chords') {
      // Warm Analog Pad / Synth chords
      const chords = [
        [220, 261.6, 329.6], // Am
        [174.6, 220, 261.6], // F
        [261.6, 329.6, 392], // C
        [196, 246.9, 293.7]  // G
      ];
      // Fix(waveB-ts): índice siempre en rango; ?? [] solo para el tipo.
      const chord = chords[Math.floor(beat / 2) % chords.length] ?? [];
      const soundLength = Math.floor(beatDuration * 1.8 * sampleRate);
      for (let i = 0; i < soundLength && beatStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.sin((Math.PI * i) / soundLength) * 0.4;
        let sLeft = 0;
        let sRight = 0;
        chord.forEach((f) => {
          // Slight detune for stereo width
          sLeft += Math.sin(2 * Math.PI * (f * 1.002) * t) * 0.25;
          sRight += Math.sin(2 * Math.PI * (f * 0.998) * t) * 0.25;
        });
        left[beatStart + i] = (left[beatStart + i] ?? 0) + sLeft * env;
        right[beatStart + i] = (right[beatStart + i] ?? 0) + sRight * env;
      }
    } else if (type === 'lead') {
      // Vocal Melodic Lead Synth
      const melody = [440, 523.25, 659.25, 587.33, 440, 659.25, 783.99, 659.25];
      // Fix(waveB-ts): índice siempre en rango; ?? 440 solo para el tipo.
      const freq = melody[beat % melody.length] ?? 440;
      const soundLength = Math.floor(beatDuration * 0.85 * sampleRate);
      for (let i = 0; i < soundLength && beatStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 100) * Math.exp(-t * 2);
        const vibrato = Math.sin(2 * Math.PI * 5 * t) * 4;
        const sample = Math.sin(2 * Math.PI * (freq + vibrato) * t) * env * 0.5;
        // Fix(waveB-ts): noUncheckedIndexedAccess → lectura indexada es number|undefined.
        left[beatStart + i] = (left[beatStart + i] ?? 0) + sample * 0.8;
        right[beatStart + i] = (right[beatStart + i] ?? 0) + sample * 1.0;
      }
    }
  }

  // Fix(waveA): normalizar el pico final a ~0.89 (la acumulación de capas clipeaba).
  let peak = 0;
  for (let i = 0; i < totalSamples; i++) {
    // Fix(waveB-ts): noUncheckedIndexedAccess → índice tipado como number|undefined.
    const a = Math.abs(left[i] ?? 0);
    if (a > peak) peak = a;
    const b = Math.abs(right[i] ?? 0);
    if (b > peak) peak = b;
  }
  if (peak > DEMO_TARGET_PEAK && peak > 0) {
    const gain = DEMO_TARGET_PEAK / peak;
    for (let i = 0; i < totalSamples; i++) {
      // Fix(waveB-ts): noUncheckedIndexedAccess → lectura indexada es number|undefined.
      left[i] = (left[i] ?? 0) * gain;
      right[i] = (right[i] ?? 0) * gain;
    }
  }

  return buffer;
}
