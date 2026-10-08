import { get, set, del, keys, delMany } from 'idb-keyval';
import type { AudioClip, AudioTrack } from '../types/daw';
import { useDawStore } from './useDawStore';
import { audioEngine } from '../audio/AudioEngine';
import { generateDemoTrackBuffer, generateWaveformPeaks } from '../audio/waveformUtils';
import { encodeWav } from '../audio/WavExporter';

/**
 * Persistencia de proyecto entre sesiones (IndexedDB vía `idb-keyval`).
 *
 * DECISIÓN DE DISEÑO (tamaño / fiabilidad):
 * - El registro principal sigue siendo JSON plano (metadatos, pistas y
 *   descriptores de clip): clave única, un proyecto activo.
 * - Los `peaks` nunca se guardan (se regeneran en milisegundos con
 *   `generateWaveformPeaks`).
 * - Clips demo: se guarda `demoKind` y se regeneran sintéticamente al cargar.
 * - Clips de usuario (importados/grabados): el PCM real se guarda como WAV de
 *   32-bit float (ver `AUDIO_WAV_BIT_DEPTH`) bajo una clave por clip
 *   (`hydradaw:audio:<clipId>`), fuera del registro principal para no inflarlo
 *   ni romper su lectura JSON. Al cargar, `restoreAudioBuffers()` los
 *   decodifica y regenera picos; si no hay audio (cuota, clip enorme, IDB
 *   vacío) se mantiene el fallback anterior: `audioBuffer: null` + marcador
 *   ⚠️ de reimportación.
 *
 * DECISIONES DE AUDIO (formato / claves / limpieza / cuota / límites):
 * - Formato 32-bit float IEEE (código 3), no 16-bit PCM: el `AudioBuffer` de
 *   Web Audio ya es float32, así que el round-trip es bit-exacto (tolerancia 0;
 *   el parser también acepta PCM-16 con tolerancia ≈ 2/32768 por compatibilidad
 *   futura). Cuesta ~2× en bytes frente a 16-bit, aceptable en IndexedDB, y la
 *   degradación por cuota cubre el caso sin espacio.
 * - Claves: `hydradaw:audio:<clipId>`, una entrada por clip. El registro
 *   principal incluye el manifiesto `audioClipIds` con los ids cuyo audio se
 *   guardó con éxito en el último `saveProjectNow()`.
 * - Limpieza anti-huérfanos: antes de escribir audio se barren las claves con
 *   el prefijo (vía `keys()`) y se borran las que ya no tienen clip vivo; esto
 *   además libera cuota antes de escribir. Sin `keys` disponible se usa el
 *   manifiesto del registro anterior como fallback.
 * - Cuota: cada escritura de audio va en su propio try/catch; ante
 *   `QuotaExceededError` (u otro error) ese clip degrada a metadatos y se
 *   intenta borrar su entrada parcial. El registro principal se escribe
 *   siempre al final con el manifiesto exacto. `saveProjectNow()` nunca lanza.
 * - Límite: clips cuyo WAV estimado supere `MAX_AUDIO_BYTES_PER_CLIP` (~6 min
 *   estéreo 32-float @44.1 kHz) se omiten con aviso y degradan a metadatos.
 * - Rendimiento: los WAV ya codificados se cachean por identidad de
 *   `AudioBuffer` (WeakMap), así el autosave no re-codifica MBs en cada edición
 *   y los clips divididos (mismo buffer) se codifican una sola vez.
 */

export const PERSISTENCE_KEY = 'hydradaw:project:v1';
export const PERSISTENCE_VERSION = 1;
export const AUTOSAVE_DEBOUNCE_MS = 2000;

/** Prefijo de las entradas de audio por clip: `hydradaw:audio:<clipId>`. */
export const AUDIO_KEY_PREFIX = 'hydradaw:audio:';
/**
 * Profundidad del WAV persistido. 32 = float IEEE (código 3): bit-exacto con el
 * `AudioBuffer` de Web Audio. Ver comentario de decisiones en la cabecera.
 */
export const AUDIO_WAV_BIT_DEPTH = 32 as const;
/**
 * Tamaño máximo de audio persistido por clip (WAV estimado, cabecera incl.).
 * 64 MiB ≈ 6 min estéreo 32-bit float @44.1 kHz; por encima se degrada a
 * metadatos en vez de arriesgar la cuota de toda la app.
 */
