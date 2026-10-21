// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fix(waveA): este fichero simula un entorno SIN `keys()` en idb-keyval
// (mock parcial) para verificar los fallbacks al manifiesto `audioClipIds`.
vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    delMany: vi.fn(async (keysArr: string[]) => {
      for (const k of keysArr) store.delete(k);
    }),
    __store: store,
  };
});

import { get, set } from 'idb-keyval';
import type { AudioClip, AudioTrack } from '../types/daw';
import {
  serializeProject,
  deserializeProject,
  migrateV0toV1,
  sanitizeClip,
  restoreClips,
  applyTotalAudioBudget,
  saveProjectNow,
  loadSavedProject,
  clearSavedProject,
  startAutosave,
  audioKeyForClip,
  clipIdFromAudioKey,
  selectAutosaveSnapshot,
  PERSISTENCE_KEY,
  PERSISTENCE_VERSION,
  MAX_TOTAL_AUDIO_BYTES,
  type PersistableProjectState,
} from '../store/persistence';
import { useDawStore } from '../store/useDawStore';

function makeFakeAudioContext(sampleRate = 44100): BaseAudioContext {
  return {
    sampleRate,
    createBuffer(channels: number, length: number, sr: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate: sr,
        duration: length / sr,
        getChannelData: (c: number) => data[c],
      };
    },
  } as unknown as BaseAudioContext;
}

function demoTrack(id: string): AudioTrack {
  return {
    id,
    name: 'track ' + id,
    type: 'audio',
    color: '#fff',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    plugins: [],
  };
}

function demoClip(id: string, trackId: string, name: string): AudioClip {
  return {
    id,
    trackId,
    name,
    startTime: 0,
    duration: 4,
    offset: 0,
    audioBuffer: null,
    peaks: new Float32Array(0),
    color: '#fff',
  };
}

function baseState(): PersistableProjectState {
  return {
    projectName: 'Migración',
    bpm: 120,
    timeSignature: [4, 4],
    currentTime: 0,
    duration: 32,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    metronome: false,
    masterVolume: 1.0,
    masterMute: false,
    snapMode: '1/16',
    zoom: 50,
    scrollLeft: 0,
    activeView: 'timeline',
    selectedTrackId: null,
    selectedClipIds: [],
    tracks: [demoTrack('track_1')],
    clips: [demoClip('clip_1', 'track_1', 'Voz.wav')],
  };
}

function synthAudioBuffer(ctx: BaseAudioContext, seconds = 0.2, channels = 1): AudioBuffer {
  const sampleRate = 44100;
  const buf = ctx.createBuffer(channels, Math.max(1, Math.floor(sampleRate * seconds)), sampleRate);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
  }
  return buf;
}

describe('persistence_migration: versiones', () => {
  it('rechaza payloads de versiones futuras', () => {
    const out = serializeProject(baseState());
    const future = { ...JSON.parse(JSON.stringify(out)), version: PERSISTENCE_VERSION + 1 };
    expect(deserializeProject(future)).toBeNull();
    expect(deserializeProject({ ...future, version: 99 })).toBeNull();
  });

  it('v0 (sin version) migra vía migrateV0toV1 con defaults', () => {
    const legacy = {
      projectName: 'Viejo',
      tracks: [{ ...demoTrack('track_drums') }],
      clips: [
        {
          id: 'clip_drums_1',
          trackId: 'track_drums',
          name: 'Drums Groove (120 BPM)',
          startTime: 0,
          duration: 16,
          offset: 0,
          audioBuffer: { fake: true },
          peaks: [0, 1, 2],
        },
      ],
    };
    const direct = migrateV0toV1(legacy);
    expect(direct).not.toBeNull();
    expect(direct!.version).toBe(PERSISTENCE_VERSION);
    const back = deserializeProject(legacy);
    expect(back).not.toBeNull();
    expect(back!).toMatchObject({ bpm: 120, masterVolume: 1.0 });
    expect(back!.timeSignature).toEqual([4, 4]);
    expect(JSON.stringify(back)).not.toContain('audioBuffer');
    // Versión 0 explícita también va por la ruta legacy.
    expect(deserializeProject({ ...legacy, version: 0 })).not.toBeNull();
  });
});

