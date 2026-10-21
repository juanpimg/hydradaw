import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  registerCustomPluginForTest,
  runHarnessDirect,
  lastOps,
  TEST_SESSION,
} from '../audio/pluginTestBridge';
import { replayBridgeOps, scanCustomPluginCode } from '../audio/pluginSandbox';
import { pluginHost } from '../audio/PluginHost';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Mocks mínimos de Web Audio para el replay del padre.
// ---------------------------------------------------------------------------

class BridgeParam {
  value: number;
  calls: Array<{ method: string; args: number[] }> = [];
  constructor(defaultValue: number) {
    this.value = defaultValue;
  }
  setValueAtTime(v: number): void {
    this.value = v;
    this.calls.push({ method: 'setValueAtTime', args: [v] });
  }
  setTargetAtTime(v: number): void {
    this.value = v;
    this.calls.push({ method: 'setTargetAtTime', args: [v] });
  }
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
}

class BridgeNode {
  connectedTo: BridgeNode[] = [];
  connect(dest: BridgeNode): void {
    this.connectedTo.push(dest);
  }
  disconnect(): void {
    this.connectedTo = [];
  }
}

class BridgeGain extends BridgeNode {
  gain = new BridgeParam(1);
}

class BridgeFilter extends BridgeNode {
  type = 'lowpass';
  frequency = new BridgeParam(350);
  Q = new BridgeParam(1);
}

class BridgeConvolver extends BridgeNode {
  buffer: unknown = null;
}

