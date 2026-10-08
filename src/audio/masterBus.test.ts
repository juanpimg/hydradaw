import { describe, it, expect, vi, afterEach } from 'vitest';
import { MasterBus } from './MasterBus';

// Regression test: exports rendered silence because MasterBus only connected
// the analyser to destination for realtime AudioContext, never for
// OfflineAudioContext (the graph was never wired to the render target).

function makeNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: { value: 1, setTargetAtTime: vi.fn() },
    pan: { value: 0, setTargetAtTime: vi.fn() },
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 0 },
    attack: { value: 0 },
    release: { value: 0 },
    fftSize: 0,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData: vi.fn(),
  };
}

function makeContextClass() {
  return class FakeContext {
    currentTime = 0;
    destination = makeNode();
    createGain() { return makeNode(); }
    createDynamicsCompressor() { return makeNode(); }
    createAnalyser() { return makeNode(); }
  };
}

const RealAudioContext = (globalThis as any).AudioContext;
const RealOfflineAudioContext = (globalThis as any).OfflineAudioContext;

afterEach(() => {
  (globalThis as any).AudioContext = RealAudioContext;
  (globalThis as any).OfflineAudioContext = RealOfflineAudioContext;
});

describe('MasterBus destination wiring', () => {
  it('connects analyser to destination on realtime AudioContext', () => {
    const FakeAudioContext = makeContextClass();
    (globalThis as any).AudioContext = FakeAudioContext;
    const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
    const bus = new MasterBus(ctx);
    const analyser = bus.analyserNode as unknown as ReturnType<typeof makeNode>;
    expect(analyser.connect).toHaveBeenCalledTimes(1);
    expect(analyser.connect).toHaveBeenCalledWith((ctx as any).destination);
  });

  it('connects analyser to destination on OfflineAudioContext (export path)', () => {
    const FakeOffline = makeContextClass();
    (globalThis as any).AudioContext = class {} as any; // ensure NOT instanceof AudioContext
    (globalThis as any).OfflineAudioContext = FakeOffline;
    const ctx = new FakeOffline() as unknown as BaseAudioContext;
    const bus = new MasterBus(ctx);
    const analyser = bus.analyserNode as unknown as ReturnType<typeof makeNode>;
    expect(analyser.connect).toHaveBeenCalledTimes(1);
    expect(analyser.connect).toHaveBeenCalledWith((ctx as any).destination);
  });

  it('does not connect on unknown/headless mock contexts', () => {
    (globalThis as any).AudioContext = undefined;
    (globalThis as any).OfflineAudioContext = undefined;
    const ctx = {
      currentTime: 0,
      createGain: () => makeNode(),
      createDynamicsCompressor: () => makeNode(),
      createAnalyser: () => makeNode(),
    } as unknown as BaseAudioContext;
    const bus = new MasterBus(ctx);
    const analyser = bus.analyserNode as unknown as ReturnType<typeof makeNode>;
    expect(analyser.connect).not.toHaveBeenCalled();
  });
});