describe('persistence_migration: validación', () => {
  it('descarta clips sin id (sin placeholder clip_invalid persistido)', () => {
    const raw = {
      version: 1,
      tracks: [{ ...demoTrack('t1') }],
      clips: [
        { trackId: 't1', name: 'Sin id', startTime: 0, duration: 1, offset: 0 },
        { id: '', trackId: 't1', name: 'Id vacío', startTime: 0, duration: 1, offset: 0 },
        42,
        null,
      ],
    };
    const back = deserializeProject(raw);
    expect(back).not.toBeNull();
    expect(back!.clips).toHaveLength(0);
    expect(JSON.stringify(back)).not.toContain('clip_invalid');
  });

  it('trackId huérfano conserva su id y marca needsReimport', () => {
    const raw = {
      version: 1,
      tracks: [{ ...demoTrack('t1') }],
      clips: [
        { id: 'clip_ghost', trackId: 'track_missing', name: 'Voz.wav', startTime: 1, duration: 4, offset: 0 },
      ],
    };
    const back = deserializeProject(raw);
    expect(back!.clips).toHaveLength(1);
    expect(back!.clips[0]).toMatchObject({ id: 'clip_ghost', demoKind: null, needsReimport: true });
    // sanitizeClip directo coincide.
    expect(sanitizeClip(raw.clips[0], new Set(['t1']))!.needsReimport).toBe(true);
  });

  it('payload corrupto parcial: clamp de duration y fallbacks numéricos', () => {
    const raw = {
      version: 1,
      bpm: 'rápido',
      timeSignature: [0, -1],
      tracks: [{ id: 't1', volume: 'alto', pan: NaN, plugins: 'no-array' }],
      clips: [
        { id: 'c1', trackId: 't1', name: 'X', startTime: -3, duration: -5, offset: -2 },
      ],
    };
    const back = deserializeProject(raw);
    expect(back).not.toBeNull();
    expect(back!.bpm).toBe(120);
    expect(back!.timeSignature).toEqual([4, 4]);
    expect(back!.tracks[0]).toMatchObject({ volume: 1.0, pan: 0, plugins: [] });
    expect(back!.clips[0]).toMatchObject({ startTime: 0, duration: 0, offset: 0 });
  });
});

describe('persistence_migration: claves y metadatos', () => {
  it('usa claves versionadas y parsea también el prefijo legacy', () => {
    expect(audioKeyForClip('abc')).toBe('hydradaw:audio:v1:abc');
    expect(clipIdFromAudioKey('hydradaw:audio:v1:abc')).toBe('abc');
    expect(clipIdFromAudioKey('hydradaw:audio:old')).toBe('old');
    expect(clipIdFromAudioKey('hydradaw:project:v1')).toBeNull();
  });

  it('persiste sampleRate, sourceFileName y mime del clip', () => {
    const ctx = makeFakeAudioContext(48000);
    const buf = synthAudioBuffer(ctx);
    Object.defineProperty(buf, 'sampleRate', { value: 48000 });
    const clip = {
      ...demoClip('clip_u1', 'track_1', 'Pista.wav'),
      audioBuffer: buf,
      sourceFileName: 'toma3.wav',
      sourceMime: 'audio/wav',
    } as unknown as AudioClip;
    const out = serializeProject({ ...baseState(), clips: [clip] });
    expect(out.clips[0]!.sampleRate).toBe(48000);
    expect(out.clips[0]!.sourceFileName).toBe('toma3.wav');
    expect(out.clips[0]!.sourceMime).toBe('audio/wav');
    const back = deserializeProject(JSON.parse(JSON.stringify(out)));
    expect(back!.clips[0]).toMatchObject({ sampleRate: 48000, sourceFileName: 'toma3.wav' });
    const restored = restoreClips(back!.clips, ctx);
    expect(restored[0]!.name).toContain('toma3.wav');
  });

  it('snapMode persiste y lo inválido cae a 1/16', () => {
    const out = serializeProject({ ...baseState(), snapMode: 'triplet' });
    expect(out.snapMode).toBe('triplet');
    const back = deserializeProject(JSON.parse(JSON.stringify(out)));
    expect(back!.snapMode).toBe('triplet');
    const bad = deserializeProject({ ...JSON.parse(JSON.stringify(out)), snapMode: 'cuantizado-x' });
    expect(bad!.snapMode).toBe('1/16');
    const missing = deserializeProject({ ...JSON.parse(JSON.stringify(out)), snapMode: undefined });
    expect(missing!.snapMode).toBe('1/16');
  });
});

