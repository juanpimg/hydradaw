import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine, audioEngine } from './AudioEngine';
import { MasterBus } from './MasterBus';
import { useDawStore } from '../store/useDawStore';
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

function setupEngine() {
  const engine = AudioEngine.getInstance();
  const mockCtx = new MockBaseContext();
  (engine as unknown as { context: unknown }).context = mockCtx;
  (engine as unknown as { masterBus: unknown }).masterBus = new MasterBus(
    mockCtx as unknown as BaseAudioContext
  );
  (engine as unknown as { trackNodes: Map<string, unknown> }).trackNodes.clear();
  (engine as unknown as { isPlaying: boolean }).isPlaying = false;
  (engine as unknown as { activeLoop: unknown }).activeLoop = null;
  vi.spyOn(engine, 'ensureContext').mockResolvedValue(mockCtx as unknown as AudioContext);
  return { engine, mockCtx };
}

afterEach(() => {
  try {
    audioEngine.stop();
  } catch (_) {}
  try {
    audioEngine.clear();
  } catch (_) {}
  audioEngine.setLoop(false, 0, 16);
  audioEngine.setMetronome(false);
  useDawStore.setState({ currentTime: 0, isPlaying: false, isRecording: false, tracks: [], clips: [] });
  vi.restoreAllMocks();
});

describe('Task 20: el transporte conserva la posición al parar', () => {
  it('stop() conserva la posición del cursor', async () => {
    const { engine, mockCtx } = setupEngine();
    await engine.play([makeTrack()], [makeClip()], 0);
    mockCtx.currentTime += 5.02; // compensa el lookahead 0.02 → posición exacta 5
    const pos = engine.stop();
    expect(pos).toBeCloseTo(5, 2);
    // Hoy getCurrentTime() devuelve el playheadOffset obsoleto (0).
    expect(engine.getCurrentTime()).toBeCloseTo(5, 2);
  });

  it('la acción stop del store no rebobina a 0', async () => {
    const { mockCtx } = setupEngine();
    useDawStore.setState({
      tracks: [makeTrack()],
      clips: [makeClip()],
      currentTime: 0,
      isPlaying: true,
      isRecording: false,
    });
    const { tracks, clips } = useDawStore.getState();
    await audioEngine.play(tracks, clips, 0);
    mockCtx.currentTime += 5.02;
    useDawStore.getState().stop();
    expect(useDawStore.getState().isPlaying).toBe(false);
    expect(useDawStore.getState().currentTime).toBeCloseTo(5, 2);
  });

  it('la acción pause del store sigue conservando la posición', async () => {
    const { mockCtx } = setupEngine();
    useDawStore.setState({
      tracks: [makeTrack()],
      clips: [makeClip()],
      currentTime: 0,
      isPlaying: true,
      isRecording: false,
    });
    const { tracks, clips } = useDawStore.getState();
    await audioEngine.play(tracks, clips, 0);
    mockCtx.currentTime += 5.02;
    useDawStore.getState().pause();
    expect(useDawStore.getState().isPlaying).toBe(false);
    expect(useDawStore.getState().currentTime).toBeCloseTo(5, 2);
  });
});
