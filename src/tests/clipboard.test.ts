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
  },
}));

import { useDawStore, resetHistory } from '../store/useDawStore';

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
    duration: 4,
    offset: 0,
    audioBuffer: null,
    peaks: new Float32Array([0, 0.5]),
    color: '#06b6d4',
    ...overrides,
  };
}

function fakeBuffer(): AudioBuffer {
  const data = new Float32Array(100).fill(0.2);
  return {
    numberOfChannels: 1,
    length: data.length,
    sampleRate: 44100,
    duration: 4,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
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
    exportModalOpen: false,
    pluginModalTrackId: null,
    pluginModalInstanceId: null,
    tracks: [makeTrack()],
    clips: [
      makeClip({ id: 'c1', startTime: 0, duration: 4 }),
      makeClip({ id: 'c2', startTime: 4, duration: 2 }),
    ],
    toasts: [],
  });
  // Vacía el portapapeles interno entre tests.
  useDawStore.getState().copyClips([]);
});

describe('Portapapeles de clips (G2)', () => {
  it('C1: copiar 2 clips y pegar ⇒ 2 clips nuevos con ids nuevos y misma duración/startTime', () => {
    const st = useDawStore.getState();
    st.copyClips(['c1', 'c2']);
    st.pasteClips();
    const clips = useDawStore.getState().clips;
    expect(clips).toHaveLength(4);
    const pasted = clips.filter((c) => c.id !== 'c1' && c.id !== 'c2');
    expect(pasted).toHaveLength(2);
    expect(new Set(pasted.map((c) => c.id)).size).toBe(2);
    const byDur = [...pasted].sort((a, b) => a.startTime - b.startTime);
    expect(byDur[0]!.duration).toBe(4);
    expect(byDur[0]!.startTime).toBe(0);
    expect(byDur[1]!.duration).toBe(2);
    expect(byDur[1]!.startTime).toBe(4);
  });

  it('C2: el clip pegado conserva su audioBuffer por referencia (sin duplicar PCM)', () => {
    const buf = fakeBuffer();
    useDawStore.setState({
      clips: [makeClip({ id: 'c1', startTime: 0, duration: 4, audioBuffer: buf })],
    });
    useDawStore.getState().copyClips(['c1']);
    useDawStore.getState().pasteClips();
    const clips = useDawStore.getState().clips;
    expect(clips).toHaveLength(2);
    const pasted = clips.find((c) => c.id !== 'c1')!;
    expect(pasted.audioBuffer).toBe(buf);
  });

  it('C3: duplicateSelectedClips ⇒ el duplicado va justo después del original', () => {
    useDawStore.setState({ selectedClipIds: ['c1'] });
    useDawStore.getState().duplicateSelectedClips();
    const clips = useDawStore.getState().clips;
    expect(clips).toHaveLength(3);
    const orig = clips.find((c) => c.id === 'c1')!;
    const dup = clips.find((c) => c.id !== 'c1' && c.id !== 'c2')!;
    expect(dup.trackId).toBe(orig.trackId);
    expect(dup.duration).toBe(orig.duration);
    expect(dup.startTime).toBeCloseTo(orig.startTime + orig.duration, 5);
  });

  it('C4: pegar con el portapapeles vacío ⇒ no hace nada y no lanza', () => {
    expect(() => useDawStore.getState().pasteClips()).not.toThrow();
    expect(useDawStore.getState().clips).toHaveLength(2);
  });

  it('C5: copiar/pegar es deshacible (undo deshace el pegado)', () => {
    useDawStore.getState().copyClips(['c1']);
    useDawStore.getState().pasteClips();
    expect(useDawStore.getState().clips).toHaveLength(3);
    useDawStore.getState().undo();
    expect(useDawStore.getState().clips).toHaveLength(2);
    expect(useDawStore.getState().clips.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });
});
