// Fix(waveB-shell): toasts del store (push/dismiss, ids únicos).
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { useDawStore } from '../store/useDawStore';

beforeEach(() => {
  useDawStore.setState({ toasts: [] });
});

describe('toasts waveB-shell', () => {
  it('pushToast añade con id único', () => {
    useDawStore.getState().pushToast('hola');
    useDawStore.getState().pushToast('mundo');
    const toasts = useDawStore.getState().toasts;
    expect(toasts).toHaveLength(2);
    expect(toasts[0]!.message).toBe('hola');
    expect(toasts[1]!.message).toBe('mundo');
    expect(toasts[0]!.id).not.toBe(toasts[1]!.id);
  });

  it('dismissToast filtra por id', () => {
    useDawStore.getState().pushToast('a');
    useDawStore.getState().pushToast('b');
    const [first] = useDawStore.getState().toasts;
    useDawStore.getState().dismissToast(first!.id);
    const rest = useDawStore.getState().toasts;
    expect(rest).toHaveLength(1);
    expect(rest[0]!.message).toBe('b');
  });

  it('toggleRecord sin pistas usa toast (no alert)', async () => {
    useDawStore.setState({ tracks: [], isRecording: false, toasts: [] });
    await useDawStore.getState().toggleRecord();
    expect(useDawStore.getState().toasts.map((t) => t.message)).toContain(
      'Por favor añade y arma una pista para grabar.'
    );
  });
});
