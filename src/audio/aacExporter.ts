/**
 * Exportación AAC-LC vía WebCodecs AudioEncoder + muxado manual ADTS.
 * Sin dependencias: cabecera ADTS de 7 bytes por frame.
 */

// Fix(waveC): tabla MPEG-4 de índices de sampleRate para ADTS.
export const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
] as const;

export const AAC_CODEC_STRING = 'mp4a.40.2';
export const AAC_DEFAULT_BITRATE = 128_000;
export const AAC_BITRATES = [128_000, 192_000, 256_000] as const;

export interface AdtsFrameConfig {
  sampleRate: number;
  numberOfChannels: number;
}

/** Índice ADTS (0-12) o -1 si la tasa no es muxable en ADTS. */
export function aacSampleRateIndex(sampleRate: number): number {
  return (AAC_SAMPLE_RATES as readonly number[]).indexOf(sampleRate);
}

// Fix(waveC): framing ADTS puro (7 bytes + payload), sin I/O ni WebCodecs.
export function muxAdtsFrame(payload: Uint8Array, config: AdtsFrameConfig): Uint8Array {
  const idx = aacSampleRateIndex(config.sampleRate);
  if (idx < 0) {
    throw new Error(
      `[aac] sampleRate ${config.sampleRate} no muxable en ADTS (soportados: ${AAC_SAMPLE_RATES.join(', ')})`,
    );
  }
  const ch = config.numberOfChannels;
  if (!Number.isInteger(ch) || ch < 1 || ch > 8) {
    throw new Error(`[aac] canales inválidos para ADTS: ${String(ch)} (1-8)`);
  }
  // T40: MPEG-4 Audio no tiene código de 7 canales (channel_config 7
  // significa 8 canales): un stream genuino de 7 canales se rechaza en vez
  // de escribir un 7 que el parser releería como 8 (mezcla silenciosa).
  if (ch === 7) {
    throw new Error('[aac] 7 canales no muxable en ADTS: MPEG-4 Audio no tiene código de 7 canales (channel_config 7 significa 8); usa 6 u 8 canales.');
  }
  // AAC-06: channel_configuration es un campo de 3 bits donde 7 significa
  // 8 canales (MPEG-4 Audio). Escribir 8 en crudo truncaba a 0 (reservado).
  const channelConfig = ch === 8 ? 7 : ch;
  const frameLength = 7 + payload.length;
  if (frameLength > 0x1fff) {
    throw new Error(`[aac] frame ADTS demasiado grande (${frameLength} > 8191 bytes)`);
  }
  const out = new Uint8Array(frameLength);
  // Byte 0-1: syncword 0xFFF + MPEG-4 (ID=0) + layer 00 + protection_absent 1.
  out[0] = 0xff;
  out[1] = 0xf1;
  // Byte 2: perfil LC (1) + índice de tasa + private 0 + bit alto de canales.
  out[2] = (1 << 6) | (idx << 2) | ((channelConfig >> 2) & 0x01);
  // Byte 3: 2 bits bajos de canales + 2 bits altos de frame_length.
  out[3] = ((channelConfig & 0x03) << 6) | ((frameLength >> 11) & 0x03);
  // Byte 4: 8 bits medios de frame_length.
  out[4] = (frameLength >> 3) & 0xff;
  // Byte 5-6: 3 bits bajos de frame_length + fullness VBR 0x7FF + 0 bloques extra.
  out[5] = (((frameLength & 0x07) << 5) | 0x1f) & 0xff;
  out[6] = 0xfc;
  out.set(payload, 7);
  return out;
}

export interface ParsedAdtsHeader {
  syncword: number;
  profile: number;
  sampleRateIndex: number;
  sampleRate: number;
  channels: number;
  frameLength: number;
}

