import { create } from 'zustand';
import type { AudioTrack, AudioClip, PluginInstance, SnapMode } from '../types/daw';
import { audioEngine } from '../audio/AudioEngine';
import { splitClipOperation, trimLeftOperation, trimRightOperation, type SplitResult } from '../audio/timelineOps';
import { generateDemoTrackBuffer, generateWaveformPeaks } from '../audio/waveformUtils';
import { BUILTIN_PLUGINS } from '../audio/builtinPlugins';

// Fix(waveA): la duración del proyecto deriva de los clips (mínimo 16s). Antes solo
// crecía en addClip; borrar o encoger clips dejaba compases vacíos o clips invisibles.
const recalcDuration = (clips: AudioClip[]): number =>
  Math.max(16, ...clips.map((c) => c.startTime + c.duration));

// Fix(waveB-shell): id monótono para toasts (fuera del estado: no persiste).
let nextToastId = 1;

export interface Toast {
  id: number;
  message: string;
}

export interface HistorySnapshot {
  tracks: AudioTrack[];
  clips: AudioClip[];
  bpm: number;
  timeSignature: [number, number];
  loopStart: number;
  loopEnd: number;
  isLooping: boolean;
  metronome: boolean;
  masterVolume: number;
  masterMute: boolean;
  projectName: string;
  snapMode: SnapMode;
  selectedTrackId: string | null;
  selectedClipIds: string[];
}

const MAX_HISTORY = 30;
let undoStack: HistorySnapshot[] = [];
let redoStack: HistorySnapshot[] = [];

// ST-01: el arrastre de un knob emite decenas de cambios por segundo; el historial
// se coalesce (leading-edge, 1 snapshot cada 400 ms) para que un solo gesto no
// vacíe la pila de 30. Ver `updatePluginParam`.
const PLUGIN_PARAM_HISTORY_MS = 400;
let lastPluginParamHistoryAt = 0;

// Portapapeles interno de clips (G2): guarda copias superficiales — `audioBuffer`
// y `peaks` se comparten por referencia para no duplicar el PCM en memoria.
// Vive fuera del estado: no persiste ni entra en el historial.
let clipClipboard: AudioClip[] = [];

let clipIdCounter = 0;
export function generateClipId(): string {
  // Contador monótono: ni dos pegados en el mismo milisegundo colisionan
  // aunque `Date.now()` no avance y `Math.random()` se repita.
  return (
    'clip_' + Date.now().toString(36) + '_' + (clipIdCounter++).toString(36) +
    Math.random().toString(36).slice(2, 6)
  );
}

// Ancla de la multi-selección (G5): el último clip seleccionado en simple o
// añadido con toggle; el rango se calcula desde aquí. Se limpia con el
// historial (proyecto nuevo / aislamiento entre tests).
let selectionAnchorId: string | null = null;

export function cloneHistoryState(state: {
  tracks: AudioTrack[];
  clips: AudioClip[];
  bpm: number;
  timeSignature: [number, number];
  loopStart: number;
  loopEnd: number;
  isLooping: boolean;
  metronome: boolean;
  masterVolume: number;
  masterMute: boolean;
  projectName: string;
  snapMode: SnapMode;
  selectedTrackId: string | null;
  selectedClipIds: string[];
}): HistorySnapshot {
  return {
    tracks: state.tracks.map((t) => ({
      ...t,
      plugins: t.plugins.map((p) => ({ ...p, parameters: { ...p.parameters } })),
    })),
    clips: state.clips.map((c) => ({ ...c })),
    bpm: state.bpm,
    timeSignature: [state.timeSignature[0], state.timeSignature[1]],
    loopStart: state.loopStart,
    loopEnd: state.loopEnd,
    isLooping: state.isLooping,
    metronome: state.metronome,
    masterVolume: state.masterVolume,
    masterMute: state.masterMute,
    projectName: state.projectName,
    snapMode: state.snapMode,
    selectedTrackId: state.selectedTrackId,
    selectedClipIds: [...state.selectedClipIds],
  };
}

export function resetHistory(): void {
  undoStack = [];
  redoStack = [];
  lastPluginParamHistoryAt = 0;
  selectionAnchorId = null;
  historyBatchDepth = 0;
  batchedSnapshot = null;
  // M-3: el portapapeles interno no cruza proyectos (los caminos de proyecto
  // nuevo/demo/carga ya llaman aquí).
  clipClipboard = [];
  useDawStore?.setState?.({ canUndo: false, canRedo: false });
}

function recordHistory(snapshot: HistorySnapshot): void {
  // Dentro de un lote (`beginHistoryBatch`) los snapshots intermedios se
  // omiten: `endHistoryBatch` registra el snapshot previo al lote una sola vez.
  if (historyBatchDepth > 0) return;
  undoStack.push(snapshot);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  useDawStore?.setState?.({ canUndo: true, canRedo: false });
}

// Lotes de historial: una acción lógica de usuario (p. ej. importar N
// archivos) registra UN snapshot aunque llame a varias acciones con
// historial. Sin anidar en la práctica; el contador lo tolera.
let historyBatchDepth = 0;
let batchedSnapshot: HistorySnapshot | null = null;

