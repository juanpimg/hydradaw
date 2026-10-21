// Task 13 (ST-01, ST-02, ST-03, ST-11): historial completo y sin fugas.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioClip, AudioTrack } from '../types/daw';

vi.mock('../audio/AudioEngine', () => {
  const masterBus = { setVolume: vi.fn(), setMute: vi.fn() };
  return {
    audioEngine: {
      play: vi.fn(),
      stop: vi.fn(() => 0),
      rewind: vi.fn(),
      syncTracks: vi.fn(),
      rebuildTrackEffects: vi.fn(),
      getMasterBus: vi.fn(() => masterBus),
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
  };
});

vi.mock('../audio/waveformUtils', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../audio/waveformUtils')>();
  return { ...mod, generateWaveformPeaks: vi.fn(() => new Float32Array([1, 2, 3])) };
});

import { useDawStore, resetHistory } from '../store/useDawStore';
import { audioEngine } from '../audio/AudioEngine';

const mockedEngine = vi.mocked(audioEngine);

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
    plugins: [
      {
        instanceId: 'inst_1',
        pluginId: 'eq3',
        name: 'EQ',
        enabled: true,
        parameters: { lowGain: 0 },
      },
    ],
    ...overrides,
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

function masterBus() {
  return mockedEngine.getMasterBus() as unknown as {
    setVolume: ReturnType<typeof vi.fn>;
    setMute: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  resetHistory();
  vi.clearAllMocks();
  useDawStore.setState({
    projectName: 'Test',
    bpm: 120,
    timeSignature: [4, 4],
    currentTime: 0,
    duration: 32,
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    metronome: false,
    masterVolume: 1.0,
    masterMute: false,
    snapMode: '1/16',
    selectedTrackId: null,
    selectedClipIds: [],
    tracks: [makeTrack()],
    clips: [makeClip()],
    toasts: [],
  });
});