export const MAX_AUDIO_BYTES_PER_CLIP = 64 * 1024 * 1024;
/** Puntos min/max regenerados para clips de usuario restaurados desde IDB. */
export const RESTORED_AUDIO_PEAK_POINTS = 800;

/** Clave de IndexedDB donde vive el WAV de un clip de usuario. */
export function audioKeyForClip(clipId: string): string {
  return `${AUDIO_KEY_PREFIX}${clipId}`;
}

/** Los buffers demo siempre se generaron a 120 BPM y 16 s en `loadDemoProject`. */
const DEMO_BPM = 120;
const DEMO_DURATION_SEC = 16;
const DEMO_PEAK_POINTS = 800;

const REIMPORT_PREFIX = '⚠️ ';
const REIMPORT_SUFFIX = ' (reimportar)';

export type DemoKind = 'drums' | 'bass' | 'chords' | 'lead';

/** Subconjunto del estado del store que es seguro persistir (todo JSON). */
export interface PersistableProjectState {
  projectName: string;
  bpm: number;
  timeSignature: [number, number];
  currentTime: number;
  duration: number;
  isLooping: boolean;
  loopStart: number;
  loopEnd: number;
  metronome: boolean;
  masterVolume: number;
  masterMute: boolean;
  zoom: number;
  scrollLeft: number;
  activeView: 'timeline' | 'mixer';
  selectedTrackId: string | null;
  selectedClipId: string | null;
  tracks: AudioTrack[];
  clips: AudioClip[];
}

export interface SerializedClip {
  id: string;
  trackId: string;
  name: string;
  startTime: number;
  duration: number;
  offset: number;
  color?: string;
  demoKind: DemoKind | null;
  /** Duración del buffer a regenerar para clips demo. */
  demoDurationSec?: number;
  needsReimport: boolean;
  /** Nombre original sin el marcador ⚠️ (solo si needsReimport). */
  sourceName?: string;
}

export interface SerializedProject {
  version: number;
  savedAt: number;
  projectName: string;
  bpm: number;
  timeSignature: [number, number];
  currentTime: number;
  duration: number;
  isLooping: boolean;
  loopStart: number;
  loopEnd: number;
  metronome: boolean;
  masterVolume: number;
  masterMute: boolean;
  zoom: number;
  scrollLeft: number;
  activeView: 'timeline' | 'mixer';
  selectedTrackId: string | null;
  selectedClipId: string | null;
  tracks: AudioTrack[];
  clips: SerializedClip[];
  /**
   * Manifiesto exacto de clips cuyo WAV se guardó con éxito bajo
   * `hydradaw:audio:<clipId>` en el último `saveProjectNow()`. Sirve de
   * fallback para la limpieza de huérfanos cuando `keys()` no está disponible.
   */
  audioClipIds: string[];
}

/** Clip restaurado en memoria (admite flags extra no presentes en `AudioClip`). */
export type RestoredAudioClip = AudioClip & {
  needsReimport?: boolean;
  demoKind?: DemoKind | null;
};

/** Especificación de los 4 stems demo (ids/nombres fijados por `loadDemoProject`). */
const DEMO_CLIP_SPECS: Array<{
  trackId: string;
  clipIdPrefix: string;
  name: string;
  kind: DemoKind;
}> = [
  { trackId: 'track_drums', clipIdPrefix: 'clip_drums_', name: 'Drums Groove (120 BPM)', kind: 'drums' },
  { trackId: 'track_bass', clipIdPrefix: 'clip_bass_', name: 'Bass Progression', kind: 'bass' },
  { trackId: 'track_chords', clipIdPrefix: 'clip_chords_', name: 'Analog Warm Pad', kind: 'chords' },
  { trackId: 'track_lead', clipIdPrefix: 'clip_lead_', name: 'Vocal Melody Lead', kind: 'lead' },
];

