import type { PluginDefinition } from '../types/daw';

/**
 * SEC-01 / AUD-08 — sandbox real para plugins de usuario (ronda fix 1).
 *
 * Arquitectura: el código del plugin se evalúa **solo dentro de un
 * `<iframe sandbox="allow-scripts">` sin `allow-same-origin`** (origen opaco)
 * y **nunca** en el hilo principal. Como el plugin necesita el
 * `AudioContext` del padre (no transferible al iframe), el iframe recibe un
 * **contexto proxy** cuyas únicas operaciones son un conjunto allowlisted de
 * factorías de nodos; cada llamada viaja al padre por `postMessage`, el padre
 * crea los nodos reales y devuelve **handles opacos**. `connect`, `setParam`
 * y `dispose` viajan por el mismo canal. El iframe nunca toca un `AudioNode`
 * y el padre nunca ejecuta código de usuario: por eso el CSP puede omitir
 * `'unsafe-eval'` (ver `public/_headers`).
 *
 * Capas:
 * 1. `scanCustomPluginCode` (denegar-por-defecto, siempre, también en tests).
 * 2. Evaluación en el iframe + sondas de `updateParameter` en el registro.
 * 3. Re-validación de cada mensaje y cada op en el padre (nunca se confía en
 *    el frame, ni siquiera en el propio).
 *
 * Sin sandbox (sin DOM, iframe bloqueado, timeout) ⇒ **rechazo explícito**,
 * nunca ejecución sin protección.
 */

export type CustomPluginDefinition = PluginDefinition;

// ---------------------------------------------------------------------------
// 1. Escáner denegar-por-defecto
// ---------------------------------------------------------------------------

/**
 * Lista de prohibición (spec §3.7 + anterior): cualquier coincidencia
 * rechaza el plugin.
 *
 * Ronda fix 1: `eval` y `Function` se rechazan como PALABRAS (`/\beval\b/`),
 * no solo como llamadas. `const e = eval;` pasaba el escáner antiguo y, como
 * `eval` no puede sombrearse como parámetro en modo estricto (SyntaxError),
 * el alias seguía siendo el `eval` real: un `e(payload)` indirecto ejecuta en
 * ámbito global y salta todos los sombreados. `this` (solo minúsculas, la
 * palabra reservada) se rechaza porque `this['constr'+'uctor']` elude el
 * rechazo por subcadena de `constructor`.
 */
export const FORBIDDEN_PATTERNS: RegExp[] = [
  /\b(globalThis|self|top|parent|frames|opener)\b/i,
  /\b(location|navigator|history)\b/i,
  /\b(Worker|SharedWorker|WebAssembly|importScripts)\b/i,
  /\b(postMessage|indexedDB|caches|cookieStore)\b/i,
  /\b(document|window|localStorage|sessionStorage)\b/i,
  /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/i,
  /\beval\b/i,
  /\bFunction\b/i,
  /\bthis\b/,
  /\bimport\s*\(/i,
  /\bimport\.meta\b/i,
  /\bprototype\b/i,
];

export const SANDBOX_UNAVAILABLE_MESSAGE =
  'No se pudo crear el entorno aislado (sandbox) para plugins en este navegador: ' +
  'la importación se rechaza por seguridad y no se ha ejecutado ningún código.';

/**
 * Escáner denegar-por-defecto. Devuelve el motivo del rechazo o null si el
 * código pasa. Cubre todo el fuente, incluido el cuerpo de `createDSPNode`.
 */
export function scanCustomPluginCode(code: string): string | null {
  const lowered = code.toLowerCase();
  if (lowered.includes('constructor') || lowered.includes('__proto__')) {
    return 'uso de constructor/__proto__ (evasión por cadena de prototipos)';
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      return `acceso restringido a APIs del navegador (${pattern})`;
    }
  }
  return null;
}

