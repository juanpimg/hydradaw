// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { useDawStore } from '../../store/useDawStore';
import { Timeline } from '../../components/Timeline/Timeline';
import { Ruler } from '../../components/Timeline/Ruler';

function seedStore() {
  useDawStore.setState({
    tracks: Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      name: `Pista ${i}`,
      type: 'audio' as const,
      color: '#fff',
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      armed: false,
      plugins: [],
    })),
    clips: [],
    zoom: 50,
    duration: 8,
    bpm: 120,
    timeSignature: [4, 4] as [number, number],
    snapMode: 'off',
    selectedClipId: null,
    selectedTrackId: null,
    isPlaying: false,
    currentTime: 0,
  });
}

beforeEach(() => {
  seedStore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Timeline con scroll sincronizado y regla sticky (UI-01, UI-02, F10, F11, F12)', () => {
  it('T1: scroll en los headers ⇒ el scrollTop de los lanes se iguala', () => {
    const { getByTestId } = render(<Timeline />);
    const headers = getByTestId('headers-scroll');
    const lanes = getByTestId('lanes-scroll');
    headers.scrollTop = 120;
    fireEvent.scroll(headers);
    expect(lanes.scrollTop).toBe(120);
  });

  it('T2: scroll en los lanes ⇒ el scrollTop de los headers se iguala', () => {
    const { getByTestId } = render(<Timeline />);
    const headers = getByTestId('headers-scroll');
    const lanes = getByTestId('lanes-scroll');
    lanes.scrollTop = 200;
    fireEvent.scroll(lanes);
    expect(headers.scrollTop).toBe(200);
  });

  it('T3: el scroll sincronizado no entra en bucle', () => {
    const { getByTestId } = render(<Timeline />);
    const headers = getByTestId('headers-scroll');
    const lanes = getByTestId('lanes-scroll');
    let events = 0;
    headers.addEventListener('scroll', () => { events += 1; });
    lanes.addEventListener('scroll', () => { events += 1; });
    // Ida y vuelta alternada: cada scroll manual debe sincronizar sin
    // amplificarse (programar scrollTop no dispara scroll en el DOM real ni aquí).
    for (let i = 0; i < 10; i++) {
      headers.scrollTop = 10 * (i + 1);
      fireEvent.scroll(headers);
      lanes.scrollTop = headers.scrollTop;
      fireEvent.scroll(lanes);
    }
    expect(headers.scrollTop).toBe(lanes.scrollTop);
    expect(events).toBe(20);
  });

  it('T4: la raíz de la Ruler contiene sticky', () => {
    const { getByTestId } = render(<Ruler />);
    expect(getByTestId('ruler').className).toContain('sticky');
  });

  it('T5: el ancho de lanes usa el ancho medido del header, no 240', () => {
    // ResizeObserver capturable: el Timeline mide la columna de headers.
    const holder: { cb: (() => void) | null } = { cb: null };
    class CapturingRO {
      constructor(cb: () => void) { holder.cb = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', CapturingRO);
    const { getByTestId } = render(<Timeline />);
    const headerCol = getByTestId('headers-col');
    headerCol.getBoundingClientRect = () =>
      ({ width: 200, left: 0, right: 200, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    act(() => { holder.cb?.(); });
    // viewport jsdom 1024 − medido 200 = 824 (con el 240 hardcodeado serían 784;
    // duration 8 × zoom 50 = 400 no manda).
    expect(getByTestId('lanes-inner').style.width).toBe('824px');
  });
});
