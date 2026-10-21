import { BUILTIN_PLUGINS } from './builtinPlugins';
import type { PluginDefinition, PluginInstance, PluginParameter } from '../types/daw';
import {
  applyBridgeOpsToNodes,
  evaluateInSandbox,
  getSandboxSession,
  isSandboxAvailable,
  postToSandbox,
  replayBridgeOps,
  scanCustomPluginCode,
  setBridgeOpsHandler,
  validateBridgeImport,
} from './pluginSandbox';
import type { BridgeDescriptor, BridgeOp } from './pluginSandbox';

/** Marca de definición puente (datos validados del iframe, sin fábrica viva). */
export const BRIDGE_MARKER = '__bridge';

export interface BridgePluginDefinition extends PluginDefinition {
  __bridge: { oplog: BridgeOp[]; input: string; output: string };
}

function isBridgePluginDefinition(def: PluginDefinition): def is BridgePluginDefinition {
  const marker = (def as unknown as Record<string, unknown>)[BRIDGE_MARKER];
  return (
    typeof marker === 'object' &&
    marker !== null &&
    Array.isArray((marker as Record<string, unknown>)['oplog'])
  );
}

/**
 * Definición de primera parte u objeto de test (NO código de usuario): la
 * fábrica es un objeto vivo, no una cadena. Nunca usar con funciones
 * derivadas de código de usuario — esa vía es `registerCustomPluginSecure`.
 */
export interface LoosePluginDefinition {
  id: string;
  name: string;
  category: PluginDefinition['category'];
  description: string;
  parameters?: PluginParameter[];
  createDSPNode: (context: BaseAudioContext, params: Record<string, number>) => unknown;
}

const KNOWN_CATEGORIES: PluginDefinition['category'][] = [
  'eq',
  'dynamics',
  'spatial',
  'distortion',
  'utility',
  'custom',
];

export interface ActiveDSPNode {
  instanceId: string;
  pluginId: string;
  inputNode: AudioNode;
  outputNode: AudioNode;
  updateParameter: (paramId: string, value: number) => void;
  // TS-01 (exactOptionalPropertyTypes): `cleanup` ausente ≡ `undefined`.
  cleanup?: (() => void) | undefined;
}

