// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { MasterBus } from './MasterBus';
import type { AudioTrack, AudioClip } from '../types/daw';

/* ------------------------------------------------------------------ */
/* Mocks headless (estilo engine_loop.test.ts)                         */
/* ------------------------------------------------------------------ */

class MockAudioParam {
  value: number;
  constructor(defaultValue: number = 0) {
    this.value = defaultValue;
  }
  setTargetAtTime(target: number): void {
    this.value = target;
  }
  setValueAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(): void {}
}

class MockAudioNode {
  connectedTo: MockAudioNode[] = [];
  disconnected = false;
  connect(destination: MockAudioNode): MockAudioNode {
    this.connectedTo.push(destination);
    this.disconnected = false;
    return destination;
  }
  disconnect(): void {
    this.connectedTo = [];
    this.disconnected = true;
  }
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam(1.0);
}

class MockOscillatorNode extends MockAudioNode {
  type: OscillatorType = 'sine';
  frequency = new MockAudioParam(440);
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

class MockBufferSourceNode extends MockAudioNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  startCalls: Array<{ when: number; offset: number; dur: number }> = [];
  stopped = false;
  start(when?: number, offset?: number, dur?: number): void {
    this.startCalls.push({ when: when ?? 0, offset: offset ?? 0, dur: dur ?? 0 });
  }
  stop(): void {
    this.stopped = true;
  }
}

class MockBaseContext {
  currentTime = 100.0;
  sampleRate = 44100;
  destination = new MockAudioNode();
  sources: MockBufferSourceNode[] = [];
  oscillators: MockOscillatorNode[] = [];
  createGain(): MockGainNode {
    return new MockGainNode();
  }
  createOscillator(): MockOscillatorNode {
    const o = new MockOscillatorNode();
    this.oscillators.push(o);
    return o;
  }
  createBufferSource(): MockBufferSourceNode {
    const s = new MockBufferSourceNode();
    this.sources.push(s);
    return s;
  }
  createDynamicsCompressor(): MockAudioNode & Record<string, MockAudioParam> {
    const n = new MockAudioNode() as MockAudioNode & Record<string, MockAudioParam>;
    n.threshold = new MockAudioParam(-24);
    n.knee = new MockAudioParam(30);
    n.ratio = new MockAudioParam(12);
    n.attack = new MockAudioParam(0.003);
    n.release = new MockAudioParam(0.25);
    return n;
  }
  createStereoPanner(): MockAudioNode & { pan: MockAudioParam } {
    const n = new MockAudioNode() as MockAudioNode & { pan: MockAudioParam };
    n.pan = new MockAudioParam(0);
    return n;
  }
  createAnalyser(): MockAudioNode & { fftSize: number; smoothingTimeConstant: number; getFloatTimeDomainData: (a: Float32Array) => void } {
    const n = new MockAudioNode() as MockAudioNode & {
      fftSize: number;
      smoothingTimeConstant: number;
      getFloatTimeDomainData: (a: Float32Array) => void;
    };
    n.fftSize = 256;
    n.smoothingTimeConstant = 0.8;
    n.getFloatTimeDomainData = (a: Float32Array) => a.fill(0.1);
    return n;
  }
}

/* ------------------------------ helpers ------------------------------ */

function makeTrack(id = 'track_1', overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id,
    name: 'Pista 1',
    type: 'audio',
    color: '#06b6d4',
    volume: 1.0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    plugins: [],
    ...overrides,
  };
}

function fakeBuffer(duration: number): AudioBuffer {
  return { duration } as unknown as AudioBuffer;
}

function makeClip(overrides: Partial<AudioClip> = {}): AudioClip {
  return {
    id: 'clip_1',
    trackId: 'track_1',
    name: 'Clip 1',
    startTime: 0,
    duration: 16,
    offset: 0,
    audioBuffer: fakeBuffer(16),
    peaks: new Float32Array([0, 0]),
    color: '#06b6d4',
    ...overrides,
  };
}

function setupEngine() {
  const engine = AudioEngine.getInstance();
  const mockCtx = new MockBaseContext();
  (engine as unknown as { context: unknown }).context = mockCtx;
  (engine as unknown as { masterBus: unknown }).masterBus = new MasterBus(
    mockCtx as unknown as BaseAudioContext
  );
  vi.spyOn(engine, 'ensureContext').mockResolvedValue(mockCtx as unknown as AudioContext);
  // Limpia estado singleton entre tests.
  (engine as unknown as { trackNodes: Map<string, unknown> }).trackNodes.clear();
  (engine as unknown as { trackEffectsSig?: Map<string, string> }).trackEffectsSig?.clear();
  (engine as unknown as { isPlaying: boolean }).isPlaying = false;
  (engine as unknown as { isRecording: boolean }).isRecording = false;
  (engine as unknown as { lastTake: unknown }).lastTake = null;
  (engine as unknown as { activeLoop: unknown }).activeLoop = null;
  return { engine, mockCtx };
}

