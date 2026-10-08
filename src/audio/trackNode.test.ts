import { describe, it, expect, vi } from 'vitest';
import { TrackNode } from './TrackNode';
import { MasterBus } from './MasterBus';
import type { AudioTrack } from '../types/daw';

function makeParam(initial = 0) {
  return { value: initial, setTargetAtTime: vi.fn() };
}

function makeNode() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function makeContext(opts: { offline?: boolean; withDestination?: boolean } = {}) {
  const gains: ReturnType<typeof makeParam>[] = [];
  const pans: ReturnType<typeof makeParam>[] = [];
  const analysers: any[] = [];
  const ctx: any = {
    currentTime: 0,
    createGain: () => {
      const g = makeParam(1);
      gains.push(g);
      return { ...makeNode(), gain: g };
    },
    createStereoPanner: () => {
      const p = makeParam(0);
      pans.push(p);
      return { ...makeNode(), pan: p };
    },
    createDynamicsCompressor: () => ({
      ...makeNode(),
      threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
      attack: { value: 0 }, release: { value: 0 },
    }),
    createAnalyser: () => {
      const a: any = {
        ...makeNode(),
        fftSize: 256,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData: vi.fn((arr: Float32Array) => { arr.fill(0.5); }),
      };
      analysers.push(a);
      return a;
    },
    __gains: gains,
    __pans: pans,
    __analysers: analysers,
  };
  if (opts.offline) ctx.startRendering = vi.fn();
  if (opts.withDestination) ctx.destination = makeNode();
  return ctx;
}

function makeTrack(over: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: 't1', name: 'T', type: 'audio' as any, color: '#fff',
    volume: 1, pan: 0, mute: false, solo: false, armed: false,
    plugins: [], ...over,
  };
}

describe('TrackNode', () => {
  it('clamps pan to [-1,1] before scheduling', () => {
    const ctx = makeContext() as unknown as BaseAudioContext;
    const node = new TrackNode(ctx, makeTrack({ pan: 5 }));
    const pan = (node.pannerNode as any).pan;
    expect(pan.setTargetAtTime).toHaveBeenCalled();
    expect(pan.setTargetAtTime.mock.calls[0][0]).toBe(1);
    pan.setTargetAtTime.mockClear();
    node.updateTrackState(makeTrack({ pan: -9 }));
    expect(pan.setTargetAtTime.mock.calls[0][0]).toBe(-1);
  });

  it('clamps volume to [0,1.5] before scheduling', () => {
    const ctx = makeContext() as unknown as BaseAudioContext;
    const node = new TrackNode(ctx, makeTrack({ volume: 9 }));
    const gain = (node.volumeNode as any).gain;
    expect(gain.setTargetAtTime.mock.calls[0][0]).toBe(1.5);
    gain.setTargetAtTime.mockClear();
    node.updateTrackState(makeTrack({ volume: -3 }));
    expect(gain.setTargetAtTime.mock.calls[0][0]).toBe(0);
  });

  it('connect() is idempotent (no double wire / +6dB)', () => {
    const ctx = makeContext() as unknown as BaseAudioContext;
    const node = new TrackNode(ctx, makeTrack());
    const dest = makeNode() as unknown as AudioNode;
    node.connect(dest);
    node.connect(dest);
    expect((node.analyserNode as any).connect).toHaveBeenCalledTimes(1);
    const dest2 = makeNode() as unknown as AudioNode;
    node.connect(dest2);
    expect((node.analyserNode as any).connect).toHaveBeenCalledTimes(2);
  });

  it('offline uses direct assignment (no ramps) with clamped values', () => {
    const ctx = makeContext({ offline: true }) as unknown as BaseAudioContext;
    const node = new TrackNode(ctx, makeTrack({ pan: 5, volume: 9, mute: false }));
    const pan = (node.pannerNode as any).pan;
    const vol = (node.volumeNode as any).gain;
    const mute = (node.muteNode as any).gain;
    expect(pan.setTargetAtTime).not.toHaveBeenCalled();
    expect(vol.setTargetAtTime).not.toHaveBeenCalled();
    expect(mute.setTargetAtTime).not.toHaveBeenCalled();
    expect(pan.value).toBe(1);
    expect(vol.value).toBe(1.5);
    expect(mute.value).toBe(1);
    // Muted offline still direct-assigns 0
    node.updateTrackState(makeTrack({ pan: -9, volume: -2, mute: true }));
    expect(pan.value).toBe(-1);
    expect(vol.value).toBe(0);
    expect(mute.value).toBe(0);
  });

  it('getMeterLevels reuses the instance buffer and computes correct values', () => {
    const ctx = makeContext() as unknown as BaseAudioContext;
    const node = new TrackNode(ctx, makeTrack());
    (node.analyserNode as any).fftSize = 4;
    (node.analyserNode as any).getFloatTimeDomainData = vi.fn((arr: Float32Array) => {
      arr[0] = 0.5; arr[1] = -0.5; arr[2] = 0.25; arr[3] = -0.25;
    });
    const a = node.getMeterLevels();
    const firstBuf = ((node.analyserNode as any).getFloatTimeDomainData as any).mock.calls[0][0];
    const b = node.getMeterLevels();
    const secondBuf = ((node.analyserNode as any).getFloatTimeDomainData as any).mock.calls[1][0];
    expect(secondBuf).toBe(firstBuf);
    // rms = sqrt((.25+.25+.0625+.0625)/4)=sqrt(.15625)≈.3953 → *1.4 ≈ .5534; peak .5
    expect(a.peak).toBeCloseTo(0.5, 5);
    expect(a.rms).toBeCloseTo(Math.min(1, Math.sqrt(0.15625) * 1.4), 5);
    expect(b).toEqual(a);
  });
});

