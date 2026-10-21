// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useDawStore } from '../../store/useDawStore';
import { Timeline } from '../../components/Timeline/Timeline';
import { TrackHeader } from '../../components/Timeline/TrackHeader';
import { TransportBar } from '../../components/Transport/TransportBar';
import { ChannelStrip } from '../../components/Mixer/ChannelStrip';
import { Header } from '../../components/Header/Header';

function seed() {
  useDawStore.setState({
    tracks: [
      {
        id: 't1', name: 'Voz', type: 'vocal' as const, color: '#a855f7',
        volume: 1, pan: 0, mute: false, solo: false, armed: false, plugins: [],
      },
    ],
    clips: [],
    zoom: 50,
    duration: 16,
    bpm: 120,
    timeSignature: [4, 4] as [number, number],
    snapMode: 'off',
    selectedClipIds: [],
    selectedTrackId: null,
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    metronome: false,
    masterVolume: 1,
    masterMute: false,
    currentTime: 0,
    projectName: 'Test',
    activeView: 'timeline' as const,
  });
}

beforeEach(() => {
  seed();
});

afterEach(() => {
  cleanup();
});

describe('Responsive y objetivos táctiles (UI-09)', () => {
  it('S1: la columna de headers es w-36 en móvil y w-60 desde sm', () => {
    const { getByTestId } = render(<Timeline />);
    const col = getByTestId('headers-col');
    expect(col.className).toContain('w-36');
    expect(col.className).toContain('sm:w-60');
  });

  it('S2: el TrackHeader sigue la misma columna responsive', () => {
    const track = useDawStore.getState().tracks[0]!;
    const { container } = render(<TrackHeader track={track} isSelected={false} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('w-36');
    expect(root.className).toContain('sm:w-60');
  });

  it('S3: zoom, M/S/R, transporte, borrar y añadir efecto tienen 44px mínimos', () => {
    render(<Timeline />);
    // jsdom no calcula layout: todos los rect son 0x0; el tamaño real se
    // verifica en el navegador (B6). Aquí se afirma la causa: las clases.
    const zoomOut = screen.getByRole('button', { name: 'Alejar zoom' });
    expect(zoomOut.getBoundingClientRect().width).toBe(0);
    for (const name of ['Alejar zoom', 'Acercar zoom', 'Cortar clip'] as const) {
      const cls = screen.getByRole('button', { name }).className;
      expect(cls).toContain('min-w-[44px]');
      expect(cls).toContain('min-h-[44px]');
    }
    cleanup();

    const track = useDawStore.getState().tracks[0]!;
    render(<TrackHeader track={track} isSelected={false} />);
    for (const name of [
      `Silenciar pista ${track.name}`,
      `Pista ${track.name} en solo`,
      `Armar pista ${track.name} para grabación`,
      `Eliminar pista ${track.name}`,
    ] as const) {
      const cls = screen.getByRole('button', { name }).className;
      expect(cls).toContain('min-w-[44px]');
      expect(cls).toContain('min-h-[44px]');
    }
    cleanup();

    render(<TransportBar />);
    for (const name of [
      'Detener', 'Reproducir', 'Grabar', 'Activar bucle', 'Silenciar master', 'Metrónomo',
    ] as const) {
      const cls = screen.getByRole('button', { name }).className;
      expect(cls).toContain('min-w-[44px]');
      expect(cls).toContain('min-h-[44px]');
    }
    cleanup();

    // El play en estado de reproducción (Pausar) usa el mismo elemento.
    useDawStore.setState({ isPlaying: true });
    render(<TransportBar />);
    const pauseCls = screen.getByRole('button', { name: 'Pausar' }).className;
    expect(pauseCls).toContain('min-w-[44px]');
    expect(pauseCls).toContain('min-h-[44px]');
    cleanup();
    useDawStore.setState({ isPlaying: false });

    render(<ChannelStrip track={track} levels={{ rms: 0, peak: 0 }} />);
    const addFx = screen.getByRole('button', { name: 'Añadir efecto' });
    expect(addFx.className).toContain('min-w-[44px]');
    expect(addFx.className).toContain('min-h-[44px]');
  });

  it('S4: metrónomo y VU master visibles en todos los breakpoints', () => {
    const { container } = render(<TransportBar />);
    const metro = screen.getByRole('button', { name: 'Metrónomo' });
    expect(metro.className.split(/\s+/)).not.toContain('hidden');
    const vu = container.querySelector('[title="Medidor de pico Master (0 dBFS)"]') as HTMLElement | null;
    expect(vu).not.toBeNull();
    expect(vu!.className.split(/\s+/)).not.toContain('hidden');
    expect(vu!.className.split(/\s+/)).not.toContain('sm:flex');
  });

  it('S5: la barra flotante se recoge a bottom-2 right-2 en móvil', () => {
    render(<Timeline />);
    const zoomOut = screen.getByRole('button', { name: 'Alejar zoom' });
    const toolbar = zoomOut.parentElement as HTMLElement;
    expect(toolbar.className).toContain('bottom-2');
    expect(toolbar.className).toContain('right-2');
    expect(toolbar.className).toContain('sm:bottom-4');
    expect(toolbar.className).toContain('sm:right-6');
  });

  it('S6: los tiradores de trim son visibles (sin opacity-25)', () => {
    useDawStore.setState({
      clips: [
        {
          id: 'c1', trackId: 't1', name: 'Clip', startTime: 0, duration: 4,
          offset: 0, audioBuffer: null, peaks: new Float32Array([0, 0.5]),
          color: '#06b6d4',
        },
      ],
    });
    render(<Timeline />);
    const trims = document.querySelectorAll('[title^="Recortar"]');
    expect(trims.length).toBeGreaterThan(0);
    trims.forEach((el) => {
      expect((el as HTMLElement).className).not.toContain('opacity-25');
    });
  });

  it('S7: el header adapta sus etiquetas bajo sm', () => {
    render(<Header />);
    // Las etiquetas textuales se ocultan en móvil (botones icon-only con
    // aria-label ya presente); el header no fuerza scroll horizontal.
    const header = document.querySelector('header') as HTMLElement;
    expect(header.className).toContain('overflow-x-auto');
    const nuevaPista = screen.getByText('Nueva Pista');
    expect((nuevaPista as HTMLElement).className.split(/\s+/)).toContain('hidden');
  });
});
