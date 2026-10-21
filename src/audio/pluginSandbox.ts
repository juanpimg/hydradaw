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
 * connect/disconnect. Todo lo demás se rechaza.
 */
const BRIDGE_NODE_SPECS: Record<string, BridgeNodeSpec> = {
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
const BRIDGE_PARAM_DEFAULTS: Record<string, Record<string, number>> = {
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
// 5. Harness del iframe (cadena; el iframe no tiene imports)
// ---------------------------------------------------------------------------

const MSG_EVALUATE = 'hydradaw-evaluate';
const MSG_RESULT = 'hydradaw-result';
const MSG_INSTANTIATE = 'hydradaw-instantiate';
const MSG_UPDATE = 'hydradaw-update';
const MSG_DISPOSE = 'hydradaw-dispose';
const MSG_OPS = 'hydradaw-ops';

/**
 * Construye el `srcdoc` del iframe. El código de usuario llega después por
 * `postMessage` (nunca interpolado aquí: evita rupturas de `</script>`).
 * Solo usa globales disponibles en iframe opaco y en `node:vm` (window, JSON,
 * Object, Array, Number, String, Boolean, RegExp, Error, isFinite).
 */
export function buildSandboxHarness(session: string): string {
  return (
    '<!DOCTYPE html><html><body><script>\n' +
    buildSandboxScript(session) +
    '<\\/script></body></html>'
  );
}

/** El JS del harness sin envoltura HTML (para `node:vm` en tests). */
export function buildSandboxScript(session: string): string {
  const parts: string[] = [];
  parts.push("'use strict';\n");
  parts.push('(function () {\n');
  parts.push(`var SESSION = ${JSON.stringify(session)};\n`);
  parts.push(`var NODE = ${JSON.stringify(BRIDGE_NODE_SPECS)};\n`);
  parts.push(`var DEFAULTS = ${JSON.stringify(BRIDGE_PARAM_DEFAULTS)};\n`);
  parts.push(
    `var SCAN = ${JSON.stringify(FORBIDDEN_PATTERNS.map((p) => [p.source, p.flags]))};\n`
  );
  parts.push(
    "var METHODS = ['setValue','setValueAtTime','setTargetAtTime','linearRampToValueAtTime','exponentialRampToValueAtTime'];\n"
  );
  parts.push('var OP_CAP_TEMPLATE = ' + String(BRIDGE_OP_CAP_TEMPLATE) + ';\n');
  parts.push('var OP_CAP_TOTAL = 2048;\n');
  parts.push('var OP_CAP_RUNTIME = 64;\n');
  parts.push('var MAX_PARAMS = 64;\n');
  parts.push('var MAX_INSTANCES = 64;\n');
  parts.push('var parentOrigin = null;\n');
  parts.push('var plugins = {};\n');
  parts.push('var instances = {};\n');
  parts.push('var instanceCount = 0;\n');
  parts.push('var handleSeq = 0;\n');
  parts.push('function isNum(v) { return typeof v === "number" && isFinite(v); }\n');
  parts.push('function isStr(v, max) { return typeof v === "string" && v.length <= max; }\n');
  parts.push('function newHandle() { handleSeq += 1; return "h" + handleSeq; }\n');
  parts.push(
    'function post(evt, msg) {\n' +
      '  try { evt.source.postMessage(msg, parentOrigin || "*"); } catch (e) {}\n' +
      '}\n'
  );
  parts.push(
    'function fail(evt, reqId, error) {\n' +
      `  post(evt, { type: "${MSG_RESULT}", session: SESSION, reqId: reqId, ok: false, error: error });\n` +
      '}\n'
  );
  parts.push(
    'function scan(code) {\n' +
      '  var low = code.toLowerCase();\n' +
      '  if (low.indexOf("constructor") !== -1 || low.indexOf("__proto__") !== -1) return "constructor/__proto__";\n' +
      '  for (var i = 0; i < SCAN.length; i++) {\n' +
      '    if (new RegExp(SCAN[i][0], SCAN[i][1]).test(code)) return SCAN[i][0];\n' +
      '  }\n' +
      '  return null;\n' +
      '}\n'
  );
  parts.push(
    'function checkArgs(args, n) {\n' +
      '  if (!Array.isArray(args) || args.length !== n) throw new Error("argumentos inválidos");\n' +
      '  for (var i = 0; i < args.length; i++) if (!isNum(args[i])) throw new Error("argumento no finito");\n' +
      '  return args;\n' +
      '}\n'
  );
  parts.push(
    'function emit(rec, op) {\n' +
      '  if (rec.ops.length >= OP_CAP_TOTAL) throw new Error("demasiadas operaciones");\n' +
      '  rec.ops.push(op);\n' +
      '}\n'
  );
  parts.push(
    'function makeParam(rec, hid, ntype, pname) {\n' +
      '  function record(method, args) { emit(rec, { op: "param", handle: hid, param: pname, method: method, args: args }); }\n' +
      '  return {\n' +
      '    get value() { return rec.values[hid + "." + pname]; },\n' +
      '    set value(v) {\n' +
      '      if (!isNum(v)) throw new Error("valor de parámetro no finito");\n' +
      '      rec.values[hid + "." + pname] = v;\n' +
      '      record("setValue", [v]);\n' +
      '    },\n' +
      '    setValueAtTime: function (v, t) { record("setValueAtTime", checkArgs([v, t], 2)); },\n' +
      '    setTargetAtTime: function (v, t, tc) { record("setTargetAtTime", checkArgs([v, t, tc], 3)); },\n' +
      '    linearRampToValueAtTime: function (v, t) { record("linearRampToValueAtTime", checkArgs([v, t], 2)); },\n' +
      '    exponentialRampToValueAtTime: function (v, t) { record("exponentialRampToValueAtTime", checkArgs([v, t], 2)); }\n' +
      '  };\n' +
      '}\n'
  );
  parts.push(
    'function makeFacade(rec, hid, ntype) {\n' +
      '  var spec = NODE[ntype];\n' +
      '  var f = { __hid: hid };\n' +
      '  for (var i = 0; i < spec.params.length; i++) (function (pname) {\n' +
      '    rec.values[hid + "." + pname] = DEFAULTS[ntype][pname];\n' +
      '    f[pname] = makeParam(rec, hid, ntype, pname);\n' +
      '  })(spec.params[i]);\n' +
      '  for (var prop in spec.props) (function (pname, rule) {\n' +
      '    var current = null;\n' +
      '    Object.defineProperty(f, pname, {\n' +
      '      enumerable: true, configurable: false,\n' +
      '      get: function () { return current; },\n' +
      '      set: function (v) {\n' +
      '        if (rule === "finite") { if (!isNum(v)) throw new Error("propiedad no finita para " + pname); }\n' +
      '        else if (rule.indexOf(v) === -1) throw new Error("valor fuera de la lista permitida para " + pname);\n' +
      '        current = v;\n' +
      '        emit(rec, { op: "set", handle: hid, prop: pname, value: v });\n' +
      '      }\n' +
      '    });\n' +
      '  })(prop, spec.props[prop]);\n' +
      '  f.connect = function (dest, out, inn) {\n' +
      '    if (!dest || typeof dest !== "object" || !isStr(dest.__hid, 8)) throw new Error("destino de connect inválido");\n' +
      '    var mop = { op: "connect", from: hid, to: dest.__hid };\n' +
      '    if (arguments.length > 1) {\n' +
      '      if (!Number.isInteger(out) || out < 0) throw new Error("índices de connect inválidos");\n' +
      '      mop.out = out;\n' +
      '      if (arguments.length > 2) {\n' +
      '        if (!Number.isInteger(inn) || inn < 0) throw new Error("índices de connect inválidos");\n' +
      '        mop.inn = inn;\n' +
      '      }\n' +
      '    }\n' +
      '    emit(rec, mop);\n' +
      '    return dest;\n' +
      '  };\n' +
      '  f.disconnect = function (dest) {\n' +
      '    var mop = { op: "disconnect", from: hid };\n' +
      '    if (dest !== undefined) {\n' +
      '      if (!dest || typeof dest !== "object" || !isStr(dest.__hid, 8)) throw new Error("destino de disconnect inválido");\n' +
      '      mop.to = dest.__hid;\n' +
      '    }\n' +
      '    emit(rec, mop);\n' +
      '  };\n' +
      '  try { Object.preventExtensions(f); } catch (e) {}\n' +
      '  return f;\n' +
      '}\n'
  );
  parts.push(
    'function makeProxy(rec) {\n' +
      '  var ctx = {};\n' +
      '  for (var key in NODE) (function (ntype) {\n' +
      '    var spec = NODE[ntype];\n' +
      '    ctx[spec.method] = function () {\n' +
      '      var args = [];\n' +
      '      if (spec.factoryArgs > 0) {\n' +
      '        if (arguments.length > 1) throw new Error("demasiados argumentos para " + spec.method);\n' +
      '        if (arguments.length === 1) {\n' +
      '          if (!isNum(arguments[0])) throw new Error("argumento no finito para " + spec.method);\n' +
      '          args = [arguments[0]];\n' +
      '        }\n' +
      '      } else if (arguments.length > 0) {\n' +
      '        throw new Error("argumentos no permitidos para " + spec.method);\n' +
      '      }\n' +
      '      var hid = newHandle();\n' +
      '      emit(rec, { op: "create", node: ntype, handle: hid, args: args });\n' +
      '      return makeFacade(rec, hid, ntype);\n' +
      '    };\n' +
      '  })(key);\n' +
      '  try { Object.preventExtensions(ctx); } catch (e) {}\n' +
      '  return ctx;\n' +
      '}\n'
  );
  parts.push(
    'function errText(e) { return e && e.message ? String(e.message) : String(e); }\n' +
      'function checkShape(def) {\n' +
      '  if (!def || typeof def !== "object") return "sin definición";\n' +
      '  if (typeof def.id !== "string" || !def.id || def.id.length > 64) return "id inválido";\n' +
      '  if (typeof def.createDSPNode !== "function") return "sin createDSPNode";\n' +
      '  if (def.parameters !== undefined && !Array.isArray(def.parameters)) return "parameters inválido";\n' +
      '  return null;\n' +
      '}\n' +
      'function checkParams(raw) {\n' +
      '  if (!Array.isArray(raw)) return "parameters debe ser un array";\n' +
      '  if (raw.length > MAX_PARAMS) return "demasiados parámetros";\n' +
      '  for (var i = 0; i < raw.length; i++) {\n' +
      '    var p = raw[i];\n' +
      '    if (!p || typeof p !== "object") return "parámetro inválido";\n' +
      '    if (!isStr(p.id, 64) || !p.id) return "parámetro sin id";\n' +
      '    if (!isStr(p.name, 128) || !p.name) return "parámetro sin nombre";\n' +
      '    if (!isNum(p.min) || !isNum(p.max) || !isNum(p.step) || !isNum(p.defaultValue)) return "rango no finito en " + p.id;\n' +
      '    if (!(p.min <= p.max) || !(p.step > 0)) return "rango incoherente en " + p.id;\n' +
      '    if (!(p.defaultValue >= p.min && p.defaultValue <= p.max)) return "default fuera de rango en " + p.id;\n' +
      '    if (p.unit !== undefined && !isStr(p.unit, 32)) return "unit inválida en " + p.id;\n' +
      '  }\n' +
      '  return null;\n' +
      '}\n' +
      'function isFacade(v) { return v && typeof v === "object" && isStr(v.__hid, 8); }\n'
  );
  parts.push(
    `function onEvaluate(evt, d) {\n` +
      '  if (!isStr(d.reqId, 64) || typeof d.code !== "string") return;\n' +
      '  var hit = scan(d.code);\n' +
      `  if (hit) { fail(evt, d.reqId, "Código de plugin bloqueado por seguridad: " + hit); return; }\n` +
      '  var customPlugin = null;\n' +
      '  try {\n' +
      '    var factory = new Function("\\"use strict\\";\\n" + d.code + "\\n;return typeof customPlugin !== \\"undefined\\" ? customPlugin : null;");\n' +
      '    customPlugin = factory();\n' +
      '  } catch (e) { fail(evt, d.reqId, "El plugin falló al evaluarse: " + errText(e)); return; }\n' +
      '  var bad = checkShape(customPlugin);\n' +
      '  if (bad) { fail(evt, d.reqId, "El plugin local no exporta una definición válida (" + bad + ")."); return; }\n' +
      '  var params = Array.isArray(customPlugin.parameters) ? customPlugin.parameters : [];\n' +
      '  bad = checkParams(params);\n' +
      '  if (bad) { fail(evt, d.reqId, "Parámetros inválidos (" + bad + ")."); return; }\n' +
      '  var defaults = {};\n' +
      '  for (var i = 0; i < params.length; i++) defaults[params[i].id] = params[i].defaultValue;\n' +
      '  var rec = { ops: [], values: {} };\n' +
      '  var produced = null;\n' +
      '  try {\n' +
      '    produced = customPlugin.createDSPNode(makeProxy(rec), defaults);\n' +
      '  } catch (e) { fail(evt, d.reqId, "createDSPNode lanzó: " + errText(e)); return; }\n' +
      '  if (!produced || typeof produced !== "object" || !isFacade(produced.inputNode) || !isFacade(produced.outputNode)) {\n' +
      '    fail(evt, d.reqId, "inputNode/outputNode deben crearse con el proxy del sandbox."); return;\n' +
      '  }\n' +
      '  if (typeof produced.updateParameter !== "function") {\n' +
      '    fail(evt, d.reqId, "falta updateParameter."); return;\n' +
      '  }\n' +
      '  var split = rec.ops.length;\n' +
      '  try {\n' +
      '    for (var j = 0; j < params.length; j++) {\n' +
      '      var p = params[j];\n' +
      '      var alt = p.defaultValue !== p.max ? p.max : (p.defaultValue !== p.min ? p.min : p.defaultValue);\n' +
      '      var before = rec.ops.length;\n' +
      '      produced.updateParameter(p.id, p.defaultValue);\n' +
      '      produced.updateParameter(p.id, alt);\n' +
      '      var saw = false;\n' +
      '      for (var k = before; k < rec.ops.length; k++) if (rec.ops[k].op === "param") { saw = true; break; }\n' +
      `      if (!saw) { fail(evt, d.reqId, "el parámetro '" + p.id + "' debe responder a updateParameter."); return; }\n` +
      '    }\n' +
      '  } catch (e) { fail(evt, d.reqId, "updateParameter lanzó en la sonda: " + errText(e)); return; }\n' +
      '  if (split > OP_CAP_TEMPLATE) { fail(evt, d.reqId, "demasiadas operaciones en el template."); return; }\n' +
      '  if (rec.ops.length > OP_CAP_TOTAL) { fail(evt, d.reqId, "demasiadas operaciones en total."); return; }\n' +
      '  var serialParams = null;\n' +
      '  try { serialParams = JSON.parse(JSON.stringify(params)); }\n' +
      '  catch (e) { fail(evt, d.reqId, "parámetros no serializables."); return; }\n' +
      '  plugins[customPlugin.id] = { createDSPNode: customPlugin.createDSPNode };\n' +
      `  post(evt, { type: "${MSG_RESULT}", session: SESSION, reqId: d.reqId, ok: true,\n` +
      '    descriptor: { id: customPlugin.id,\n' +
      '      name: typeof customPlugin.name === "string" ? customPlugin.name : "",\n' +
      '      category: typeof customPlugin.category === "string" ? customPlugin.category : "",\n' +
      '      description: typeof customPlugin.description === "string" ? customPlugin.description : "",\n' +
      '      parameters: serialParams },\n' +
      '    oplog: rec.ops.slice(0, split),\n' +
      '    input: produced.inputNode.__hid,\n' +
      '    output: produced.outputNode.__hid });\n' +
      '}\n'
  );
  parts.push(
    `function onInstantiate(evt, d) {\n` +
      '  if (!isStr(d.pluginId, 64) || !isStr(d.instanceId, 128)) return;\n' +
      '  var plugin = plugins[d.pluginId];\n' +
      '  if (!plugin) return;\n' +
      '  if (instanceCount >= MAX_INSTANCES) return;\n' +
      '  if (!d.params || typeof d.params !== "object") return;\n' +
      '  var keys = Object.keys(d.params);\n' +
      '  if (keys.length > MAX_PARAMS) return;\n' +
      '  var params = {};\n' +
      '  var kept = [];\n' +
      '  for (var i = 0; i < keys.length; i++) {\n' +
      '    if (!isStr(keys[i], 64)) continue;\n' +
      '    var v = d.params[keys[i]];\n' +
      '    if (!isNum(v)) continue;\n' +
      '    params[keys[i]] = v;\n' +
      '    kept.push(keys[i]);\n' +
      '  }\n' +
      '  var rec = { ops: [], values: {} };\n' +
      '  var produced = null;\n' +
      '  try { produced = plugin.createDSPNode(makeProxy(rec), params); }\n' +
      '  catch (e) { return; }\n' +
      '  if (!produced || typeof produced !== "object" || typeof produced.updateParameter !== "function") return;\n' +
      '  instances[d.instanceId] = { update: produced.updateParameter, cleanup: produced.cleanup, rec: rec };\n' +
      '  instanceCount += 1;\n' +
      '  var sync = [];\n' +
      '  try {\n' +
      '    for (var j = 0; j < kept.length; j++) {\n' +
      '      produced.updateParameter(kept[j], params[kept[j]]);\n' +
      '    }\n' +
      '    for (var k = 0; k < rec.ops.length && sync.length < OP_CAP_RUNTIME; k++) sync.push(rec.ops[k]);\n' +
      '  } catch (e) { opsOut(evt, d.instanceId, sync, "updateParameter lanzó: " + errText(e)); return; }\n' +
      '  opsOut(evt, d.instanceId, sync, null);\n' +
      '}\n' +
      'function opsOut(evt, instanceId, ops, error) {\n' +
      `  var msg = { type: "${MSG_OPS}", session: SESSION, instanceId: instanceId, ops: ops };\n` +
      '  if (error) msg.error = error;\n' +
      '  post(evt, msg);\n' +
      '}\n' +
      `function onUpdate(evt, d) {\n` +
      '  if (!isStr(d.instanceId, 128) || !isStr(d.paramId, 64) || !isNum(d.value)) return;\n' +
      '  var inst = instances[d.instanceId];\n' +
      '  if (!inst || typeof inst.update !== "function") return;\n' +
      '  inst.rec.ops = [];\n' +
      '  try { inst.update(d.paramId, d.value); }\n' +
      '  catch (e) { opsOut(evt, d.instanceId, [], "updateParameter lanzó: " + errText(e)); return; }\n' +
      '  if (inst.rec.ops.length > OP_CAP_RUNTIME) { opsOut(evt, d.instanceId, [], "demasiadas operaciones."); return; }\n' +
      '  opsOut(evt, d.instanceId, inst.rec.ops.slice(0), null);\n' +
      '}\n' +
      `function onDispose(evt, d) {\n` +
      '  if (!isStr(d.instanceId, 128)) return;\n' +
      '  var inst = instances[d.instanceId];\n' +
      '  if (!inst) return;\n' +
      '  delete instances[d.instanceId];\n' +
      '  instanceCount -= 1;\n' +
      '  try { if (typeof inst.cleanup === "function") inst.cleanup(); } catch (e) {}\n' +
      '}\n'
  );
  parts.push(
    'window.addEventListener("message", function (event) {\n' +
      '  try {\n' +
      '    if (event.source !== window.parent) return;\n' +
      '    var d = event.data;\n' +
      '    if (!d || typeof d !== "object" || typeof d.type !== "string") return;\n' +
      '    if (d.session !== SESSION) return;\n' +
      '    if (typeof d.origin === "string" && /^https?:\\/\\/[^/]+$/.test(d.origin)) parentOrigin = d.origin;\n' +
      `    if (d.type === "${MSG_EVALUATE}") onEvaluate(event, d);\n` +
      `    else if (d.type === "${MSG_INSTANTIATE}") onInstantiate(event, d);\n` +
      `    else if (d.type === "${MSG_UPDATE}") onUpdate(event, d);\n` +
      `    else if (d.type === "${MSG_DISPOSE}") onDispose(event, d);\n` +
      '  } catch (e) {}\n' +
      '});\n'
  );
  parts.push('})();\n');
  return parts.join('');
}

// ---------------------------------------------------------------------------
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
  // Origen opaco: allow-scripts SIN allow-same-origin.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.display = 'none';
  iframe.srcdoc = buildSandboxHarness(session);
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
