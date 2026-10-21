// Task 12 (ST-10): los updaters de `set()` deben ser puros.
// Estrategia: el engine se espía con implementaciones que capturan
// `useDawStore.getState()` EN EL MOMENTO de la llamada. Si el efecto corre
// dentro del updater, el estado visible aún es el anterior (zustand fusiona
// el parcial DESPUÉS de invocar al updater) → el test falla. Si corre fuera
// del `set`, el estado ya contiene la mutación → el test pasa.
// Además cada acción debe disparar su efecto exactamente una vez.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioClip, AudioTrack } from '../types/daw';

vi.mock('../audio/AudioEngine', () => ({
  audioEngine: {
    play: vi.fn(),
    stop: vi.fn(() => 0),
    rewind: vi.fn(),
    syncTracks: vi.fn(),
    rebuildTrackEffects: vi.fn(),
    getMasterBus: vi.fn(() => null),
    getCurrentTime: vi.fn(() => 0),
    ensureContext: vi.fn(),
    setTempo: vi.fn(),
    updateTrackPluginParam: vi.fn(),
    setLoop: vi.fn(),
    setMetronome: vi.fn(),
    setTimeSignature: vi.fn(),
    seek: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  },
}));

import { useDawStore, resetHistory } from '../store/useDawStore';
import { audioEngine } from '../audio/AudioEngine';

const mockedEngine = vi.mocked(audioEngine);

interface SeenCall {
  method: 'syncTracks' | 'play' | 'rebuildTrackEffects';
  tracks: AudioTrack[];
  clips: AudioClip[];
}

let seen: SeenCall[] = [];

function makeTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: 'track_1',
    name: 'Pista 1',
    type: 'audio',
    color: '#06b6d4',
    volume: 1.0,
    pan: 0,
    mute: false,
    solo: false,
    armed: true,
    plugins: [],
    ...overrides,
  };
}

function makePlugin() {
  return {
    instanceId: 'inst_1',
    pluginId: 'eq3',
    name: 'EQ',
    enabled: true,
    parameters: { lowGain: 0 },
  };
}

function makeClip(overrides: Partial<AudioClip> = {}): AudioClip {
  return {
    id: 'clip_1',
    trackId: 'track_1',
    name: 'Clip 1',
    startTime: 0,
    duration: 8,
    offset: 0,
    audioBuffer: null,
    peaks: new Float32Array(0),
    color: '#06b6d4',
    ...overrides,
  };
}

beforeEach(() => {
  resetHistory();
  vi.clearAllMocks();
  seen = [];
  mockedEngine.syncTracks.mockImplementation(async () => {
    const s = useDawStore.getState();
    seen.push({ method: 'syncTracks', tracks: s.tracks, clips: s.clips });
  });
  mockedEngine.play.mockImplementation(async () => {
    const s = useDawStore.getState();
    seen.push({ method: 'play', tracks: s.tracks, clips: s.clips });
    return true;
  });
  mockedEngine.rebuildTrackEffects.mockImplementation(() => {
    const s = useDawStore.getState();
    seen.push({ method: 'rebuildTrackEffects', tracks: s.tracks, clips: s.clips });
  });
  useDawStore.setState({
    tracks: [makeTrack()],
    clips: [makeClip()],
    bpm: 120,
    currentTime: 0,
    duration: 32,
    isPlaying: false,
    isRecording: false,
    selectedClipIds: [],
    selectedTrackId: null,
    toasts: [],
  });
});

function callsOf(method: SeenCall['method']): SeenCall[] {
  return seen.filter((c) => c.method === method);
}

