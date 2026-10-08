// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    keys: vi.fn(async () => [...store.keys()]),
    delMany: vi.fn(async (keysArr: string[]) => {
      for (const k of keysArr) store.delete(k);
    }),
    __store: store,
  };
});

import { get, set } from 'idb-keyval';
import type { AudioClip, AudioTrack } from '../types/daw';
import { encodeWav } from '../audio/WavExporter';
import {
  serializeProject,
  deserializeProject,
  restoreClips,
  restoreAudioBuffers,
  encodeClipAudio,
  decodeWavBytes,
  saveProjectNow,
  loadSavedProject,
  clearSavedProject,
  startAutosave,
  inferDemoKind,
  stripReimportMarker,
  audioKeyForClip,
  PERSISTENCE_KEY,
  type PersistableProjectState,
} from '../store/persistence';
import { useDawStore } from '../store/useDawStore';

/** Fake mínimo de BaseAudioContext para regenerar stems demo en Node. */
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

function demoTrack(id: string, volume: number, pan: number): AudioTrack {
  return {
    id,
    name: 'track ' + id,
    type: 'audio',
    color: '#fff',
    volume,
    pan,
    mute: false,
    solo: false,
    armed: false,
    plugins: [
      {
        instanceId: 'inst_1',
        pluginId: 'eq3',
        name: 'EQ',
        enabled: true,
        parameters: { lowGain: 2 },
      },
    ],
  };
}

function demoClip(id: string, trackId: string, name: string): AudioClip {
  return {
    id,
    trackId,
    name,
    startTime: 0,
    duration: 16,
    offset: 0,
    audioBuffer: {} as AudioBuffer,
    peaks: new Float32Array([0, 1]),
    color: '#f59e0b',
  };
}

function baseState(): PersistableProjectState {
  return {
    projectName: 'Mi Proyecto',
    bpm: 128,
    timeSignature: [4, 4],
    currentTime: 3,
    duration: 20,
    isLooping: true,
    loopStart: 0,
    loopEnd: 8,
    metronome: true,
    masterVolume: 0.8,
    masterMute: false,
    zoom: 60,
    scrollLeft: 10,
    activeView: 'mixer',
    selectedTrackId: 'track_drums',
    selectedClipId: 'clip_drums_1',
    tracks: [demoTrack('track_drums', 0.95, -0.2)],
    clips: [demoClip('clip_drums_1', 'track_drums', 'Drums Groove (120 BPM)')],
  };
}

describe('persistence: serializeProject', () => {
  it('produce salida 100% JSON (sin AudioBuffer ni peaks)', () => {
    const out = serializeProject(baseState());
    const json = JSON.stringify(out);
    expect(json).not.toContain('audioBuffer');
    expect(json).not.toContain('peaks');
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(out)));
  });

  it('marca clips demo con demoKind y needsReimport=false', () => {
    const state = baseState();
    state.clips = [
      demoClip('clip_drums_1', 'track_drums', 'Drums Groove (120 BPM)'),
      demoClip('clip_bass_1', 'track_bass', 'Bass Progression'),
      demoClip('clip_chords_1', 'track_chords', 'Analog Warm Pad'),
      demoClip('clip_lead_1', 'track_lead', 'Vocal Melody Lead'),
    ];
    const out = serializeProject(state);
    expect(out.clips.map((c) => c.demoKind)).toEqual(['drums', 'bass', 'chords', 'lead']);
    expect(out.clips.every((c) => c.needsReimport === false)).toBe(true);
  });

  it('marca clips de usuario como needsReimport y conserva metadatos/pistas', () => {
    const state = baseState();
    state.tracks = [demoTrack('track_1', 0.7, 0.5)];
    state.clips = [
      { ...demoClip('clip_user_1', 'track_1', 'Guitar.wav'), startTime: 2, duration: 8, offset: 1 },
      { ...demoClip('clip_rec_1', 'track_1', 'Grabación 12:30'), duration: 5, offset: 0 },
    ];
    const out = serializeProject(state);
    expect(out.clips.every((c) => c.demoKind === null && c.needsReimport === true)).toBe(true);
    expect(out.clips[0]).toMatchObject({ startTime: 2, duration: 8, offset: 1, sourceName: 'Guitar.wav' });
    expect(out.tracks[0]).toMatchObject({ volume: 0.7, pan: 0.5 });
    expect(out.tracks[0]!.plugins[0]!.parameters).toEqual({ lowGain: 2 });
  });

  it('no acumula el marcador ⚠️ al serializar clips pendientes', () => {
    const state = baseState();
    state.clips = [{ ...demoClip('clip_user_1', 'track_1', '⚠️ Guitar.wav (reimportar)') }];
    const out = serializeProject(state);
    expect(out.clips[0]!.name).toBe('Guitar.wav');
    expect(out.clips[0]!.sourceName).toBe('Guitar.wav');
  });
});

