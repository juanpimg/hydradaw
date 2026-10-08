import { BUILTIN_PLUGINS } from './builtinPlugins';
import type { PluginDefinition, PluginInstance } from '../types/daw';

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
      const passNode = context.createGain();
      return {
        instanceId: instance.instanceId,
        pluginId: instance.pluginId,
        inputNode: passNode,
        outputNode: passNode,
        updateParameter: () => {},
      };
    }

    try {
      // Fix(waveA): sanitizar parámetros en creación (frecuencias <= 0, ratio < 1, etc.).
      const rawParams = instance.parameters ?? {};
      const sanitized: Record<string, number> = {};
      for (const [key, val] of Object.entries(rawParams)) {
        sanitized[key] = this.clampToDef(instance.pluginId, key, val);
      }
      const dsp = def.createDSPNode(context, sanitized);
      const rawUpdate = dsp.updateParameter;
      // Fix(waveA): aplicar clampToDef en TODOS los updateParameter.
      const host = this;
      return {
        instanceId: instance.instanceId,
        pluginId: instance.pluginId,
        inputNode: dsp.inputNode,
        outputNode: dsp.outputNode,
        updateParameter: (paramId: string, value: number) => {
          rawUpdate(paramId, host.clampToDef(instance.pluginId, paramId, value));
        },
        cleanup: dsp.cleanup,
      };
    } catch (err) {
      console.error(`[PluginHost] Error creating DSP node for ${instance.pluginId}:`, err);
      const passNode = context.createGain();
      return {
        instanceId: instance.instanceId,
        pluginId: instance.pluginId,
        inputNode: passNode,
        outputNode: passNode,
        updateParameter: () => {},
      };
    }
  }

  /**
   * Registers a local custom audio plugin imported from a JS/JSON file
   */
  registerCustomPlugin(code: string): PluginDefinition {
    // Custom plugin evaluation in a controlled wrapper
    const fn = new Function('PluginHost', `
      ${code}
      return typeof customPlugin !== 'undefined' ? customPlugin : null;
    `);

    const pluginDef = fn(this) as PluginDefinition | null;
    if (!pluginDef || !pluginDef.id || !pluginDef.createDSPNode) {
      throw new Error('El plugin local no exporta una definición válida de PluginDefinition con createDSPNode.');
    }

    this.customPlugins.set(pluginDef.id, pluginDef);
    return pluginDef;
  }
}

export const pluginHost = new PluginHost();

// Fix(waveA): helper centralizado `clampToDef(pluginId, paramId, value)` sobre
// `BUILTIN_PLUGINS[...].parameters[].min/max` (delega en el host para cubrir customs).
export function clampToDef(pluginId: string, paramId: string, value: number): number {
  return pluginHost.clampToDef(pluginId, paramId, value);
}
