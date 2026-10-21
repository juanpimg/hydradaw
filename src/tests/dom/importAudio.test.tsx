// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useDawStore, resetHistory } from '../../store/useDawStore';
import { Header } from '../../components/Header/Header';

vi.mock('../../audio/waveformUtils', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../audio/waveformUtils')>();
  return {
    ...orig,
    decodeAudioFile: vi.fn(),
  };
});

import { decodeAudioFile } from '../../audio/waveformUtils';
import { importAudioFiles } from '../../audio/importAudio';
import { audioEngine } from '../../audio/AudioEngine';

function fakeBuffer(durationSec = 2): AudioBuffer {
  const data = new Float32Array(44100 * durationSec).fill(0.1);
  return {
    numberOfChannels: 1,
    length: data.length,
    sampleRate: 44100,
    duration: durationSec,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

function audioFile(name: string): File {
  return new File(['dummy'], name, { type: 'audio/wav' });
}

function resetStore() {
  useDawStore.setState({
    projectName: 'Test',
    bpm: 120,
    timeSignature: [4, 4],
    currentTime: 0,
    duration: 16,
    isPlaying: false,
    isRecording: false,
    tracks: [],
    clips: [],
    selectedTrackId: null,
    selectedClipIds: [],
    zoom: 50,
    scrollLeft: 0,
    activeView: 'timeline',
    masterVolume: 1,
    masterMute: false,
    metronome: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    snapMode: 'off',
    exportModalOpen: false,
    pluginModalTrackId: null,
    pluginModalInstanceId: null,
    toasts: [],
  });
  resetHistory();
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  vi.spyOn(audioEngine, 'ensureContext').mockResolvedValue({} as AudioContext);
  vi.spyOn(audioEngine, 'getCurrentTime').mockReturnValue(4);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Importar audio sin arrastrar (G1)', () => {
  it('A1: importAudioFiles con 2 ficheros ⇒ 2 clips en la pista indicada', async () => {
    const trackId = useDawStore.getState().addTrack('Base');
    resetHistory();
    vi.mocked(decodeAudioFile).mockResolvedValue(fakeBuffer(2));
    const result = await importAudioFiles([audioFile('a.wav'), audioFile('b.wav')], {
      targetTrackId: trackId,
    });
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);
    const clips = useDawStore.getState().clips.filter((c) => c.trackId === trackId);
    expect(clips).toHaveLength(2);
  });

  it('A2: sin pista indicada ⇒ se crea una pista nueva', async () => {
    vi.mocked(decodeAudioFile).mockResolvedValue(fakeBuffer(1));
    const before = useDawStore.getState().tracks.length;
    const result = await importAudioFiles([audioFile('solo.wav')], {});
    expect(result.imported).toBe(1);
    expect(useDawStore.getState().tracks.length).toBe(before + 1);
    expect(useDawStore.getState().clips).toHaveLength(1);
  });

  it('A3: un fichero corrupto ⇒ 1 importado, 1 fallo, toast, sin lanzar', async () => {
    const trackId = useDawStore.getState().addTrack('Base');
    resetHistory();
    vi.mocked(decodeAudioFile).mockImplementation(async (f: Blob) => {
      const file = f as File;
      if ((file as File).name === 'roto.wav') throw new Error('datos corruptos');
      return fakeBuffer(1);
    });
    const result = await importAudioFiles([audioFile('ok.wav'), audioFile('roto.wav')], {
      targetTrackId: trackId,
    });
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(useDawStore.getState().clips).toHaveLength(1);
    expect(useDawStore.getState().toasts.length).toBeGreaterThan(0);
  });

  it('A4: el clip importado usa el snap magnético en la posición del playhead', async () => {
    useDawStore.setState({ snapMode: '1/4', bpm: 120, timeSignature: [4, 4] });
    // Playhead en 4.1 s; con rejilla de 1/4 (0.5 s) debe caer a 4.0.
    vi.mocked(audioEngine.getCurrentTime).mockReturnValue(4.1);
    vi.mocked(decodeAudioFile).mockResolvedValue(fakeBuffer(1));
    const trackId = useDawStore.getState().addTrack('Base');
    resetHistory();
    await importAudioFiles([audioFile('snap.wav')], { targetTrackId: trackId });
    const clip = useDawStore.getState().clips[0];
    expect(clip).toBeDefined();
    expect(clip!.startTime).toBeCloseTo(4.0, 5);
  });

  it('A5: el Header tiene un <input type="file" accept="audio/*">', () => {
    const { container } = render(<Header />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input!.getAttribute('accept')).toContain('audio/*');
  });
});