export class PluginHost {
  private customPlugins: Map<string, PluginDefinition> = new Map();
  private bridgeInstances: Map<string, { nodes: Map<string, AudioNode>; session: string | null }> =
    new Map();

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
    // Ronda fix 1: las definiciones puente se materializan por replay del
    // oplog (datos), nunca ejecutando código en el padre.
    if (isBridgePluginDefinition(def)) {
      return this.createBridgeInstanceNode(context, instance, def);
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
   * SEC-01 (ronda fix 1): ÚNICA vía para código de usuario — escáner +
   * evaluación en el iframe opaco con proxy allowlisted. El padre nunca
   * ejecuta el código. Sin DOM (tests) rechaza: los tests usan el helper
   * `registerCustomPluginForTest` (contenedor node:vm).
   */
  async registerCustomPluginSecure(code: string): Promise<PluginDefinition> {
    const hit = scanCustomPluginCode(code);
    if (hit !== null) {
      throw new Error(`Código de plugin bloqueado por seguridad: ${hit}`);
    }
    const result = await evaluateInSandbox(code);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return this.importBridgeDefinition({
      descriptor: result.descriptor,
      oplog: result.oplog,
      input: result.input,
      output: result.output,
    });
  }

  /**
   * Importa datos puente YA VALIDADOS (descriptor + oplog + handles) y los
   * guarda como definición. No ejecuta nada: es la única puerta por la que
   * un resultado del sandbox entra al host. Lanza si los datos no validan.
   */
  importBridgeDefinition(input: {
    descriptor: unknown;
    oplog: unknown;
    input: unknown;
    output: unknown;
  }): PluginDefinition {
    const reason = validateBridgeImport(input);
    if (reason) {
      throw new Error(`Plugin rechazado por el sandbox: ${reason}`);
    }
    const descriptor = input.descriptor as BridgeDescriptor;
    const oplog = input.oplog as BridgeOp[];
    const category: PluginDefinition['category'] = KNOWN_CATEGORIES.includes(
      descriptor.category as PluginDefinition['category']
    )
      ? (descriptor.category as PluginDefinition['category'])
      : 'custom';
    const parameters: PluginParameter[] = descriptor.parameters.map((p) => ({
      id: p.id,
      name: p.name,
      min: p.min,
      max: p.max,
      step: p.step,
      defaultValue: p.defaultValue,
      ...(typeof p.unit === 'string' ? { unit: p.unit } : {}),
    }));
    const def: BridgePluginDefinition = {
      id: descriptor.id,
      name: descriptor.name,
      category,
      description: descriptor.description,
      parameters,
      createDSPNode: () => {
        throw new Error('Definición puente: instanciar vía PluginHost.createInstanceNode.');
      },
      __bridge: { oplog, input: input.input as string, output: input.output as string },
    };
    this.customPlugins.set(def.id, def);
    return def;
  }

  /**
   * Registra una definición de primera parte (builtins/tests): objeto vivo,
   * no código. Valida la forma; la robustez ante fábricas rotas la da
   * `createInstanceNode` (degradación a pass-through). NUNCA usar con
   * funciones derivadas de código de usuario.
   */
  registerPluginDefinition(def: LoosePluginDefinition): PluginDefinition {
    if (!def || typeof def.id !== 'string' || def.id.length === 0) {
      throw new Error('Definición de plugin inválida: id vacío.');
    }
    if (typeof def.createDSPNode !== 'function') {
      throw new Error('Definición de plugin inválida: sin createDSPNode.');
    }
    const parameters = Array.isArray(def.parameters) ? def.parameters : [];
    // La fábrica se valida en cada instanciación (puede devolver basura a
    // propósito: los tests de robustez lo exigen). Cast contenido: el chequeo
    // real es el runtime de createInstanceNode, no el tipo estático.
    const stored = {
      id: def.id,
      name: def.name,
      category: def.category,
      description: def.description,
      parameters,
      createDSPNode: def.createDSPNode as PluginDefinition['createDSPNode'],
    };
    this.customPlugins.set(stored.id, stored);
    return stored;
  }

  /**
   * Materializa una definición puente: replay síncrono del oplog sobre el
   * contexto real + instancia viva en el iframe (async, fire-and-forget).
   * Los valores convergen por el cierre `updateParameter` del iframe.
   */
  private createBridgeInstanceNode(
    context: BaseAudioContext,
    instance: PluginInstance,
    def: BridgePluginDefinition
  ): ActiveDSPNode | null {
    const rawParams = instance.parameters ?? {};
    const sanitized: Record<string, number> = {};
    for (const [key, val] of Object.entries(rawParams)) {
      sanitized[key] = this.clampToDef(def.id, key, val);
    }
    let replayed;
    try {
      replayed = replayBridgeOps(context, def.__bridge.oplog, def.__bridge.input, def.__bridge.output);
    } catch (err) {
      console.warn(
        `[PluginHost] El plugin ${def.id} no pudo reproducirse; se usa pass-through: ${String(err)}`
      );
      return this.makePassThrough(context, instance);
    }
    const instanceId = instance.instanceId;
    let session: string | null = null;
    try {
      session = getSandboxSession();
    } catch {
      session = null;
    }
    this.bridgeInstances.set(instanceId, { nodes: replayed.nodes, session });
    // Instancia viva en el iframe (crea sus cierres y devuelve los valores
    // por el canal). Sin sandbox (tests node) el template ya suena.
    this.forwardToSandbox({
      type: 'hydradaw-instantiate',
      pluginId: def.id,
      instanceId,
      params: sanitized,
    });
    const host = this;
    const oscillators = replayed.oscillators;
    return {
      instanceId,
      pluginId: instance.pluginId,
      inputNode: replayed.inputNode,
      outputNode: replayed.outputNode,
      updateParameter: (paramId: string, value: number) => {
        const clamped = host.clampToDef(def.id, paramId, value);
        host.forwardToSandbox({ type: 'hydradaw-update', instanceId, paramId, value: clamped });
      },
      cleanup: () => {
        host.forwardToSandbox({ type: 'hydradaw-dispose', instanceId });
        const entry = host.bridgeInstances.get(instanceId);
        host.bridgeInstances.delete(instanceId);
        const nodes = entry ? entry.nodes : replayed.nodes;
        for (const node of nodes.values()) {
          try {
            (node as unknown as { disconnect: () => void }).disconnect();
          } catch (_) {}
        }
        for (const osc of oscillators) {
          try {
            (osc as unknown as { stop?: () => void }).stop?.();
          } catch (_) {}
        }
      },
    };
  }

  /** Aplica ops de runtime que llegan del iframe a una instancia viva. */
  applyBridgeOps(instanceId: string, ops: BridgeOp[], error?: string): void {
    if (error) {
      console.warn(`[sandbox] el iframe avisa para '${instanceId}': ${error}`);
    }
    const entry = this.bridgeInstances.get(instanceId);
    if (!entry) {
      console.warn(`[sandbox] ops para instancia desconocida '${instanceId}' (descartadas)`);
      return;
    }
    if (entry.session !== getSandboxSession()) {
      console.warn(`[sandbox] sesión rotada para '${instanceId}' (descartadas)`);
      this.bridgeInstances.delete(instanceId);
      return;
    }
    applyBridgeOpsToNodes(entry.nodes, ops);
  }

  private forwardToSandbox(message: Record<string, unknown>): void {
    // Sin DOM (tests node) no hay a quién reenviar: el template ya suena.
    if (!isSandboxAvailable()) return;
    try {
      postToSandbox(message);
    } catch (err) {
      console.warn(`[sandbox] no se pudo reenviar: ${String(err)}`);
    }
  }
}

export const pluginHost = new PluginHost();

// El backend del sandbox reenvía las ops de runtime al host (inyectado aquí
// para no crear un ciclo de imports: pluginSandbox no conoce a PluginHost).
setBridgeOpsHandler((instanceId, ops, error) => {
  pluginHost.applyBridgeOps(instanceId, ops, error);
});

// Fix(waveA): helper centralizado `clampToDef(pluginId, paramId, value)` sobre
// `BUILTIN_PLUGINS[...].parameters[].min/max` (delega en el host para cubrir customs).
export function clampToDef(pluginId: string, paramId: string, value: number): number {
  return pluginHost.clampToDef(pluginId, paramId, value);
}
