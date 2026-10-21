import { BUILTIN_PLUGINS } from './builtinPlugins';
import type { PluginDefinition, PluginInstance } from '../types/daw';
import { evaluateCustomPlugin, evaluateCustomPluginSandboxed } from './pluginSandbox';

export interface ActiveDSPNode {
  instanceId: string;
  pluginId: string;
  inputNode: AudioNode;
  outputNode: AudioNode;
  updateParameter: (paramId: string, value: number) => void;
  cleanup?: () => void;
}

export class PluginHost {
  private customPlugins: Map<string, PluginDefinition> = new Map();

  /**
   * Retrieves definition for any plugin (builtin or user imported)
   */
  getPluginDefinition(pluginId: string): PluginDefinition | undefined {
    return BUILTIN_PLUGINS[pluginId] || this.customPlugins.get(pluginId);
  }

  /**
   * Returns list of all available plugins
   */
  getAllPluginDefinitions(): PluginDefinition[] {
    const builtins = Object.values(BUILTIN_PLUGINS);
    const customs = Array.from(this.customPlugins.values());
    return [...builtins, ...customs];
  }

  // Fix(waveA): clamp centralizado contra la definición (min/max/defaultValue).
  clampToDef(pluginId: string, paramId: string, value: number): number {
    const def = this.getPluginDefinition(pluginId);
    const param = def?.parameters.find((p) => p.id === paramId);
    if (!param) return value;
    if (!Number.isFinite(value)) return param.defaultValue;
    return Math.min(param.max, Math.max(param.min, value));
  }

  /**
   * Instantiates the DSP nodes for a plugin instance
   */
  createInstanceNode(context: BaseAudioContext, instance: PluginInstance): ActiveDSPNode | null {
    const def = this.getPluginDefinition(instance.pluginId);
    if (!def) {
      console.warn(`[PluginHost] Plugin definition not found for: ${instance.pluginId}`);
      // Fallback pass-through gain node
      return this.makePassThrough(context, instance);
    }

    try {
      // Fix(waveA): sanitizar parámetros en creación (frecuencias <= 0, ratio < 1, etc.).
      const rawParams = instance.parameters ?? {};
      const sanitized: Record<string, number> = {};
      for (const [key, val] of Object.entries(rawParams)) {
        sanitized[key] = this.clampToDef(instance.pluginId, key, val);
      }
      const dsp = def.createDSPNode(context, sanitized) as unknown as {
        inputNode?: unknown;
        outputNode?: unknown;
        updateParameter?: (paramId: string, value: number) => void;
        cleanup?: () => void;
      } | null | undefined;
      // Fix(AUD-10): validar la forma del nodo devuelto, no solo la definición.
      // Un plugin que devuelve {} (o basura) degradaba a un nodo con
      // inputNode undefined y tumbaba syncTracks/play() con TypeError.
      const inputNode = dsp?.inputNode as AudioNode | undefined;
      const outputNode = dsp?.outputNode as AudioNode | undefined;
      if (
        !dsp ||
        typeof (inputNode as unknown as { connect?: unknown } | undefined)?.connect !== 'function' ||
        // Fix(M1): outputNode también debe ser cableable, no solo truthy —
        // un nodo a medio formar se caza aquí y no en el cableado.
        typeof (outputNode as unknown as { connect?: unknown } | undefined)?.connect !== 'function'
      ) {
        console.warn(`[PluginHost] El plugin ${instance.pluginId} devolvió un nodo inválido; se usa pass-through.`);
        return this.makePassThrough(context, instance);
      }
      const rawUpdate = typeof dsp.updateParameter === 'function' ? dsp.updateParameter : () => {};
      // Fix(waveA): aplicar clampToDef en TODOS los updateParameter.
      const host = this;
      return {
        instanceId: instance.instanceId,
        pluginId: instance.pluginId,
        inputNode: inputNode as AudioNode,
        outputNode: outputNode as AudioNode,
        updateParameter: (paramId: string, value: number) => {
          rawUpdate(paramId, host.clampToDef(instance.pluginId, paramId, value));
        },
        cleanup: typeof dsp.cleanup === 'function' ? dsp.cleanup : undefined,
      };
    } catch (err) {
      console.error(`[PluginHost] Error creating DSP node for ${instance.pluginId}:`, err);
      return this.makePassThrough(context, instance);
    }
  }

  /**
   * Builds an owned unity-gain pass-through for degraded plugins.
   * Fix(M2): ganancia 1 explícita (un mock con default 0 atenuaría en silencio).
   */
  private makePassThrough(context: BaseAudioContext, instance: PluginInstance): ActiveDSPNode {
    const passNode = context.createGain();
    passNode.gain.value = 1;
    return {
      instanceId: instance.instanceId,
      pluginId: instance.pluginId,
      inputNode: passNode,
      outputNode: passNode,
      updateParameter: () => {},
    };
  }

  /**
   * Registers a local custom audio plugin imported from a JS/JSON file.
   *
   * SEC-01: vía síncrona (tests/compat) — escáner denegar-por-defecto +
   * evaluación endurecida (ver `pluginSandbox.ts`). El punto de entrada de
   * la UI es `registerCustomPluginSecure`, que pre-ejecuta el código en un
   * iframe con origen opaco antes de materializar.
   */
  registerCustomPlugin(code: string): PluginDefinition {
    const result = evaluateCustomPlugin(code);
    if (!result.ok) {
      throw new Error(result.error);
    }
    this.customPlugins.set(result.definition.id, result.definition);
    return result.definition;
  }

  /**
   * Vía segura para la UI: pre-ejecución aislada en iframe opaco y, solo si
   * el descriptor es válido, materialización endurecida. Si el sandbox no
   * está disponible, rechaza SIN ejecutar el código.
   */
  async registerCustomPluginSecure(code: string): Promise<PluginDefinition> {
    const pre = await evaluateCustomPluginSandboxed(code);
    if (!pre.ok) {
      throw new Error(pre.error);
    }
    return this.registerCustomPlugin(code);
  }
}

export const pluginHost = new PluginHost();

// Fix(waveA): helper centralizado `clampToDef(pluginId, paramId, value)` sobre
// `BUILTIN_PLUGINS[...].parameters[].min/max` (delega en el host para cubrir customs).
export function clampToDef(pluginId: string, paramId: string, value: number): number {
  return pluginHost.clampToDef(pluginId, paramId, value);
}
