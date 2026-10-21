// I1: la plantilla por defecto del editor debe compilar bajo el sandbox puente.
// La plantilla anterior usaba `context.currentTime` (inexistente en el proxy) y
// el registro fallaba en la sonda con "argumento no finito".
import { describe, it, expect } from 'vitest';
import { CUSTOM_PLUGIN_TEMPLATE } from '../audio/customPluginTemplate';
import { registerCustomPluginForTest } from '../audio/pluginTestBridge';
import { pluginHost } from '../audio/PluginHost';

class TParam {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
}

class TFilter {
  type = 'lowpass';
  frequency = new TParam(350);
  Q = new TParam(1);
  gain = new TParam(0);
  connectedTo: unknown[] = [];
  connect(dest: unknown): void {
    this.connectedTo.push(dest);
  }
  disconnect(): void {
    this.connectedTo = [];
  }
}

function makeTemplateCtx() {
  const filters: TFilter[] = [];
  const ctx = {
    createBiquadFilter: () => {
      const n = new TFilter();
      filters.push(n);
      return n;
    },
  } as unknown as BaseAudioContext;
  return { ctx, filters };
}

describe('I1: plantilla por defecto del editor de plugins', () => {
  it('no usa APIs fuera del proxy (sin currentTime)', () => {
    expect(CUSTOM_PLUGIN_TEMPLATE).not.toContain('currentTime');
    expect(CUSTOM_PLUGIN_TEMPLATE).toContain('custom_filter_');
  });

  it('la plantilla REAL se registra en el sandbox y produce un nodo DSP con parámetros vivos', () => {
    // El registro ejecuta la sonda del sandbox: si updateParameter no emite
    // ops de parámetro para cada declarado, lanza (así fallaba la anterior).
    const def = registerCustomPluginForTest(CUSTOM_PLUGIN_TEMPLATE);
    expect(def.id.startsWith('custom_filter_')).toBe(true);
    expect(def.parameters.map((p) => p.id)).toEqual(['cutoff', 'resonance']);

    const { ctx, filters } = makeTemplateCtx();
    const node = pluginHost.createInstanceNode(ctx, {
      instanceId: 'i1_template',
      pluginId: def.id,
      name: def.name,
      enabled: true,
      parameters: { cutoff: 2500, resonance: 3 },
    });
    expect(node).not.toBeNull();
    expect(filters.length).toBe(1);
    // El template aplica los defaults al crear.
    expect(filters[0]!.frequency.value).toBe(2500);
    expect(filters[0]!.Q.value).toBe(3);
    expect(node!.inputNode).toBe(filters[0] as unknown as AudioNode);
    expect(node!.outputNode).toBe(filters[0] as unknown as AudioNode);
    expect(() => node!.updateParameter('cutoff', 5000)).not.toThrow();
    expect(() => node!.updateParameter('resonance', 6)).not.toThrow();
    node!.cleanup?.();
  });
});