// Fix(waveC): parser mínimo para validar/tests (no depende de WebCodecs).
export function parseAdtsHeader(frame: Uint8Array): ParsedAdtsHeader {
  if (frame.length < 7) throw new Error('[aac] frame ADTS demasiado corto (<7 bytes)');
  const b0 = frame[0] ?? 0;
  const b1 = frame[1] ?? 0;
  const b2 = frame[2] ?? 0;
  const b3 = frame[3] ?? 0;
  const b4 = frame[4] ?? 0;
  const b5 = frame[5] ?? 0;
  const syncword = (b0 << 4) | ((b1 >> 4) & 0x0f);
  const profile = (b2 >> 6) & 0x03;
  const sampleRateIndex = (b2 >> 2) & 0x0f;
  const rawChannels = (((b2 & 0x01) << 2) | ((b3 >> 6) & 0x03)) as number;
  // AAC-06: channel_configuration 7 significa 8 canales (ver muxAdtsFrame).
  const channels = rawChannels === 7 ? 8 : rawChannels;
  const frameLength = (((b3 & 0x03) << 11) | (b4 << 3) | ((b5 >> 5) & 0x07)) as number;
  const sampleRate = (AAC_SAMPLE_RATES as readonly number[])[sampleRateIndex] ?? 0;
  return { syncword, profile, sampleRateIndex, sampleRate, channels, frameLength };
}

interface AacInput {
  sampleRate: number;
  numberOfChannels?: number;
  length?: number;
  getChannelData(channel: number): { length: number; [index: number]: number };
}

