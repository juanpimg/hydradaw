// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useDawStore } from '../../store/useDawStore';
import { audioEngine } from '../../audio/AudioEngine';
import { encodeWavAsync } from '../../audio/WavExporter';
import { ExportModal } from '../../components/Export/ExportModal';

vi.mock('../../audio/WavExporter', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../audio/WavExporter')>();
  return {
    ...orig,
    encodeWavAsync: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    downloadAudioBlob: vi.fn(),
  };
});

function fakeRenderedBuffer(): AudioBuffer {
  const length = 44100;
  const ch0 = new Float32Array(length);
  const ch1 = new Float32Array(length);
  return {
    numberOfChannels: 2,
    length,
    sampleRate: 44100,
    duration: 1,
    getChannelData: (c: number) => (c === 0 ? ch0 : ch1),
  } as unknown as AudioBuffer;
}

describe('ExportModal profundidad 32-bit (EXP-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDawStore.setState({
      exportModalOpen: true,
      projectName: 'Mi Tema',
      masterVolume: 0.8,
      masterMute: false,
      tracks: [
        {
          id: 't1', name: 'T1', type: 'audio', color: '#fff', volume: 1, pan: 0,
          mute: false, solo: false, armed: false, plugins: [],
        },
      ],
      clips: [
        {
          id: 'c1', trackId: 't1', name: 'C1', startTime: 0, duration: 1, offset: 0,
          audioBuffer: null, peaks: new Float32Array(0),
        },
      ],
    });
    vi.spyOn(audioEngine, 'renderOfflineMixdown').mockResolvedValue(fakeRenderedBuffer());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useDawStore.setState({ exportModalOpen: false });
  });

  it('E4: con bitDepth 32 el export codifica a 32 bits vía la vía asíncrona con progreso', async () => {
    render(<ExportModal />);
    fireEvent.click(screen.getByText('32-bit (Float)'));
    fireEvent.click(screen.getByText('Exportar Mezcla Completa'));
    await waitFor(() => {
      expect(encodeWavAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sampleRate: 44100 }),
        32,
        expect.any(Function),
      );
    });
  });

  it('EXP-01: el modal propaga masterVolume/masterMute del store al render', async () => {
    useDawStore.setState({ masterVolume: 0.5, masterMute: true });
    render(<ExportModal />);
    fireEvent.click(screen.getByText('Exportar Mezcla Completa'));
    await waitFor(() => {
      expect(audioEngine.renderOfflineMixdown).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ masterVolume: 0.5, masterMute: true }),
      );
    });
  });
});
