/**
 * High-speed offline WAV encoder & mixdown renderer
 */

// Fix(waveB): nº de muestras (frames × canales) por chunk del exporter
// cooperativo. 1M muestras ≈ 2 MB en 16-bit estéreo: cada chunk tarda unos
// pocos ms y cede el event loop entre chunks.
export const WAV_ASYNC_CHUNK_SAMPLES = 1_000_000;

// Fix(waveB): retardo de revocación de URLs de descarga (antes 100 ms, que
// podía invalidar la descarga antes de que el navegador la iniciase).
export const DOWNLOAD_URL_REVOKE_MS = 30_000;

interface WavAllocation {
  arrayBuffer: ArrayBuffer;
  view: DataView;
  channels: Float32Array[];
  numChannels: number;
  length: number;
}

// Fix(waveB): cabecera RIFF/fmt/data idéntica byte a byte a la anterior,
// extraída para compartirla entre la vía síncrona y la asíncrona.
function allocWav(audioBuffer: AudioBuffer, bitDepth: 16 | 24 | 32): WavAllocation {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  // EXP-04: alineación de palabra RIFF. Con dataSize impar (p. ej. 24-bit
  // mono con nº impar de frames) el archivo mediría un nº impar de bytes y
  // los importadores estrictos lo rechazan: se añade un byte de padding a 0
  // y el tamaño RIFF pasa a 37 + dataSize (36 + dataSize + 1 de pad).
  // El campo dataSize (subchunk2Size) queda intacto. El ArrayBuffer ya viene
  // a ceros, así que el pad queda a 0 sin escritura explícita.
  const padBytes = dataSize % 2;
  const bufferSize = 44 + dataSize + padBytes;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  // Helper to write ASCII strings
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /* RIFF chunk descriptor */
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize + padBytes, true); // chunkSize (36 + dataSize [+ pad])
  writeString(8, 'WAVE');

  /* FMT sub-chunk */
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);           // subchunk1Size (16 for PCM / IEEE Float)
  // Format code: 1 = WAVE_FORMAT_PCM (16/24-bit), 3 = WAVE_FORMAT_IEEE_FLOAT (32-bit float)
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, numChannels, true);  // numChannels
  view.setUint32(24, sampleRate, true);   // sampleRate
  view.setUint32(28, byteRate, true);     // byteRate
  view.setUint16(32, blockAlign, true);   // blockAlign
  view.setUint16(34, bitDepth, true);     // bitsPerSample

  /* Data sub-chunk */
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);     // subchunk2Size

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  return { arrayBuffer, view, channels, numChannels, length };
}

// Fix(waveB): bloque 16-bit por vista tipada Int16Array (1 store por muestra
// en lugar de 1 llamada DataView.setInt16 por muestra) + Math.round simétrico
// en vez de Math.floor (floor sesgaba −1 LSB en negativos y truncaba en
// positivos). Rango clampado a [-1, 1]; el store Int16Array recibe un entero
// ya redondeado, sin cambio de formato (LE, mismos tamaños).
function encodePcm16Frames(
  out: Int16Array,
  channels: Float32Array[],
  numChannels: number,
  startFrame: number,
  endFrame: number,
): void {
  let idx = startFrame * numChannels;
  for (let i = startFrame; i < endFrame; i++) {
    for (let c = 0; c < numChannels; c++) {
      // Fix(waveB-ts): noUncheckedIndexedAccess → canal/muestra pueden ser undefined en tipo.
      const sample = channels[c]?.[i] ?? 0;
      // Clamp to [-1.0, 1.0]
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      // Scale to 16-bit signed integer
      out[idx++] = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF);
    }
  }
}

// Fix(waveB): bloque 24-bit por vista Uint8Array directa (3 stores por
// muestra en lugar de 3 llamadas DataView.setUint8) + Math.round simétrico.
// Empaquetado 3-byte little-endian idéntico al anterior.
function encodePcm24Frames(
  bytes: Uint8Array,
  channels: Float32Array[],
  numChannels: number,
  startFrame: number,
  endFrame: number,
): void {
  let offset = 44 + startFrame * numChannels * 3;
  for (let i = startFrame; i < endFrame; i++) {
    for (let c = 0; c < numChannels; c++) {
      // Fix(waveB-ts): noUncheckedIndexedAccess → canal/muestra pueden ser undefined en tipo.
      const sample = channels[c]?.[i] ?? 0;
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      const int24 = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7FFFFF);
      bytes[offset] = int24 & 0xFF;
      bytes[offset + 1] = (int24 >> 8) & 0xFF;
      bytes[offset + 2] = (int24 >> 16) & 0xFF;
      offset += 3;
    }
  }
}

// Fix(waveB): bloque 32-bit float por vista Float32Array (1 store por muestra
// en lugar de 1 llamada DataView.setFloat32). Sin clamp: conserva headroom
// por encima de 0 dBFS, igual que antes.
function encodeFloat32Frames(
  out: Float32Array,
  channels: Float32Array[],
  numChannels: number,
  startFrame: number,
  endFrame: number,
): void {
  let idx = startFrame * numChannels;
  for (let i = startFrame; i < endFrame; i++) {
    for (let c = 0; c < numChannels; c++) {
      // Fix(waveB-ts): noUncheckedIndexedAccess → canal/muestra pueden ser undefined en tipo.
      out[idx++] = channels[c]?.[i] ?? 0;
    }
  }
}