/** ¿Hay DOM suficiente para montar el iframe aislado? (En tests/node: no.) */
export function isSandboxAvailable(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const probe = document.createElement('iframe');
    return 'srcdoc' in probe;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Puente de capacidades: tipos y tabla allowlisted (única fuente de verdad)
// ---------------------------------------------------------------------------

export type BridgeParamMethod =
  | 'setValue'
  | 'setValueAtTime'
  | 'setTargetAtTime'
  | 'linearRampToValueAtTime'
  | 'exponentialRampToValueAtTime';

export type BridgeOp =
  | { op: 'create'; node: string; handle: string; args: number[] }
  | { op: 'set'; handle: string; prop: string; value: string | number }
  | { op: 'param'; handle: string; param: string; method: BridgeParamMethod; args: number[] }
  | { op: 'connect'; from: string; to: string; out?: number; inn?: number }
  | { op: 'disconnect'; from: string; to?: string };

export interface BridgePluginParameter {
  id: string;
  name: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
}

export interface BridgeDescriptor {
  id: string;
  name: string;
  category: string;
  description: string;
  parameters: BridgePluginParameter[];
}

export type BridgeEvaluation =
  | { ok: true; descriptor: BridgeDescriptor; oplog: BridgeOp[]; input: string; output: string }
  | { ok: false; error: string };

interface BridgeNodeSpec {
  /** Método de BaseAudioContext. */
  method: string;
  /** AudioParams expuestos. */
  params: string[];
  /** Props asignables: lista cerrada de valores o 'finite'. */
  props: Record<string, string[] | 'finite'>;
  /** Nº máximo de argumentos de la factoría (solo createDelay acepta 1). */
  factoryArgs: 0 | 1;
}

/**
 * Superficie exacta del proxy (ver ayuda del editor en PluginRackModal y el
 * informe): 8 factorías, props enumeradas, 5 operaciones de parámetro,
 * connect/disconnect. Todo lo demás se rechaza. Exportada para la prueba de
 * sincronía con public/sandbox.js (derivado de esta tabla).
 */
export const BRIDGE_NODE_SPECS: Record<string, BridgeNodeSpec> = {
  gain: { method: 'createGain', params: ['gain'], props: {}, factoryArgs: 0 },
  filter: {
    method: 'createBiquadFilter',
    params: ['frequency', 'Q', 'gain'],
    props: {
      type: ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'],
    },
    factoryArgs: 0,
  },
  shaper: {
    method: 'createWaveShaper',
    params: [],
    props: { oversample: ['none', '2x', '4x'] },
    factoryArgs: 0,
  },
  delay: { method: 'createDelay', params: ['delayTime'], props: {}, factoryArgs: 1 },
  convolver: { method: 'createConvolver', params: [], props: {}, factoryArgs: 0 },
  comp: {
    method: 'createDynamicsCompressor',
    params: ['threshold', 'knee', 'ratio', 'attack', 'release'],
    props: {},
    factoryArgs: 0,
  },
  panner: { method: 'createStereoPanner', params: ['pan'], props: {}, factoryArgs: 0 },
  osc: {
    method: 'createOscillator',
    params: ['frequency', 'detune'],
    props: { type: ['sine', 'square', 'sawtooth', 'triangle'] },
    factoryArgs: 0,
  },
};

/** Defaults para lectura (el replay usa los defaults reales de los AudioParam). */
export const BRIDGE_PARAM_DEFAULTS: Record<string, Record<string, number>> = {
  gain: { gain: 1 },
  filter: { frequency: 350, Q: 1, gain: 0 },
  delay: { delayTime: 0 },
  comp: { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 },
  panner: { pan: 0 },
  osc: { frequency: 440, detune: 0 },
};

const BRIDGE_PARAM_METHODS: BridgeParamMethod[] = [
  'setValue',
  'setValueAtTime',
  'setTargetAtTime',
  'linearRampToValueAtTime',
  'exponentialRampToValueAtTime',
];

/** Topes anti-bomba de mensajes (documentados en el informe). */
export const BRIDGE_OP_CAP_TEMPLATE = 512;
const HANDLE_RE = /^h\d{1,6}$/;
const MAX_ID_LEN = 64;

// ---------------------------------------------------------------------------
// 3. Validación en el padre (puerta semántica única)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isValidHandle(value: unknown): value is string {
  return isShortString(value, 8) && HANDLE_RE.test(value);
}

