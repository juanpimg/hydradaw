// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { useRef, Profiler } from 'react';
import { useDawStore } from '../../store/useDawStore';
import { audioEngine } from '../../audio/AudioEngine';
import { usePlayheadSync } from '../../hooks/usePlayheadSync';
import { Timeline } from '../../components/Timeline/Timeline';
import { TransportBar } from '../../components/Transport/TransportBar';
import { formatTransportTime } from '../../components/Transport/TransportBar';

function Probe({ zoom }: { zoom: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playheadRef = usePlayheadSync({ containerRef, zoom });
  return (
    <div ref={containerRef} data-testid="ph-container">
      <div ref={playheadRef} data-testid="ph-playhead" />
    </div>
  );
}

function seedStore() {
  useDawStore.setState({
    tracks: [],
    clips: [],
    zoom: 50,
    duration: 32,
    bpm: 120,
    timeSignature: [4, 4] as [number, number],
    snapMode: 'off',
    selectedClipId: null,
    selectedTrackId: null,
    isPlaying: true,
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

describe('Un solo bucle de playhead + seguimiento (UI-07, UI-12)', () => {
  it('PH1: con isPlaying, sólo hay una suscripción activa al onTimeUpdate', () => {
    const spy = vi.spyOn(audioEngine, 'onTimeUpdate');
    render(<Timeline />);
    // Timeline y Ruler comparten el bucle: dos superficies, una suscripción.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('PH2: el playhead se actualiza al cambiar el tiempo del engine', () => {
    let timeCb: ((time: number) => void) | null = null;
    vi.spyOn(audioEngine, 'onTimeUpdate').mockImplementation((cb) => {
      timeCb = cb;
      return () => {};
    });
    const { getByTestId } = render(<Probe zoom={50} />);
    act(() => { timeCb?.(3); });
    expect(getByTestId('ph-playhead').style.transform).toBe('translateX(150px)');
  });

  it('PH3: el scrollLeft del contenedor sigue al playhead cuando se acerca al borde', () => {
    let timeCb: ((time: number) => void) | null = null;
    vi.spyOn(audioEngine, 'onTimeUpdate').mockImplementation((cb) => {
      timeCb = cb;
      return () => {};
    });
    const { getByTestId } = render(<Probe zoom={50} />);
    const container = getByTestId('ph-container') as HTMLElement;
    Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true });
    act(() => { timeCb?.(10); });
    // x = 500 supera (400 − 40) ⇒ scrollLeft = 500 − 400 + 40 = 140.
    expect(container.scrollLeft).toBe(140);
  });

  it('PH4: el timecode sólo cambia cuando cambian los dígitos mostrados', () => {
    // 1.001 y 1.002 caen en la misma centésima: mismo texto.
    expect(formatTransportTime(1.001, 120, [4, 4])).toBe(formatTransportTime(1.002, 120, [4, 4]));
    expect(formatTransportTime(1.001, 120, [4, 4])).not.toBe(formatTransportTime(1.02, 120, [4, 4]));
    // Y el componente aplica el gate: tiempos con mismos dígitos no tocan el DOM.
    let timeCb: ((time: number) => void) | null = null;
    vi.spyOn(audioEngine, 'onTimeUpdate').mockImplementation((cb) => {
      timeCb = cb;
      return () => {};
    });
    const { container } = render(<TransportBar />);
    const readout = container.querySelector(
      'div[title="Rejilla (no estira el audio)"] > div:last-child',
    ) as HTMLElement;
    act(() => { timeCb?.(1.001); });
    const before = readout.textContent;
    // 1.002 muestra los mismos dígitos ⇒ el gate no toca el DOM.
    act(() => { timeCb?.(1.002); });
    expect(readout.textContent).toBe(before);
    // 2.5 s sí cambia los dígitos ⇒ el DOM se actualiza.
    act(() => { timeCb?.(2.5); });
    expect(readout.textContent).not.toBe(before);
  });

  it('PH5: el timecode no re-renderiza si los dígitos no cambian (Profiler)', () => {
    let timeCb: ((time: number) => void) | null = null;
    vi.spyOn(audioEngine, 'onTimeUpdate').mockImplementation((cb) => {
      timeCb = cb;
      return () => {};
    });
    let commits = 0;
    render(
      <Profiler id="timecode-gate" onRender={() => { commits += 1; }}>
        <TransportBar />
      </Profiler>,
    );
    commits = 0;
    act(() => { timeCb?.(1.001); });
    expect(commits).toBeGreaterThan(0);
    commits = 0;
    // Mismos dígitos (misma centésima) ⇒ cero commits.
    act(() => { timeCb?.(1.002); });
    expect(commits).toBe(0);
  });

  it('PH6: en pausa no hay follow-scroll, pero el playhead sí se posiciona', () => {
    useDawStore.setState({ isPlaying: false });
    let timeCb: ((time: number) => void) | null = null;
    vi.spyOn(audioEngine, 'onTimeUpdate').mockImplementation((cb) => {
      timeCb = cb;
      return () => {};
    });
    const { getByTestId } = render(<Probe zoom={50} />);
    const container = getByTestId('ph-container') as HTMLElement;
    Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true });
    act(() => { timeCb?.(10); });
    // Posición correcta por suscripción…
    expect(getByTestId('ph-playhead').style.transform).toBe('translateX(500px)');
    // …pero el scroll no se toca: el usuario inspecciona libremente en pausa.
    expect(container.scrollLeft).toBe(0);
  });

  it('PH7: el bucle rAF no corre en pausa y sí corriendo', () => {
    useDawStore.setState({ isPlaying: false });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const { unmount } = render(<Probe zoom={50} />);
    expect(rafSpy).not.toHaveBeenCalled();
    unmount();
    rafSpy.mockClear();
    act(() => { useDawStore.setState({ isPlaying: true }); });
    const { unmount: unmount2 } = render(<Probe zoom={50} />);
    expect(rafSpy).toHaveBeenCalled();
    unmount2();
  });

  it('PH8: pausa→play arranca el bucle, play→pausa lo detiene', () => {
    useDawStore.setState({ isPlaying: false });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    render(<Probe zoom={50} />);
    expect(rafSpy).not.toHaveBeenCalled();
    act(() => { useDawStore.setState({ isPlaying: true }); });
    expect(rafSpy).toHaveBeenCalled();
    act(() => { useDawStore.setState({ isPlaying: false }); });
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('PH9: un scroll manual corriendo aparca el follow (no pelea)', () => {
    let timeCb: ((time: number) => void) | null = null;
    vi.spyOn(audioEngine, 'onTimeUpdate').mockImplementation((cb) => {
      timeCb = cb;
      return () => {};
    });
    const { getByTestId } = render(<Probe zoom={50} />);
    const container = getByTestId('ph-container') as HTMLElement;
    Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true });
    // El usuario mueve las lanes por su cuenta mientras suena.
    fireEvent.scroll(container);
    act(() => { timeCb?.(10); });
    // x = 500 saldría de la vista, pero el gesto manual manda: no se toca.
    expect(container.scrollLeft).toBe(0);
  });

  it('PH10: el eco del scroll propio no cuenta como gesto manual', () => {
    let timeCb: ((time: number) => void) | null = null;
    vi.spyOn(audioEngine, 'onTimeUpdate').mockImplementation((cb) => {
      timeCb = cb;
      return () => {};
    });
    const { getByTestId } = render(<Probe zoom={50} />);
    const container = getByTestId('ph-container') as HTMLElement;
    Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true });
    act(() => { timeCb?.(10); });
    expect(container.scrollLeft).toBe(140);
    // El navegador emite scroll por NUESTRA escritura: es eco, no gesto.
    fireEvent.scroll(container);
    act(() => { timeCb?.(11); });
    // x = 550 > 140 + 400 − 40 ⇒ sigue: 550 − 400 + 40 = 190.
    expect(container.scrollLeft).toBe(190);
  });

  it('PH11: cambiar el zoom reposiciona de inmediato también en pausa', () => {
    useDawStore.setState({ isPlaying: false });
    vi.spyOn(audioEngine, 'getCurrentTime').mockReturnValue(4);
    const { getByTestId, rerender } = render(<Probe zoom={50} />);
    // Al montar ya posiciona con el tiempo vivo del engine, sin esperar nada.
    expect(getByTestId('ph-playhead').style.transform).toBe('translateX(200px)');
    rerender(<Probe zoom={100} />);
    expect(getByTestId('ph-playhead').style.transform).toBe('translateX(400px)');
  });
});