class BridgeOsc extends BridgeNode {
  type = 'sine';
  frequency = new BridgeParam(440);
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

function makeBridgeCtx() {
  const gains: BridgeGain[] = [];
  const filters: BridgeFilter[] = [];
  const oscs: BridgeOsc[] = [];
  const ctx = {
    createGain: () => {
      const n = new BridgeGain();
      gains.push(n);
      return n;
    },
    createBiquadFilter: () => {
      const n = new BridgeFilter();
      filters.push(n);
      return n;
    },
    createConvolver: () => new BridgeConvolver(),
    createOscillator: () => {
      const n = new BridgeOsc();
      oscs.push(n);
      return n;
    },
  } as unknown as BaseAudioContext;
  return { ctx, gains, filters, oscs };
}

const GAIN_PLUGIN = `
  const customPlugin = {
    id: 'bridge_gain',
    name: 'Ganancia Puente',
    category: 'utility',
    description: 'crea un gain por el proxy',
    parameters: [
      { id: 'level', name: 'Nivel', min: 0, max: 2, step: 0.1, defaultValue: 1.0 }
    ],
    createDSPNode: (ctx, params) => {
      const g = ctx.createGain();
      g.gain.setTargetAtTime(params.level ?? 1.0, 0, 0.02);
      return {
        inputNode: g,
        outputNode: g,
        updateParameter: (pid, val) => {
          if (pid === 'level') g.gain.setTargetAtTime(val, 0, 0.02);
        }
      };
    }
  };
`;

// ---------------------------------------------------------------------------
// V1: el puente de verdad — un plugin crea un nodo por el proxy y el padre
// lo materializa y lo opera.
// ---------------------------------------------------------------------------

describe('Puente de capacidades iframe (ronda fix 1)', () => {
  it('V1: el plugin crea un gain por el proxy y el padre lo materializa', () => {
    const def = registerCustomPluginForTest(GAIN_PLUGIN);
    expect(def.id).toBe('bridge_gain');
    // La definición puente no trae fábrica viva: instanciar directo es un error.
    expect(() =>
      def.createDSPNode({} as unknown as BaseAudioContext, {})
    ).toThrow(/puente/);

    const { ctx, gains } = makeBridgeCtx();
    const node = pluginHost.createInstanceNode(ctx, {
      instanceId: 'v1_inst',
      pluginId: 'bridge_gain',
      name: 'Ganancia Puente',
      enabled: true,
      parameters: { level: 0.5 },
    });
    expect(node).not.toBeNull();
    // El replay aplica el template (default 1.0) y los valores llegan por el
    // canal async; aquí se verifica la estructura cableada.
    expect(gains.length).toBe(1);
    expect(node!.inputNode).toBe(gains[0] as unknown as AudioNode);
    expect(node!.outputNode).toBe(gains[0] as unknown as AudioNode);
    expect(() => node!.updateParameter('level', 0.7)).not.toThrow();
    node!.cleanup?.();
  });

  it('V2: el contenedor confina el código — la sonda del padre queda intacta', () => {
    vi.stubGlobal('__sbxProbe', { touched: [] as string[] });
    try {
      const run = runHarnessDirect();
      // Pasa el escáner (ninguna palabra prohibida) pero delata ejecución.
      const code = `__sbxProbe.touched.push('V2');\n${GAIN_PLUGIN}`;
      expect(scanCustomPluginCode(code)).toBeNull();
      run.dispatch({
        type: 'hydradaw-evaluate',
        session: TEST_SESSION,
        reqId: 'v2',
        code,
        origin: 'http://localhost/',
      });
      const probe = (
        globalThis as unknown as { __sbxProbe: { touched: string[] } }
      ).__sbxProbe.touched;
      expect(probe).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('V3: operaciones fuera de la lista (convolver.buffer) rechazan el registro', () => {
    expect(() =>
      registerCustomPluginForTest(`
        const customPlugin = {
          id: 'bridge_reverb_x',
          name: 'Reverb X',
          category: 'spatial',
          description: 'intenta fijar el buffer del convolver',
          parameters: [],
          createDSPNode: (ctx) => {
            const c = ctx.createConvolver();
            c.buffer = null;
            return { inputNode: c, outputNode: c, updateParameter: () => {} };
          }
        };
      `)
    ).toThrow(/permitida|buffer/i);
  });

  it('V4: un parámetro que updateParameter ignora rechaza el registro', () => {
    expect(() =>
      registerCustomPluginForTest(`
        const customPlugin = {
          id: 'bridge_deaf',
          name: 'Sordo',
          category: 'utility',
          description: 'declara un parámetro que nunca ajusta',
          parameters: [
            { id: 'rate', name: 'Rate', min: 0.1, max: 10, step: 0.1, defaultValue: 1.0 }
          ],
          createDSPNode: (ctx) => {
            const g = ctx.createGain();
            return { inputNode: g, outputNode: g, updateParameter: () => {} };
          }
        };
      `)
    ).toThrow(/updateParameter/);
  });

  it('V5: la importación valida los datos del puente (método, handle, finitud, tope)', () => {
    const base = {
      descriptor: {
        id: 'bridge_bad',
        name: 'Malo',
        category: 'utility',
        description: 'd',
        parameters: [],
      },
      input: 'h1',
      output: 'h1',
    };
    expect(() =>
      pluginHost.importBridgeDefinition({
        ...base,
        oplog: [{ op: 'create', node: 'teletransporte', handle: 'h1', args: [] }],
      } as unknown as Parameters<typeof pluginHost.importBridgeDefinition>[0])
    ).toThrow();
    expect(() =>
      pluginHost.importBridgeDefinition({
        ...base,
        oplog: [{ op: 'connect', from: 'h1', to: 'h9' }],
      } as unknown as Parameters<typeof pluginHost.importBridgeDefinition>[0])
    ).toThrow();
    expect(() =>
      pluginHost.importBridgeDefinition({
        ...base,
        oplog: [
          { op: 'create', node: 'gain', handle: 'h1', args: [] },
          { op: 'param', handle: 'h1', param: 'gain', method: 'setValue', args: [NaN] },
        ],
      } as unknown as Parameters<typeof pluginHost.importBridgeDefinition>[0])
    ).toThrow();
    const huge: Array<{ op: string; node: string; handle: string; args: number[] }> = [];
    for (let i = 0; i < 600; i++) {
      huge.push({ op: 'create', node: 'gain', handle: `h${i + 1}`, args: [] });
    }
    expect(() =>
      pluginHost.importBridgeDefinition({
        ...base,
        oplog: huge,
      } as unknown as Parameters<typeof pluginHost.importBridgeDefinition>[0])
    ).toThrow();
  });

  it('V6: el oscilador arranca solo en el replay y se detiene al limpiar', () => {
    registerCustomPluginForTest(`
      const customPlugin = {
        id: 'bridge_osc',
        name: 'Osc Puente',
        category: 'utility',
        description: 'oscilador por el proxy',
        parameters: [],
        createDSPNode: (ctx) => {
          const o = ctx.createOscillator();
          o.type = 'square';
          const g = ctx.createGain();
          o.connect(g);
          return { inputNode: g, outputNode: g, updateParameter: () => {} };
        }
      };
    `);
    const { ctx, oscs } = makeBridgeCtx();
    const node = pluginHost.createInstanceNode(ctx, {
      instanceId: 'v6_inst',
      pluginId: 'bridge_osc',
      name: 'Osc Puente',
      enabled: true,
      parameters: {},
    });
    expect(node).not.toBeNull();
    expect(oscs.length).toBe(1);
    expect(oscs[0]!.started).toBe(true);
    expect(oscs[0]!.type).toBe('square');
    node!.cleanup?.();
    expect(oscs[0]!.stopped).toBe(true);
  });

  it('V7: el replay aplica el template (tipo y valores del filtro)', () => {
    const def = registerCustomPluginForTest(`
      const customPlugin = {
        id: 'bridge_filter',
        name: 'Filtro Puente',
        category: 'custom',
        description: 'filtro por el proxy',
        parameters: [
          { id: 'cutoff', name: 'Cutoff', min: 100, max: 12000, step: 50, defaultValue: 2500 }
        ],
        createDSPNode: (ctx, params) => {
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.setTargetAtTime(params.cutoff ?? 2500, 0, 0.02);
          return { inputNode: f, outputNode: f, updateParameter: (pid, val) => {
            if (pid === 'cutoff') f.frequency.setTargetAtTime(val, 0, 0.02);
          } };
        }
      };
    `);
    expect(def.id).toBe('bridge_filter');
    const { ctx, filters } = makeBridgeCtx();
    const replayed = replayBridgeOps(
      ctx,
      (def as unknown as { __bridge: { oplog: Parameters<typeof replayBridgeOps>[1] } })
        .__bridge.oplog,
      'h1',
      'h1'
    );
    expect(filters.length).toBe(1);
    expect(filters[0]!.type).toBe('lowpass');
    expect(filters[0]!.frequency.value).toBe(2500);
    expect(replayed.inputNode).toBe(filters[0] as unknown as AudioNode);
  });

  it('V8: las operaciones de update viajan por el canal (ops con instanceId)', () => {
    const run = runHarnessDirect();
    run.dispatch({
      type: 'hydradaw-evaluate',
      session: TEST_SESSION,
      reqId: 'v8eval',
      code: GAIN_PLUGIN,
      origin: 'http://localhost/',
    });
    run.dispatch({
      type: 'hydradaw-instantiate',
      session: TEST_SESSION,
      pluginId: 'bridge_gain',
      instanceId: 'v8_inst',
      params: { level: 0.5 },
    });
    const ops = lastOps(run.captured);
    expect(ops).not.toBeNull();
    expect(ops!['instanceId']).toBe('v8_inst');
    const list = ops!['ops'] as Array<Record<string, unknown>>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(
      list.some((o) => o['op'] === 'param' && o['param'] === 'gain')
    ).toBe(true);
  });
});
