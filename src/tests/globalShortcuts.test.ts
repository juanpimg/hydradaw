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
      selectedClipId: null,
      selectedTrackId: null,
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

  it('S splits clip when a clip is selected', () => {
    const splitSpy = vi.spyOn(useDawStore.getState(), 'splitClip');
    useDawStore.setState({ selectedClipId: 'c1' });

    handleGlobalKeyDown(makeKeyEvent({ key: 's' }));
    expect(splitSpy).toHaveBeenCalledWith('c1', 5.0);
  });

  it('S toggles solo on track when track is selected and no clip is selected', () => {
    useDawStore.setState({ selectedClipId: null, selectedTrackId: 't1' });
    expect(useDawStore.getState().tracks[0]!.solo).toBe(false);

    handleGlobalKeyDown(makeKeyEvent({ key: 's' }));
    expect(useDawStore.getState().tracks[0]!.solo).toBe(true);
  });

  it('M toggles mute on selected track', () => {
    useDawStore.setState({ selectedClipId: null, selectedTrackId: 't1' });
    expect(useDawStore.getState().tracks[0]!.mute).toBe(false);

    handleGlobalKeyDown(makeKeyEvent({ key: 'm' }));
    expect(useDawStore.getState().tracks[0]!.mute).toBe(true);
  });

  it('Home rewinds to 0:00 and stops', () => {
    const stopSpy = vi.spyOn(useDawStore.getState(), 'stop');
    handleGlobalKeyDown(makeKeyEvent({ key: 'Home' }));
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('Delete removes selected clip', () => {
    const removeSpy = vi.spyOn(useDawStore.getState(), 'removeClip');
    useDawStore.setState({ selectedClipId: 'c1' });
    handleGlobalKeyDown(makeKeyEvent({ key: 'Delete' }));
    expect(removeSpy).toHaveBeenCalledWith('c1');
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
});
