import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGlobalKeyDown } from '../hooks/useGlobalShortcuts';
import { useDawStore } from '../store/useDawStore';

vi.mock('../audio/AudioEngine', () => ({
  audioEngine: {
    play: vi.fn(),
    stop: vi.fn(() => 0),
    rewind: vi.fn(),
    getCurrentTime: vi.fn(() => 5.0),
    setLoop: vi.fn(),
    setMetronome: vi.fn(),
    syncTracks: vi.fn(),
    rebuildTrackEffects: vi.fn(),
    setTempo: vi.fn(),
    setTimeSignature: vi.fn(),
    updateTrackPluginParam: vi.fn(),
    getMasterBus: vi.fn(() => null),
  },
}));

describe('handleGlobalKeyDown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDawStore.setState({
      isPlaying: false,
      isRecording: false,
      isLooping: false,
      metronome: false,
      selectedClipIds: [],
      selectedTrackId: null,
      exportModalOpen: false,
      pluginModalTrackId: null,
      pluginModalInstanceId: null,
      tracks: [{ id: 't1', name: 'Track 1', type: 'audio', color: '#fff', volume: 1, pan: 0, mute: false, solo: false, armed: false, plugins: [] }],
      clips: [{ id: 'c1', trackId: 't1', name: 'Clip 1', startTime: 0, duration: 10, offset: 0, color: '#fff', audioBuffer: null, peaks: new Float32Array(0) }],
    });
  });

  function makeKeyEvent(props: Partial<KeyboardEvent> & { targetTag?: string }) {
    const targetTag = props.targetTag || 'DIV';
    const targetEl = {
      tagName: targetTag,
      closest: (sel: string) => (sel.toLowerCase().includes(targetTag.toLowerCase()) ? targetEl : null),
    };
    return {
      code: props.code || '',
      key: props.key || '',
      target: targetEl as unknown as HTMLElement,
      preventDefault: vi.fn(),
      ctrlKey: props.ctrlKey || false,
      metaKey: props.metaKey || false,
      altKey: props.altKey || false,
      shiftKey: props.shiftKey || false,
      repeat: (props as { repeat?: boolean }).repeat || false,
    } as unknown as KeyboardEvent;
  }

  it('Space toggles play when stopped, and pause when playing', () => {
    const playSpy = vi.spyOn(useDawStore.getState(), 'play');
    const pauseSpy = vi.spyOn(useDawStore.getState(), 'pause');

    // Space to play
    handleGlobalKeyDown(makeKeyEvent({ code: 'Space' }));
    expect(playSpy).toHaveBeenCalledTimes(1);

    useDawStore.setState({ isPlaying: true });
    handleGlobalKeyDown(makeKeyEvent({ code: 'Space' }));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it('Space is ignored inside input elements', () => {
    const playSpy = vi.spyOn(useDawStore.getState(), 'play');
    handleGlobalKeyDown(makeKeyEvent({ code: 'Space', targetTag: 'INPUT' }));
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('L toggles loop mode', () => {
    expect(useDawStore.getState().isLooping).toBe(false);
    handleGlobalKeyDown(makeKeyEvent({ key: 'l' }));
    expect(useDawStore.getState().isLooping).toBe(true);
  });

  it('C toggles metronome', () => {
    expect(useDawStore.getState().metronome).toBe(false);
    handleGlobalKeyDown(makeKeyEvent({ key: 'c' }));
    expect(useDawStore.getState().metronome).toBe(true);
  });

  it('S splits all selected clips at the playhead', () => {
    const splitSpy = vi.spyOn(useDawStore.getState(), 'splitSelectedClips');
    useDawStore.setState({ selectedClipIds: ['c1'] });

    handleGlobalKeyDown(makeKeyEvent({ key: 's' }));
    expect(splitSpy).toHaveBeenCalledWith(5.0);
  });

  it('S toggles solo on track when track is selected and no clip is selected', () => {
    useDawStore.setState({ selectedClipIds: [], selectedTrackId: 't1' });
    expect(useDawStore.getState().tracks[0]!.solo).toBe(false);

    handleGlobalKeyDown(makeKeyEvent({ key: 's' }));
    expect(useDawStore.getState().tracks[0]!.solo).toBe(true);
  });

  it('M toggles mute on selected track', () => {
    useDawStore.setState({ selectedClipIds: [], selectedTrackId: 't1' });
    expect(useDawStore.getState().tracks[0]!.mute).toBe(false);

    handleGlobalKeyDown(makeKeyEvent({ key: 'm' }));
    expect(useDawStore.getState().tracks[0]!.mute).toBe(true);
  });

  it('Home rewinds to 0:00 and stops', () => {
    const stopSpy = vi.spyOn(useDawStore.getState(), 'stop');
    handleGlobalKeyDown(makeKeyEvent({ key: 'Home' }));
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('Delete removes all selected clips', () => {
    const removeSpy = vi.spyOn(useDawStore.getState(), 'removeSelectedClips');
    useDawStore.setState({ selectedClipIds: ['c1'] });
    handleGlobalKeyDown(makeKeyEvent({ key: 'Delete' }));
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(useDawStore.getState().clips).toHaveLength(0);
  });

  it('Escape clears the clip selection', () => {
    useDawStore.setState({ selectedClipIds: ['c1'] });
    const ev = makeKeyEvent({ key: 'Escape' });
    handleGlobalKeyDown(ev);
    expect(useDawStore.getState().selectedClipIds).toEqual([]);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('Ctrl+Z triggers undo, and Ctrl+Y triggers redo', () => {
    const undoSpy = vi.spyOn(useDawStore.getState(), 'undo');
    const redoSpy = vi.spyOn(useDawStore.getState(), 'redo');

    handleGlobalKeyDown(makeKeyEvent({ key: 'z', ctrlKey: true }));
    expect(undoSpy).toHaveBeenCalledTimes(1);

    handleGlobalKeyDown(makeKeyEvent({ key: 'y', ctrlKey: true }));
    expect(redoSpy).toHaveBeenCalledTimes(1);

    handleGlobalKeyDown(makeKeyEvent({ key: 'z', ctrlKey: true, shiftKey: true } as any));
    expect(redoSpy).toHaveBeenCalledTimes(2);
  });

  it('S1: con exportModalOpen, Delete no borra el clip seleccionado', () => {
    const removeSpy = vi.spyOn(useDawStore.getState(), 'removeSelectedClips');
    useDawStore.setState({ selectedClipIds: ['c1'], exportModalOpen: true });
    handleGlobalKeyDown(makeKeyEvent({ key: 'Delete' }));
    expect(removeSpy).not.toHaveBeenCalled();
    expect(useDawStore.getState().clips).toHaveLength(1);
  });

  it('S1b: con exportModalOpen, Space/Ctrl+Z tampoco mutan el proyecto', () => {
    const undoSpy = vi.spyOn(useDawStore.getState(), 'undo');
    useDawStore.setState({ exportModalOpen: true, isPlaying: false });
    handleGlobalKeyDown(makeKeyEvent({ code: 'Space' }));
    expect(useDawStore.getState().isPlaying).toBe(false);
    handleGlobalKeyDown(makeKeyEvent({ key: 'z', ctrlKey: true }));
    expect(undoSpy).not.toHaveBeenCalled();
  });

  it('S2: con pluginModalTrackId activo, S no corta el clip', () => {
    const splitSpy = vi.spyOn(useDawStore.getState(), 'splitClip');
    useDawStore.setState({ selectedClipIds: ['c1'], pluginModalTrackId: 't1', pluginModalInstanceId: 'inst_1' });
    handleGlobalKeyDown(makeKeyEvent({ key: 's' }));
    expect(splitSpy).not.toHaveBeenCalled();
    expect(useDawStore.getState().clips).toHaveLength(1);
  });

  it('S3: con un modal abierto, Escape no dispara atajos y se deja pasar al modal', () => {
    const removeSpy = vi.spyOn(useDawStore.getState(), 'removeClip');
    const undoSpy = vi.spyOn(useDawStore.getState(), 'undo');
    useDawStore.setState({ selectedClipIds: ['c1'], exportModalOpen: true });
    const ev = makeKeyEvent({ key: 'Escape' });
    handleGlobalKeyDown(ev);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(undoSpy).not.toHaveBeenCalled();
    // Con modal abierto Escape tampoco limpia la selección.
    expect(useDawStore.getState().selectedClipIds).toEqual(['c1']);
    // El modal cierra con Escape en su propio listener: no se interfiere.
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('S4: e.repeat no dispara toggleRecord (ni el resto de atajos de una tecla)', () => {
    const recordSpy = vi.spyOn(useDawStore.getState(), 'toggleRecord');
    handleGlobalKeyDown(makeKeyEvent({ key: 'r', repeat: true } as any));
    expect(recordSpy).not.toHaveBeenCalled();

    handleGlobalKeyDown(makeKeyEvent({ key: 'c', repeat: true } as any));
    expect(useDawStore.getState().metronome).toBe(false);
    handleGlobalKeyDown(makeKeyEvent({ key: 'l', repeat: true } as any));
    expect(useDawStore.getState().isLooping).toBe(false);
    handleGlobalKeyDown(makeKeyEvent({ code: 'Space', repeat: true } as any));
    expect(useDawStore.getState().isPlaying).toBe(false);
  });
});