describe('history (ST-01/02/03/11)', () => {
  it('H1: updateTrack (volumen) y luego undo() devuelve el volumen anterior', () => {
    useDawStore.getState().updateTrack('track_1', { volume: 0.5 });
    expect(useDawStore.getState().tracks[0]!.volume).toBe(0.5);
    useDawStore.getState().undo();
    expect(useDawStore.getState().tracks[0]!.volume).toBe(1.0);
  });

  it('H2: updatePluginParam y luego undo() devuelve el parámetro anterior', () => {
    useDawStore.getState().updatePluginParam('track_1', 'inst_1', 'lowGain', 5);
    expect(useDawStore.getState().tracks[0]!.plugins[0]!.parameters['lowGain']).toBe(5);
    useDawStore.getState().undo();
    expect(useDawStore.getState().tracks[0]!.plugins[0]!.parameters['lowGain']).toBe(0);
  });

  it('H3: addPluginToTrack y luego undo() hace desaparecer el plugin', () => {
    useDawStore.getState().addPluginToTrack('track_1', 'eq3');
    expect(useDawStore.getState().tracks[0]!.plugins).toHaveLength(2);
    useDawStore.getState().undo();
    expect(useDawStore.getState().tracks[0]!.plugins).toHaveLength(1);
  });

  it('H4: undo() de una acción registrable restaura el BPM del snapshot (setBpm solo no registra historial)', () => {
    useDawStore.getState().addTrack('Base');
    useDawStore.getState().setBpm(150);
    expect(useDawStore.getState().bpm).toBe(150);
    useDawStore.getState().undo();
    expect(useDawStore.getState().bpm).toBe(120);
    expect(mockedEngine.setTempo).toHaveBeenLastCalledWith(120);
  });

  it('H4c: los ajustes de transporte no registran historial por sí solos (contrato real)', () => {
    // Ni setBpm ni los toggles ni el volumen master son deshacibles por sí
    // mismos: undo() sin acción registrable previa es un no-op.
    useDawStore.getState().setBpm(150);
    useDawStore.getState().toggleLoop();
    useDawStore.getState().toggleMetronome();
    useDawStore.getState().setMasterVolume(0.3);
    expect(useDawStore.getState().canUndo).toBe(false);
    useDawStore.getState().undo();
    const s = useDawStore.getState();
    expect(s.bpm).toBe(150);
    expect(s.isLooping).toBe(true);
    expect(s.metronome).toBe(true);
    expect(s.masterVolume).toBe(0.3);
    // ...pero el snapshot de la siguiente acción registrable LOS INCLUYE, y
    // deshacerla los restaura y reinyecta en el engine (eso fijan H4/H4b).
    useDawStore.getState().addTrack('Posterior');
    expect(useDawStore.getState().canUndo).toBe(true);
    useDawStore.getState().undo();
    const back = useDawStore.getState();
    expect(back.tracks).toHaveLength(1);
    expect(back.bpm).toBe(150);
    expect(back.isLooping).toBe(true);
    expect(back.metronome).toBe(true);
    expect(back.masterVolume).toBe(0.3);
    expect(mockedEngine.setTempo).toHaveBeenLastCalledWith(150);
    expect(mockedEngine.setLoop).toHaveBeenLastCalledWith(true, 0, 16);
    expect(mockedEngine.setMetronome).toHaveBeenLastCalledWith(true);
    expect(masterBus().setVolume).toHaveBeenLastCalledWith(0.3);
  });
  it('H4b: undo() de una acción registrable reinyecta loop/metrónomo/master (esos ajustes solos no registran historial)', () => {
    useDawStore.getState().addTrack('Base');
    useDawStore.getState().toggleLoop();
    useDawStore.getState().toggleMetronome();
    useDawStore.getState().setMasterVolume(0.3);
    expect(useDawStore.getState().isLooping).toBe(true);
    useDawStore.getState().undo();
    const s = useDawStore.getState();
    expect(s.isLooping).toBe(false);
    expect(s.metronome).toBe(false);
    expect(s.masterVolume).toBe(1.0);
    expect(mockedEngine.setLoop).toHaveBeenLastCalledWith(false, 0, 16);
    expect(mockedEngine.setMetronome).toHaveBeenLastCalledWith(false);
    expect(masterBus().setVolume).toHaveBeenLastCalledWith(1.0);
  });

  it('H5: undo() tras createBlankProject() no resucita pistas del proyecto anterior', async () => {
    useDawStore.setState({
      tracks: [makeTrack({ id: 'track_old' })],
      clips: [makeClip({ id: 'clip_old', trackId: 'track_old' })],
    });
    useDawStore.getState().addTrack('Nueva');
    await useDawStore.getState().createBlankProject();
    expect(useDawStore.getState().tracks).toHaveLength(0);
    useDawStore.getState().undo();
    expect(useDawStore.getState().tracks).toHaveLength(0);
    expect(useDawStore.getState().clips.find((c) => c.id === 'clip_old')).toBeUndefined();
  });

  it('H6: undo() tras loadDemoProject() no resucita clips del proyecto anterior', async () => {
    useDawStore.setState({
      tracks: [makeTrack({ id: 'track_old' })],
      clips: [makeClip({ id: 'clip_old', trackId: 'track_old' })],
    });
    useDawStore.getState().addTrack('Nueva');
    await useDawStore.getState().loadDemoProject();
    expect(useDawStore.getState().tracks.length).toBeGreaterThan(0);
    useDawStore.getState().undo();
    expect(useDawStore.getState().clips.find((c) => c.id === 'clip_old')).toBeUndefined();
    expect(useDawStore.getState().tracks.find((t) => t.id === 'track_old')).toBeUndefined();
  });

  it('H7: trimClip(id, left, 0) no registra historial (canUndo sigue en false)', () => {
    expect(useDawStore.getState().canUndo).toBe(false);
    useDawStore.getState().trimClip('clip_1', 'left', 0);
    expect(useDawStore.getState().canUndo).toBe(false);
    expect(useDawStore.getState().clips[0]).toMatchObject({ startTime: 0, duration: 8, offset: 0 });
  });

  it('H8: undo() de un removeClip devuelve el clip y la selección', () => {
    useDawStore.setState({ selectedClipIds: ['clip_1'] });
    useDawStore.getState().removeClip('clip_1');
    expect(useDawStore.getState().clips).toHaveLength(0);
    expect(useDawStore.getState().selectedClipIds).toEqual([]);
    useDawStore.getState().undo();
    expect(useDawStore.getState().clips).toHaveLength(1);
    expect(useDawStore.getState().selectedClipIds).toEqual(['clip_1']);
  });

  it('H9: tras updateClip (arrastre), undo() devuelve el startTime', () => {
    useDawStore.getState().updateClip('clip_1', { startTime: 5 });
    expect(useDawStore.getState().clips[0]!.startTime).toBe(5);
    useDawStore.getState().undo();
    expect(useDawStore.getState().clips[0]!.startTime).toBe(0);
  });

  it('removePluginFromTrack y togglePlugin también se pueden deshacer', () => {
    useDawStore.getState().togglePlugin('track_1', 'inst_1');
    expect(useDawStore.getState().tracks[0]!.plugins[0]!.enabled).toBe(false);
    useDawStore.getState().undo();
    expect(useDawStore.getState().tracks[0]!.plugins[0]!.enabled).toBe(true);

    useDawStore.getState().removePluginFromTrack('track_1', 'inst_1');
    expect(useDawStore.getState().tracks[0]!.plugins).toHaveLength(0);
    useDawStore.getState().undo();
    expect(useDawStore.getState().tracks[0]!.plugins).toHaveLength(1);
  });

  it('redo() restaura el estado extendido (BPM)', () => {
    useDawStore.getState().addTrack('Base');
    useDawStore.getState().setBpm(150);
    useDawStore.getState().undo();
    expect(useDawStore.getState().bpm).toBe(120);
    useDawStore.getState().redo();
    expect(useDawStore.getState().bpm).toBe(150);
    expect(mockedEngine.setTempo).toHaveBeenLastCalledWith(150);
  });

  it('updatePluginParam coalesce: ráfaga rápida genera un solo snapshot', () => {
    const t0 = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      useDawStore.getState().updatePluginParam('track_1', 'inst_1', 'lowGain', 5);
      spy.mockReturnValue(t0 + 100);
      useDawStore.getState().updatePluginParam('track_1', 'inst_1', 'lowGain', 9);
      expect(useDawStore.getState().tracks[0]!.plugins[0]!.parameters['lowGain']).toBe(9);
      useDawStore.getState().undo();
      expect(useDawStore.getState().tracks[0]!.plugins[0]!.parameters['lowGain']).toBe(0);
      expect(useDawStore.getState().canUndo).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('updatePluginParam fuerza snapshot pasados 400 ms', () => {
    const t0 = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      useDawStore.getState().updatePluginParam('track_1', 'inst_1', 'lowGain', 5);
      spy.mockReturnValue(t0 + 500);
      useDawStore.getState().updatePluginParam('track_1', 'inst_1', 'lowGain', 9);
      useDawStore.getState().undo();
      expect(useDawStore.getState().tracks[0]!.plugins[0]!.parameters['lowGain']).toBe(5);
      useDawStore.getState().undo();
      expect(useDawStore.getState().tracks[0]!.plugins[0]!.parameters['lowGain']).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
