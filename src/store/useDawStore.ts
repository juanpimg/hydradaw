import { create } from 'zustand';
import type { AudioTrack, AudioClip, PluginInstance, SnapMode } from '../types/daw';
import { audioEngine } from '../audio/AudioEngine';
import { splitClipOperation, trimLeftOperation, trimRightOperation } from '../audio/timelineOps';
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
}

const MAX_HISTORY = 30;
let undoStack: HistorySnapshot[] = [];
let redoStack: HistorySnapshot[] = [];

export function cloneHistoryState(tracks: AudioTrack[], clips: AudioClip[]): HistorySnapshot {
  return {
    tracks: tracks.map((t) => ({
      ...t,
      plugins: t.plugins.map((p) => ({ ...p, parameters: { ...p.parameters } })),
    })),
    clips: clips.map((c) => ({ ...c })),
  };
}

export function resetHistory(): void {
  undoStack = [];
  redoStack = [];
  useDawStore?.setState?.({ canUndo: false, canRedo: false });
}

function recordHistory(tracks: AudioTrack[], clips: AudioClip[]): void {
  undoStack.push(cloneHistoryState(tracks, clips));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  useDawStore?.setState?.({ canUndo: true, canRedo: false });
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
  selectedClipId: string | null;
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
  setSelectedClip: (id: string | null) => void;
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
  trimClip: (clipId: string, edge: 'left' | 'right', deltaSeconds: number) => void;

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
  selectedClipId: null,
  exportModalOpen: false,
  pluginModalTrackId: null,
  pluginModalInstanceId: null,
  snapMode: '1/16',

  tracks: [],
  clips: [],

  // Fix(waveB-shell): push añade con id monótono; dismiss filtra por id.
  toasts: [],
  pushToast: (message) => set((state) => ({ toasts: [...state.toasts, { id: nextToastId++, message }] })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  canUndo: false,
  canRedo: false,
  undo: () => {
    if (undoStack.length === 0) return;
    const current = cloneHistoryState(get().tracks, get().clips);
    redoStack.push(current);
    const prev = undoStack.pop()!;
    set({
      tracks: prev.tracks,
      clips: prev.clips,
      duration: recalcDuration(prev.clips),
      canUndo: undoStack.length > 0,
      canRedo: true,
    });
    audioEngine.syncTracks(prev.tracks);
    if (get().isPlaying) {
      audioEngine.play(prev.tracks, prev.clips, audioEngine.getCurrentTime());
    }
    get().pushToast('Deshecho');
  },
  redo: () => {
    if (redoStack.length === 0) return;
    const current = cloneHistoryState(get().tracks, get().clips);
    undoStack.push(current);
    const next = redoStack.pop()!;
    set({
      tracks: next.tracks,
      clips: next.clips,
      duration: recalcDuration(next.clips),
      canUndo: true,
      canRedo: redoStack.length > 0,
    });
    audioEngine.syncTracks(next.tracks);
    if (get().isPlaying) {
      audioEngine.play(next.tracks, next.clips, audioEngine.getCurrentTime());
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
  setSelectedClip: (selectedClipId) => set({ selectedClipId }),
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
    audioEngine.stop();
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
    recordHistory(get().tracks, get().clips);
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

    set((state) => {
      const updated = [...state.tracks, newTrack];
      audioEngine.syncTracks(updated);
      return { tracks: updated, selectedTrackId: newId };
    });

    return newId;
  },

  removeTrack: (id) => {
    recordHistory(get().tracks, get().clips);
    // Release underlying AudioBuffer memory to avoid memory leaks
    // Fix(waveB): solo `audioBuffer` (alias `buffer` eliminado).
    get().clips.filter((c) => c.trackId === id).forEach((c) => {
      c.audioBuffer = null;
    });
    set((state) => {
      const updatedTracks = state.tracks.filter((t) => t.id !== id);
      const updatedClips = state.clips.filter((c) => c.trackId !== id);
      audioEngine.syncTracks(updatedTracks);
      if (state.isPlaying) {
        audioEngine.play(updatedTracks, updatedClips, audioEngine.getCurrentTime());
      }
      // Fix(waveA): recalcular duración al borrar pista (antes solo crecía).
      return {
        tracks: updatedTracks,
        clips: updatedClips,
        duration: recalcDuration(updatedClips),
        selectedTrackId: state.selectedTrackId === id ? null : state.selectedTrackId,
      };
    });
  },

  updateTrack: (id, updates) => {
    set((state) => {
      const updated = state.tracks.map((t) => (t.id === id ? { ...t, ...updates } : t));
      audioEngine.syncTracks(updated);
      return { tracks: updated };
    });
  },

  addClip: (clip) => {
    recordHistory(get().tracks, get().clips);
    set((state) => {
      const maxEnd = Math.max(state.duration, clip.startTime + clip.duration + 4);
      return {
        clips: [...state.clips, clip],
        duration: maxEnd,
        selectedClipId: clip.id,
      };
    });
  },

  updateClip: (id, updates) => {
    // Fix(waveA): resincroniza audio en play (mismo patrón que removeClip/removeTrack;
    // antes mover un clip durante la reproducción no sonaba hasta reiniciar) y recalcula
    // duración para que arrastrar fuera no deje clips invisibles.
    set((state) => {
      const updatedClips = state.clips.map((c) => (c.id === id ? { ...c, ...updates } : c));
      if (state.isPlaying) {
        audioEngine.play(state.tracks, updatedClips, audioEngine.getCurrentTime());
      }
      return { clips: updatedClips, duration: recalcDuration(updatedClips) };
    });
  },

  removeClip: (id) => {
    recordHistory(get().tracks, get().clips);
    const clip = get().clips.find((c) => c.id === id);
    // Fix(waveB): solo `audioBuffer` (alias `buffer` eliminado).
    if (clip) {
      clip.audioBuffer = null;
    }
    set((state) => {
      const remainingClips = state.clips.filter((c) => c.id !== id);
      if (state.isPlaying) {
        audioEngine.play(state.tracks, remainingClips, audioEngine.getCurrentTime());
      }
      // Fix(waveA): recalcular duración al borrar clip (borrar todo vuelve a 16s).
      return {
        clips: remainingClips,
        duration: recalcDuration(remainingClips),
        selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
      };
    });
  },

  splitClip: (clipId, atTime) => {
    const clip = get().clips.find((c) => c.id === clipId);
    if (!clip) return;
    // Fix(wave2): delega en splitClipOperation (minDuration 0.2, ids únicos); null = no mutar.
    const result = splitClipOperation(clip, atTime);
    if (!result) return;

    recordHistory(get().tracks, get().clips);
    // Fix(wave2): regenera picos si hay audioBuffer (como hacía el store antes); sin buffer
    // se conservan los picos existentes para no romper clips sin audio decodificado.
    const withPeaks = (c: AudioClip): AudioClip =>
      c.audioBuffer ? { ...c, peaks: generateWaveformPeaks(c.audioBuffer, 500) } : c;
    const clip1 = withPeaks(result.clip1);
    const clip2 = withPeaks(result.clip2);

    set((state) => ({
      clips: state.clips.map((c) => (c.id === clipId ? clip1 : c)).concat(clip2),
      selectedClipId: clip2.id,
    }));
  },

  // Fix(wave2): nueva acción trimClip que delega en trimLeft/RightOperation y regen picos.
  trimClip: (clipId, edge, deltaSeconds) => {
    const clip = get().clips.find((c) => c.id === clipId);
    if (!clip) return;
    recordHistory(get().tracks, get().clips);
    const trimmed =
      edge === 'left' ? trimLeftOperation(clip, deltaSeconds) : trimRightOperation(clip, deltaSeconds);
    const next: AudioClip = trimmed.audioBuffer
      ? { ...trimmed, peaks: generateWaveformPeaks(trimmed.audioBuffer, 500) }
      : trimmed;
    // Fix(waveA): recalcular duración tras el trim (encoger puede liberar compases).
    set((state) => {
      const updatedClips = state.clips.map((c) => (c.id === clipId ? next : c));
      return { clips: updatedClips, duration: recalcDuration(updatedClips) };
    });
  },

  addPluginToTrack: (trackId, pluginId) => {
    const def = BUILTIN_PLUGINS[pluginId];
    if (!def) return;

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

    set((state) => {
      const tracks = state.tracks.map((t) => {
        if (t.id === trackId) {
          return { ...t, plugins: [...t.plugins, instance] };
        }
        return t;
      });
      const targetTrack = tracks.find((t) => t.id === trackId);
      if (targetTrack) audioEngine.rebuildTrackEffects(targetTrack);
      return { tracks };
    });
  },

  removePluginFromTrack: (trackId, instanceId) => {
    set((state) => {
      const tracks = state.tracks.map((t) => {
        if (t.id === trackId) {
          return { ...t, plugins: t.plugins.filter((p) => p.instanceId !== instanceId) };
        }
        return t;
      });
      const targetTrack = tracks.find((t) => t.id === trackId);
      if (targetTrack) audioEngine.rebuildTrackEffects(targetTrack);
      return { tracks };
    });
  },

  togglePlugin: (trackId, instanceId) => {
    set((state) => {
      const tracks = state.tracks.map((t) => {
        if (t.id === trackId) {
          return {
            ...t,
            plugins: t.plugins.map((p) => (p.instanceId === instanceId ? { ...p, enabled: !p.enabled } : p)),
          };
        }
        return t;
      });
      const targetTrack = tracks.find((t) => t.id === trackId);
      if (targetTrack) audioEngine.rebuildTrackEffects(targetTrack);
      return { tracks };
    });
  },

  updatePluginParam: (trackId, instanceId, paramId, value) => {
    set((state) => {
      const tracks = state.tracks.map((t) => {
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
      return { tracks };
    });
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
      selectedClipId: null,
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
