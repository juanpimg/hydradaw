// Task 9 (AUD-06, AUD-07): los gains de fades y clicks deben desconectarse
// al terminar la fuente; si no, el grafo crece sin cota en sesiones largas.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { MasterBus } from './MasterBus';
import type { AudioTrack, AudioClip } from '../types/daw';

/* ------------------------------------------------------------------ */
/* Mocks headless (estilo engine_fixes.test.ts)                        */
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
  linearRampToValueAtTime(): void {}
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
  gains: MockGainNode[] = [];
  createGain(): MockGainNode {
    const g = new MockGainNode();
    this.gains.push(g);
    return g;
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
  vi.unstubAllGlobals();
});

/* -------------------------------- tests ------------------------------ */

describe('AUD-06/AUD-07: sin fugas de nodos de fade ni de clicks', () => {
  it('el clipGain de un fade se desconecta al terminar la fuente', async () => {
    const { engine, mockCtx } = setupEngine();
    // Los nodos de pista ya existen: solo el clipGain cuenta como fuga.
    await engine.syncTracks([makeTrack()]);
    const baseline = mockCtx.gains.length;
    await engine.play(
      [makeTrack()],
      [makeClip({ fadeIn: 0.5, fadeOut: 0.5 })],
      0
    );
    const clipGains = mockCtx.gains.slice(baseline);
    // Un clip con fade crea exactamente un clipGain.
    expect(clipGains.length).toBe(1);
    expect(mockCtx.sources.length).toBe(1);
    // Terminan todas las fuentes: el onended debe soltar también el clipGain.
    for (const s of mockCtx.sources) s.onended?.();
    for (const g of clipGains) expect(g.disconnected).toBe(true);
  });

  it('cada click del metrónomo desconecta su gain al terminar', async () => {
    const { engine, mockCtx } = setupEngine();
    await engine.syncTracks([makeTrack()]);
    const baseline = mockCtx.gains.length;
    await engine.play([makeTrack()], [], 0, { metronome: true });
    expect(mockCtx.oscillators.length).toBeGreaterThan(0);
    const clickGains = mockCtx.gains.slice(baseline);
    // Un gain por click, ni más ni menos.
    expect(clickGains.length).toBe(mockCtx.oscillators.length);
    for (const o of [...mockCtx.oscillators]) o.onended?.();
    for (const g of clickGains) expect(g.disconnected).toBe(true);
  });

  it('play(clip con fade) → stop() desconecta todos los clipGains', async () => {
    const { engine, mockCtx } = setupEngine();
    await engine.syncTracks([makeTrack()]);
    const baseline = mockCtx.gains.length;
    await engine.play(
      [makeTrack()],
      [makeClip({ fadeIn: 0.5, fadeOut: 0.5 })],
      0
    );
    const clipGains = mockCtx.gains.slice(baseline);
    expect(clipGains.length).toBe(1);
    // Parada explícita: el onended se anula, pero el cleanup debe correr igual.
    engine.stop();
    for (const g of clipGains) expect(g.disconnected).toBe(true);
  });

  it('play(metrónomo) → stop() desconecta todos los gains de click', async () => {
    const { engine, mockCtx } = setupEngine();
    await engine.syncTracks([makeTrack()]);
    const baseline = mockCtx.gains.length;
    await engine.play([makeTrack()], [], 0, { metronome: true });
    const clickGains = mockCtx.gains.slice(baseline);
    expect(clickGains.length).toBe(mockCtx.oscillators.length);
    expect(clickGains.length).toBeGreaterThan(0);
    // Parada explícita: debe soltar también el gain de cada click.
    engine.stop();
    for (const g of clickGains) expect(g.disconnected).toBe(true);
  });
});
