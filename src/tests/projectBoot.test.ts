import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioClip, AudioTrack } from '../types/daw';

// Mock de idb-keyval en memoria (mismo patrón que persistence.test.ts).
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
  };
});

// Mock del engine: sin AudioContext en Node.
vi.mock('../audio/AudioEngine', () => ({
  audioEngine: {
    play: vi.fn(),
    stop: vi.fn(() => 0),
    rewind: vi.fn(),
    syncTracks: vi.fn(),
    rebuildTrackEffects: vi.fn(),
    getMasterBus: vi.fn(() => null),
    getCurrentTime: vi.fn(() => 0),
    ensureContext: vi.fn(async () => null),
    setTempo: vi.fn(),
    updateTrackPluginParam: vi.fn(),
    setLoop: vi.fn(),
    setMetronome: vi.fn(),
    setTimeSignature: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  },
}));

import { useDawStore } from '../store/useDawStore';
import { audioEngine } from '../audio/AudioEngine';
import {
  saveProjectNow,
  clearSavedProject,
  peekSavedProjectName,
  importProjectFromJson,
} from '../store/persistence';

const mockedEngine = vi.mocked(audioEngine);

function seedProject() {
  const track = {
    id: 't1',
    name: 'Pista 1',
    type: 'audio',
    color: '#38bdf8',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    plugins: [],
  } as unknown as AudioTrack;
  const clip = {
    id: 'c1',
    trackId: 't1',
    name: 'Clip 1',
    startTime: 0,
    duration: 4,
    offset: 0,
    audioBuffer: null,
    peaks: new Float32Array(0),
  } as unknown as AudioClip;
  useDawStore.setState({
    projectName: 'Semilla',
    bpm: 140,
    duration: 32,
    tracks: [track],
    clips: [clip],
    isPlaying: false,
    isRecording: false,
  });
}

function minimalEnvelope(name: string): Record<string, unknown> {
  return {
    version: 1,
    savedAt: Date.now(),
    projectName: name,
    bpm: 100,
    timeSignature: [3, 4],
    currentTime: 0,
    duration: 24,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    metronome: false,
    masterVolume: 0.8,
    masterMute: false,
    zoom: 50,
    scrollLeft: 0,
    activeView: 'timeline',
    selectedTrackId: null,
    selectedClipId: null,
    tracks: [{ id: 't9', name: 'Importada' }],
    clips: [],
    audioClipIds: [],
  };
}

describe('arranque por pantalla de inicio', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearSavedProject();
    useDawStore.setState({
      projectName: 'Mi Canción Local',
      bpm: 120,
      duration: 32,
      tracks: [],
      clips: [],
      isPlaying: false,
      isRecording: false,
    });
  });

  it('createBlankProject vacía y resetea el proyecto', async () => {
    seedProject();
    await useDawStore.getState().createBlankProject();
    const s = useDawStore.getState();
    expect(s.tracks).toHaveLength(0);
    expect(s.clips).toHaveLength(0);
    expect(s.projectName).toBe('Proyecto sin título');
    expect(s.bpm).toBe(120);
    expect(s.duration).toBe(16);
    expect(s.selectedTrackId).toBeNull();
    expect(s.selectedClipId).toBeNull();
    expect(mockedEngine.stop).toHaveBeenCalled();
    expect(mockedEngine.syncTracks).toHaveBeenCalledWith([]);
  });

  it('importProjectFromJson rechaza payload inválido sin mutar', async () => {
    seedProject();
    const res = await importProjectFromJson({ hola: 'mundo' });
    expect(res.ok).toBe(false);
    expect(useDawStore.getState().projectName).toBe('Semilla');
  });

  it('importProjectFromJson aplica un envelope válido', async () => {
    const res = await importProjectFromJson(minimalEnvelope('Importado OK'));
    expect(res.ok).toBe(true);
    expect(res.name).toBe('Importado OK');
    const s = useDawStore.getState();
    expect(s.projectName).toBe('Importado OK');
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0]?.id).toBe('t9');
    expect(s.bpm).toBe(100);
    expect(mockedEngine.syncTracks).toHaveBeenCalled();
  });

  it('peekSavedProjectName: null si vacío, nombre tras guardar', async () => {
    expect(await peekSavedProjectName()).toBeNull();
    seedProject();
    await saveProjectNow();
    expect(await peekSavedProjectName()).toBe('Semilla');
  });
});