describe('persistence: deserializeProject', () => {
  it('round-trip conserva proyecto, pistas, plugins, volúmenes, paneos y clips', () => {
    const out = serializeProject(baseState());
    const back = deserializeProject(JSON.parse(JSON.stringify(out)));
    expect(back).not.toBeNull();
    expect(back!).toMatchObject({
      projectName: 'Mi Proyecto',
      bpm: 128,
      masterVolume: 0.8,
      zoom: 60,
      isLooping: true,
    });
    expect(back!.tracks[0]).toMatchObject({ volume: 0.95, pan: -0.2 });
    expect(back!.tracks[0]!.plugins[0]!.parameters).toEqual({ lowGain: 2 });
    expect(back!.clips[0]).toMatchObject({ demoKind: 'drums', needsReimport: false });
  });

  it('migra payload legacy v0 (sin version, con buffers incrustados y sin defaults)', () => {
    const legacy = {
      projectName: 'Viejo',
      tracks: [{ ...demoTrack('track_drums', 1, 0) }],
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
        {
          id: 'clip_xyz',
          trackId: 'track_1',
          name: 'Voz.wav',
          startTime: 1,
          duration: 4,
          offset: 0,
        },
      ],
    };
    const back = deserializeProject(legacy);
    expect(back).not.toBeNull();
    expect(back!.version).toBe(1);
    expect(back!).toMatchObject({ masterVolume: 1.0, zoom: 50, metronome: false, bpm: 120 });
    expect(back!.timeSignature).toEqual([4, 4]);
    expect(back!.clips[0]).toMatchObject({ demoKind: 'drums', needsReimport: false });
    expect(back!.clips[1]).toMatchObject({ demoKind: null, needsReimport: true });
    expect(JSON.stringify(back)).not.toContain('audioBuffer');
  });

  it('devuelve null ante payload ausente o corrupto', () => {
    expect(deserializeProject(null)).toBeNull();
    expect(deserializeProject(undefined)).toBeNull();
    expect(deserializeProject('basura')).toBeNull();
    expect(deserializeProject({})).toBeNull();
    expect(deserializeProject({ tracks: [], clips: 'no-array' })).toBeNull();
  });

  it('inferDemoKind no clasifica audio de usuario como demo (sin falsos positivos)', () => {
    expect(inferDemoKind({ id: 'clip_1234_abcd', trackId: 'track_1', name: 'my drums loop.wav' })).toBeNull();
    expect(inferDemoKind({ id: 'clip_9999', trackId: 'track_drums', name: 'Grabación 12:30' })).toBeNull();
    expect(inferDemoKind({ id: 'clip_drums_1', trackId: 'track_drums', name: 'Drums Groove (120 BPM)' })).toBe('drums');
    expect(stripReimportMarker('⚠️ Voz.wav (reimportar)')).toBe('Voz.wav');
  });
});

