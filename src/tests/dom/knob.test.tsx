// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Knob } from '../../components/Plugins/Knob';

function renderKnob(onChange = vi.fn()) {
  const utils = render(
    <Knob label="Volumen" value={5} min={0} max={10} step={1} defaultValue={10} onChange={onChange} />,
  );
  const dial = utils.getByRole('slider', { name: 'Volumen' }) as HTMLElement;
  dial.setPointerCapture = vi.fn();
  dial.releasePointerCapture = vi.fn();
  return { ...utils, dial, onChange };
}

function pointerEvent(type: string, init: Record<string, unknown> = {}) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Knob con captura de puntero y rueda no pasiva (UI-04, F7)', () => {
  it('K1: pointerdown ⇒ setPointerCapture llamado', () => {
    const { dial } = renderKnob();
    dial.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientY: 100 }));
    expect(dial.setPointerCapture).toHaveBeenCalledWith(9);
  });

  it('K2: pointerup ⇒ releasePointerCapture llamado', () => {
    const { dial } = renderKnob();
    dial.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientY: 100 }));
    dial.dispatchEvent(pointerEvent('pointerup', { pointerId: 9, clientY: 100 }));
    expect(dial.releasePointerCapture).toHaveBeenCalledWith(9);
  });

  it('K3: el dial declara touch-action: none (clase + estilo en línea)', () => {
    // jsdom no computa `touch-action`: se afirma la causa (clase + inline),
    // que en un navegador real computa a `none`.
    const { dial } = renderKnob();
    expect(dial.className).toContain('touch-none');
    expect(dial.style.touchAction).toBe('none');
  });

  it('K4: doble clic ⇒ el valor vuelve al valor por defecto', () => {
    const { dial, onChange } = renderKnob();
    fireEvent.doubleClick(dial);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('K5: el listener de rueda se registra con { passive: false }', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    const { unmount, dial, onChange } = renderKnob();
    const wheelCalls = spy.mock.calls.filter((c) => c[0] === 'wheel');
    expect(wheelCalls.length).toBeGreaterThan(0);
    expect(wheelCalls.some((c) => (c[2] as AddEventListenerOptions)?.passive === false)).toBe(true);
    // Y funcionalmente gira el valor: rueda hacia arriba ⇒ +step.
    dial.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }));
    expect(onChange).toHaveBeenCalledWith(6);
    unmount();
  });
});
