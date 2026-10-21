import { useEffect } from 'react';
import { useDawStore } from '../store/useDawStore';
import { audioEngine } from '../audio/AudioEngine';

export function handleGlobalKeyDown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return;

  // ST-07: con un modal abierto los atajos no disparan (evita borrar/cortar/
  // mutar el proyecto detrás del diálogo). Escape se deja pasar: cada modal lo
  // usa en su propio listener para cerrarse.
  const modalState = useDawStore.getState();
  if (
    (modalState.exportModalOpen || modalState.pluginModalTrackId !== null) &&
    e.key !== 'Escape'
  ) {
    return;
  }

  // Don't intercept when user is typing in form controls or modals with inputs
  if (t.closest && t.closest('input,textarea,select,[contenteditable="true"]')) return;

  // Space toggles Play / Pause across entire application (Timeline and Mixer)
  if (e.code === 'Space') {
    // ST-12: una sola pulsación (mantenerla no conmuta en bucle).
    if (e.repeat) return;
    if ((t.closest && t.closest('button,select')) || t.tagName === 'BUTTON' || t.tagName === 'SELECT') return;
    e.preventDefault();
    const st = useDawStore.getState();
    if (st.isPlaying) {
      st.pause();
    } else {
      void st.play();
    }
    return;
  }

  // Home or NumPad 0: Rewind to 0:00
  if (e.key === 'Home') {
    e.preventDefault();
    const st = useDawStore.getState();
    st.stop();
    return;
  }

  // 'R' / 'r' toggles Recording
  if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // ST-12: una sola pulsación (mantenerla no conmuta en bucle).
    if (e.repeat) return;
    e.preventDefault();
    void useDawStore.getState().toggleRecord();
    return;
  }

  // 'C' / 'c' toggles Metronome (Click)
  if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // ST-12: una sola pulsación.
    if (e.repeat) return;
    e.preventDefault();
    useDawStore.getState().toggleMetronome();
    return;
  }

  // 'L' / 'l' toggles Loop
  if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // ST-12: una sola pulsación.
    if (e.repeat) return;
    e.preventDefault();
    useDawStore.getState().toggleLoop();
    return;
  }

  // 'S' / 's' for Split clip if a clip is selected, or Solo track if a track is selected
  if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // ST-12: una sola pulsación.
    if (e.repeat) return;
    const st = useDawStore.getState();
    if (st.selectedClipId) {
      e.preventDefault();
      const currTime = audioEngine.getCurrentTime();
      st.splitClip(st.selectedClipId, currTime);
    } else if (st.selectedTrackId) {
      e.preventDefault();
      const track = st.tracks.find((tr) => tr.id === st.selectedTrackId);
      if (track) {
        st.updateTrack(track.id, { solo: !track.solo });
      }
    }
    return;
  }

  // 'M' / 'm' for Mute selected track
  if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // ST-12: una sola pulsación.
    if (e.repeat) return;
    const st = useDawStore.getState();
    if (st.selectedTrackId) {
      e.preventDefault();
      const track = st.tracks.find((tr) => tr.id === st.selectedTrackId);
      if (track) {
        st.updateTrack(track.id, { mute: !track.mute });
      }
    }
    return;
  }

  // Delete / Backspace removes selected clip
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const st = useDawStore.getState();
    if (st.selectedClipId) {
      e.preventDefault();
      st.removeClip(st.selectedClipId);
    }
    return;
  }

  // Redo: Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z
  if (
    ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
    ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && e.shiftKey)
  ) {
    e.preventDefault();
    useDawStore.getState().redo();
    return;
  }

  // Undo: Ctrl+Z / Cmd+Z (without shift)
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    e.preventDefault();
    useDawStore.getState().undo();
    return;
  }
}

export function useGlobalShortcuts() {
  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);
}