describe('persistence: restoreClips', () => {
  it('regenera buffers y picos demo; marca clips de usuario como pendientes', () => {
    const ctx = makeFakeAudioContext();
    const clips = restoreClips(serializeProject(baseState()).clips, ctx);
    expect(clips[0]!.audioBuffer).not.toBeNull();
    expect(clips[0]!.peaks.length).toBeGreaterThan(0);
    expect(clips[0]!.needsReimport).toBe(false);
  });

  it('clips de usuario quedan con buffer null, picos vacíos y marcador visible', () => {
    const state = baseState();
    state.clips = [{ ...demoClip('clip_u1', 'track_1', 'Voz.wav'), duration: 4 }];
    const clips = restoreClips(serializeProject(state).clips, makeFakeAudioContext());
    expect(clips[0]!.audioBuffer).toBeNull();
    expect(clips[0]!.peaks.length).toBe(0);
    expect(clips[0]!.needsReimport).toBe(true);
    expect(clips[0]!.name).toContain('Voz.wav');
    expect(clips[0]!.name).toContain('⚠️');
  });
});

describe('persistence: storage + autosave (idb-keyval mockeado)', () => {
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

  it('saveProjectNow → loadSavedProject restaura nombre, pistas y clips', async () => {
    useDawStore.setState({
      projectName: 'Persistido OK',
      bpm: 100,
      tracks: [demoTrack('track_drums', 0.9, 0.1)],
      clips: [
        { ...demoClip('clip_drums_1', 'track_drums', 'Drums Groove (120 BPM)'), audioBuffer: null, peaks: new Float32Array(0) },
        { ...demoClip('clip_u1', 'track_1', 'Voz.wav'), duration: 4, audioBuffer: null, peaks: new Float32Array(0) },
      ],
    });
    await saveProjectNow();
    expect(set).toHaveBeenCalledWith(PERSISTENCE_KEY, expect.objectContaining({ projectName: 'Persistido OK' }));

    // Vacía el store y recarga desde IndexedDB (sin Web Audio en Node: fallback a metadatos)
    useDawStore.setState({ projectName: 'Otro', tracks: [], clips: [] });
    const loaded = await loadSavedProject();
    expect(loaded).toBe(true);
    const s = useDawStore.getState();
    expect(s.projectName).toBe('Persistido OK');
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0]).toMatchObject({ volume: 0.9, pan: 0.1 });
    expect(s.clips).toHaveLength(2);
    const demo = s.clips.find((c) => c.id === 'clip_drums_1') as unknown as Record<string, unknown>;
    const user = s.clips.find((c) => c.id === 'clip_u1') as unknown as Record<string, unknown>;
    expect(demo['demoKind']).toBe('drums');
    expect(demo['needsReimport']).toBe(false);
    expect(user['needsReimport']).toBe(true);
    expect(get).toHaveBeenCalledWith(PERSISTENCE_KEY);
  });

  it('loadSavedProject devuelve false si no hay nada guardado', async () => {
    expect(await loadSavedProject()).toBe(false);
  });

  it('clearSavedProject borra lo guardado', async () => {
    useDawStore.setState({ projectName: 'Temporal' });
    await saveProjectNow();
    expect(await loadSavedProject()).toBe(true);
    await clearSavedProject();
    expect(await loadSavedProject()).toBe(false);
  });

  it('startAutosave usa debounce ~2s y devuelve cancelación', async () => {
    vi.useFakeTimers();
    try {
      const listeners: Array<() => void> = [];
      const subscribeFn = vi.fn((listener: () => void) => {
        listeners.push(listener);
        return vi.fn();
      });
      const stop = startAutosave(subscribeFn);
      expect(subscribeFn).toHaveBeenCalledTimes(1);

      listeners[0]!();
      listeners[0]!();
      listeners[0]!();
      expect(set).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1999);
      expect(set).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(set).toHaveBeenCalledTimes(1);

      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('persistence: audio de usuario (WAV por clip)', () => {
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

  /** Buffer sintético no-demo (id sin prefijo demo) compatible con encode/decode. */
  function synthAudioBuffer(ctx: BaseAudioContext, seconds = 0.5, channels = 2): AudioBuffer {
    const sampleRate = 44100;
    const buf = ctx.createBuffer(channels, Math.floor(sampleRate * seconds), sampleRate);
    for (let c = 0; c < channels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.sin((2 * Math.PI * 440 * i) / sampleRate) * (c === 0 ? 0.5 : 0.25));
      }
    }
    return buf;
  }

  function userClipWithAudio(id: string, buf: AudioBuffer): AudioClip {
    return {
      id,
      trackId: 'track_1',
      name: 'Guitar.wav',
      startTime: 2,
      duration: 4,
      offset: 0,
      audioBuffer: buf,
      peaks: new Float32Array(0),
      color: '#fff',
    };
  }

  it('round-trip save→load conserva duración, canales, muestras (bit-exacto) y picos', async () => {
    const ctx = makeFakeAudioContext();
    const original = synthAudioBuffer(ctx);
    useDawStore.setState({
      projectName: 'Audio OK',
      tracks: [demoTrack('track_1', 1, 0)],
      clips: [userClipWithAudio('clip_user_1', original)],
    });
    await saveProjectNow();

    const raw = (await get(PERSISTENCE_KEY)) as { audioClipIds: string[] };
    expect(raw.audioClipIds).toEqual(['clip_user_1']);
    expect(await get(audioKeyForClip('clip_user_1'))).toBeInstanceOf(Uint8Array);

    const data = deserializeProject(raw);
    expect(data).not.toBeNull();
    const clips = restoreClips(data!.clips, ctx);
    expect(clips[0]!.audioBuffer).toBeNull();
    expect(clips[0]!.needsReimport).toBe(true);

    const res = await restoreAudioBuffers(clips, ctx);
    expect(res).toEqual({ restored: 1, failed: 0, missing: 0 });
    const restoredBuf = clips[0]!.audioBuffer!;
    expect(restoredBuf.numberOfChannels).toBe(original.numberOfChannels);
    expect(restoredBuf.duration).toBeCloseTo(original.duration, 6);
    for (let c = 0; c < original.numberOfChannels; c++) {
      expect(Array.from(restoredBuf.getChannelData(c))).toEqual(
        Array.from(original.getChannelData(c)),
      );
    }
    expect(clips[0]!.peaks.length).toBeGreaterThan(0);
    expect(clips[0]!.needsReimport).toBe(false);
    expect(clips[0]!.name).toBe('Guitar.wav');
  });

  it('decodeWavBytes soporta PCM-16 con error de cuantización ≈ 2/32768', () => {
    const ctx = makeFakeAudioContext();
    const original = synthAudioBuffer(ctx, 0.1, 1);
    const decoded = decodeWavBytes(encodeWav(original, 16), ctx);
    expect(decoded.numberOfChannels).toBe(1);
    const a = original.getChannelData(0);
    const b = decoded.getChannelData(0);
    expect(b.length).toBe(a.length);
    let maxDiff = 0;
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i]! - b[i]!));
    expect(maxDiff).toBeLessThanOrEqual(2 / 32768);
  });

  it('bytes corruptos conservan el fallback ⚠️ sin lanzar', async () => {
    const ctx = makeFakeAudioContext();
    await set(audioKeyForClip('clip_bad'), new Uint8Array([1, 2, 3]));
    const clips = restoreClips(
      [{
        id: 'clip_bad', trackId: 't', name: 'Malo.wav', startTime: 0,
        duration: 1, offset: 0, demoKind: null, needsReimport: true,
      }],
      ctx,
    );
    const res = await restoreAudioBuffers(clips, ctx);
    expect(res.failed).toBe(1);
    expect(clips[0]!.audioBuffer).toBeNull();
    expect(clips[0]!.needsReimport).toBe(true);
  });

  it('recurre al parser interno si decodeAudioData nativo falla', async () => {
    const ctx = makeFakeAudioContext();
    useDawStore.setState({
      projectName: 'Fallback',
      tracks: [demoTrack('track_1', 1, 0)],
      clips: [userClipWithAudio('clip_user_1', synthAudioBuffer(ctx))],
    });
    await saveProjectNow();

    const raw = await get(PERSISTENCE_KEY);
    const clips = restoreClips(deserializeProject(raw)!.clips, ctx);
    const ctxConNativoRoto = Object.assign(ctx, {
      decodeAudioData: async () => { throw new Error('native boom'); },
    });
    const res = await restoreAudioBuffers(clips, ctxConNativoRoto);
    expect(res.restored).toBe(1);
    expect(clips[0]!.audioBuffer).not.toBeNull();
  });

  it('al guardar borra el audio de clips que ya no existen (anti-huérfanos)', async () => {
    const ctx = makeFakeAudioContext();
    useDawStore.setState({
      projectName: 'Huérfanos',
      tracks: [demoTrack('track_1', 1, 0)],
      clips: [userClipWithAudio('clip_old', synthAudioBuffer(ctx))],
    });
    await saveProjectNow();
    expect(await get(audioKeyForClip('clip_old'))).toBeInstanceOf(Uint8Array);

    useDawStore.setState({ clips: [userClipWithAudio('clip_new', synthAudioBuffer(ctx, 0.25, 1))] });
    await saveProjectNow();
    expect(await get(audioKeyForClip('clip_old'))).toBeUndefined();
    expect(await get(audioKeyForClip('clip_new'))).toBeInstanceOf(Uint8Array);
    const raw = (await get(PERSISTENCE_KEY)) as { audioClipIds: string[] };
    expect(raw.audioClipIds).toEqual(['clip_new']);
  });

  it('ante QuotaExceededError degrada a metadatos sin romper el guardado principal', async () => {
    const ctx = makeFakeAudioContext();
    useDawStore.setState({
      projectName: 'Sin cuota',
      tracks: [demoTrack('track_1', 1, 0)],
      clips: [userClipWithAudio('clip_user_1', synthAudioBuffer(ctx))],
    });
    // Solo falla la primera escritura (el WAV); el registro principal debe pasar.
    vi.mocked(set).mockRejectedValueOnce(
      Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' }),
    );
    await expect(saveProjectNow()).resolves.toBeUndefined();

    const raw = (await get(PERSISTENCE_KEY)) as { projectName: string; audioClipIds: string[] };
    expect(raw.projectName).toBe('Sin cuota');
    expect(raw.audioClipIds).toEqual([]);
    expect(await get(audioKeyForClip('clip_user_1'))).toBeUndefined();

    const clips = restoreClips(deserializeProject(raw)!.clips, ctx);
    const res = await restoreAudioBuffers(clips, ctx);
    expect(res).toEqual({ restored: 0, failed: 0, missing: 1 });
    expect(clips[0]!.needsReimport).toBe(true);
  });

  it('saveProjectNow nunca lanza aunque todo el almacenamiento falle', async () => {
    const impl = vi.mocked(set).getMockImplementation();
    vi.mocked(set).mockRejectedValue(new Error('IDB roto'));
    try {
      useDawStore.setState({ projectName: 'Todo roto' });
      await expect(saveProjectNow()).resolves.toBeUndefined();
      await expect(clearSavedProject()).resolves.toBeUndefined();
    } finally {
      vi.mocked(set).mockImplementation(impl!);
    }
  });

  it('encodeClipAudio omite buffers gigantes sin asignar memoria', () => {
    const huge = {
      numberOfChannels: 2,
      length: 100_000_000, // ~800 MB en 32-float: muy por encima del límite
      sampleRate: 44100,
      getChannelData: () => { throw new Error('no debería llamarse'); },
    } as unknown as AudioBuffer;
    expect(encodeClipAudio(huge)).toBeNull();
    expect(encodeClipAudio(null)).toBeNull();
  });

  it('clearSavedProject borra también las entradas de audio', async () => {
    const ctx = makeFakeAudioContext();
    useDawStore.setState({
      projectName: 'Temporal',
      tracks: [demoTrack('track_1', 1, 0)],
      clips: [userClipWithAudio('clip_user_1', synthAudioBuffer(ctx))],
    });
    await saveProjectNow();
    expect(await get(audioKeyForClip('clip_user_1'))).toBeInstanceOf(Uint8Array);
    await clearSavedProject();
    expect(await get(audioKeyForClip('clip_user_1'))).toBeUndefined();
    expect(await loadSavedProject()).toBe(false);
  });
});