function resolveAacChannels(input: AacInput): number {
  if (
    typeof input.numberOfChannels === 'number' &&
    Number.isFinite(input.numberOfChannels) &&
    input.numberOfChannels > 0
  ) {
    return Math.floor(input.numberOfChannels);
  }
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

type AudioEncoderCtor = new (init: {
  output: (chunk: { byteLength: number; copyTo: (dest: Uint8Array) => void }, meta?: unknown) => void;
  error: (e: Error) => void;
}) => {
  configure: (config: unknown) => void;
  encode: (data: { close: () => void }) => void;
  flush: () => Promise<void>;
  close: () => void;
};

function getAudioEncoderCtor(): AudioEncoderCtor | null {
  const g = globalThis as unknown as { AudioEncoder?: AudioEncoderCtor };
  return typeof g.AudioEncoder !== 'undefined' ? (g.AudioEncoder ?? null) : null;
}

// Fix(waveC): soporte AAC vía AudioEncoder.isConfigSupported (false sin WebCodecs, p. ej. Safari).
export async function isAacSupported(opts?: {
  sampleRate?: number;
  numberOfChannels?: number;
  bitrate?: number;
}): Promise<boolean> {
  const Ctor = getAudioEncoderCtor() as unknown as {
    isConfigSupported?: (config: unknown) => Promise<{ supported: boolean }>;
  } | null;
  if (!Ctor || typeof Ctor.isConfigSupported !== 'function') return false;
  const config = {
    codec: AAC_CODEC_STRING,
    sampleRate: opts?.sampleRate ?? 44100,
    numberOfChannels: opts?.numberOfChannels ?? 2,
    bitrate: opts?.bitrate ?? AAC_DEFAULT_BITRATE,
  };
  try {
    const res = await Ctor.isConfigSupported(config);
    return res.supported === true;
  } catch {
    return false;
  }
}

export interface AacEncodeOptions {
  bitrate?: number;
}

// Fix(waveC): capa fina async WebCodecs; el framing ADTS vive en muxAdtsFrame (puro/testeado).
export async function encodeAacAdts(
  buffer: AacInput,
  opts?: AacEncodeOptions,
): Promise<Uint8Array> {
  const sampleRate = buffer.sampleRate;
  const numChannels = resolveAacChannels(buffer);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`[aac] sampleRate inválido: ${String(sampleRate)}`);
  }
  if (numChannels < 1) throw new Error('[aac] el buffer no tiene canales que codificar');
  if (aacSampleRateIndex(sampleRate) < 0) {
    throw new Error(
      `[aac] sampleRate ${sampleRate} no soportado por ADTS (usa 44100 o 48000)`,
    );
  }
  const bitrate = opts?.bitrate ?? AAC_DEFAULT_BITRATE;
  if (!Number.isFinite(bitrate) || bitrate <= 0) {
    throw new Error(`[aac] bitrate inválido: ${String(bitrate)}`);
  }

  const Ctor = getAudioEncoderCtor();
  if (!Ctor) {
    throw new Error(
      'AAC no soportado: AudioEncoder (WebCodecs) no disponible en este navegador (p. ej. Safari). Exporta en WAV.',
    );
  }
  const withSupport = Ctor as unknown as {
    isConfigSupported: (config: unknown) => Promise<{ supported: boolean }>;
  };
  const config = { codec: AAC_CODEC_STRING, sampleRate, numberOfChannels: numChannels, bitrate };
  let supported = false;
  try {
    const res = await withSupport.isConfigSupported(config);
    supported = res.supported === true;
  } catch {
    supported = false;
  }
  if (!supported) {
    throw new Error(
      `AAC no soportado: el codec ${AAC_CODEC_STRING} no admite ${sampleRate}Hz/${numChannels}ch en este navegador. Exporta en WAV.`,
    );
  }

  // Materializa canales y recorta al mínimo común.
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const raw = buffer.getChannelData(ch) as unknown as Float32Array;
    chans.push(raw instanceof Float32Array ? raw : Float32Array.from(raw as ArrayLike<number>));
  }
  let totalFrames = chans.length > 0 ? (chans[0]?.length ?? 0) : 0;
  for (const c of chans) totalFrames = Math.min(totalFrames, c.length);
  if (totalFrames <= 0) throw new Error('[aac] el buffer está vacío');

  const payloads: Uint8Array[] = [];
  let encodeError: Error | null = null;
  const G = globalThis as unknown as {
    AudioData?: new (init: {
      format: string;
      sampleRate: number;
      numberOfFrames: number;
      numberOfChannels: number;
      timestamp: number;
      data: Float32Array;
    }) => { close: () => void };
  };
  if (!G.AudioData) {
    throw new Error(
      'AAC no soportado: AudioData (WebCodecs) no disponible en este navegador. Exporta en WAV.',
    );
  }
  const AudioDataCtor = G.AudioData;

  const encoder = new Ctor({
    output: (chunk) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      payloads.push(bytes);
    },
    error: (e: Error) => {
      encodeError = e instanceof Error ? e : new Error(String(e));
    },
  });
  try {
    encoder.configure(config);
    const CHUNK_FRAMES = 4096;
    let frameOffset = 0;
    while (frameOffset < totalFrames) {
      if (encodeError) throw encodeError;
      const frames = Math.min(CHUNK_FRAMES, totalFrames - frameOffset);
      const planar = new Float32Array(frames * numChannels);
      for (let ch = 0; ch < numChannels; ch++) {
        const src = chans[ch];
        if (!src) continue;
        planar.set(src.subarray(frameOffset, frameOffset + frames), ch * frames);
      }
      const timestamp = Math.round((frameOffset / sampleRate) * 1_000_000);
      const audioData = new AudioDataCtor({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels: numChannels,
        timestamp,
        data: planar,
      });
      encoder.encode(audioData);
      audioData.close();
      frameOffset += frames;
    }
    await encoder.flush();
  } finally {
    try {
      encoder.close();
    } catch {
      // Cierre best-effort tras flush.
    }
  }
  if (encodeError) throw encodeError;
  if (payloads.length === 0) {
    throw new Error('[aac] el codificador no produjo ningún frame (buffer vacío o codec ocupado)');
  }

  const frames = payloads.map((p) =>
    muxAdtsFrame(p, { sampleRate, numberOfChannels: numChannels }),
  );
  let total = 0;
  for (const f of frames) total += f.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}
