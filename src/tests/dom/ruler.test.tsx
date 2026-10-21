// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useDawStore } from '../../store/useDawStore';
import { Ruler } from '../../components/Timeline/Ruler';

const RULER_LEFT = 50;

function renderRuler() {
  const utils = render(<Ruler />);
  const ruler = utils.getByTestId('ruler') as HTMLElement;
  ruler.getBoundingClientRect = () =>
    ({ left: RULER_LEFT, top: 0, width: 2000, height: 28, right: 2050, bottom: 28, x: RULER_LEFT, y: 0, toJSON: () => {} }) as DOMRect;
  return { ...utils, ruler };
}

beforeEach(() => {
  useDawStore.setState({
    zoom: 50,
    duration: 16,
    bpm: 120,
    timeSignature: [4, 4] as [number, number],
    currentTime: 0,
    isPlaying: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Ruler con seek acotado y teclado (UI-08, F13)', () => {
  it('R1: clic a 10 000 px con zoom 50 y duración 16 ⇒ currentTime === 16', () => {
    const { ruler } = renderRuler();
    fireEvent.click(ruler, { clientX: RULER_LEFT + 10000 });
    expect(useDawStore.getState().currentTime).toBe(16);
  });

  it('R2: clic a −500 px ⇒ currentTime === 0', () => {
    useDawStore.setState({ currentTime: 5 });
    const { ruler } = renderRuler();
    fireEvent.click(ruler, { clientX: RULER_LEFT - 500 });
    expect(useDawStore.getState().currentTime).toBe(0);
  });

  it('R3: la regla tiene role="slider" y es focusable', () => {
    const { ruler } = renderRuler();
    expect(ruler).toHaveAttribute('role', 'slider');
    ruler.focus();
    expect(document.activeElement).toBe(ruler);
  });

  it('R4: ArrowRight con foco ⇒ currentTime avanza 1 s, acotado a la duración', () => {
    const { ruler } = renderRuler();
    ruler.focus();
    fireEvent.keyDown(ruler, { key: 'ArrowRight' });
    expect(useDawStore.getState().currentTime).toBe(1);
    useDawStore.setState({ currentTime: 15.5 });
    fireEvent.keyDown(ruler, { key: 'ArrowRight' });
    expect(useDawStore.getState().currentTime).toBe(16);
    fireEvent.keyDown(ruler, { key: 'ArrowLeft' });
    expect(useDawStore.getState().currentTime).toBe(15);
    fireEvent.keyDown(ruler, { key: 'Home' });
    expect(useDawStore.getState().currentTime).toBe(0);
    fireEvent.keyDown(ruler, { key: 'End' });
    expect(useDawStore.getState().currentTime).toBe(16);
  });
});