/**
 * Encodes an AudioBuffer into standard RIFF WAV format (16-bit, 24-bit PCM, or 32-bit IEEE Float)
 */
export function encodeWav(audioBuffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Uint8Array {
  const { arrayBuffer, channels, numChannels, length } = allocWav(audioBuffer, bitDepth);

  if (bitDepth === 16) {
    // Fix(waveB): offset 44 par → alineado para Int16Array; LE en x86/ARM.
    encodePcm16Frames(new Int16Array(arrayBuffer, 44, length * numChannels), channels, numChannels, 0, length);
  } else if (bitDepth === 24) {
    // 24-bit PCM
    encodePcm24Frames(new Uint8Array(arrayBuffer), channels, numChannels, 0, length);
  } else if (bitDepth === 32) {
    // 32-bit IEEE 754 Float PCM
    // Fix(waveB): offset 44 múltiplo de 4 → alineado para Float32Array.
    encodeFloat32Frames(new Float32Array(arrayBuffer, 44, length * numChannels), channels, numChannels, 0, length);
  }

  return new Uint8Array(arrayBuffer);
}

/**
 * Fix(waveB): exporter cooperativo por chunks para mixdowns largos.
 * Codifica los mismos bytes que `encodeWav` pero cede el event loop con
 * `setTimeout(..., 0)` cada ~1M muestras para no bloquear la UI durante
 * segundos (p. ej. 5 min estéreo ≈ 26M muestras).
 *
 * Cuándo usar cada una:
 * - `encodeWav` (síncrona): clips cortos y llamadas existentes
 *   (persistence sigue con la síncrona para clips cortos; ExportModal usa la asíncrona).
 * - `encodeWavAsync`: bounces largos donde el bloqueo del hilo principal
 *   sería perceptible; `onProgress(encodedFrames, totalFrames)` permite
 *   barra de progreso. No cambia la firma de `encodeWav`.
 */
export async function encodeWavAsync(
  audioBuffer: AudioBuffer,
  bitDepth: 16 | 24 | 32 = 16,
  onProgress?: (encodedFrames: number, totalFrames: number) => void,
): Promise<Uint8Array> {
  const { arrayBuffer, channels, numChannels, length } = allocWav(audioBuffer, bitDepth);

  if (length === 0) {
    onProgress?.(0, 0);
    return new Uint8Array(arrayBuffer);
  }

  const chunkFrames = Math.max(1, Math.floor(WAV_ASYNC_CHUNK_SAMPLES / Math.max(1, numChannels)));
  let out16: Int16Array | null = null;
  let out24: Uint8Array | null = null;
  let out32: Float32Array | null = null;
  if (bitDepth === 16) {
    out16 = new Int16Array(arrayBuffer, 44, length * numChannels);
  } else if (bitDepth === 24) {
    out24 = new Uint8Array(arrayBuffer);
  } else if (bitDepth === 32) {
    out32 = new Float32Array(arrayBuffer, 44, length * numChannels);
  }

  for (let start = 0; start < length; start += chunkFrames) {
    const end = Math.min(start + chunkFrames, length);
    if (out16) {
      encodePcm16Frames(out16, channels, numChannels, start, end);
    } else if (out24) {
      encodePcm24Frames(out24, channels, numChannels, start, end);
    } else if (out32) {
      encodeFloat32Frames(out32, channels, numChannels, start, end);
    }
    onProgress?.(end, length);
    if (end < length) {
      // Fix(waveB): cede el event loop entre chunks (pinta UI, input, etc.).
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return new Uint8Array(arrayBuffer);
}

// Fix(waveB): revocaciones pendientes para la regla de "segundo click": cada
// descarga revoca la URL anterior aún viva, así solo hay una object URL por
// descarga y nunca se acumulan.
const pendingDownloadRevocations: Array<() => void> = [];

/**
 * Triggers browser download for a Blob
 *
 * Fix(waveB): la URL se revoca a los 30 s (antes 100 ms, que podía romper la
 * descarga) o al ocultarse la pestaña (`visibilitychange`), o en la siguiente
 * descarga (segundo click). Guard `settled` → una sola revocación por
 * descarga, sin fugas de listeners (se retiran al revocar).
 */
export function downloadAudioBlob(blob: Blob, filename: string): void {
  // Revoca descargas anteriores aún pendientes (segundo click).
  let prev: (() => void) | undefined;
  while ((prev = pendingDownloadRevocations.pop()) !== undefined) {
    prev();
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Fix(waveB): el <a> oculto se retira pronto; la URL vive aparte (ver abajo).
  setTimeout(() => a.remove(), 1000);

  let settled = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const revoke = () => {
    if (settled) return;
    settled = true;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    document.removeEventListener('visibilitychange', onHidden);
    URL.revokeObjectURL(url);
    const i = pendingDownloadRevocations.indexOf(revoke);
    if (i >= 0) pendingDownloadRevocations.splice(i, 1);
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') revoke();
  };
  document.addEventListener('visibilitychange', onHidden);
  timerId = setTimeout(revoke, DOWNLOAD_URL_REVOKE_MS);
  pendingDownloadRevocations.push(revoke);
}