function mockRecorderEnv() {
  const stream = { getTracks: () => [] as Array<{ stop: () => void }> };
  (globalThis as unknown as { navigator?: unknown }).navigator = {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  };
  class MockMediaRecorder {
    static isTypeSupported = () => false;
    state = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    mimeType = '';
    constructor(public s: unknown, public o?: unknown) {}
    start(): void {
      this.state = 'recording';
    }
    stop(): void {
      this.state = 'inactive';
      this.onstop?.();
    }
  }
  (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = MockMediaRecorder;
}

afterEach(() => {
  const engine = AudioEngine.getInstance();
  try {
    (engine as unknown as { isRecording: boolean }).isRecording = false;
    engine.stop();
  } catch (_) {}
  try {
    engine.clear();
  } catch (_) {}
  engine.setLoop(false, 0, 16);
  engine.setMetronome(false);
  vi.restoreAllMocks();
  delete (globalThis as unknown as { navigator?: unknown }).navigator;
  delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
});

/* -------------------------------- tests ------------------------------ */

describe('waveA: fixes del engine', () => {
  it('punch-in en frío: isRecording después del play inicial y la toma sobrevive', async () => {
    const { engine } = setupEngine();
    mockRecorderEnv();
    const stopRecSpy = vi.spyOn(engine, 'stopRecording');
    await engine.startRecording('track_1', [makeTrack()], [makeClip()]);
    expect((engine as unknown as { isRecording: boolean }).isRecording).toBe(true);
    // El stop interno del play inicial no consumió la grabación.
    expect(stopRecSpy).not.toHaveBeenCalled();
    expect((engine as unknown as { isPlaying: boolean }).isPlaying).toBe(true);
  });

  it('punch-in en caliente: si ya sonaba no reinicia clips (solo arranca recorder)', async () => {
    const { engine, mockCtx } = setupEngine();
    mockRecorderEnv();
    await engine.play([makeTrack()], [makeClip()], 0);
    const scheduledBefore = mockCtx.sources.length;
    expect(scheduledBefore).toBeGreaterThan(0);
    const playSpy = vi.spyOn(engine, 'play');
    await engine.startRecording('track_1', [makeTrack()], [makeClip()]);
    // No re-planifica: play no se invoca de nuevo y no hay fuentes extra.
    expect(playSpy).not.toHaveBeenCalled();
    expect(mockCtx.sources.length).toBe(scheduledBefore);
    expect((engine as unknown as { isRecording: boolean }).isRecording).toBe(true);
  });

  it('stop() preserva la toma en lastTake (getter) en vez de perderla', async () => {
    const { engine } = setupEngine();
    const fakeClip = {
      id: 'clip_take',
      trackId: 'track_1',
      name: 'Toma',
      startTime: 0,
      duration: 1,
      offset: 0,
      audioBuffer: fakeBuffer(1),
      // Fix(waveB): alias `buffer` eliminado — la toma expone solo `audioBuffer`.
      peaks: new Float32Array([0]),
    };
    (engine as unknown as { isRecording: boolean }).isRecording = true;
    vi.spyOn(engine, 'stopRecording').mockResolvedValue(fakeClip as unknown as AudioClip & { audioBuffer: AudioBuffer });
    engine.stop();
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.getLastTake()).toBe(fakeClip);
    // stop(true) preserva: no consume la grabación.
    (engine as unknown as { isRecording: boolean }).isRecording = true;
    const spy2 = vi.spyOn(engine, 'stopRecording').mockResolvedValue(null);
    (engine as unknown as { lastTake: unknown }).lastTake = null;
    engine.stop(true);
    expect(spy2).not.toHaveBeenCalled();
  });

  it('syncTracks reconstruye efectos solo cuando cambia la firma de plugins', async () => {
    const { engine } = setupEngine();
    const rebuildSpy = vi.spyOn(engine, 'rebuildTrackEffects');
    const base = makeTrack('track_1', {
      plugins: [{ instanceId: 'i1', pluginId: 'eq3', name: 'EQ', enabled: true, parameters: { g: 0 } }],
    });
    await engine.syncTracks([base]);
    expect(rebuildSpy).not.toHaveBeenCalled(); // alta: el ctor ya construye
    await engine.syncTracks([{ ...base }]);
    expect(rebuildSpy).not.toHaveBeenCalled(); // misma firma: no rebuild
    await engine.syncTracks([
      { ...base, plugins: [{ instanceId: 'i1', pluginId: 'eq3', name: 'EQ', enabled: true, parameters: { g: 5 } }] },
    ]);
    expect(rebuildSpy).toHaveBeenCalledTimes(1); // cambio de param
    await engine.syncTracks([
      { ...base, plugins: [{ instanceId: 'i1', pluginId: 'eq3', name: 'EQ', enabled: false, parameters: { g: 5 } }] },
    ]);
    expect(rebuildSpy).toHaveBeenCalledTimes(2); // toggle enabled
    expect(typeof engine.rebuildTrackEffectsChain).toBe('function');
  });

  it('seek(): stop síncrono antes de replanificar (sin doble sonido)', async () => {
    const { engine } = setupEngine();
    await engine.play([makeTrack()], [makeClip()], 0);
    const stopSpy = vi.spyOn(engine, 'stop');
    const playSpy = vi.spyOn(engine, 'play');
    engine.seek(5);
    expect(stopSpy).toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), 5);
    // Orden: stop antes que play (stop síncrono, play async después).
    expect(stopSpy.mock.invocationCallOrder[0]!).toBeLessThan(playSpy.mock.invocationCallOrder[0]!);
    await new Promise((r) => setTimeout(r, 0));
    expect((engine as unknown as { isPlaying: boolean }).isPlaying).toBe(true);
  });

  it('track nuevo respeta anySoloed (nace silenciado si otro tiene solo)', async () => {
    const { engine } = setupEngine();
    await engine.syncTracks([makeTrack('a', { solo: true })]);
    await engine.syncTracks([makeTrack('a', { solo: true }), makeTrack('b', { solo: false })]);
    const nodeB = engine.getTrackNodes().get('b');
    expect(nodeB).toBeDefined();
    const muteVal = (nodeB!.muteNode as unknown as { gain: { value: number } }).gain.value;
    expect(muteVal).toBe(0);
  });

  it('loop timer suma lookahead 0.02 y handleLoopWrap compensa jitter', async () => {
    const { engine } = setupEngine();
    const toSpy = vi.spyOn(globalThis, 'setTimeout');
    await engine.play([makeTrack()], [makeClip()], 0, { loop: true, loopStart: 0, loopEnd: 4 });
    const firstDelay = toSpy.mock.calls[toSpy.mock.calls.length - 1]![1] as number;
    // (4 + 0.02) * 1000 = 4020
    expect(firstDelay).toBeCloseTo(4020, 0);
    // Simula wrap tardío (100ms late): el re-schedule debe acortarse.
    (engine as unknown as { loopDueWallMs: number }).loopDueWallMs = Date.now() - 100;
    toSpy.mockClear();
    (engine as unknown as { handleLoopWrap: () => void }).handleLoopWrap();
    const secondDelay = toSpy.mock.calls[toSpy.mock.calls.length - 1]![1] as number;
    expect(secondDelay).toBeLessThan(firstDelay);
    expect(secondDelay).toBeCloseTo(4020 - 100, -1);
  });

  it('compat de firmas usadas por el store (+ nuevos getters)', async () => {
    const { engine } = setupEngine();
    for (const m of [
      'play',
      'stop',
      'seek',
      'syncTracks',
      'rebuildTrackEffects',
      'rebuildTrackEffectsChain',
      'getLastTake',
      'getMasterBus',
      'getCurrentTime',
      'ensureContext',
      'startRecording',
      'stopRecording',
      'renderOffline',
      'renderOfflineMixdown',
      'setTempo',
      'updateTrackPluginParam',
    ] as const) {
      expect(typeof (engine as unknown as Record<string, unknown>)[m]).toBe('function');
    }
    expect(typeof engine.stop()).toBe('number');
    expect(typeof engine.stop(true)).toBe('number');
    await expect(engine.play([makeTrack()], [makeClip()], 0)).resolves.toBeUndefined();
  });

  it('telemetría: reutiliza scratch y emite solo si playing o cambió el nivel', async () => {
    const { engine } = setupEngine();
    const frames: Array<() => void> = [];
    // Fix(waveA): rAF no existe en Node — se define el global en vez de espiar.
    (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = ((cb: () => void) => {
      frames.push(cb);
      return 1;
    }) as unknown as typeof requestAnimationFrame;
    (engine as unknown as { startTelemetryLoop: () => void }).startTelemetryLoop();
    expect(frames.length).toBe(1);
    const scratchBefore = (engine as unknown as { telemetryScratch: Float32Array }).telemetryScratch;
    const seen: unknown[] = [];
    const unsub = engine.onMeterUpdate((lv) => seen.push(lv));
    frames[0]!(); // pausa, primer emit (firma inicial)
    const scratchAfterFirst = (engine as unknown as { telemetryScratch: Float32Array }).telemetryScratch;
    frames[0]!(); // pausa, mismos niveles → no emite
    expect(seen.length).toBe(1);
    (engine as unknown as { isPlaying: boolean }).isPlaying = true;
    frames[0]!(); // playing → emite aunque no cambie
    expect(seen.length).toBe(2);
    // El scratch se reutiliza cuando el fftSize cabe (256 < 2048).
    expect(scratchAfterFirst).toBe(scratchBefore);
    unsub();
    delete (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  });
});
