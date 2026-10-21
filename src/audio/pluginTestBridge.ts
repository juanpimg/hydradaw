// Ronda fix 1: puente de test para el sandbox de plugins. Ronda fix 2:
// ejecuta los BYTES EXACTOS de public/sandbox.js (el mismo fichero que se
// sirve en producción) en un contenedor `node:vm` con una ventana falsa
// (registro de listeners + captura de `postMessage`) y vuelca el resultado
// con un round-trip JSON —como el clon estructurado de `postMessage`— antes
// de importarlo al host. Es el espejo del camino del navegador sin DOM.
// Solo para la capa node (este fichero importa `node:vm`, nunca va al bundle).
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanCustomPluginCode } from './pluginSandbox';
import type {
  BridgeDescriptor,
  BridgeOp,
} from './pluginSandbox';
import { pluginHost } from './PluginHost';
import type { PluginDefinition } from '../types/daw';

export const TEST_SESSION = 'test-session';

interface CapturedPost {
  target: string;
  message: Record<string, unknown>;
}

export interface HarnessRun {
  captured: CapturedPost[];
  dispatch: (data: Record<string, unknown>) => void;
}

function makeFakeWindow(captured: CapturedPost[]) {
  const listeners: Array<(event: unknown) => void> = [];
  const parent = {
    postMessage: (message: unknown, target: string) => {
      captured.push({ target, message: message as Record<string, unknown> });
    },
  };
  return {
    window: {
      parent,
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (type === 'message') listeners.push(fn);
      },
    },
    dispatch: (data: Record<string, unknown>) => {
      const event = { source: parent, data };
      for (const fn of listeners) fn(event);
    },
  };
}

/**
 * Ejecuta el harness REAL en `vm` SIN pasar el escáner: pruebas de
 * confinamiento (el payload se ejecuta dentro del contenedor y el padre debe
 * quedar intacto). Corre public/sandbox.js byte por byte.
 */
export function runHarnessDirect(): HarnessRun {
  const captured: CapturedPost[] = [];
  const fake = makeFakeWindow(captured);
  const context = createContext({
    window: fake.window,
    JSON,
    Math,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    isFinite,
  });
  // Los bytes exactos servidos en producción (la sesión se adopta del primer
  // mensaje, igual que en el iframe: este fichero es estático).
  const shipped = readFileSync(join(process.cwd(), 'public', 'sandbox.js'), 'utf8');
  runInContext(shipped, context);
  return { captured, dispatch: fake.dispatch };
}

function lastResult(captured: CapturedPost[]): Record<string, unknown> | null {
  for (let i = captured.length - 1; i >= 0; i--) {
    const message = captured[i]!.message;
    if (message['type'] === 'hydradaw-result') return message;
  }
  return null;
}

export function lastOps(captured: CapturedPost[]): Record<string, unknown> | null {
  for (let i = captured.length - 1; i >= 0; i--) {
    const message = captured[i]!.message;
    if (message['type'] === 'hydradaw-ops') return message;
  }
  return null;
}

/**
 * Vía completa de test: escáner + harness + round-trip JSON + importación
 * validada al host. Equivale a `registerCustomPluginSecure` en el navegador.
 */
export function registerCustomPluginForTest(code: string): PluginDefinition {
  const hit = scanCustomPluginCode(code);
  if (hit !== null) {
    throw new Error(`Código de plugin bloqueado por seguridad: ${hit}`);
  }
  const run = runHarnessDirect();
  run.dispatch({
    type: 'hydradaw-evaluate',
    session: TEST_SESSION,
    reqId: 'test-req',
    code,
    origin: 'http://localhost/',
  });
  const result = lastResult(run.captured);
  if (!result || result['ok'] !== true) {
    throw new Error(
      `El sandbox de test rechazó el plugin: ${String(result?.['error'] ?? 'sin respuesta')}`
    );
  }
  // Round-trip JSON: imita el clon estructurado de postMessage. Nada no
  // serializable (ni funciones) puede cruzar al padre.
  const cloned = JSON.parse(
    JSON.stringify({
      descriptor: result['descriptor'],
      oplog: result['oplog'],
      input: result['input'],
      output: result['output'],
    })
  ) as {
    descriptor: BridgeDescriptor;
    oplog: BridgeOp[];
    input: string;
    output: string;
  };
  const def = pluginHost.importBridgeDefinition(cloned);
  // ST-04: recuerda la fuente igual que la vía segura del navegador, para
  // que `addPluginToTrack` y la persistencia la encuentren en tests.
  pluginHost.rememberCustomSource(def.id, code);
  return def;
}