/** Valida la FORMA de una op (la semántica de referencias la valida el import). */
export function validateBridgeOp(op: unknown): string | null {
  if (!isRecord(op)) return 'op no es un objeto';
  switch (op['op']) {
    case 'create': {
      const spec = BRIDGE_NODE_SPECS[String(op['node'])];
      if (!spec) return 'nodo fuera de la lista permitida';
      if (!isValidHandle(op['handle'])) return 'handle inválido';
      if (!Array.isArray(op['args']) || op['args'].length > spec.factoryArgs) {
        return 'argumentos de factoría inválidos';
      }
      for (const arg of op['args']) {
        if (!isFiniteNumber(arg)) return 'argumento de factoría no finito';
      }
      return null;
    }
    case 'set': {
      if (!isValidHandle(op['handle'])) return 'handle inválido';
      if (!isShortString(op['prop'], 32)) return 'propiedad inválida';
      if (!isShortString(op['value'], 64) && !isFiniteNumber(op['value'])) {
        return 'valor de propiedad inválido';
      }
      return null;
    }
    case 'param': {
      if (!isValidHandle(op['handle'])) return 'handle inválido';
      if (!isShortString(op['param'], 32)) return 'parámetro inválido';
      if (
        typeof op['method'] !== 'string' ||
        (BRIDGE_PARAM_METHODS as string[]).indexOf(op['method']) < 0
      ) {
        return 'método de parámetro inválido';
      }
      if (!Array.isArray(op['args']) || op['args'].length < 1 || op['args'].length > 3) {
        return 'argumentos de parámetro inválidos';
      }
      for (const arg of op['args']) {
        if (!isFiniteNumber(arg)) return 'argumento de parámetro no finito';
      }
      return null;
    }
    case 'connect': {
      if (!isValidHandle(op['from']) || !isValidHandle(op['to'])) return 'handle inválido';
      for (const key of ['out', 'inn'] as const) {
        const v = op[key];
        if (v !== undefined && (!Number.isInteger(v) || (v as number) < 0)) {
          return 'índice de connect inválido';
        }
      }
      return null;
    }
    case 'disconnect': {
      if (!isValidHandle(op['from'])) return 'handle inválido';
      if (op['to'] !== undefined && !isValidHandle(op['to'])) return 'handle inválido';
      return null;
    }
    default:
      return 'operación desconocida';
  }
}

function validateBridgeParameters(raw: unknown): string | null {
  if (!Array.isArray(raw)) return 'parameters debe ser un array';
  if (raw.length > 64) return 'demasiados parámetros';
  for (const item of raw) {
    if (!isRecord(item)) return 'parámetro inválido';
    if (!isShortString(item['id'], MAX_ID_LEN) || item['id'].length === 0) {
      return 'parámetro sin id';
    }
    if (!isShortString(item['name'], 128) || item['name'].length === 0) {
      return 'parámetro sin nombre';
    }
    const min = item['min'];
    const max = item['max'];
    const step = item['step'];
    const defaultValue = item['defaultValue'];
    if (!isFiniteNumber(min) || !isFiniteNumber(max) || !isFiniteNumber(step) || !isFiniteNumber(defaultValue)) {
      return `rango no finito en '${item['id']}'`;
    }
    if (!(min <= max) || !(step > 0)) return `rango incoherente en '${item['id']}'`;
    if (!(defaultValue >= min && defaultValue <= max)) {
      return `default fuera de rango en '${item['id']}'`;
    }
    if (item['unit'] !== undefined && !isShortString(item['unit'], 32)) {
      return `unit inválida en '${item['id']}'`;
    }
  }
  return null;
}

/**
 * Puerta semántica única: valida descriptor + oplog + resolución de
 * input/output. La usan `evaluateInSandbox` (vía transporte) e
 * `importBridgeDefinition` (vía helper de test). Devuelve el motivo o null.
 */