/**
 * Infiere el tipo de stem demo de un clip.
 * Regla conservadora (evita falsos positivos con audio real del usuario):
 * el id conserva el prefijo demo ORIGINAL, o bien el clip sigue en su pista
 * demo con su nombre demo exacto (el split conserva nombre y trackId).
 * Si el usuario renombra el clip, se degrada a `needsReimport` (seguro).
 */
export function inferDemoKind(clip: { id: string; trackId: string; name: string }): DemoKind | null {
  const baseName = stripReimportMarker(clip.name);
  for (const spec of DEMO_CLIP_SPECS) {
    if (clip.id.startsWith(spec.clipIdPrefix)) return spec.kind;
    if (clip.trackId === spec.trackId && baseName === spec.name) return spec.kind;
  }
  return null;
}

export function stripReimportMarker(name: string): string {
  let out = name;
  if (out.startsWith(REIMPORT_PREFIX)) out = out.slice(REIMPORT_PREFIX.length);
  if (out.endsWith(REIMPORT_SUFFIX)) out = out.slice(0, out.length - REIMPORT_SUFFIX.length);
  return out;
}

function withReimportMarker(name: string): string {
  const base = stripReimportMarker(name);
  return `${REIMPORT_PREFIX}${base}${REIMPORT_SUFFIX}`;
}