export function beginHistoryBatch(): void {
  if (historyBatchDepth === 0) batchedSnapshot = cloneHistoryState(useDawStore.getState());
  historyBatchDepth++;
}

export function endHistoryBatch(commit: boolean): void {
  historyBatchDepth = Math.max(0, historyBatchDepth - 1);
  if (historyBatchDepth > 0) return;
  const snap = batchedSnapshot;
  batchedSnapshot = null;
  if (commit && snap) recordHistory(snap);
}

interface DawState {
  // Project Info
  projectName: string;
  bpm: number;
  timeSignature: [number, number];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isRecording: boolean;
  isLooping: boolean;
  loopStart: number;
  loopEnd: number;
  metronome: boolean;

  // Master bus
  masterVolume: number;
  masterMute: boolean;

  // UI state
  zoom: number; // pixels per second
  scrollLeft: number;
  activeView: 'timeline' | 'mixer';
  selectedTrackId: string | null;
  selectedClipIds: string[];
  exportModalOpen: boolean;
  pluginModalTrackId: string | null;
  pluginModalInstanceId: string | null;
  snapMode: SnapMode;

  // Audio Data
  tracks: AudioTrack[];
  clips: AudioClip[];

  // Fix(waveB-shell): toasts no bloqueantes (sustituyen alert()/confirm()).
  toasts: Toast[];
  pushToast: (message: string) => void;
  dismissToast: (id: number) => void;

  // History (Undo / Redo)
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // Actions
  setProjectName: (name: string) => void;
  setBpm: (bpm: number) => void;
  setCurrentTime: (time: number) => void;
  setZoom: (zoom: number) => void;
  setScrollLeft: (scroll: number) => void;
  setActiveView: (view: 'timeline' | 'mixer') => void;
  setSelectedTrack: (id: string | null) => void;
  selectClip: (id: string | null, mode: 'single' | 'toggle' | 'range') => void;
  setExportModalOpen: (open: boolean) => void;
  setPluginModal: (trackId: string | null, instanceId: string | null) => void;
  setSnapMode: (mode: SnapMode) => void;

  setMasterVolume: (vol: number) => void;
  setMasterMute: (mute: boolean) => void;

  // Transport
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  toggleRecord: () => Promise<void>;
  toggleLoop: () => void;
  toggleMetronome: () => void;
  // Fix(waveA): adiciones para dejar el store listo para la UI con inputs.
  setTimeSignature: (sig: [number, number]) => void;
  setLoopRange: (start: number, end: number) => void;

  // Tracks & Clips
  addTrack: (name?: string, type?: AudioTrack['type']) => string;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, updates: Partial<AudioTrack>) => void;

  addClip: (clip: AudioClip) => void;
  updateClip: (id: string, updates: Partial<AudioClip>) => void;
  removeClip: (id: string) => void;
  splitClip: (clipId: string, atTime: number) => void;
  splitSelectedClips: (atTime: number) => void;
  trimClip: (clipId: string, edge: 'left' | 'right', deltaSeconds: number) => void;

  // Portapapeles interno de clips (G2)
  copyClips: (ids: string[]) => void;
  pasteClips: (atTime?: number) => void;
  duplicateSelectedClips: () => void;
  removeSelectedClips: () => void;

  // Plugins
  addPluginToTrack: (trackId: string, pluginId: string) => void;
  removePluginFromTrack: (trackId: string, instanceId: string) => void;
  togglePlugin: (trackId: string, instanceId: string) => void;
  updatePluginParam: (trackId: string, instanceId: string, paramId: string, value: number) => void;

  // Project Templates & Persistence
  loadDemoProject: () => Promise<void>;
  createBlankProject: () => Promise<void>;
}

