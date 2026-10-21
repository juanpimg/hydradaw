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
    selectedClipIds: [],
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

  it('T3: el sync absorbe el eco asíncrono sin escrituras extra', () => {
    const { getByTestId } = render(<Timeline />);
    const headers = getByTestId('headers-scroll');
    const lanes = getByTestId('lanes-scroll');
    // Contadores de escrituras programadas: el navegador real emite `scroll`
    // también por `scrollTop = x` (eco asíncrono); aquí se dispara a mano para
    // simularlo. La asignación directa al respaldo simula el scroll físico del
    // usuario (ningún código nuestro escribe).
    let headersTop = 0;
    let lanesTop = 0;
    let headersWrites = 0;
    let lanesWrites = 0;
    Object.defineProperty(headers, 'scrollTop', {
      get: () => headersTop,
      set: (v: number) => { headersWrites += 1; headersTop = v; },
      configurable: true,
    });
    Object.defineProperty(lanes, 'scrollTop', {
      get: () => lanesTop,
      set: (v: number) => { lanesWrites += 1; lanesTop = v; },
      configurable: true,
    });

    // Gesto: el usuario baja los headers a 100 ⇒ una sola escritura en lanes.
    headersTop = 100;
    fireEvent.scroll(headers);
    expect(lanesTop).toBe(100);
    expect(lanesWrites).toBe(1);

    // Eco rancio entrelazado con un gesto: antes de que llegue el eco de la
    // escritura programada (lanes:=100), el usuario mueve las lanes a 60.
    lanesTop = 60;
    fireEvent.scroll(lanes);
    // La bandera absorbe el eco: los headers siguen en 100, sin escrituras.
    expect(headersTop).toBe(100);
    expect(headersWrites).toBe(0);

    // El evento propio del gesto del usuario sí sincroniza (bandera consumida).
    fireEvent.scroll(lanes);
    expect(headersTop).toBe(60);
    expect(headersWrites).toBe(1);

    // Eco de esa escritura en los headers: se absorbe sin reescribir lanes.
    fireEvent.scroll(headers);
    expect(lanesTop).toBe(60);
    expect(lanesWrites).toBe(1);

    // Umbral sub-píxel: una diferencia de 0.3 no escribe nada.
    headersTop = 60.3;
    fireEvent.scroll(headers);
    expect(lanesWrites).toBe(1);
    expect(lanesTop).toBe(60);
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
