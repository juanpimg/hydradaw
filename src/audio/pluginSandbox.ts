import type { PluginDefinition } from '../types/daw';

/**
 * SEC-01 / AUD-08 — sandbox real para plugins de usuario.
 *
 * Dos capas:
 *
 * 1. **Denegar por defecto (siempre):** `scanCustomPluginCode` rechaza el
 *    código que nombra primitivas de exfiltración (`globalThis`, `self`,
 *    `fetch`, …) y cualquier código que contenga `constructor` o `__proto__`
 *    (cierra `x.constructor.constructor("...")()` y la contaminación de
 *    prototipos). Sin la cadena literal no hay acceso: no se puede nombrar
 *    `localStorage` sin escribir `localStorage`, y no se llega a ningún
 *    global sin `globalThis`/`self`/`window`/`constructor`.
 *
 * 2. **Aislamiento real (navegador):** `evaluateCustomPluginSandboxed`
 *    ejecuta el código en un `<iframe sandbox="allow-scripts">` SIN
 *    `allow-same-origin` (origen opaco ⇒ sin `localStorage`, sin IndexedDB,
 *    sin acceso al DOM ni al `window` del padre) y solo acepta de vuelta un
 *    descriptor serializable por `postMessage` con un protocolo allowlisted
 *    (tipo + nonce). Si el sandbox no existe, la importación se **rechaza**,
 *    nunca se ejecuta sin protección.
 *
 * El DSP en tiempo real (`createDSPNode`) necesita el `AudioContext` del
 * hilo principal —un iframe no puede construir nodos de audio del padre—,
 * así que la materialización sigue haciéndose en el hilo principal con
 * evaluación endurecida (modo estricto + todos los globales peligrosos
 * sombreados a `undefined`), solo DESPUÉS de pasar el escáner y (en el
 * navegador) de detonar sin efectos en el iframe estéril.
 */

export type CustomPluginDefinition = PluginDefinition;

export type SandboxResult =
  | { ok: true; definition: CustomPluginDefinition }
  | { ok: false; error: string };

/** Descriptor serializable que el iframe devuelve por postMessage (sin funciones). */
export interface SandboxedPluginDescriptor {
  id: string;
  name: string;
  category: string;
  description: string;
  parameters: Array<Record<string, string | number | boolean | null>>;
  hasFactory: boolean;
}

export type SandboxPrecheck =
  | { ok: true; descriptor: SandboxedPluginDescriptor }
  | { ok: false; error: string };

/**
 * Lista de prohibición (spec §3.7 + la anterior): cualquier coincidencia
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
 * código pasa. Cubre todo el fuente, incluido el cuerpo de `createDSPNode`
 * (el acceso diferido también se rechaza en el registro).
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

/**
 * Globales sombreados a `undefined` en la evaluación endurecida. Todos son
 * identificadores válidos en modo estricto (`eval` no lo es y por eso solo
 * vive en el escáner estático).
 */
const SHADOWED_GLOBALS: string[] = [
  'globalThis',
  'self',
  'top',
  'parent',
  'location',
  'navigator',
  'history',
  'Worker',
  'SharedWorker',
  'WebAssembly',
  'importScripts',
  'postMessage',
  'indexedDB',
  'caches',
  'cookieStore',
  'document',
  'window',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'Function',
  'constructor',
  'prototype',
  '__proto__',
  'localStorage',
  'sessionStorage',
  'PluginHost',
];

function checkShape(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return 'El plugin local no exporta una definición válida de PluginDefinition con createDSPNode.';
  }
  const def = value as {
    id?: unknown;
    parameters?: unknown;
    createDSPNode?: unknown;
  };
  if (typeof def.id !== 'string' || def.id.length === 0) {
    return 'El plugin local no exporta una definición válida de PluginDefinition con createDSPNode.';
  }
  if (typeof def.createDSPNode !== 'function') {
    return 'El plugin local no exporta una definición válida de PluginDefinition con createDSPNode.';
  }
  if (def.parameters !== undefined && !Array.isArray(def.parameters)) {
    return 'El plugin local declara parameters inválidos (debe ser un array).';
  }
  return null;
}

function evaluateHardened(code: string): SandboxResult {
  let factory: (...args: unknown[]) => unknown;
  try {
    factory = new Function(
      ...SHADOWED_GLOBALS,
      ` "use strict";\n${code}\n;return typeof customPlugin !== 'undefined' ? customPlugin : null;`
    ) as (...args: unknown[]) => unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `El plugin local no se pudo compilar: ${detail}` };
  }
  let exported: unknown;
  try {
    exported = factory(...SHADOWED_GLOBALS.map(() => undefined));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `El plugin local falló al evaluarse: ${detail}` };
  }
  const shapeError = checkShape(exported);
  if (shapeError) return { ok: false, error: shapeError };
  const def = exported as CustomPluginDefinition;
  const definition: CustomPluginDefinition = {
    ...def,
    parameters: Array.isArray(def.parameters) ? def.parameters : [],
  };
  return { ok: true, definition };
}

/**
 * Vía síncrona: escáner + evaluación endurecida. Es la que usan los tests y
 * la que materializa la definición tras el pre-chequeo aislado.
 */