export function validateBridgeImport(input: {
  descriptor: unknown;
  oplog: unknown;
  input: unknown;
  output: unknown;
}): string | null {
  const descriptor = input.descriptor;
  if (!isRecord(descriptor)) return 'descriptor inválido';
  if (!isShortString(descriptor['id'], MAX_ID_LEN) || descriptor['id'].length === 0) {
    return 'id de plugin inválido';
  }
  for (const key of ['name', 'category', 'description'] as const) {
    if (!isShortString(descriptor[key], key === 'name' ? 128 : 512)) {
      return `campo '${key}' inválido`;
    }
  }
  const paramsError = validateBridgeParameters(descriptor['parameters']);
  if (paramsError) return paramsError;
  const oplog = input.oplog;
  if (!Array.isArray(oplog)) return 'oplog inválido';
  if (oplog.length > BRIDGE_OP_CAP_TEMPLATE) return 'demasiadas operaciones en el template';
  const created = new Set<string>();
  for (const op of oplog) {
    const reason = validateBridgeOp(op);
    if (reason) return reason;
    const rec = op as Record<string, unknown>;
    if (rec['op'] === 'create') {
      const handle = rec['handle'] as string;
      if (created.has(handle)) return 'handle duplicado';
      created.add(handle);
    } else {
      for (const key of ['handle', 'from', 'to'] as const) {
        const value = rec[key];
        if (typeof value === 'string' && !created.has(value)) {
          return 'handle sin crear';
        }
      }
    }
  }
  // La pertenencia al spec de params/props se valida aquí (forma + semántica).
  for (const op of oplog) {
    const rec = op as {
      op: string;
      node?: string;
      handle?: string;
      from?: string;
      prop?: string;
      param?: string;
    };
    if (rec.op === 'create') {
      const spec = BRIDGE_NODE_SPECS[rec.node as string];
      if (!spec) return 'nodo fuera de la lista permitida';
    } else if (rec.op === 'set' || rec.op === 'param') {
      const owner = (rec.op === 'set' ? rec.handle : rec.handle) as string;
      const creator = (oplog as Array<{ op: string; node?: string; handle?: string }>).find(
        (o) => o.op === 'create' && o.handle === owner
      );
      const spec = creator ? BRIDGE_NODE_SPECS[creator.node as string] : undefined;
      if (!spec) return 'handle sin crear';
      if (rec.op === 'set') {
        const rule = spec.props[rec.prop as string];
        if (rule === undefined) return `propiedad '${rec.prop as string}' fuera de la lista permitida`;
      } else if (spec.params.indexOf(rec.param as string) < 0) {
        return `parámetro '${rec.param as string}' fuera de la lista permitida`;
      }
    } else if (rec.op === 'connect' || rec.op === 'disconnect') {
      const refs = rec.op === 'connect' ? [rec.from as string, (rec as { to?: string }).to as string] : [rec.from as string];
      for (const ref of refs) {
        if (!created.has(ref)) return 'handle sin crear';
      }
      if (rec.op === 'disconnect') {
        const to = (rec as { to?: unknown }).to;
        if (to !== undefined && typeof to === 'string' && !created.has(to)) {
          return 'handle sin crear';
        }
      }
    }
  }
  if (!isValidHandle(input.input) || !created.has(input.input as string)) {
    return 'inputNode no resuelve a un nodo del proxy';
  }
  if (!isValidHandle(input.output) || !created.has(input.output as string)) {
    return 'outputNode no resuelve a un nodo del proxy';
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Replay en el padre (interpreta datos, nunca ejecuta código de usuario)
// ---------------------------------------------------------------------------

function lookupMember(node: object, prop: string): unknown {
  return (node as unknown as Record<string, unknown>)[prop];
}

function applyNonCreateOp(
  nodes: Map<string, AudioNode>,
  op: Exclude<BridgeOp, { op: 'create' }>
): void {
  switch (op.op) {
    case 'set': {
      const node = nodes.get(op.handle);
      if (!node) throw new Error(`handle desconocido '${op.handle}'`);
      try {
        (node as unknown as Record<string, unknown>)[op.prop] = op.value;
      } catch (err) {
        throw new Error(`no se pudo fijar '${op.prop}': ${String(err)}`);
      }
      return;
    }
    case 'param': {
      const node = nodes.get(op.handle);
      if (!node) throw new Error(`handle desconocido '${op.handle}'`);
      const target = lookupMember(node, op.param);
      if (!isRecord(target)) throw new Error(`parámetro desconocido '${op.param}'`);
      if (op.method === 'setValue') {
        const [v] = op.args;
        (target as unknown as { value: number }).value = v as number;
        return;
      }
      const fn = target[op.method];
      if (typeof fn !== 'function') throw new Error(`método desconocido '${op.method}'`);
      (fn as (...args: number[]) => void).apply(target, op.args);
      return;
    }
    case 'connect': {
      const from = nodes.get(op.from);
      const to = nodes.get(op.to);
      if (!from || !to) throw new Error('handle desconocido en connect');
      const connect = lookupMember(from, 'connect');
      if (typeof connect !== 'function') throw new Error('nodo no conectable');
      if (op.out !== undefined) {
        (connect as (d: unknown, out: number, inn?: number) => void).call(from, to, op.out, op.inn);
      } else {
        (connect as (d: unknown) => void).call(from, to);
      }
      return;
    }
    case 'disconnect': {
      const from = nodes.get(op.from);
      if (!from) throw new Error('handle desconocido en disconnect');
      const disconnect = lookupMember(from, 'disconnect');
      if (typeof disconnect !== 'function') throw new Error('nodo no desconectable');
      if (op.to !== undefined) {
        const to = nodes.get(op.to);
        if (!to) throw new Error('handle desconocido en disconnect');
        (disconnect as (d: unknown) => void).call(from, to);
      } else {
        (disconnect as () => void).call(from);
      }
      return;
    }
  }
}

export interface ReplayedBridgeGraph {
  nodes: Map<string, AudioNode>;
  inputNode: AudioNode;
  outputNode: AudioNode;
  oscillators: AudioNode[];
}

/**
 * Reproduce el oplog validado sobre un AudioContext real y devuelve los
 * nodos. Lanza si algo falla (el llamador degrada a pass-through).
 * Los osciladores se arrancan solos (el proxy no expone start/stop).
 */
export function replayBridgeOps(
  context: BaseAudioContext,
  oplog: BridgeOp[],
  input: string,
  output: string
): ReplayedBridgeGraph {
  const factories = context as unknown as Record<string, ((...args: number[]) => object) | undefined>;
  const nodes = new Map<string, AudioNode>();
  const oscillators: AudioNode[] = [];
  for (const op of oplog) {
    if (op.op !== 'create') {
      applyNonCreateOp(nodes, op);
      continue;
    }
    const spec = BRIDGE_NODE_SPECS[op.node];
    if (!spec) throw new Error(`nodo fuera de la lista permitida '${op.node}'`);
    if (nodes.has(op.handle)) throw new Error(`handle duplicado '${op.handle}'`);
    const factory = factories[spec.method];
    if (typeof factory !== 'function') {
      throw new Error(`el contexto no ofrece '${spec.method}'`);
    }
    let created: object;
    try {
      created = factory.apply(context, op.args);
    } catch (err) {
      throw new Error(`no se pudo crear '${op.node}': ${String(err)}`);
    }
    if (!isRecord(created) || typeof created['connect'] !== 'function') {
      throw new Error(`'${op.node}' no devolvió un nodo válido`);
    }
    const node = created as unknown as AudioNode;
    nodes.set(op.handle, node);
    if (op.node === 'osc') oscillators.push(node);
  }
  const inputNode = nodes.get(input);
  const outputNode = nodes.get(output);
  if (!inputNode || !outputNode) throw new Error('input/output sin resolver');
  if (typeof lookupMember(inputNode, 'connect') !== 'function') {
    throw new Error('inputNode no conectable');
  }
  if (typeof lookupMember(outputNode, 'connect') !== 'function') {
    throw new Error('outputNode no conectable');
  }
  for (const osc of oscillators) {
    try {
      const start = lookupMember(osc, 'start');
      if (typeof start === 'function') {
        (start as () => void).call(osc);
      }
    } catch (err) {
      console.warn(`[sandbox] oscilador sin arranque: ${String(err)}`);
    }
  }
  return { nodes, inputNode, outputNode, oscillators };
}

/** Aplica ops de runtime (sin 'create': el mapa de nodos queda fijado). */
export function applyBridgeOpsToNodes(nodes: Map<string, AudioNode>, ops: BridgeOp[]): void {
  for (const op of ops) {
    if (op.op === 'create') {
      console.warn('[sandbox] op create en runtime descartada (mapa fijado)');
      continue;
    }
    try {
      applyNonCreateOp(nodes, op);
    } catch (err) {
      console.warn(`[sandbox] op descartada: ${String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 5. Harness del iframe: vive en public/sandbox.js (documento estático con
// CSP propia, cargado por `src`). La única fuente de verdad de la tabla
// allowlisted y los validadores de ESTE fichero (secciones 2-4) la genera;
// public/sandbox.js se derivó de ellos y los tests `vm` corren esos bytes
// exactos (ver src/tests/pluginBridge.test.ts).
// ---------------------------------------------------------------------------

const MSG_EVALUATE = 'hydradaw-evaluate';
const MSG_RESULT = 'hydradaw-result';
const MSG_INSTANTIATE = 'hydradaw-instantiate';
const MSG_UPDATE = 'hydradaw-update';
const MSG_DISPOSE = 'hydradaw-dispose';
const MSG_OPS = 'hydradaw-ops';

export const BRIDGE_MESSAGE_TYPES = {
  evaluate: MSG_EVALUATE,
  result: MSG_RESULT,
  instantiate: MSG_INSTANTIATE,
  update: MSG_UPDATE,
  dispose: MSG_DISPOSE,
  ops: MSG_OPS,
} as const;

// 6. Backend del padre (transporte iframe + validación de cada mensaje)
// ---------------------------------------------------------------------------

export interface SandboxBackend {
  iframe: HTMLIFrameElement;
  session: string;
  ready: Promise<void>;
}

let backend: SandboxBackend | null = null;
let listenerInstalled = false;
const pendingResults = new Map<string, (result: BridgeEvaluation) => void>();
let bridgeOpsHandler: ((instanceId: string, ops: BridgeOp[], error?: string) => void) | null =
  null;

/** El host registra aquí la aplicación de ops de runtime a nodos reales. */
export function setBridgeOpsHandler(
  fn: (instanceId: string, ops: BridgeOp[], error?: string) => void
): void {
  bridgeOpsHandler = fn;
}

export function getSandboxSession(): string | null {
  return backend ? backend.session : null;
}

function isBridgeEvaluationShape(value: unknown): value is BridgeEvaluation {
  if (!isRecord(value)) return false;
  if (value['ok'] === true) {
    return (
      isRecord(value['descriptor']) &&
      Array.isArray(value['oplog']) &&
      typeof value['input'] === 'string' &&
      typeof value['output'] === 'string'
    );
  }
  return value['ok'] === false && typeof value['error'] === 'string';
}

function onSandboxMessage(event: MessageEvent): void {
  if (!backend) return;
  // Origen opaco del iframe ⇒ event.origin es 'null'. Se exige exacto (no '*'
  // conceptual): cualquier otro origen se descarta antes de mirar el contenido.
  if (event.source !== backend.iframe.contentWindow) return;
  if (event.origin !== 'null') return;
  const data = event.data as Record<string, unknown> | null;
  if (!isRecord(data)) return;
  if (data['session'] !== backend.session) return;
  if (data['type'] === MSG_RESULT) {
    if (!isShortString(data['reqId'], MAX_ID_LEN)) return;
    const pending = pendingResults.get(data['reqId']);
    if (!pending) return;
    pendingResults.delete(data['reqId']);
    if (!isBridgeEvaluationShape(data)) {
      pending({ ok: false, error: 'Respuesta del sandbox con forma inválida.' });
      return;
    }
    if (data.ok) {
      const reason = validateBridgeImport({
        descriptor: data.descriptor,
        oplog: data.oplog,
        input: data.input,
        output: data.output,
      });
      if (reason) {
        pending({ ok: false, error: `Respuesta del sandbox inválida: ${reason}` });
        return;
      }
      pending({
        ok: true,
        descriptor: data.descriptor as BridgeDescriptor,
        oplog: data.oplog as BridgeOp[],
        input: data.input as string,
        output: data.output as string,
      });
      return;
    }
    pending({ ok: false, error: data.error as string });
    return;
  }
  if (data['type'] === MSG_OPS) {
    if (!isShortString(data['instanceId'], 128) || !Array.isArray(data['ops'])) return;
    if (data['ops'].length > 64) return;
    const ops: BridgeOp[] = [];
    for (const raw of data['ops']) {
      if (validateBridgeOp(raw)) return;
      ops.push(raw as BridgeOp);
    }
    const error = typeof data['error'] === 'string' ? data['error'] : undefined;
    try {
      bridgeOpsHandler?.(data['instanceId'], ops, error);
    } catch (err) {
      console.warn(`[sandbox] handler de ops falló: ${String(err)}`);
    }
  }
}

/**
 * Crea (o reutiliza) el iframe opaco. Lanza si no hay sandbox: la importación
 * se rechaza, nunca se ejecuta sin protección.
 */
export function ensureSandboxBackend(): SandboxBackend {
  if (backend && backend.iframe.isConnected) return backend;
  backend = null;
  if (!isSandboxAvailable()) {
    throw new Error(SANDBOX_UNAVAILABLE_MESSAGE);
  }
  const doc = document;
  if (!doc.body) {
    throw new Error(SANDBOX_UNAVAILABLE_MESSAGE);
  }
  const session = `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
  const iframe = doc.createElement('iframe');
  // Origen opaco: allow-scripts SIN allow-same-origin. El harness se carga
  // por `src` (documento con CSP propia): el `srcdoc` heredaría el CSP del
  // padre y el harness inline moriría en producción. Ruta relativa al
  // documento ⇒ vale en raíz y en sub-path.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.display = 'none';
  iframe.src = './sandbox.html';
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  iframe.addEventListener('load', () => resolveReady(), { once: true });
  if (!listenerInstalled) {
    window.addEventListener('message', onSandboxMessage);
    listenerInstalled = true;
  }
  doc.body.appendChild(iframe);
  backend = { iframe, session, ready };
  return backend;
}

/** Evaluación de registro en el iframe (con timeout que rechaza en silencio). */
export function evaluateInSandbox(code: string, timeoutMs = 10000): Promise<BridgeEvaluation> {
  const hit = scanCustomPluginCode(code);
  if (hit !== null) {
    return Promise.resolve({
      ok: false,
      error: `Código de plugin bloqueado por seguridad: ${hit}`,
    });
  }
  let active: SandboxBackend;
  try {
    active = ensureSandboxBackend();
  } catch (err) {
    return Promise.resolve({
      ok: false,
      error: err instanceof Error ? err.message : SANDBOX_UNAVAILABLE_MESSAGE,
    });
  }
  const reqId = `r_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
  return new Promise<BridgeEvaluation>((resolve) => {
    const timer = window.setTimeout(() => {
      pendingResults.delete(reqId);
      resolve({ ok: false, error: 'El sandbox no respondió a tiempo: importación rechazada.' });
    }, timeoutMs);
    pendingResults.set(reqId, (result) => {
      window.clearTimeout(timer);
      pendingResults.delete(reqId);
      resolve(result);
    });
    void active.ready.then(() => {
      try {
        const target = active.iframe.contentWindow;
        if (!target) throw new Error('sin ventana');
        // '*' inevitable: el destino es de origen opaco (sin origen al que
        // acotar). La protección viaja en el contenido: sesión + formas
        // allowlisted + comprobación de event.source/event.origin al volver.
        target.postMessage(
          { type: MSG_EVALUATE, session: active.session, reqId, code, origin: window.location.origin },
          '*'
        );
      } catch {
        pendingResults.delete(reqId);
        window.clearTimeout(timer);
        resolve({ ok: false, error: SANDBOX_UNAVAILABLE_MESSAGE });
      }
    });
  });
}

/** Envío fire-and-forget (instantiate/update/dispose): sin sandbox, aviso. */
export function postToSandbox(message: Record<string, unknown>): void {
  if (!isSandboxAvailable()) return;
  try {
    const active = ensureSandboxBackend();
    const target = active.iframe.contentWindow;
    if (!target) throw new Error('sin ventana');
    target.postMessage({ ...message, session: active.session, origin: window.location.origin }, '*');
  } catch (err) {
    console.warn(`[sandbox] mensaje no entregado: ${String(err)}`);
  }
}