export const useDawStore = create<DawState>((set, get) => ({
  projectName: 'Mi Canción Local',
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

  zoom: 50,
  scrollLeft: 0,
  activeView: 'timeline',
  selectedTrackId: null,
  selectedClipIds: [],
  exportModalOpen: false,
  pluginModalTrackId: null,
  pluginModalInstanceId: null,
  snapMode: '1/16',

  tracks: [],
  clips: [],

  // Fix(waveB-shell): push añade con id monótono; dismiss filtra por id.
  toasts: [],
  pushToast: (message) => {
    // ST-10: el contador vive fuera del updater (el updater es puro).
    const id = nextToastId++;
    set((state) => ({ toasts: [...state.toasts, { id, message }] }));
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  canUndo: false,
  canRedo: false,
  undo: () => {
    if (undoStack.length === 0) return;
    const current = cloneHistoryState(get());
    redoStack.push(current);
    const prev = undoStack.pop()!;
    // ST-02: se restaura el snapshot completo (no solo tracks/clips) para que
    // el estado y el engine no diverjan tras deshacer.
    set({
      tracks: prev.tracks,
      clips: prev.clips,
      duration: recalcDuration(prev.clips),
      bpm: prev.bpm,
      timeSignature: [prev.timeSignature[0], prev.timeSignature[1]],
      loopStart: prev.loopStart,
      loopEnd: prev.loopEnd,
      isLooping: prev.isLooping,
      metronome: prev.metronome,
      masterVolume: prev.masterVolume,
      masterMute: prev.masterMute,
      projectName: prev.projectName,
      snapMode: prev.snapMode,
      selectedTrackId: prev.selectedTrackId,
      selectedClipIds: [...prev.selectedClipIds],
      canUndo: undoStack.length > 0,
      canRedo: true,
    });
    // ST-02: reinyectar transporte/mezcla en el engine (si no, suenan distintos).
    audioEngine.setTempo(prev.bpm);
    audioEngine.setTimeSignature(prev.timeSignature[0], prev.timeSignature[1]);
    audioEngine.setLoop(prev.isLooping, prev.loopStart, prev.loopEnd);
    audioEngine.setMetronome(prev.metronome);
    audioEngine.getMasterBus()?.setVolume(prev.masterVolume);
    audioEngine.getMasterBus()?.setMute(prev.masterMute);
    void audioEngine.syncTracks(prev.tracks);
    if (get().isPlaying) {
      void audioEngine.play(prev.tracks, prev.clips, audioEngine.getCurrentTime());
    }
    get().pushToast('Deshecho');
  },
  redo: () => {
    if (redoStack.length === 0) return;
    const current = cloneHistoryState(get());
    undoStack.push(current);
    const next = redoStack.pop()!;
    // ST-02: idem undo (restauración completa + reinyección).
    set({
      tracks: next.tracks,
      clips: next.clips,
      duration: recalcDuration(next.clips),
      bpm: next.bpm,
      timeSignature: [next.timeSignature[0], next.timeSignature[1]],
      loopStart: next.loopStart,
      loopEnd: next.loopEnd,
      isLooping: next.isLooping,
      metronome: next.metronome,
      masterVolume: next.masterVolume,
      masterMute: next.masterMute,
      projectName: next.projectName,
      snapMode: next.snapMode,
      selectedTrackId: next.selectedTrackId,
      selectedClipIds: [...next.selectedClipIds],
      canUndo: true,
      canRedo: redoStack.length > 0,
    });
    audioEngine.setTempo(next.bpm);
    audioEngine.setTimeSignature(next.timeSignature[0], next.timeSignature[1]);
    audioEngine.setLoop(next.isLooping, next.loopStart, next.loopEnd);
    audioEngine.setMetronome(next.metronome);
    audioEngine.getMasterBus()?.setVolume(next.masterVolume);
    audioEngine.getMasterBus()?.setMute(next.masterMute);
    void audioEngine.syncTracks(next.tracks);
    if (get().isPlaying) {
      void audioEngine.play(next.tracks, next.clips, audioEngine.getCurrentTime());
    }
    get().pushToast('Rehecho');
  },

  setProjectName: (projectName) => set({ projectName }),
  // Fix(wave2): propaga el tempo al engine para que play/render usen el bpm vigente.
  // Fix(waveA): clamp 40-260 + guard NaN para que la UI nunca muestre valores absurdos
  // (el engine ya clampa 20-300 por su cuenta; con NaN se conserva el bpm vigente).
  setBpm: (bpm) => {
    const safe = Number.isFinite(bpm) ? Math.max(40, Math.min(260, bpm)) : get().bpm;
    set({ bpm: safe });
    audioEngine.setTempo(safe);
  },
  setCurrentTime: (currentTime) => {
    set({ currentTime });
    if (get().isPlaying) {
      const { tracks, clips } = get();
      // Fix(wave2): se mantiene el reinicio vía play() con estado fresco. Los BufferSource de
      // Web Audio son one-shot y no admiten seek sin replanificar; engine.seek() hace el mismo
      // reinicio interno pero con caché posiblemente obsoleta (addClip no resincroniza clips),
      // por eso se pasa aquí tracks/clips vigentes en lugar de usar seek().
      audioEngine.play(tracks, clips, currentTime);
    }
  },
  setZoom: (zoom) => set({ zoom: Math.max(15, Math.min(250, zoom)) }),
  setScrollLeft: (scrollLeft) => set({ scrollLeft }),
  setActiveView: (activeView) => set({ activeView }),
  setSelectedTrack: (selectedTrackId) => set({ selectedTrackId }),
  selectClip: (id, mode) => {
    if (id === null) {
      selectionAnchorId = null;
      set({ selectedClipIds: [] });
      return;
    }
    if (mode === 'single') {
      selectionAnchorId = id;
      set({ selectedClipIds: [id] });
      return;
    }
    if (mode === 'toggle') {
      const current = get().selectedClipIds;
      if (current.includes(id)) {
        set({ selectedClipIds: current.filter((x) => x !== id) });
      } else {
        selectionAnchorId = id;
        set({ selectedClipIds: [...current, id] });
      }
      return;
    }
    // Rango: todos los clips entre el ancla y el destino, ordenados por
    // pista y tiempo. Sin ancla válida se comporta como selección simple.
    const anchor = selectionAnchorId ?? get().selectedClipIds[0] ?? id;
    const trackIndex = new Map(get().tracks.map((t, i) => [t.id, i]));
    const ordered = [...get().clips].sort((a, b) => {
      const ta = trackIndex.get(a.trackId) ?? Number.MAX_SAFE_INTEGER;
      const tb = trackIndex.get(b.trackId) ?? Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return a.startTime - b.startTime;
    });
    const anchorIdx = ordered.findIndex((c) => c.id === anchor);
    const targetIdx = ordered.findIndex((c) => c.id === id);
    if (anchorIdx === -1 || targetIdx === -1) {
      selectionAnchorId = id;
      set({ selectedClipIds: [id] });
      return;
    }
    const lo = Math.min(anchorIdx, targetIdx);
    const hi = Math.max(anchorIdx, targetIdx);
    set({ selectedClipIds: ordered.slice(lo, hi + 1).map((c) => c.id) });
  },
  setExportModalOpen: (exportModalOpen) => set({ exportModalOpen }),
  setPluginModal: (pluginModalTrackId, pluginModalInstanceId) => set({ pluginModalTrackId, pluginModalInstanceId }),
  setSnapMode: (snapMode) => set({ snapMode }),

  setMasterVolume: (masterVolume) => {
    set({ masterVolume });
    audioEngine.getMasterBus()?.setVolume(masterVolume);
  },
  setMasterMute: (masterMute) => {
    set({ masterMute });
    audioEngine.getMasterBus()?.setMute(masterMute);
  },

  play: async () => {
    const { tracks, clips, currentTime } = get();
    await audioEngine.play(tracks, clips, currentTime);
    set({ isPlaying: true });
  },

  // Fix(waveA): si se está grabando, delegan en toggleRecord() para no perder la toma
  // (su rama stop vuelca el clip grabado al timeline antes de parar).
  pause: () => {
    if (get().isRecording) {
      void get().toggleRecord();
      return;
    }
    const time = audioEngine.stop();
    set({ isPlaying: false, isRecording: false, currentTime: time });
  },

  stop: () => {
    if (get().isRecording) {
      void get().toggleRecord();
      return;
    }
    // Stop aparca el motor y rebobina al inicio (convención DAW; el título del
    // botón lo promete). Pause conserva la posición aparcada.
    audioEngine.stop();
    audioEngine.rewind();
    set({ isPlaying: false, isRecording: false, currentTime: 0 });
  },

  toggleRecord: async () => {
    const { isRecording, tracks, clips } = get();
    if (isRecording) {
      const newClip = await audioEngine.stopRecording();
      // Fix(waveA): parar también la reproducción; antes la UI decía parado pero seguía sonando.
      audioEngine.stop();
      set({ isRecording: false, isPlaying: false });
      if (newClip) {
        get().addClip(newClip);
      }
    } else {
      const armedTrack = tracks.find((t) => t.armed) || tracks[0];
      if (!armedTrack) {
        // Fix(waveB-shell): toast no bloqueante en vez de alert().
        get().pushToast('Por favor añade y arma una pista para grabar.');
        return;
      }
      try {
        await audioEngine.startRecording(armedTrack.id, tracks, clips);
        set({ isRecording: true, isPlaying: true });
      } catch (err) {
        // Fix(waveB-shell): toast no bloqueante en vez de alert().
        get().pushToast('No se pudo acceder al micrófono para la grabación: ' + err);
      }
    }
  },

  // Fix(wave4): loop y metrónomo cableados al engine (setLoop/setMetronome reales).
  toggleLoop: () => {
    const next = !get().isLooping;
    set({ isLooping: next });
    audioEngine.setLoop(next, get().loopStart, get().loopEnd);
  },
  toggleMetronome: () => {
    const next = !get().metronome;
    set({ metronome: next });
    audioEngine.setMetronome(next);
  },
  // Fix(waveA): deja el store listo para la UI con selector de compás.
  setTimeSignature: (sig) => {
    set({ timeSignature: sig });
    audioEngine.setTimeSignature(sig[0], sig[1]);
  },
  // Fix(waveA): deja el store listo para la UI con inputs de rango de loop.
  setLoopRange: (start, end) => {
    set({ loopStart: start, loopEnd: end });
    audioEngine.setLoop(get().isLooping, start, end);
  },

  addTrack: (name, type = 'audio') => {
    recordHistory(cloneHistoryState(get()));
    const colors = ['#06b6d4', '#10b981', '#a855f7', '#f59e0b', '#ec4899', '#3b82f6'];
    const trackCount = get().tracks.length;
    const newId = 'track_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    const newTrack: AudioTrack = {
      id: newId,
      name: name || `Pista ${trackCount + 1}`,
      type,
      // Fix(waveB-ts): índice siempre en rango; ?? solo para el tipo.
      color: colors[trackCount % colors.length] ?? '#06b6d4',
      volume: 1.0,
      pan: 0,
      mute: false,
      solo: false,
      armed: trackCount === 0,
      plugins: [
        {
          instanceId: 'inst_eq_' + Date.now(),
          pluginId: 'eq3',
          name: 'Vintage 3-Band Parametric EQ',
          enabled: true,
          parameters: { lowGain: 0, lowFreq: 100, midGain: 0, midFreq: 1000, midQ: 1.0, highGain: 0, highFreq: 8000 },
        },
      ],
    };

    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const updated = [...get().tracks, newTrack];
    set({ tracks: updated, selectedTrackId: newId });
    void audioEngine.syncTracks(updated);

    return newId;
  },

  removeTrack: (id) => {
    recordHistory(cloneHistoryState(get()));
    // Release underlying AudioBuffer memory to avoid memory leaks
    // Fix(waveB): solo `audioBuffer` (alias `buffer` eliminado).
    get().clips.filter((c) => c.trackId === id).forEach((c) => {
      c.audioBuffer = null;
    });
    // ST-10: calcular con `get()`, luego `set(...)`, luego los efectos.
    const { tracks, clips, isPlaying, selectedTrackId } = get();
    const updatedTracks = tracks.filter((t) => t.id !== id);
    const updatedClips = clips.filter((c) => c.trackId !== id);
    set({
      tracks: updatedTracks,
      clips: updatedClips,
      // Fix(waveA): recalcular duración al borrar pista (antes solo crecía).
      duration: recalcDuration(updatedClips),
      selectedTrackId: selectedTrackId === id ? null : selectedTrackId,
    });
    void audioEngine.syncTracks(updatedTracks);
    if (isPlaying) {
      void audioEngine.play(updatedTracks, updatedClips, audioEngine.getCurrentTime());
    }
  },

  updateTrack: (id, updates) => {
    // ST-01: la edición más común (volumen/pan/mute/solo, arrastre) se puede deshacer.
    recordHistory(cloneHistoryState(get()));
    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const updated = get().tracks.map((t) => (t.id === id ? { ...t, ...updates } : t));
    set({ tracks: updated });
    void audioEngine.syncTracks(updated);
  },

  addClip: (clip) => {
    recordHistory(cloneHistoryState(get()));
    set((state) => {
      const maxEnd = Math.max(state.duration, clip.startTime + clip.duration + 4);
      return {
        clips: [...state.clips, clip],
        duration: maxEnd,
        selectedClipIds: [clip.id],
      };
    });
  },

  updateClip: (id, updates) => {
    // ST-01: el arrastre de clips se puede deshacer.
    recordHistory(cloneHistoryState(get()));
    // Fix(waveA): resincroniza audio en play (mismo patrón que removeClip/removeTrack;
    // antes mover un clip durante la reproducción no sonaba hasta reiniciar) y recalcula
    // duración para que arrastrar fuera no deje clips invisibles.
    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const { tracks, clips, isPlaying } = get();
    const updatedClips = clips.map((c) => (c.id === id ? { ...c, ...updates } : c));
    set({ clips: updatedClips, duration: recalcDuration(updatedClips) });
    if (isPlaying) {
      void audioEngine.play(tracks, updatedClips, audioEngine.getCurrentTime());
    }
  },

  removeClip: (id) => {
    recordHistory(cloneHistoryState(get()));
    const clip = get().clips.find((c) => c.id === id);
    // Fix(waveB): solo `audioBuffer` (alias `buffer` eliminado).
    if (clip) {
      clip.audioBuffer = null;
    }
    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const { tracks, clips, isPlaying, selectedClipIds } = get();
    const remainingClips = clips.filter((c) => c.id !== id);
    set({
      // Fix(waveA): recalcular duración al borrar clip (borrar todo vuelve a 16s).
      clips: remainingClips,
      duration: recalcDuration(remainingClips),
      selectedClipIds: selectedClipIds.filter((x) => x !== id),
    });
    if (isPlaying) {
      void audioEngine.play(tracks, remainingClips, audioEngine.getCurrentTime());
    }
  },

  splitClip: (clipId, atTime) => {
    const clip = get().clips.find((c) => c.id === clipId);
    if (!clip) return;
    // Fix(wave2): delega en splitClipOperation (minDuration 0.2, ids únicos); null = no mutar.
    const result = splitClipOperation(clip, atTime);
    if (!result) return;

    recordHistory(cloneHistoryState(get()));
    // Fix(wave2): regenera picos si hay audioBuffer (como hacía el store antes); sin buffer
    // se conservan los picos existentes para no romper clips sin audio decodificado.
    const withPeaks = (c: AudioClip): AudioClip =>
      c.audioBuffer ? { ...c, peaks: generateWaveformPeaks(c.audioBuffer, 500) } : c;
    const clip1 = withPeaks(result.clip1);
    const clip2 = withPeaks(result.clip2);

    set((state) => ({
      clips: state.clips.map((c) => (c.id === clipId ? clip1 : c)).concat(clip2),
      selectedClipIds: [clip2.id],
    }));
  },

  splitSelectedClips: (atTime) => {
    // G5: corta TODOS los seleccionados que contienen atTime en un solo
    // snapshot (un undo revierte el lote). Los no cortables conservan su
    // selección; las dos mitades de cada corte quedan seleccionadas.
    if (!Number.isFinite(atTime)) return;
    const ids = get().selectedClipIds;
    if (ids.length === 0) return;
    const splits = new Map<string, SplitResult>();
    for (const clip of get().clips) {
      if (!ids.includes(clip.id)) continue;
      const result = splitClipOperation(clip, atTime);
      if (result) splits.set(clip.id, result);
    }
    if (splits.size === 0) return;
    recordHistory(cloneHistoryState(get()));
    const withPeaks = (c: AudioClip): AudioClip =>
      c.audioBuffer ? { ...c, peaks: generateWaveformPeaks(c.audioBuffer, 500) } : c;
    // ST-10: calcular con `get()`, luego `set(...)` (sin efectos: el corte no
    // replanifica el engine, igual que `splitClip`).
    const next = get().clips.flatMap((c) => {
      const r = splits.get(c.id);
      return r ? [withPeaks(r.clip1), withPeaks(r.clip2)] : [c];
    });
    const selected: string[] = [];
    for (const id of ids) {
      const r = splits.get(id);
      if (r) selected.push(r.clip1.id, r.clip2.id);
      else selected.push(id);
    }
    set({ clips: next, selectedClipIds: selected });
  },

  // Fix(wave2): nueva acción trimClip que delega en trimLeft/RightOperation y regen picos.
  trimClip: (clipId, edge, deltaSeconds) => {
    const clip = get().clips.find((c) => c.id === clipId);
    if (!clip) return;
    const trimmed =
      edge === 'left' ? trimLeftOperation(clip, deltaSeconds) : trimRightOperation(clip, deltaSeconds);
    // ST-11: si el trim no cambió nada, no registrar (ni mutar): evita snapshots
    // inútiles y autosaves espurios.
    if (
      trimmed.startTime === clip.startTime &&
      trimmed.duration === clip.duration &&
      trimmed.offset === clip.offset
    ) {
      return;
    }
    recordHistory(cloneHistoryState(get()));
    const next: AudioClip = trimmed.audioBuffer
      ? { ...trimmed, peaks: generateWaveformPeaks(trimmed.audioBuffer, 500) }
      : trimmed;
    // Fix(waveA): recalcular duración tras el trim (encoger puede liberar compases).
    const updatedClips = get().clips.map((c) => (c.id === clipId ? next : c));
    set({ clips: updatedClips, duration: recalcDuration(updatedClips) });
  },

  copyClips: (ids) => {
    // Sin historial: el portapapeles no es estado del proyecto. Copia
    // superficial: `audioBuffer` y `peaks` se comparten por referencia.
    clipClipboard = get().clips
      .filter((c) => ids.includes(c.id))
      .map((c) => ({ ...c }));
  },

  pasteClips: (atTime) => {
    if (clipClipboard.length === 0) return;
    const state = get();
    // Pista de repliegue si la original ya no existe.
    const fallbackTrackId = state.selectedTrackId ?? state.tracks[0]?.id ?? null;
    if (state.tracks.length === 0 || fallbackTrackId === null) {
      state.pushToast('No hay pista donde pegar los clips.');
      return;
    }
    const liveTrackIds = new Set(state.tracks.map((t) => t.id));
    const minStart = Math.min(...clipClipboard.map((c) => c.startTime));
    const pasted: AudioClip[] = clipClipboard.map((c) => ({
      ...c,
      id: generateClipId(),
      trackId: liveTrackIds.has(c.trackId) ? c.trackId : fallbackTrackId,
      startTime: atTime === undefined ? c.startTime : atTime + (c.startTime - minStart),
    }));
    recordHistory(cloneHistoryState(get()));
    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const { tracks, clips, isPlaying } = get();
    const updatedClips = [...clips, ...pasted];
    set({
      clips: updatedClips,
      duration: recalcDuration(updatedClips),
      selectedClipIds: pasted.map((p) => p.id),
    });
    if (isPlaying) {
      void audioEngine.play(tracks, updatedClips, audioEngine.getCurrentTime());
    }
  },

  duplicateSelectedClips: () => {
    const ids = get().selectedClipIds;
    if (ids.length === 0) return;
    const targets = get().clips.filter((c) => ids.includes(c.id));
    if (targets.length === 0) return;
    recordHistory(cloneHistoryState(get()));
    // Cada duplicado va justo después de su original.
    const dups: AudioClip[] = targets.map((clip) => ({
      ...clip,
      id: generateClipId(),
      startTime: clip.startTime + clip.duration,
    }));
    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const { tracks, clips, isPlaying } = get();
    const updatedClips = [...clips, ...dups];
    set({
      clips: updatedClips,
      duration: recalcDuration(updatedClips),
      selectedClipIds: dups.map((d) => d.id),
    });
    if (isPlaying) {
      void audioEngine.play(tracks, updatedClips, audioEngine.getCurrentTime());
    }
  },

  removeSelectedClips: () => {
    const ids = get().selectedClipIds;
    if (ids.length === 0) return;
    // Un solo snapshot para que un `undo` restaure toda la selección (G5).
    recordHistory(cloneHistoryState(get()));
    const idSet = new Set(ids);
    get().clips.filter((c) => idSet.has(c.id)).forEach((c) => {
      c.audioBuffer = null;
    });
    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const { tracks, clips, isPlaying } = get();
    const remainingClips = clips.filter((c) => !idSet.has(c.id));
    set({
      clips: remainingClips,
      duration: recalcDuration(remainingClips),
      selectedClipIds: [],
    });
    if (isPlaying) {
      void audioEngine.play(tracks, remainingClips, audioEngine.getCurrentTime());
    }
  },

  addPluginToTrack: (trackId, pluginId) => {
    const def = BUILTIN_PLUGINS[pluginId];
    if (!def) return;

    // ST-01: añadir plugins se puede deshacer.
    recordHistory(cloneHistoryState(get()));

    const defaultParams: Record<string, number> = {};
    def.parameters.forEach((p) => {
      defaultParams[p.id] = p.defaultValue;
    });

    const instance: PluginInstance = {
      instanceId: 'inst_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      pluginId,
      name: def.name,
      enabled: true,
      parameters: defaultParams,
    };

    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const tracks = get().tracks.map((t) => {
      if (t.id === trackId) {
        return { ...t, plugins: [...t.plugins, instance] };
      }
      return t;
    });
    set({ tracks });
    const targetTrack = tracks.find((t) => t.id === trackId);
    if (targetTrack) audioEngine.rebuildTrackEffects(targetTrack);
  },

  removePluginFromTrack: (trackId, instanceId) => {
    // ST-01: quitar plugins se puede deshacer.
    recordHistory(cloneHistoryState(get()));
    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const tracks = get().tracks.map((t) => {
      if (t.id === trackId) {
        return { ...t, plugins: t.plugins.filter((p) => p.instanceId !== instanceId) };
      }
      return t;
    });
    set({ tracks });
    const targetTrack = tracks.find((t) => t.id === trackId);
    if (targetTrack) audioEngine.rebuildTrackEffects(targetTrack);
  },

  togglePlugin: (trackId, instanceId) => {
    // ST-01: activar/desactivar plugins se puede deshacer.
    recordHistory(cloneHistoryState(get()));
    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const tracks = get().tracks.map((t) => {
      if (t.id === trackId) {
        return {
          ...t,
          plugins: t.plugins.map((p) => (p.instanceId === instanceId ? { ...p, enabled: !p.enabled } : p)),
        };
      }
      return t;
    });
    set({ tracks });
    const targetTrack = tracks.find((t) => t.id === trackId);
    if (targetTrack) audioEngine.rebuildTrackEffects(targetTrack);
  },

  updatePluginParam: (trackId, instanceId, paramId, value) => {
    // ST-01: el giro de un knob se puede deshacer, pero coalescado —un arrastre
    // emite decenas de eventos por segundo y cada uno no puede ser un snapshot
    // (vaciaría la pila de 30 con un solo gesto). Leading-edge: el primer evento
    // del gesto guarda el valor previo (el que undo debe restaurar); se fuerza un
    // snapshot nuevo al pasar 400 ms desde el último. El "fin del gesto" es
    // implícito: el siguiente gesto empieza con snapshot fresco porque ya pasaron
    // >400 ms; dos gestos rapidísimos coalescen en un solo paso de undo.
    const now = Date.now();
    if (now - lastPluginParamHistoryAt >= PLUGIN_PARAM_HISTORY_MS) {
      recordHistory(cloneHistoryState(get()));
      lastPluginParamHistoryAt = now;
    }
    // ST-10: calcular con `get()`, luego `set(...)`, luego el efecto.
    const tracks = get().tracks.map((t) => {
      if (t.id === trackId) {
        return {
          ...t,
          plugins: t.plugins.map((p) => {
            if (p.instanceId === instanceId) {
              return { ...p, parameters: { ...p.parameters, [paramId]: value } };
            }
            return p;
          }),
        };
      }
      return t;
    });
    set({ tracks });
    // Fix(wave2): propaga al engine para que los knobs suenen en vivo
    // (patrón igual que add/remove/toggle, que llaman a rebuildTrackEffects).
    audioEngine.updateTrackPluginParam(trackId, instanceId, paramId, value);
  },

  loadDemoProject: async () => {
    // Release previous clip buffers to ensure zero memory leaks
    // Fix(waveB): solo `audioBuffer` (alias `buffer` eliminado).
    get().clips.forEach((c) => {
      c.audioBuffer = null;
    });
    // ST-03: proyecto nuevo ⇒ pilas de undo/redo vacías (si no, Ctrl+Z
    // resucita pistas del proyecto anterior).
    resetHistory();
    audioEngine.stop();

    let drumBuffer: AudioBuffer | null = null;
    let bassBuffer: AudioBuffer | null = null;
    let chordsBuffer: AudioBuffer | null = null;
    let leadBuffer: AudioBuffer | null = null;

    // Fix(M1-R1): inicialización segura del contexto de audio.
    // Si Web Audio no está disponible o falla, inicializa en modo silencioso sin arrojar error.
    try {
      const ctx = await audioEngine.ensureContext();
      if (ctx) {
        drumBuffer = generateDemoTrackBuffer(ctx, 'drums', 16, 120);
        bassBuffer = generateDemoTrackBuffer(ctx, 'bass', 16, 120);
        chordsBuffer = generateDemoTrackBuffer(ctx, 'chords', 16, 120);
        leadBuffer = generateDemoTrackBuffer(ctx, 'lead', 16, 120);
      }
    } catch (err) {
      console.warn('[store] AudioContext no disponible para demo, cargando en modo silencioso:', err);
      get().pushToast('Aviso: Motor de audio no disponible. Se inicia en modo silencioso.');
    }

    const safePeaks = (buf: AudioBuffer | null) =>
      buf ? generateWaveformPeaks(buf, 800) : new Float32Array(0);

    const trackDrumsId = 'track_drums';
    const trackBassId = 'track_bass';
    const trackChordsId = 'track_chords';
    const trackLeadId = 'track_lead';

    const tracks: AudioTrack[] = [
      {
        id: trackDrumsId,
        name: '🥁 Batería Acústica',
        type: 'audio',
        color: '#f59e0b',
        volume: 0.95,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        plugins: [
          {
            instanceId: 'inst_comp_drums',
            pluginId: 'compressor',
            name: 'Pro VCA Compressor',
            enabled: true,
            parameters: { threshold: -16, ratio: 4, attack: 15, release: 120, makeupGain: 2 },
          },
        ],
      },
      {
        id: trackBassId,
        name: '🎸 Bajo 808 / Sub',
        type: 'instrument',
        color: '#10b981',
        volume: 0.9,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        plugins: [
          {
            instanceId: 'inst_sat_bass',
            pluginId: 'saturator',
            name: 'Tube Saturation & Warmth',
            enabled: true,
            parameters: { drive: 35, tone: 4500, mix: 40 },
          },
        ],
      },
      {
        id: trackChordsId,
        name: '🎹 Sintetizador / Pads',
        type: 'instrument',
        color: '#06b6d4',
        volume: 0.85,
        pan: -0.2,
        mute: false,
        solo: false,
        armed: false,
        plugins: [
          {
            instanceId: 'inst_eq_chords',
            pluginId: 'eq3',
            name: 'Vintage 3-Band Parametric EQ',
            enabled: true,
            parameters: { lowGain: -2, lowFreq: 120, midGain: 1.5, midFreq: 1200, midQ: 1.2, highGain: 2, highFreq: 9000 },
          },
          {
            instanceId: 'inst_rev_chords',
            pluginId: 'reverb',
            name: 'Studio Hall Reverb',
            enabled: true,
            parameters: { decay: 2.2, mix: 28, damping: 7500 },
          },
        ],
      },
      {
        id: trackLeadId,
        name: '🎤 Voz Principal / Lead',
        type: 'vocal',
        color: '#a855f7',
        volume: 1.0,
        pan: 0.15,
        mute: false,
        solo: false,
        armed: true,
        plugins: [
          {
            instanceId: 'inst_comp_lead',
            pluginId: 'compressor',
            name: 'Pro VCA Compressor',
            enabled: true,
            parameters: { threshold: -18, ratio: 3.5, attack: 10, release: 100, makeupGain: 3 },
          },
          {
            instanceId: 'inst_delay_lead',
            pluginId: 'delay',
            name: 'Analog Tape Delay',
            enabled: true,
            parameters: { time: 250, feedback: 30, damp: 5000, mix: 20 },
          },
        ],
      },
    ];

    const clips: AudioClip[] = [
      {
        id: 'clip_drums_1',
        trackId: trackDrumsId,
        name: 'Drums Groove (120 BPM)',
        startTime: 0,
        duration: 16,
        offset: 0,
        audioBuffer: drumBuffer,
        peaks: safePeaks(drumBuffer),
        color: '#f59e0b',
      },
      {
        id: 'clip_bass_1',
        trackId: trackBassId,
        name: 'Bass Progression',
        startTime: 0,
        duration: 16,
        offset: 0,
        audioBuffer: bassBuffer,
        peaks: safePeaks(bassBuffer),
        color: '#10b981',
      },
      {
        id: 'clip_chords_1',
        trackId: trackChordsId,
        name: 'Analog Warm Pad',
        startTime: 0,
        duration: 16,
        offset: 0,
        audioBuffer: chordsBuffer,
        peaks: safePeaks(chordsBuffer),
        color: '#06b6d4',
      },
      {
        id: 'clip_lead_1',
        trackId: trackLeadId,
        name: 'Vocal Melody Lead',
        startTime: 0,
        duration: 16,
        offset: 0,
        audioBuffer: leadBuffer,
        peaks: safePeaks(leadBuffer),
        color: '#a855f7',
      },
    ];

    set({
      projectName: 'Proyecto Demo — Hydra Groove',
      bpm: 120,
      duration: 20,
      tracks,
      clips,
      selectedTrackId: trackLeadId,
      currentTime: 0,
    });

    try {
      await audioEngine.syncTracks(tracks);
    } catch (err) {
      console.warn('[store] AudioEngine syncTracks falló al cargar demo:', err);
    }
  },

  // Pantalla de inicio: proyecto vacío (conserva zoom/vista/toasts).
  // El autosave persistirá el lienzo en blanco tras el arranque.
  createBlankProject: async () => {
    get().clips.forEach((c) => {
      c.audioBuffer = null;
    });
    // ST-03: proyecto nuevo ⇒ pilas de undo/redo vacías.
    resetHistory();
    audioEngine.stop();

    set({
      projectName: 'Proyecto sin título',
      bpm: 120,
      timeSignature: [4, 4],
      currentTime: 0,
      duration: 16,
      isPlaying: false,
      isRecording: false,
      isLooping: false,
      loopStart: 0,
      loopEnd: 16,
      metronome: false,
      masterVolume: 1.0,
      masterMute: false,
      selectedTrackId: null,
      selectedClipIds: [],
      tracks: [],
      clips: [],
    });

    try {
      audioEngine.setTempo(120);
      audioEngine.getMasterBus()?.setVolume(1.0);
      audioEngine.getMasterBus()?.setMute(false);
      await audioEngine.syncTracks([]);
    } catch (err) {
      console.warn('[store] AudioEngine syncTracks falló al crear proyecto en blanco:', err);
    }
  },
}));
