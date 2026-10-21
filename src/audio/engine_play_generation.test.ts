import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { MasterBus } from './MasterBus';
import type { AudioTrack, AudioClip } from '../types/daw';

/* Mocks headless (patrón de engine_loop.test.ts) */

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
  linearRampToValueAtTime(): void {}
}

class MockAudioNode {
  connectedTo: MockAudioNode[] = [];
  connect(destination: MockAudioNode): MockAudioNode {
    this.connectedTo.push(destination);
    return destination;
  }
  disconnect(): void {
    this.connectedTo = [];
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

function makeTrack(id = 'track_1'): AudioTrack {
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

/** Contexto con resume diferido: ensureContext no resuelve hasta liberarlo. */
function setupDeferredEngine() {
  const engine = AudioEngine.getInstance();
  const mockCtx = new MockBaseContext();
  (engine as unknown as { context: unknown }).context = mockCtx;
  (engine as unknown as { masterBus: unknown }).masterBus = new MasterBus(
    mockCtx as unknown as BaseAudioContext
  );
  (engine as unknown as { trackNodes: Map<string, unknown> }).trackNodes.clear();
  (engine as unknown as { isPlaying: boolean }).isPlaying = false;
  (engine as unknown as { activeLoop: unknown }).activeLoop = null;
  let resolveCtx!: (ctx: AudioContext) => void;
  const gate = new Promise<AudioContext>((res) => {
    resolveCtx = res;
  });
  vi.spyOn(engine, 'ensureContext').mockReturnValue(gate);
  return {
    engine,
    mockCtx,
    release: () => resolveCtx(mockCtx as unknown as AudioContext),
  };
}

afterEach(() => {
  const engine = AudioEngine.getInstance();
  try {
    engine.stop();
  } catch (_) {}
  try {
    engine.clear();
  } catch (_) {}
  engine.setLoop(false, 0, 16);
  engine.setMetronome(false);
  vi.restoreAllMocks();
});

describe('AUD-01/AUD-02: token de generación de play()', () => {
  it('dos play() solapados programan una sola generación de fuentes', async () => {
    const { engine, mockCtx, release } = setupDeferredEngine();
    const tracks = [makeTrack()];
    const clips = [makeClip()];
    const p1 = engine.play(tracks, clips, 0);
    const p2 = engine.play(tracks, clips, 0);
    release();
    await Promise.all([p1, p2]);
    // Un clip ⇒ una fuente por generación; dos generaciones serían dos fuentes.
    expect(mockCtx.sources.length).toBe(1);
  });

  it('stop() durante un play() en vuelo deja el motor en silencio', async () => {
    const { engine, mockCtx, release } = setupDeferredEngine();
    const p = engine.play([makeTrack()], [makeClip()], 0);
    engine.stop();
    release();
    await p;
    expect((engine as unknown as { isPlaying: boolean }).isPlaying).toBe(false);
    expect(mockCtx.sources.length).toBe(0);
  });

  it('I2: play() informa la supervivencia (false tras stop intercalado, true en arranque limpio)', async () => {
    const { engine, release } = setupDeferredEngine();
    const p = engine.play([makeTrack()], [makeClip()], 0);
    engine.stop();
    release();
    await expect(p).resolves.toBe(false);
    const q = engine.play([makeTrack()], [makeClip()], 0);
    await expect(q).resolves.toBe(true);
    expect((engine as unknown as { isPlaying: boolean }).isPlaying).toBe(true);
  });
});