describe('persistence_migration: almacenamiento sin keys()', () => {
  const initialStore = useDawStore.getState();

  beforeEach(async () => {
    await clearSavedProject();
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useDawStore.setState({
      projectName: initialStore.projectName,
      bpm: initialStore.bpm,
      tracks: initialStore.tracks,
      clips: initialStore.clips,
    });
  });

  it('cuota parcial: sobreviven el 1º y el 3º aunque falle el 2º', async () => {
    const ctx = makeFakeAudioContext();
    const mk = (id: string, seconds: number, channels: number): AudioClip => ({
      ...demoClip(id, 'track_1', id + '.wav'),
      audioBuffer: synthAudioBuffer(ctx, seconds, channels),
    });
    useDawStore.setState({
      projectName: 'Cuota parcial',
      tracks: [demoTrack('track_1')],
      clips: [mk('clip_q1', 0.2, 1), mk('clip_q2', 0.4, 2), mk('clip_q3', 0.3, 2)],
    });
    const origSet = vi.mocked(set).getMockImplementation();
    vi.mocked(set).mockImplementation(async (key, value) => {
      if ((key as string) === audioKeyForClip('clip_q2')) {
        throw Object.assign(new Error('sin espacio'), { name: 'QuotaExceededError' });
      }
      return origSet!(key, value);
    });
    try {
      await expect(saveProjectNow()).resolves.toBeUndefined();
    } finally {
      vi.mocked(set).mockImplementation(origSet!);
    }
    const raw = (await get(PERSISTENCE_KEY)) as { audioClipIds: string[] };
    expect([...raw.audioClipIds].sort()).toEqual(['clip_q1', 'clip_q3']);
    expect(await get(audioKeyForClip('clip_q1'))).toBeInstanceOf(Uint8Array);
    expect(await get(audioKeyForClip('clip_q3'))).toBeInstanceOf(Uint8Array);
    expect(await get(audioKeyForClip('clip_q2'))).toBeUndefined();
  });

  it('sin keys(): la limpieza de huérfanos usa el manifiesto', async () => {
    const ctx = makeFakeAudioContext();
    useDawStore.setState({
      projectName: 'Huérfanos manifiesto',
      tracks: [demoTrack('track_1')],
      clips: [{ ...demoClip('clip_old', 'track_1', 'Viejo.wav'), audioBuffer: synthAudioBuffer(ctx) }],
    });
    await saveProjectNow();
    expect(await get(audioKeyForClip('clip_old'))).toBeInstanceOf(Uint8Array);

    useDawStore.setState({
      clips: [{ ...demoClip('clip_new', 'track_1', 'Nuevo.wav'), audioBuffer: synthAudioBuffer(ctx) }],
    });
    await saveProjectNow();
    expect(await get(audioKeyForClip('clip_old'))).toBeUndefined();
    expect(await get(audioKeyForClip('clip_new'))).toBeInstanceOf(Uint8Array);
  });

  it('clearSavedProject limpia el audio sin keys() (vía manifiesto)', async () => {
    const ctx = makeFakeAudioContext();
    useDawStore.setState({
      projectName: 'Temporal',
      tracks: [demoTrack('track_1')],
      clips: [{ ...demoClip('clip_u1', 'track_1', 'Voz.wav'), audioBuffer: synthAudioBuffer(ctx) }],
    });
    await saveProjectNow();
    expect(await get(audioKeyForClip('clip_u1'))).toBeInstanceOf(Uint8Array);
    await clearSavedProject();
    expect(await get(audioKeyForClip('clip_u1'))).toBeUndefined();
    expect(await loadSavedProject()).toBe(false);
  });

  it('splits con el mismo buffer reutilizan los bytes (un set por id)', async () => {
    const ctx = makeFakeAudioContext();
    const shared = synthAudioBuffer(ctx);
    useDawStore.setState({
      projectName: 'Splits',
      tracks: [demoTrack('track_1')],
      clips: [
        { ...demoClip('clip_s1', 'track_1', 'A.wav'), audioBuffer: shared },
        { ...demoClip('clip_s2', 'track_1', 'A.wav'), audioBuffer: shared, startTime: 2 },
      ],
    });
    await saveProjectNow();
    const b1 = await get(audioKeyForClip('clip_s1'));
    const b2 = await get(audioKeyForClip('clip_s2'));
    expect(b1).toBeInstanceOf(Uint8Array);
    expect(b1).toBe(b2);
    const audioSets = vi.mocked(set).mock.calls.filter(([k]) => typeof k === 'string' && k.startsWith('hydradaw:audio:'));
    const counts = new Map<string, number>();
    for (const [k] of audioSets) counts.set(k as string, (counts.get(k as string) ?? 0) + 1);
    expect(counts.get(audioKeyForClip('clip_s1'))).toBe(1);
    expect(counts.get(audioKeyForClip('clip_s2'))).toBe(1);
  });
});

