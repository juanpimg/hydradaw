// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioClip, AudioTrack } from '../types/daw';

// Mock del engine con el mismo patrón que storeIntegration.test.ts (node sin AudioContext).
vi.mock('../audio/AudioEngine', () => ({
  audioEngine: {
    play: vi.fn(),
    stop: vi.fn(() => 0),
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

import { useDawStore } from '../store/useDawStore';
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
    plugins: [],
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
    peaks: new Float32Array([0, 0]),
    color: '#06b6d4',
    ...overrides,
  };
}

function makeTake(overrides: Partial<AudioClip> = {}): AudioClip {
  return makeClip({ id: 'clip_take_1', name: 'Toma 1', startTime: 0, duration: 4, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEngine.stopRecording.mockResolvedValue(null);
  useDawStore.setState({
    tracks: [makeTrack()],
    clips: [makeClip()],
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
    selectedClipId: null,
    selectedTrackId: null,
  });
});

describe('store waveA', () => {
  it('updateClip sin reproducción no replanifica pero actualiza el clip', () => {
    useDawStore.getState().updateClip('clip_1', { startTime: 2 });
    expect(useDawStore.getState().clips[0]!.startTime).toBe(2);
    expect(mockedEngine.play).not.toHaveBeenCalled();
  });

  it('updateClip en play replanifica con tracks/clips vigentes y tiempo actual', () => {
    mockedEngine.getCurrentTime.mockReturnValue(5);
    useDawStore.setState({ isPlaying: true });
    useDawStore.getState().updateClip('clip_1', { startTime: 2 });

    expect(mockedEngine.play).toHaveBeenCalledTimes(1);
    const [tracks, clips, from] = mockedEngine.play.mock.calls[0]!;
    expect(tracks).toEqual(useDawStore.getState().tracks);
    expect(clips).toEqual(useDawStore.getState().clips);
    expect(clips?.[0]!.startTime).toBe(2);
    expect(from).toBe(5);
  });

  it('toggleRecord-stop para el engine y vuelca la toma al timeline', async () => {
    const take = makeTake();
    mockedEngine.stopRecording.mockResolvedValue({ ...take, buffer: null } as never);
    useDawStore.setState({ isRecording: true, isPlaying: true });

    await useDawStore.getState().toggleRecord();

    expect(mockedEngine.stopRecording).toHaveBeenCalledTimes(1);
    expect(mockedEngine.stop).toHaveBeenCalledTimes(1);
    expect(useDawStore.getState().isRecording).toBe(false);
    expect(useDawStore.getState().isPlaying).toBe(false);
    expect(useDawStore.getState().clips.map((c) => c.id)).toContain('clip_take_1');
  });

  it('pause durante la grabación delega en toggleRecord y conserva la toma', async () => {
    const take = makeTake();
    mockedEngine.stopRecording.mockResolvedValue({ ...take, buffer: null } as never);
    useDawStore.setState({ isRecording: true, isPlaying: true });

    useDawStore.getState().pause();

    await vi.waitFor(() => {
      expect(useDawStore.getState().isRecording).toBe(false);
    });
    expect(mockedEngine.stopRecording).toHaveBeenCalledTimes(1);
    expect(useDawStore.getState().clips.map((c) => c.id)).toContain('clip_take_1');
  });

  it('stop durante la grabación delega en toggleRecord y conserva la toma', async () => {
    const take = makeTake();
    mockedEngine.stopRecording.mockResolvedValue({ ...take, buffer: null } as never);
    useDawStore.setState({ isRecording: true, isPlaying: true });

    useDawStore.getState().stop();

    await vi.waitFor(() => {
      expect(useDawStore.getState().isRecording).toBe(false);
    });
    expect(mockedEngine.stopRecording).toHaveBeenCalledTimes(1);
    expect(useDawStore.getState().clips.map((c) => c.id)).toContain('clip_take_1');
  });

  it('setBpm clamp alto: 1000 -> 260 y propaga el valor clampado', () => {
    useDawStore.getState().setBpm(1000);
    expect(useDawStore.getState().bpm).toBe(260);
    expect(mockedEngine.setTempo).toHaveBeenCalledWith(260);
  });

  it('setBpm clamp bajo: 10 -> 40 y propaga el valor clampado', () => {
    useDawStore.getState().setBpm(10);
    expect(useDawStore.getState().bpm).toBe(40);
    expect(mockedEngine.setTempo).toHaveBeenCalledWith(40);
  });

  it('setBpm con NaN conserva el bpm vigente', () => {
    useDawStore.getState().setBpm(NaN);
    expect(useDawStore.getState().bpm).toBe(120);
    expect(mockedEngine.setTempo).toHaveBeenCalledWith(120);
  });

  it('removeClip recalcula duration: borrar todo vuelve a 16s', () => {
    useDawStore.setState({ duration: 32 });
    useDawStore.getState().removeClip('clip_1');
    expect(useDawStore.getState().clips).toHaveLength(0);
    expect(useDawStore.getState().duration).toBe(16);
  });

  it('removeTrack recalcula duration con los clips restantes', () => {
    useDawStore.setState({
      tracks: [makeTrack(), makeTrack({ id: 'track_2' })],
      clips: [makeClip(), makeClip({ id: 'clip_2', trackId: 'track_2', startTime: 20, duration: 8 })],
      duration: 32,
    });
    useDawStore.getState().removeTrack('track_2');
    expect(useDawStore.getState().duration).toBe(16);
  });

  it('updateClip recalcula duration al mover/encoger (sin clips invisibles ni huecos)', () => {
    // Arrastrar fuera del rango visible extiende la duración…
    useDawStore.getState().updateClip('clip_1', { startTime: 30 });
    expect(useDawStore.getState().duration).toBe(38);
    // …y encogerla la devuelve al mínimo.
    useDawStore.getState().updateClip('clip_1', { startTime: 0, duration: 2 });
    expect(useDawStore.getState().duration).toBe(16);
  });

  it('trimClip recalcula duration al encoger', () => {
    useDawStore.getState().trimClip('clip_1', 'right', -100);
    expect(useDawStore.getState().clips[0]!.duration).toBeCloseTo(0.2, 5);
    expect(useDawStore.getState().duration).toBe(16);
  });

  it('setTimeSignature actualiza estado y propaga al engine', () => {
    useDawStore.getState().setTimeSignature([3, 4]);
    expect(useDawStore.getState().timeSignature).toEqual([3, 4]);
    expect(mockedEngine.setTimeSignature).toHaveBeenCalledWith(3, 4);
  });

  it('setLoopRange actualiza estado y propaga a setLoop', () => {
    useDawStore.setState({ isLooping: true });
    useDawStore.getState().setLoopRange(4, 12);
    expect(useDawStore.getState().loopStart).toBe(4);
    expect(useDawStore.getState().loopEnd).toBe(12);
    expect(mockedEngine.setLoop).toHaveBeenCalledWith(true, 4, 12);
  });
});
