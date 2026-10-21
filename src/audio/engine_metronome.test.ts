import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { MasterBus } from './MasterBus';

/* Mocks headless (patrón de engine_loop.test.ts, con startCalls en el oscilador) */

class MockAudioParam {
  value: number;
  setValueAtTimeCalls: Array<{ v: number; t: number }> = [];
  expRampCalls: Array<{ v: number; t: number }> = [];
  constructor(defaultValue: number = 0) {
    this.value = defaultValue;
  }
  setTargetAtTime(target: number): void {
    this.value = target;
  }
  setValueAtTime(v: number, t: number): void {
    this.value = v;
    this.setValueAtTimeCalls.push({ v, t });
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    this.expRampCalls.push({ v, t });
  }
  linearRampToValueAtTime(): void {}
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
  startCalls: number[] = [];
  stopCalls: number[] = [];
  start(when?: number): void {
    this.startCalls.push(when ?? 0);
  }
  stop(when?: number): void {
    this.stopCalls.push(when ?? 0);
  }
}

class MockBufferSourceNode extends MockAudioNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  start(_when?: number, _offset?: number, _dur?: number): void {}
  stop(): void {}
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

interface EnginePriv {
  isPlaying: boolean;
  activeMetronome: boolean;
  activeLoop: unknown;
  playheadOffset: number;
  startTime: number;
  metroScheduledUntil: number;
  armMetroExtender: (ctx: BaseAudioContext) => void;
}

function privOf(engine: AudioEngine): EnginePriv {
  return engine as unknown as EnginePriv;
}

/** Arma el extensor aislado (sin play): reproducción lineal con metrónomo en t=0. */
function setupMetroExtender() {
  const engine = AudioEngine.getInstance();
  const mockCtx = new MockBaseContext();
  (engine as unknown as { context: unknown }).context = mockCtx;
  (engine as unknown as { masterBus: unknown }).masterBus = new MasterBus(
    mockCtx as unknown as BaseAudioContext
  );
  engine.setTempo(120);
  const priv = privOf(engine);
  priv.isPlaying = true;
  priv.activeMetronome = true;
  priv.activeLoop = null;
  priv.playheadOffset = 0;
  priv.startTime = mockCtx.currentTime;
  priv.armMetroExtender(mockCtx as unknown as BaseAudioContext);
  return { engine, mockCtx, priv };
}

afterEach(() => {
  const engine = AudioEngine.getInstance();
  try {
    engine.stop();
  } catch (_) {}
  const priv = privOf(engine);
  priv.activeMetronome = false;
  priv.activeLoop = null;
  engine.setLoop(false, 0, 16);
  engine.setMetronome(false);
  engine.setTempo(120);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AUD-04: metrónomo sin solapes', () => {
  it('el extensor no programa dos veces el mismo click', async () => {
    vi.useFakeTimers();
    const { mockCtx } = setupMetroExtender();
    await vi.advanceTimersByTimeAsync(1000); // disparo 1: [0, 2) a 120 BPM
    mockCtx.currentTime += 1; // el reloj de audio avanza 1 s
    await vi.advanceTimersByTimeAsync(1000); // disparo 2: solapa [1, 2)
    const times = mockCtx.oscillators.flatMap((o) => o.startCalls);
    expect(times.length).toBeGreaterThan(0);
    // Cada instante de click suena una sola vez (sin duplicados por el solape).
    expect(new Set(times).size).toBe(times.length);
  });

  it('el watermark se resetea al apagar el metrónomo y al parar', async () => {
    vi.useFakeTimers();
    const { engine, mockCtx, priv } = setupMetroExtender();
    await vi.advanceTimersByTimeAsync(1000);
    expect(priv.metroScheduledUntil).toBeGreaterThan(0);
    engine.setMetronome(false);
    expect(priv.metroScheduledUntil).toBe(0);
    // Rearma y verifica el reseteo al parar.
    engine.setMetronome(true);
    priv.isPlaying = true;
    priv.activeMetronome = true;
    priv.armMetroExtender(mockCtx as unknown as BaseAudioContext);
    await vi.advanceTimersByTimeAsync(1000);
    expect(priv.metroScheduledUntil).toBeGreaterThan(0);
    engine.stop();
    expect(priv.metroScheduledUntil).toBe(0);
  });
});