export function serializeProject(state: PersistableProjectState): SerializedProject {
  return {
    version: PERSISTENCE_VERSION,
    savedAt: Date.now(),
    projectName: state.projectName,
    bpm: state.bpm,
    timeSignature: [state.timeSignature[0], state.timeSignature[1]],
    currentTime: state.currentTime,
    duration: state.duration,
    isLooping: state.isLooping,
    loopStart: state.loopStart,
    loopEnd: state.loopEnd,
    metronome: state.metronome,
    masterVolume: state.masterVolume,
    masterMute: state.masterMute,
    zoom: state.zoom,
    scrollLeft: state.scrollLeft,
    activeView: state.activeView,
    selectedTrackId: state.selectedTrackId,
    selectedClipId: state.selectedClipId,
    tracks: state.tracks.map((t) => ({
      ...t,
      plugins: t.plugins.map((p) => ({ ...p, parameters: { ...p.parameters } })),
    })),
    // Placeholder: `saveProjectNow()` lo sobrescribe con el manifiesto exacto
    // tras escribir cada WAV (aquí aún no se sabe qué escrituras tendrán éxito).
    audioClipIds: [],
    clips: state.clips.map((c) => {
      const demoKind = inferDemoKind(c);
      const needsReimport = demoKind === null;
      const clip: SerializedClip = {
        id: c.id,
        trackId: c.trackId,
        name: stripReimportMarker(c.name),
        startTime: c.startTime,
        duration: c.duration,
        offset: c.offset,
        color: c.color,
        demoKind,
        needsReimport,
      };
      if (demoKind !== null) {
        clip.demoDurationSec = Math.max(DEMO_DURATION_SEC, Math.ceil(c.offset + c.duration));
      } else {
        clip.sourceName = stripReimportMarker(c.name);
      }
      return clip;
    }),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Normaliza y migra cualquier payload guardado a `SerializedProject`.
 * - Versiones antiguas / sin `version` (legacy v0, p. ej. `{ tracks, clips }`
 *   con AudioBuffers incrustados): rellena defaults y re-deriva
 *   `demoKind`/`needsReimport` por clip, descartando `audioBuffer`/`peaks`.
 * - Payload ausente o corrupto: devuelve `null`.
 */
export function deserializeProject(raw: unknown): SerializedProject | null {
  if (!isRecord(raw)) return null;
  const tracks = Array.isArray(raw['tracks']) ? (raw['tracks'] as AudioTrack[]) : null;
  const clips = Array.isArray(raw['clips']) ? (raw['clips'] as unknown[]) : null;
  if (tracks === null || clips === null) return null;

  const ts = raw['timeSignature'];
  const timeSignature: [number, number] =
    Array.isArray(ts) && typeof ts[0] === 'number' && typeof ts[1] === 'number'
      ? [ts[0], ts[1]]
      : [4, 4];

  const activeView = raw['activeView'] === 'mixer' ? 'mixer' : 'timeline';

  const audioClipIds = Array.isArray(raw['audioClipIds'])
    ? (raw['audioClipIds'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  return {
    version: PERSISTENCE_VERSION,
    savedAt: asNumber(raw['savedAt'], Date.now()),
    projectName: typeof raw['projectName'] === 'string' ? raw['projectName'] : 'Mi Canción Local',
    bpm: asNumber(raw['bpm'], 120),
    timeSignature,
    currentTime: asNumber(raw['currentTime'], 0),
    duration: asNumber(raw['duration'], 32),
    isLooping: asBool(raw['isLooping'], false),
    loopStart: asNumber(raw['loopStart'], 0),
    loopEnd: asNumber(raw['loopEnd'], 16),
    metronome: asBool(raw['metronome'], false),
    masterVolume: asNumber(raw['masterVolume'], 1.0),
    masterMute: asBool(raw['masterMute'], false),
    zoom: asNumber(raw['zoom'], 50),
    scrollLeft: asNumber(raw['scrollLeft'], 0),
    activeView,
    selectedTrackId: typeof raw['selectedTrackId'] === 'string' ? (raw['selectedTrackId'] as string) : null,
    selectedClipId: typeof raw['selectedClipId'] === 'string' ? raw['selectedClipId'] : null,
    tracks: tracks.map((t) => ({
      ...t,
      plugins: Array.isArray(t.plugins) ? t.plugins.map((p) => ({ ...p })) : [],
    })),
    audioClipIds,
    clips: clips.map((c): SerializedClip => {
      if (!isRecord(c)) {
        return { id: 'clip_invalid', trackId: '', name: '', startTime: 0, duration: 0, offset: 0, demoKind: null, needsReimport: true };
      }
      const id = typeof c['id'] === 'string' ? c['id'] : 'clip_' + Math.random().toString(36).slice(2);
      const trackId = typeof c['trackId'] === 'string' ? c['trackId'] : '';
      const rawName = typeof c['name'] === 'string' ? c['name'] : (typeof c['sourceName'] === 'string' ? c['sourceName'] : 'Clip');
      const name = stripReimportMarker(rawName);
      const demoKind =
        c['demoKind'] === 'drums' || c['demoKind'] === 'bass' || c['demoKind'] === 'chords' || c['demoKind'] === 'lead'
          ? (c['demoKind'] as DemoKind)
          : inferDemoKind({ id, trackId, name });
      const needsReimport = demoKind === null ? true : asBool(c['needsReimport'], false);
      const out: SerializedClip = {
        id,
        trackId,
        name,
        startTime: asNumber(c['startTime'], 0),
        duration: asNumber(c['duration'], 0),
        offset: asNumber(c['offset'], 0),
        color: typeof c['color'] === 'string' ? c['color'] : undefined,
        demoKind,
        needsReimport,
      };
      if (demoKind !== null) {
        out.demoDurationSec = asNumber(c['demoDurationSec'], 0) > 0
          ? asNumber(c['demoDurationSec'], DEMO_DURATION_SEC)
          : Math.max(DEMO_DURATION_SEC, Math.ceil(out.offset + out.duration));
      } else if (typeof c['sourceName'] === 'string') {
        out.sourceName = stripReimportMarker(c['sourceName']);
      } else {
        out.sourceName = name;
      }
      return out;
    }),
  };
}

/**
 * Materializa clips serializados en `AudioClip` listos para el store.
 * - Demo + `ctx` disponible: regenera buffer y picos.
 * - Demo sin `ctx` (entorno sin Web Audio): metadatos + `demoKind` para
 *   regenerar más tarde, sin marcar como pendiente de reimportar.
 * - Usuario: `audioBuffer: null`, picos vacíos y marcador ⚠️ en el nombre.
 */
export function restoreClips(serialized: SerializedClip[], ctx: BaseAudioContext | null): RestoredAudioClip[] {
  return serialized.map((s) => {
    if (s.demoKind !== null && ctx) {
      const durationSec = s.demoDurationSec && s.demoDurationSec > 0
        ? s.demoDurationSec
        : Math.max(DEMO_DURATION_SEC, Math.ceil(s.offset + s.duration));
      const audioBuffer = generateDemoTrackBuffer(ctx, s.demoKind, durationSec, DEMO_BPM);
      const clip: RestoredAudioClip = {
        id: s.id,
        trackId: s.trackId,
        name: s.name,
        startTime: s.startTime,
        duration: s.duration,
        offset: s.offset,
        audioBuffer,
        peaks: generateWaveformPeaks(audioBuffer, DEMO_PEAK_POINTS),
        color: s.color,
        demoKind: s.demoKind,
        needsReimport: false,
      };
      return clip;
    }
    if (s.demoKind !== null) {
      const clip: RestoredAudioClip = {
        id: s.id,
        trackId: s.trackId,
        name: s.name,
        startTime: s.startTime,
        duration: s.duration,
        offset: s.offset,
        audioBuffer: null,
        peaks: new Float32Array(0),
        color: s.color,
        demoKind: s.demoKind,
        needsReimport: false,
      };
      return clip;
    }
    const clip: RestoredAudioClip = {
      id: s.id,
      trackId: s.trackId,
      name: withReimportMarker(s.sourceName ?? s.name),
      startTime: s.startTime,
      duration: s.duration,
      offset: s.offset,
      audioBuffer: null,
      peaks: new Float32Array(0),
      color: s.color,
      demoKind: null,
      needsReimport: true,
    };
    return clip;
  });
}

/** Caché de WAV ya codificados por identidad de buffer (ver cabecera). */
const encodedAudioCache = new WeakMap<AudioBuffer, Uint8Array>();

/**
 * Codifica el buffer de un clip de usuario a WAV 32-bit float.
 * Devuelve `null` (con aviso) si no hay buffer o el WAV estimado supera
 * `MAX_AUDIO_BYTES_PER_CLIP`; nunca lanza.
 */
export function encodeClipAudio(buffer: AudioBuffer | null | undefined): Uint8Array | null {
  if (!buffer) return null;
  const cached = encodedAudioCache.get(buffer);
  if (cached) return cached;
  try {
    const channels = buffer.numberOfChannels;
    const estimated = 44 + buffer.length * channels * (AUDIO_WAV_BIT_DEPTH / 8);
    if (!Number.isFinite(estimated) || channels < 1 || buffer.length < 1) return null;
    if (estimated > MAX_AUDIO_BYTES_PER_CLIP) {
      console.warn(
        `[persistence] Clip demasiado grande (~${Math.round(estimated / 1048576)} MiB, límite ${MAX_AUDIO_BYTES_PER_CLIP / 1048576} MiB): se guardan solo metadatos.`,
      );
      return null;
    }
    const bytes = encodeWav(buffer, AUDIO_WAV_BIT_DEPTH);
    encodedAudioCache.set(buffer, bytes);
    return bytes;
  } catch (err) {
    console.warn('[persistence] No se pudo codificar el audio del clip:', err);
    return null;
  }
}

function readChunkId(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Parser WAV mínimo y síncrono para los archivos que escribe `encodeClipAudio`
 * (float32, código 3) más PCM-16 (código 1, tolerancia ≈ 2/32768 por el
 * `floor` y la escala asimétrica del encoder) por compatibilidad futura. No usa `decodeAudioData`, así que funciona en
 * cualquier `BaseAudioContext` con `createBuffer` (incl. tests en Node).
 * Lanza ante bytes corruptos o formato no soportado.
 */
export function decodeWavBytes(data: Uint8Array, ctx: BaseAudioContext): AudioBuffer {
  if (data.length < 44) throw new Error('[persistence] WAV truncado (< 44 bytes).');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (readChunkId(view, 0) !== 'RIFF' || readChunkId(view, 8) !== 'WAVE') {
    throw new Error('[persistence] No es un WAV válido (sin RIFF/WAVE).');
  }
  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;
  let off = 12;
  while (off + 8 <= data.length) {
    const id = readChunkId(view, off);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      if (off + 24 > data.length) break;
      audioFormat = view.getUint16(off + 8, true);
      numChannels = view.getUint16(off + 10, true);
      sampleRate = view.getUint32(off + 12, true);
      bitsPerSample = view.getUint16(off + 22, true);
    } else if (id === 'data') {
      dataOffset = off + 8;
      dataSize = size;
      break;
    }
    off += 8 + size + (size & 1);
  }
  if (dataOffset < 0) throw new Error('[persistence] WAV sin chunk de datos.');
  const bytesPerSample = bitsPerSample / 8;
  const supported =
    (audioFormat === 3 && bitsPerSample === 32) || (audioFormat === 1 && bitsPerSample === 16);
  if (!supported || numChannels < 1 || sampleRate <= 0) {
    throw new Error(`[persistence] WAV no soportado (formato ${audioFormat}, ${bitsPerSample} bits).`);
  }
  const available = Math.max(0, data.length - dataOffset);
  const frameCount = Math.floor(Math.min(dataSize, available) / (numChannels * bytesPerSample));
  if (frameCount < 1) throw new Error('[persistence] WAV sin muestras decodificables.');
  const out = ctx.createBuffer(numChannels, frameCount, sampleRate);

  if (bitsPerSample === 32) {
    // Vía rápida: vista float directamente sobre los bytes intercalados.
    const absOffset = data.byteOffset + dataOffset;
    if (absOffset % 4 === 0) {
      const interleaved = new Float32Array(data.buffer, absOffset, frameCount * numChannels);
      for (let c = 0; c < numChannels; c++) {
        const channel = out.getChannelData(c);
        for (let i = 0; i < frameCount; i++) channel[i] = interleaved[i * numChannels + c];
      }
      return out;
    }
    for (let c = 0; c < numChannels; c++) {
      const channel = out.getChannelData(c);
      for (let i = 0; i < frameCount; i++) {
        channel[i] = view.getFloat32(dataOffset + (i * numChannels + c) * 4, true);
      }
    }
    return out;
  }
  for (let c = 0; c < numChannels; c++) {
    const channel = out.getChannelData(c);
    for (let i = 0; i < frameCount; i++) {
      channel[i] = view.getInt16(dataOffset + (i * numChannels + c) * 2, true) / 32768;
    }
  }
  return out;
}

/**
 * Decodifica los bytes guardados prefiriendo el `decodeAudioData` nativo del
 * contexto (máxima compatibilidad en navegador; equivale a `decodeAudioFile`
 * sin envolver en Blob) y recurriendo al parser interno si no existe o falla.
 * Se decodifica sobre una copia porque `decodeAudioData` puede desprender el
 * ArrayBuffer de origen.
 */
async function decodeStoredAudio(bytes: Uint8Array, ctx: BaseAudioContext): Promise<AudioBuffer> {
  if (typeof ctx.decodeAudioData === 'function') {
    try {
      const copy = bytes.slice().buffer as ArrayBuffer;
      return await ctx.decodeAudioData(copy);
    } catch {
      // Recurre al parser interno (p. ej. WAV válido que el navegador rechaza).
    }
  }
  return decodeWavBytes(bytes, ctx);
}

export interface RestoreAudioResult {
  restored: number;
  /** Clips con bytes presentes pero ilegibles (conservan el fallback ⚠️). */
  failed: number;
  /** Clips sin entrada de audio en IDB (conservan el fallback ⚠️). */
  missing: number;
}

/**
 * Restaura el audio real de los clips de usuario: lee `hydradaw:audio:<clipId>`,
 * decodifica, adjunta el buffer, regenera picos y retira el marcador ⚠️.
 * Los clips sin audio (o ilegibles) se dejan intactos con su fallback de
 * metadatos. Nunca lanza.
 */
export async function restoreAudioBuffers(
  clips: RestoredAudioClip[],
  ctx: BaseAudioContext | null,
  peakPoints: number = RESTORED_AUDIO_PEAK_POINTS,
): Promise<RestoreAudioResult> {
  const result: RestoreAudioResult = { restored: 0, failed: 0, missing: 0 };
  if (!ctx) return result;
  const pending = clips.filter((c) => c.demoKind == null && c.audioBuffer == null);
  for (const clip of pending) {
    let raw: unknown;
    try {
      raw = await get(audioKeyForClip(clip.id));
    } catch (err) {
      console.warn('[persistence] No se pudo leer el audio del clip', clip.id, err);
      result.failed += 1;
      continue;
    }
    if (raw == null) {
      result.missing += 1;
      continue;
    }
    const bytes =
      raw instanceof Uint8Array
        ? raw
        : raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : null;
    if (!bytes || bytes.length < 44) {
      console.warn('[persistence] Audio corrupto para el clip', clip.id, ': se conserva el marcador de reimportación.');
      result.failed += 1;
      continue;
    }
    try {
      const decoded = await decodeStoredAudio(bytes, ctx);
      clip.audioBuffer = decoded;
      clip.peaks = generateWaveformPeaks(decoded, peakPoints);
      clip.name = stripReimportMarker(clip.name);
      clip.needsReimport = false;
      result.restored += 1;
    } catch (err) {
      console.warn('[persistence] No se pudo decodificar el audio del clip', clip.id, err);
      result.failed += 1;
    }
  }
  return result;
}

function isQuotaError(err: unknown): boolean {
  if (!isRecord(err)) return false;
  const name = err['name'];
  const code = (err as { code?: unknown }).code;
  return name === 'QuotaExceededError' || code === 22 || code === 1014;
}

/**
 * Borra las entradas `hydradaw:audio:*` sin clip vivo (y libera cuota antes de
 * escribir). Vía rápida con `keys()`; fallback al manifiesto del registro
 * anterior si `keys` no existe (p. ej. mocks parciales). Nunca lanza.
 */
async function cleanupOrphanAudio(liveIds: Set<string>): Promise<void> {
  try {
    const keysFn: unknown = keys;
    if (typeof keysFn === 'function') {
      const all = await (keysFn as () => Promise<unknown>)();
      const list = Array.isArray(all) ? all : [];
      const orphans = list.filter(
        (k): k is string =>
          typeof k === 'string' &&
          k.startsWith(AUDIO_KEY_PREFIX) &&
          !liveIds.has(k.slice(AUDIO_KEY_PREFIX.length)),
      );
      if (orphans.length === 0) return;
      try {
        await delMany(orphans);
      } catch {
        for (const k of orphans) {
          try {
            await del(k);
          } catch {
            /* nunca lanzar */
          }
        }
      }
      return;
    }
  } catch {
    /* cae al fallback por manifiesto */
  }
  try {
    const raw = (await get(PERSISTENCE_KEY)) as { audioClipIds?: unknown } | null | undefined;
    const oldIds = Array.isArray(raw?.audioClipIds)
      ? raw.audioClipIds.filter((x): x is string => typeof x === 'string')
      : [];
    for (const id of oldIds) {
      if (liveIds.has(id)) continue;
      try {
        await del(audioKeyForClip(id));
      } catch {
        /* nunca lanzar */
      }
    }
  } catch {
    /* nunca lanzar */
  }
}

/** Guarda el estado actual del store en IndexedDB. Nunca lanza (autosave-safe). */
export async function saveProjectNow(): Promise<void> {
  try {
    const state = useDawStore.getState();
    const serialized = serializeProject(state);

    // 1. Codifica el audio real de clips no-demo (sync, cacheado por buffer).
    //    De menor a mayor: con cuota justa sobreviven primero los clips pequeños.
    const encoded: Array<{ id: string; bytes: Uint8Array }> = [];
    for (const c of state.clips) {
      if (inferDemoKind(c) !== null) continue;
      const bytes = encodeClipAudio(c.audioBuffer ?? c.buffer ?? null);
      if (bytes) encoded.push({ id: c.id, bytes });
    }
    encoded.sort((a, b) => a.bytes.byteLength - b.bytes.byteLength);
    const liveIds = new Set(encoded.map((e) => e.id));

    // 2. Limpieza de huérfanos antes de escribir (también libera cuota).
    await cleanupOrphanAudio(liveIds);

    // 3. Una entrada por clip; ante falta de cuota ese clip degrada a
    //    metadatos (ya presentes en `serialized`) sin romper el resto.
    const okIds: string[] = [];
    for (const e of encoded) {
      try {
        await set(audioKeyForClip(e.id), e.bytes);
        okIds.push(e.id);
      } catch (err) {
        if (isQuotaError(err)) {
          console.warn(`[persistence] Sin cuota para el audio del clip ${e.id}: se conservan solo metadatos.`);
        } else {
          console.warn('[persistence] No se pudo guardar el audio del clip', e.id, err);
        }
        try {
          await del(audioKeyForClip(e.id));
        } catch {
          /* nunca lanzar */
        }
      }
    }

    // 4. Registro principal con el manifiesto exacto de audio guardado.
    serialized.audioClipIds = okIds;
    await set(PERSISTENCE_KEY, serialized);
  } catch (err) {
    console.warn('[persistence] No se pudo guardar el proyecto:', err);
  }
}

/**
 * Carga el proyecto guardado al store (regenerando stems demo).
 * Devuelve `true` si había un proyecto válido (aunque esté vacío: respeta la
 * decisión del usuario de borrarlo todo); `false` si no hay nada guardado.
 */
export async function loadSavedProject(): Promise<boolean> {
  let raw: unknown = null;
  try {
    raw = await get(PERSISTENCE_KEY);
  } catch (err) {
    console.warn('[persistence] No se pudo leer el proyecto guardado:', err);
    return false;
  }
  if (raw == null) return false;

  const data = deserializeProject(raw);
  if (!data) return false;

  let ctx: BaseAudioContext | null = null;
  try {
    ctx = await audioEngine.ensureContext();
  } catch (err) {
    console.warn('[persistence] Sin Web Audio: se restauran metadatos sin regenerar audio.', err);
  }

  const clips = restoreClips(data.clips, ctx);

  // Audio real de usuario (WAV por clip); si no hay contexto o no hay bytes,
  // los clips conservan su fallback de metadatos (⚠️ reimportar).
  if (ctx) {
    try {
      await restoreAudioBuffers(clips, ctx);
    } catch (err) {
      console.warn('[persistence] No se pudo restaurar el audio guardado:', err);
    }
  }

  try {
    useDawStore.setState({
      projectName: data.projectName,
      bpm: data.bpm,
      timeSignature: data.timeSignature,
      currentTime: 0,
      duration: data.duration,
      isPlaying: false,
      isRecording: false,
      isLooping: data.isLooping,
      loopStart: data.loopStart,
      loopEnd: data.loopEnd,
      metronome: data.metronome,
      masterVolume: data.masterVolume,
      masterMute: data.masterMute,
      zoom: data.zoom,
      scrollLeft: data.scrollLeft,
      activeView: data.activeView,
      selectedTrackId: data.selectedTrackId,
      selectedClipId: data.selectedClipId,
      tracks: data.tracks,
      clips,
    });
    try {
      await audioEngine.syncTracks(data.tracks);
    } catch (err) {
      console.warn('[persistence] No se pudo sincronizar el motor de audio:', err);
    }
    return true;
  } catch (err) {
    console.warn('[persistence] No se pudo restaurar el proyecto:', err);
    return false;
  }
}

export async function clearSavedProject(): Promise<void> {
  try {
    await del(PERSISTENCE_KEY);
  } catch (err) {
    console.warn('[persistence] No se pudo borrar el proyecto guardado:', err);
  }
  // El audio vive en claves separadas: borrar también para no dejar huérfanos.
  try {
    const keysFn: unknown = keys;
    if (typeof keysFn !== 'function') return;
    const all = await (keysFn as () => Promise<unknown>)();
    const list = Array.isArray(all) ? all : [];
    const audioKeys = list.filter((k): k is string => typeof k === 'string' && k.startsWith(AUDIO_KEY_PREFIX));
    if (audioKeys.length === 0) return;
    try {
      await delMany(audioKeys);
    } catch {
      for (const k of audioKeys) {
        try {
          await del(k);
        } catch {
          /* nunca lanzar */
        }
      }
    }
  } catch (err) {
    console.warn('[persistence] No se pudo borrar el audio guardado:', err);
  }
}

/**
 * Suscribe autosave con debounce (~2 s). Acepta la fn `subscribe` para poder
 * testearse sin el store real; por defecto usa `useDawStore.subscribe`.
 * Devuelve función para cancelar (debounce + suscripción).
 */
export function startAutosave(
  subscribeFn?: (listener: () => void) => () => void,
): () => void {
  const subscribe: (listener: () => void) => () => void =
    subscribeFn ?? ((listener) => useDawStore.subscribe(listener));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveProjectNow();
    }, AUTOSAVE_DEBOUNCE_MS);
  });
  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    unsubscribe();
  };
}