export function evaluateCustomPlugin(code: string): SandboxResult {
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, error: 'El código del plugin está vacío.' };
  }
  const hit = scanCustomPluginCode(code);
  if (hit !== null) {
    return { ok: false, error: `Código de plugin bloqueado por seguridad: ${hit}` };
  }
  return evaluateHardened(code);
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

const SANDBOX_PROTOCOL_EVAL = 'hydradaw-plugin-eval';
const SANDBOX_PROTOCOL_RESULT = 'hydradaw-plugin-result';

function buildSandboxHarness(): string {
  return (
    `<!DOCTYPE html><html><body><script>\n` +
    `'use strict';\n` +
    `window.addEventListener('message', function (event) {\n` +
    `  var data = event.data;\n` +
    `  if (!data || typeof data !== 'object') return;\n` +
    `  if (data.type !== '${SANDBOX_PROTOCOL_EVAL}') return;\n` +
    `  if (typeof data.code !== 'string' || typeof data.id !== 'string') return;\n` +
    `  var error = '';\n` +
    `  var descriptor = null;\n` +
    `  try {\n` +
    `    var run = new Function('"use strict";\\n' + data.code + '\\n;return typeof customPlugin !== \\'undefined\\' ? customPlugin : null;');\n` +
    `    var def = run();\n` +
    `    if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !def.id || typeof def.createDSPNode !== 'function') {\n` +
    `      error = 'El plugin no exporta una definición válida.';\n` +
    `    } else {\n` +
    `      var params = [];\n` +
    `      try {\n` +
    `        var raw = Array.isArray(def.parameters) ? def.parameters.slice(0, 256) : [];\n` +
    `        params = JSON.parse(JSON.stringify(raw));\n` +
    `      } catch (e) { params = []; }\n` +
    `      descriptor = {\n` +
    `        id: def.id,\n` +
    `        name: typeof def.name === 'string' ? def.name : '',\n` +
    `        category: typeof def.category === 'string' ? def.category : '',\n` +
    `        description: typeof def.description === 'string' ? def.description : '',\n` +
    `        parameters: params,\n` +
    `        hasFactory: true\n` +
    `      };\n` +
    `    }\n` +
    `  } catch (e) {\n` +
    `    error = e && e.message ? String(e.message) : 'Error al evaluar el plugin en el sandbox.';\n` +
    `  }\n` +
    `  try { event.source.postMessage({ type: '${SANDBOX_PROTOCOL_RESULT}', id: data.id, ok: descriptor !== null, descriptor: descriptor, error: error }, '*'); } catch (e) {}\n` +
    `});\n` +
    `<\/script></body></html>`
  );
}

/**
 * Vía aislada (navegador): pre-ejecuta el código en un iframe con origen
 * opaco y devuelve solo el descriptor serializable. Si el sandbox no está
 * disponible (o no responde), rechaza explícitamente SIN ejecutar nada.
 */
export function evaluateCustomPluginSandboxed(
  code: string,
  timeoutMs = 5000
): Promise<SandboxPrecheck> {
  const hit = scanCustomPluginCode(code);
  if (hit !== null) {
    return Promise.resolve({
      ok: false,
      error: `Código de plugin bloqueado por seguridad: ${hit}`,
    });
  }
  if (!isSandboxAvailable()) {
    return Promise.resolve({ ok: false, error: SANDBOX_UNAVAILABLE_MESSAGE });
  }
  return new Promise<SandboxPrecheck>((resolve) => {
    const doc = document;
    if (!doc.body) {
      resolve({ ok: false, error: SANDBOX_UNAVAILABLE_MESSAGE });
      return;
    }
    const iframe = doc.createElement('iframe');
    const nonce = `sbx_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    let settled = false;
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as {
        type?: unknown;
        id?: unknown;
        ok?: unknown;
        descriptor?: unknown;
        error?: unknown;
      } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type !== SANDBOX_PROTOCOL_RESULT || data.id !== nonce) return;
      if (data.ok === true && data.descriptor && typeof data.descriptor === 'object') {
        finish({ ok: true, descriptor: data.descriptor as SandboxedPluginDescriptor });
      } else {
        finish({
          ok: false,
          error:
            typeof data.error === 'string' && data.error.length > 0
              ? data.error
              : 'El sandbox rechazó el plugin.',
        });
      }
    };
    const timer = window.setTimeout(
      () =>
        finish({
          ok: false,
          error: 'El sandbox no respondió a tiempo: importación rechazada por seguridad.',
        }),
      timeoutMs
    );
    const finish = (result: SandboxPrecheck): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
      resolve(result);
    };
    window.addEventListener('message', onMessage);
    // Origen opaco: allow-scripts SIN allow-same-origin.
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.display = 'none';
    iframe.srcdoc = buildSandboxHarness();
    iframe.addEventListener('load', () => {
      try {
        const target = iframe.contentWindow;
        if (!target) {
          finish({ ok: false, error: SANDBOX_UNAVAILABLE_MESSAGE });
          return;
        }
        target.postMessage({ type: SANDBOX_PROTOCOL_EVAL, id: nonce, code }, '*');
      } catch {
        finish({ ok: false, error: SANDBOX_UNAVAILABLE_MESSAGE });
      }
    });
    doc.body.appendChild(iframe);
  });
}
