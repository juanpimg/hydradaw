// I2: el play() del store debe reflejar la supervivencia OBSERVADA, no asumirla.
// Si un stop()/pause() cae dentro de la ventana asíncrona de play(), el motor
// queda en silencio y el store debe quedar en isPlaying: false (gemelo a
// nivel de store del defecto AUD-02).
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../audio/waveformUtils', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../audio/waveformUtils')>();
  return { ...mod, generateWaveformPeaks: vi.fn(() => new Float32Array([1, 2, 3])) };
});

import { useDawStore } from '../store/useDawStore';
import { audioEngine } from '../audio/AudioEngine';

const mockedEngine = vi.mocked(audioEngine);

beforeEach(() => {
  vi.clearAllMocks();
  useDawStore.setState({
    tracks: [],
    clips: [],
    currentTime: 0,
    isPlaying: false,
    isRecording: false,
  });
});

describe('I2: supervivencia observada del play()', () => {
  it('un play que sobrevive deja isPlaying en true', async () => {
    mockedEngine.play.mockResolvedValueOnce(true);
    await useDawStore.getState().play();
    expect(useDawStore.getState().isPlaying).toBe(true);
  });

  it('un play invalidado (el motor informa false) deja isPlaying en false', async () => {
    mockedEngine.play.mockResolvedValueOnce(false);
    await useDawStore.getState().play();
    expect(useDawStore.getState().isPlaying).toBe(false);
  });

  it('stop() dentro de la ventana asíncrona de play(): el store queda en false y coincide con el motor', async () => {
    // Doble Espacio rápido: el segundo keydown (stop/pause) es una macrotarea
    // posterior que PUEDE intercalarse dentro del await de play().
    let resolvePlay!: (survived: boolean) => void;
    mockedEngine.play.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { resolvePlay = resolve; }),
    );
    const playing = useDawStore.getState().play();
    // El stop aterriza dentro de la ventana asíncrona del play.
    useDawStore.getState().stop();
    // El motor informa que el play no sobrevivió (su chequeo de generación).
    resolvePlay(false);
    await playing;
    expect(useDawStore.getState().isPlaying).toBe(false);
    // Motor y store de acuerdo: stop() aparcó y el play no lo resucitó.
    expect(mockedEngine.stop).toHaveBeenCalled();
  });
});