describe('MasterBus (waveA extensions)', () => {
  it('setVolume clamps to [0,1.5]', () => {
    const ctx = makeContext() as unknown as BaseAudioContext;
    const bus = new MasterBus(ctx);
    const gain = (bus.volumeNode as any).gain;
    gain.setTargetAtTime.mockClear();
    bus.setVolume(9);
    expect(gain.setTargetAtTime.mock.calls[0][0]).toBe(1.5);
    bus.setVolume(-4);
    expect(gain.setTargetAtTime.mock.calls.at(-1)[0]).toBe(0);
  });

  it('offline setVolume/setMute use direct assignment', () => {
    const ctx = makeContext({ offline: true, withDestination: true }) as unknown as BaseAudioContext;
    const bus = new MasterBus(ctx);
    const vg = (bus.volumeNode as any).gain;
    const mg = (bus.muteNode as any).gain;
    vg.setTargetAtTime.mockClear();
    mg.setTargetAtTime.mockClear();
    bus.setVolume(0.7);
    bus.setMute(true);
    expect(vg.setTargetAtTime).not.toHaveBeenCalled();
    expect(mg.setTargetAtTime).not.toHaveBeenCalled();
    expect(vg.value).toBe(0.7);
    expect(mg.value).toBe(0);
  });

  it('duck-typed wiring connects with destination, skips without (webkit-safe)', () => {
    // Safari/webkit-style: plain context object, no instanceof realm match.
    const ctx = makeContext({ withDestination: true }) as unknown as BaseAudioContext;
    const bus = new MasterBus(ctx);
    expect((bus.analyserNode as any).connect).toHaveBeenCalledWith((ctx as any).destination);
    const bare = makeContext() as unknown as BaseAudioContext;
    const bus2 = new MasterBus(bare);
    expect((bus2.analyserNode as any).connect).not.toHaveBeenCalled();
  });

  it('getMeterLevels reuses the instance buffer', () => {
    const ctx = makeContext({ withDestination: true }) as unknown as BaseAudioContext;
    const bus = new MasterBus(ctx);
    (bus.analyserNode as any).fftSize = 4;
    (bus.analyserNode as any).getFloatTimeDomainData = vi.fn((arr: Float32Array) => { arr.fill(0.5); });
    bus.getMeterLevels();
    bus.getMeterLevels();
    const c0 = ((bus.analyserNode as any).getFloatTimeDomainData as any).mock.calls[0][0];
    const c1 = ((bus.analyserNode as any).getFloatTimeDomainData as any).mock.calls[1][0];
    expect(c1).toBe(c0);
    const levels = bus.getMeterLevels();
    expect(levels).toEqual({ rms: Math.min(1, 0.5 * 1.4), peak: 0.5 });
  });
});
