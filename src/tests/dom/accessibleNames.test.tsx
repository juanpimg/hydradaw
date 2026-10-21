// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useDawStore } from '../../store/useDawStore';
import { TransportBar } from '../../components/Transport/TransportBar';
import { Timeline } from '../../components/Timeline/Timeline';
import { TrackHeader } from '../../components/Timeline/TrackHeader';
import { ChannelStrip } from '../../components/Mixer/ChannelStrip';

function seedBase() {
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
    selectedClipId: null,
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
  });
}

beforeEach(() => {
  seedBase();
});

afterEach(() => {
  cleanup();
});

describe('Nombres accesibles en controles de icono (UI-05)', () => {
  it('A1: transporte expone Detener / Reproducir / Grabar / Activar bucle / Metrónomo / Silenciar master', () => {
    render(<TransportBar />);
    expect(screen.getByRole('button', { name: 'Detener' })).toHaveAttribute('aria-label', 'Detener');
    expect(screen.getByRole('button', { name: 'Reproducir' })).toHaveAttribute('aria-label', 'Reproducir');
    expect(screen.getByRole('button', { name: 'Grabar' })).toHaveAttribute('aria-label', 'Grabar');
    expect(screen.getByRole('button', { name: 'Activar bucle' })).toHaveAttribute('aria-label', 'Activar bucle');
    expect(screen.getByRole('button', { name: 'Metrónomo' })).toHaveAttribute('aria-label', 'Metrónomo');
    expect(screen.getByRole('button', { name: 'Silenciar master' })).toHaveAttribute('aria-label', 'Silenciar master');
  });

  it('A2: en reproducción el botón es Pausar', () => {
    useDawStore.setState({ isPlaying: true });
    render(<TransportBar />);
    expect(screen.getByRole('button', { name: 'Pausar' })).toHaveAttribute('aria-label', 'Pausar');
  });

  it('A3: timeline expone Acercar zoom / Alejar zoom / Cortar clip', () => {
    render(<Timeline />);
    expect(screen.getByRole('button', { name: 'Alejar zoom' })).toHaveAttribute('aria-label', 'Alejar zoom');
    expect(screen.getByRole('button', { name: 'Acercar zoom' })).toHaveAttribute('aria-label', 'Acercar zoom');
    expect(screen.getByRole('button', { name: 'Cortar clip' })).toHaveAttribute('aria-label', 'Cortar clip');
  });

  it('A4: cabecera expone Eliminar pista {nombre}', () => {
    const track = useDawStore.getState().tracks[0]!;
    render(<TrackHeader track={track} isSelected={false} />);
    expect(
      screen.getByRole('button', { name: 'Eliminar pista Voz' }),
    ).toHaveAttribute('aria-label', 'Eliminar pista Voz');
  });

  it('A5: mixer expone Añadir efecto', () => {
    const track = useDawStore.getState().tracks[0]!;
    render(<ChannelStrip track={track} levels={{ rms: 0, peak: 0 }} />);
    expect(screen.getByRole('button', { name: 'Añadir efecto' })).toHaveAttribute('aria-label', 'Añadir efecto');
  });
});
