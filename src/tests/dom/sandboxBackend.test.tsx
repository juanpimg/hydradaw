// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  ensureSandboxBackend,
  getSandboxSession,
  setBridgeOpsHandler,
} from '../../audio/pluginSandbox';
import type { BridgeOp } from '../../audio/pluginSandbox';

// Ronda fix 1: el transporte del backend (padre) con DOM real. El iframe no
// necesita ejecutar nada aquí: se prueba la creación opaca y el enrutado de
// mensajes sintéticos (fuente + origen + sesión + forma).

function fire(data: unknown, origin: string, source: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', { data, origin, source } as MessageEventInit)
  );
}

describe('backend del sandbox iframe (jsdom)', () => {
  it('crea un iframe opaco (allow-scripts sin allow-same-origin) con el harness', () => {
    const backend = ensureSandboxBackend();
    expect(backend.iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(backend.iframe.hasAttribute('allow-same-origin')).toBe(false);
    expect(backend.iframe.srcdoc).toContain('hydradaw-evaluate');
    expect(backend.session.length).toBeGreaterThan(0);
    expect(document.body.contains(backend.iframe)).toBe(true);
  });

  it('enruta ops válidas y descarta origen, fuente o sesión ajenos', () => {
    const backend = ensureSandboxBackend();
    const seen: Array<{ id: string; ops: BridgeOp[] }> = [];
    setBridgeOpsHandler((id, ops) => {
      seen.push({ id, ops });
    });
    try {
      const good = {
        type: 'hydradaw-ops',
        session: getSandboxSession(),
        instanceId: 'i1',
        ops: [{ op: 'param', handle: 'h1', param: 'gain', method: 'setValue', args: [0.5] }],
      };
      fire(good, 'null', backend.iframe.contentWindow);
      expect(seen.length).toBe(1);
      expect(seen[0]!.id).toBe('i1');
      // Origen distinto ⇒ descartado.
      fire(good, 'https://malicioso.example', backend.iframe.contentWindow);
      expect(seen.length).toBe(1);
      // Sesión ajena ⇒ descartado.
      fire({ ...good, session: 'otra-sesion' }, 'null', backend.iframe.contentWindow);
      expect(seen.length).toBe(1);
      // Fuente ajena ⇒ descartado.
      fire(good, 'null', window);
      expect(seen.length).toBe(1);
      // Ops malformadas ⇒ descartadas sin llamar al handler.
      fire(
        { ...good, ops: [{ op: 'create', node: 'teletransporte', handle: 'h1', args: [] }] },
        'null',
        backend.iframe.contentWindow
      );
      expect(seen.length).toBe(1);
    } finally {
      setBridgeOpsHandler(() => {});
    }
  });

  it('sin respuesta del iframe la evaluación rechaza por timeout', async () => {
    ensureSandboxBackend();
    vi.useFakeTimers();
    try {
      const { evaluateInSandbox } = await import('../../audio/pluginSandbox');
      const pending = evaluateInSandbox('const customPlugin = { id: "x" };', 1000);
      const assertion = expect(pending).resolves.toMatchObject({ ok: false });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
