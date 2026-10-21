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
import { handleGlobalKeyDown } from '../hooks/useGlobalShortcuts';
import { audioEngine } from '../audio/AudioEngine';
import { serializeProject, deserializeProject } from '../store/persistence';

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
    duration: 2,
    offset: 0,
    audioBuffer: null,
    peaks: new Float32Array(0),
    color: '#06b6d4',
    ...overrides,
  };
}

function seedMulti() {
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
    tracks: [makeTrack({ id: 't1' }), makeTrack({ id: 't2', name: 'Pista 2' })],
    clips: [
      makeClip({ id: 'c1', trackId: 't1', startTime: 0 }),
      makeClip({ id: 'c2', trackId: 't1', startTime: 3 }),
      makeClip({ id: 'c3', trackId: 't2', startTime: 0 }),
      makeClip({ id: 'c4', trackId: 't2', startTime: 3 }),
    ],
    toasts: [],
  });
}

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

beforeEach(() => {
  resetHistory();
  vi.clearAllMocks();
  seedMulti();
});

describe('Multi-selección de clips (G5)', () => {
  it('M1: click normal ⇒ 1 clip seleccionado', () => {
    useDawStore.getState().selectClip('c1', 'single');
    expect(useDawStore.getState().selectedClipIds).toEqual(['c1']);
    useDawStore.getState().selectClip('c2', 'single');
    expect(useDawStore.getState().selectedClipIds).toEqual(['c2']);
  });

  it('M2: toggle ⇒ añade/quita de la selección', () => {
    useDawStore.getState().selectClip('c1', 'single');
    useDawStore.getState().selectClip('c2', 'toggle');
    expect(useDawStore.getState().selectedClipIds).toEqual(['c1', 'c2']);
    useDawStore.getState().selectClip('c1', 'toggle');
    expect(useDawStore.getState().selectedClipIds).toEqual(['c2']);
  });

  it('M3: range ⇒ selecciona todos los clips entre el ancla y el destino', () => {
    useDawStore.getState().selectClip('c1', 'single');
    useDawStore.getState().selectClip('c2', 'range');
    expect(useDawStore.getState().selectedClipIds).toEqual(['c1', 'c2']);
    // Rango entre pistas (ordenado por pista y tiempo): c1..c4 lo cubre todo.
    useDawStore.getState().selectClip('c1', 'single');
    useDawStore.getState().selectClip('c4', 'range');
    expect(useDawStore.getState().selectedClipIds).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('M4: Delete borra todos los seleccionados', () => {
    useDawStore.getState().selectClip('c1', 'single');
    useDawStore.getState().selectClip('c2', 'toggle');
    handleGlobalKeyDown(makeKeyEvent({ key: 'Delete' }));
    const ids = useDawStore.getState().clips.map((c) => c.id).sort();
    expect(ids).toEqual(['c3', 'c4']);
    expect(useDawStore.getState().selectedClipIds).toEqual([]);
  });

  it('M5: undo de un borrado múltiple restaura todos', () => {
    useDawStore.getState().selectClip('c1', 'single');
    useDawStore.getState().selectClip('c3', 'toggle');
    handleGlobalKeyDown(makeKeyEvent({ key: 'Delete' }));
    expect(useDawStore.getState().clips).toHaveLength(2);
    useDawStore.getState().undo();
    expect(useDawStore.getState().clips.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('M6: la persistencia guarda y restaura selectedClipIds como array válido', () => {
    useDawStore.getState().selectClip('c1', 'single');
    useDawStore.getState().selectClip('c2', 'toggle');
    const serialized = serializeProject(useDawStore.getState());
    expect(serialized.selectedClipIds).toEqual(['c1', 'c2']);
    // Un id colgando se anula al cargar.
    const raw = { ...serialized, selectedClipIds: ['c1', 'fantasma'] };
    const back = deserializeProject(raw);
    expect(back!.selectedClipIds).toEqual(['c1']);
  });

  function seedThreeOverlapping() {
    useDawStore.setState({
      tracks: [makeTrack({ id: 't1' }), makeTrack({ id: 't2', name: 'Pista 2' }), makeTrack({ id: 't3', name: 'Pista 3' })],
      clips: [
        makeClip({ id: 'c1', trackId: 't1', startTime: 0, duration: 4 }),
        makeClip({ id: 'c2', trackId: 't2', startTime: 0, duration: 4 }),
        makeClip({ id: 'c3', trackId: 't3', startTime: 0, duration: 4 }),
      ],
    });
    vi.mocked(audioEngine.getCurrentTime).mockReturnValue(2);
    useDawStore.getState().selectClip('c1', 'single');
    useDawStore.getState().selectClip('c2', 'toggle');
    useDawStore.getState().selectClip('c3', 'toggle');
  }

  it('M7: S con tres clips seleccionados corta los tres sin reducir la selección', () => {
    seedThreeOverlapping();
    handleGlobalKeyDown(makeKeyEvent({ key: 's' }));
    expect(useDawStore.getState().clips).toHaveLength(6);
    // Las dos mitades de cada corte siguen seleccionadas: nada se pierde.
    expect(useDawStore.getState().selectedClipIds).toHaveLength(6);
  });

  it('M8: un solo undo revierte el corte múltiple entero (y redo lo repone)', () => {
    seedThreeOverlapping();
    handleGlobalKeyDown(makeKeyEvent({ key: 's' }));
    expect(useDawStore.getState().clips).toHaveLength(6);
    useDawStore.getState().undo();
    expect(useDawStore.getState().clips.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
    useDawStore.getState().redo();
    expect(useDawStore.getState().clips).toHaveLength(6);
  });
});