describe('persistence_migration: tope global', () => {
  it('MAX_TOTAL_AUDIO_BYTES es 300 MiB y degrada los más grandes primero', () => {
    expect(MAX_TOTAL_AUDIO_BYTES).toBe(300 * 1024 * 1024);
    const MiB = 1024 * 1024;
    const mk = (id: string, size: number) => ({ id, bytes: { byteLength: size } as unknown as Uint8Array });
    // Entradas ya ordenadas de menor a mayor (como en saveProjectNow).
    const kept = applyTotalAudioBudget([mk('a', 50 * MiB), mk('b', 150 * MiB), mk('c', 200 * MiB)], 300 * MiB);
    expect(kept.map((e) => e.id)).toEqual(['a', 'b']);
    // Presupuesto menor que el clip más pequeño: no sobrevive ninguno.
    expect(applyTotalAudioBudget([mk('a', 50 * MiB)], 10 * MiB)).toEqual([]);
    // Todo cabe: no se degrada nada.
    expect(applyTotalAudioBudget([mk('a', 1), mk('b', 2)], 300 * MiB).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('persistence_migration: autosave sin currentTime/isPlaying', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('el snapshot excluye el reloj pero detecta cambios reales', () => {
    const base = {
      ...baseState(),
      tracks: [demoTrack('t')],
      clips: [] as AudioClip[],
    };
    const a = selectAutosaveSnapshot(base);
    expect(selectAutosaveSnapshot({ ...base, currentTime: 999 })).toEqual(a);
    expect(selectAutosaveSnapshot({ ...base, bpm: 140 })).not.toEqual(a);
  });

  it('los ticks del reloj no rearman el debounce; un cambio real sí guarda', async () => {
    vi.useFakeTimers();
    try {
      const listeners: Array<() => void> = [];
      const subscribeFn = vi.fn((listener: () => void) => {
        listeners.push(listener);
        return vi.fn();
      });
      let rev = 1;
      const stop = startAutosave(subscribeFn, () => rev);
      listeners[0]!();
      listeners[0]!();
      await vi.advanceTimersByTimeAsync(2500);
      expect(set).not.toHaveBeenCalled();

      rev = 2;
      listeners[0]!();
      await vi.advanceTimersByTimeAsync(1999);
      expect(set).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(set).toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
