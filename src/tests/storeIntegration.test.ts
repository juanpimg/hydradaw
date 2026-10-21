// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioClip, AudioTrack } from '../types/daw';

// Mock del engine: el store lo llama en setBpm/updatePluginParam/setCurrentTime;
// en entorno node no hay AudioContext, así que se sustituye por spies.
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

// Mock de picos: evita necesitar un AudioBuffer real decodificado.
vi.mock('../audio/waveformUtils', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../audio/waveformUtils')>();
  return { ...mod, generateWaveformPeaks: vi.fn(() => new Float32Array([1, 2, 3])) };
});

import { useDawStore } from '../store/useDawStore';
import { audioEngine } from '../audio/AudioEngine';

const mockedEngine = vi.mocked(audioEngine);

function fakeBuffer(duration: number): AudioBuffer {
  return { duration } as unknown as AudioBuffer;
}

function makeTrack(): AudioTrack {
  return {
    id: 'track_1',
    name: 'Pista 1',
    type: 'audio',
    color: '#06b6d4',
    volume: 1.0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    plugins: [
      {
        instanceId: 'inst_1',
        pluginId: 'eq3',
        name: 'EQ',
        enabled: true,
        parameters: { lowGain: 0 },
      },
    ],
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
    audioBuffer: fakeBuffer(16),
    peaks: new Float32Array([0, 0]),
    color: '#06b6d4',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDawStore.setState({
    tracks: [],
    clips: [],
    bpm: 120,
    currentTime: 0,
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    metronome: false,
    selectedClipIds: [],
    selectedTrackId: null,
  });
});

describe('store integration (wave2)', () => {
  it('updatePluginParam actualiza estado y propaga al engine en vivo', () => {
    useDawStore.setState({ tracks: [makeTrack()] });
    useDawStore.getState().updatePluginParam('track_1', 'inst_1', 'lowGain', 5);

    const track = useDawStore.getState().tracks[0]!;
    expect(track.plugins[0]!.parameters.lowGain).toBe(5);
    expect(mockedEngine.updateTrackPluginParam).toHaveBeenCalledWith(
      'track_1',
      'inst_1',
      'lowGain',
      5
    );
  });

  it('setBpm actualiza estado y propaga tempo al engine', () => {
    useDawStore.getState().setBpm(140);
    expect(useDawStore.getState().bpm).toBe(140);
    expect(mockedEngine.setTempo).toHaveBeenCalledWith(140);
  });

  it('setCurrentTime sin reproducción no llama a play; en reproducción replanifica', () => {
    useDawStore.getState().setCurrentTime(4);
    expect(useDawStore.getState().currentTime).toBe(4);
    expect(mockedEngine.play).not.toHaveBeenCalled();

    useDawStore.setState({ isPlaying: true });
    useDawStore.getState().setCurrentTime(6);
    expect(mockedEngine.play).toHaveBeenCalledTimes(1);
  });

  it('splitClip válido delega en la operación (ids únicos) y selecciona el 2º slice', () => {
    useDawStore.setState({ clips: [makeClip()] });
    useDawStore.getState().splitClip('clip_1', 3);

    const clips = useDawStore.getState().clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]!.duration).toBeCloseTo(3, 5);
    expect(clips[1]!.startTime).toBe(3);
    expect(clips[1]!.duration).toBeCloseTo(5, 5);
    expect(clips[1]!.offset).toBeCloseTo(3, 5);
    expect(clips[1]!.id).toContain('split');
    expect(useDawStore.getState().selectedClipIds).toEqual([clips[1]!.id]);
  });

  it('splitClip respeta minDuration 0.2: corte pegado al borde no muta', () => {
    useDawStore.setState({ clips: [makeClip()] });
    useDawStore.getState().splitClip('clip_1', 0.1);

    expect(useDawStore.getState().clips).toHaveLength(1);
    expect(useDawStore.getState().clips[0]!.duration).toBe(8);
    expect(useDawStore.getState().selectedClipIds).toEqual([]);
  });

  it('splitClip con clip inexistente no muta', () => {
    useDawStore.setState({ clips: [makeClip()] });
    useDawStore.getState().splitClip('nope', 3);
    expect(useDawStore.getState().clips).toHaveLength(1);
  });

  it('trimClip left acorta por la izquierda (start/duration/offset)', () => {
    useDawStore.setState({ clips: [makeClip()] });
    useDawStore.getState().trimClip('clip_1', 'left', 2);

    const clip = useDawStore.getState().clips[0]!;
    expect(clip.startTime).toBeCloseTo(2, 5);
    expect(clip.duration).toBeCloseTo(6, 5);
    expect(clip.offset).toBeCloseTo(2, 5);
  });

  it('trimClip right extiende/recorta y satura a minDuration', () => {
    useDawStore.setState({ clips: [makeClip()] });
    useDawStore.getState().trimClip('clip_1', 'right', 2);
    expect(useDawStore.getState().clips[0]!.duration).toBeCloseTo(10, 5);

    useDawStore.getState().trimClip('clip_1', 'right', -100);
    expect(useDawStore.getState().clips[0]!.duration).toBeCloseTo(0.2, 5);
  });

  it('trimClip con clip inexistente no muta', () => {
    useDawStore.setState({ clips: [makeClip()] });
    useDawStore.getState().trimClip('nope', 'left', 1);
    expect(useDawStore.getState().clips).toHaveLength(1);
  });

  it('toggleLoop/toggleMetronome conmutan flags y propagan al engine (Fix wave4)', () => {
    useDawStore.getState().toggleLoop();
    expect(useDawStore.getState().isLooping).toBe(true);
    expect(mockedEngine.setLoop).toHaveBeenCalledWith(true, 0, 16);
    useDawStore.getState().toggleMetronome();
    expect(useDawStore.getState().metronome).toBe(true);
    expect(mockedEngine.setMetronome).toHaveBeenCalledWith(true);
  });

  describe('Undo / Redo History System (Task 3.1)', () => {
    it('restores previous track and clip state on undo and redo', () => {
      useDawStore.setState({ tracks: [makeTrack()], clips: [makeClip()] });
      expect(useDawStore.getState().clips).toHaveLength(1);

      // Add a second clip
      useDawStore.getState().addClip({
        ...makeClip(),
        id: 'clip_2',
        startTime: 10,
        duration: 5,
      });
      expect(useDawStore.getState().clips).toHaveLength(2);
      expect(useDawStore.getState().canUndo).toBe(true);

      // Undo adds of clip_2
      useDawStore.getState().undo();
      expect(useDawStore.getState().clips).toHaveLength(1);
      expect(useDawStore.getState().clips[0]!.id).toBe('clip_1');
      expect(useDawStore.getState().canRedo).toBe(true);

      // Redo adds of clip_2
      useDawStore.getState().redo();
      expect(useDawStore.getState().clips).toHaveLength(2);
      expect(useDawStore.getState().clips[1]!.id).toBe('clip_2');
    });

    it('undoes track removal', () => {
      const initialTrack = makeTrack();
      useDawStore.setState({ tracks: [initialTrack], clips: [] });

      useDawStore.getState().removeTrack(initialTrack.id);
      expect(useDawStore.getState().tracks).toHaveLength(0);

      useDawStore.getState().undo();
      expect(useDawStore.getState().tracks).toHaveLength(1);
      expect(useDawStore.getState().tracks[0]!.id).toBe(initialTrack.id);
    });
  });
});