describe('store purity (ST-10)', () => {
  it('addTrack: syncTracks se llama una vez y ve la pista nueva', () => {
    const id = useDawStore.getState().addTrack('Pista P');
    expect(callsOf('syncTracks')).toHaveLength(1);
    expect(callsOf('syncTracks')[0]!.tracks.map((t) => t.id)).toContain(id);
  });

  it('removeTrack: syncTracks se llama una vez y ya no ve la pista', () => {
    useDawStore.getState().removeTrack('track_1');
    expect(callsOf('syncTracks')).toHaveLength(1);
    expect(callsOf('syncTracks')[0]!.tracks).toHaveLength(0);
    expect(mockedEngine.play).not.toHaveBeenCalled();
  });

  it('updateTrack: syncTracks se llama una vez y ve el volumen nuevo', () => {
    useDawStore.getState().updateTrack('track_1', { volume: 0.5 });
    expect(callsOf('syncTracks')).toHaveLength(1);
    expect(callsOf('syncTracks')[0]!.tracks[0]!.volume).toBe(0.5);
  });

  it('addClip: no dispara efectos del engine', () => {
    useDawStore.getState().addClip(makeClip({ id: 'clip_2', startTime: 10 }));
    expect(seen).toHaveLength(0);
    expect(useDawStore.getState().clips).toHaveLength(2);
  });

  it('updateClip en play: play se llama una vez y ve el clip movido', () => {
    useDawStore.setState({ isPlaying: true });
    useDawStore.getState().updateClip('clip_1', { startTime: 2 });
    expect(callsOf('play')).toHaveLength(1);
    expect(callsOf('play')[0]!.clips[0]!.startTime).toBe(2);
  });

  it('removeClip en play: play se llama una vez y ya no ve el clip', () => {
    useDawStore.setState({ isPlaying: true, selectedClipIds: ['clip_1'] });
    useDawStore.getState().removeClip('clip_1');
    expect(callsOf('play')).toHaveLength(1);
    expect(callsOf('play')[0]!.clips).toHaveLength(0);
  });

  it('splitClip: no dispara efectos del engine', () => {
    useDawStore.getState().splitClip('clip_1', 3);
    expect(seen).toHaveLength(0);
    expect(useDawStore.getState().clips).toHaveLength(2);
  });

  it('trimClip: no dispara efectos del engine', () => {
    useDawStore.getState().trimClip('clip_1', 'right', 2);
    expect(seen).toHaveLength(0);
    expect(useDawStore.getState().clips[0]!.duration).toBeCloseTo(10, 5);
  });

  it('addPluginToTrack: rebuildTrackEffects se llama una vez y ve el plugin', () => {
    useDawStore.getState().addPluginToTrack('track_1', 'eq3');
    expect(callsOf('rebuildTrackEffects')).toHaveLength(1);
    expect(callsOf('rebuildTrackEffects')[0]!.tracks[0]!.plugins).toHaveLength(1);
  });

  it('removePluginFromTrack: rebuildTrackEffects se llama una vez y ya no ve el plugin', () => {
    useDawStore.setState({ tracks: [makeTrack({ plugins: [makePlugin()] })] });
    useDawStore.getState().removePluginFromTrack('track_1', 'inst_1');
    expect(callsOf('rebuildTrackEffects')).toHaveLength(1);
    expect(callsOf('rebuildTrackEffects')[0]!.tracks[0]!.plugins).toHaveLength(0);
  });

  it('togglePlugin: rebuildTrackEffects se llama una vez y ve el cambio', () => {
    useDawStore.setState({ tracks: [makeTrack({ plugins: [makePlugin()] })] });
    useDawStore.getState().togglePlugin('track_1', 'inst_1');
    expect(callsOf('rebuildTrackEffects')).toHaveLength(1);
    expect(callsOf('rebuildTrackEffects')[0]!.tracks[0]!.plugins[0]!.enabled).toBe(false);
  });

  it('pushToast: ids monótonos sin huecos', () => {
    useDawStore.getState().pushToast('uno');
    useDawStore.getState().pushToast('dos');
    const toasts = useDawStore.getState().toasts;
    expect(toasts).toHaveLength(2);
    expect(toasts[1]!.id).toBe(toasts[0]!.id + 1);
  });
});
