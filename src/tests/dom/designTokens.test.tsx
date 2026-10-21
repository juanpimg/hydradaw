// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { useDawStore } from '../../store/useDawStore';
import { audioEngine } from '../../audio/AudioEngine';
import { WaveformCanvas } from '../../components/Timeline/WaveformCanvas';
import { TransportBar } from '../../components/Transport/TransportBar';
import { ChannelStrip } from '../../components/Mixer/ChannelStrip';
import { Knob } from '../../components/Plugins/Knob';
import { TrackHeader } from '../../components/Timeline/TrackHeader';
import { VUMeter } from '../../components/Mixer/VUMeter';
import { ExportModal } from '../../components/Export/ExportModal';
import { StartScreen } from '../../components/Start/StartScreen';

function seed() {
  useDawStore.setState({
    tracks: [
      {
        id: 't1', name: 'Voz', type: 'vocal' as const, color: '#a855f7',
        volume: 0.5, pan: 0, mute: false, solo: false, armed: true, plugins: [],
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
    isPlaying: true,
    isRecording: true,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    metronome: false,
    masterVolume: 0.5,
    masterMute: false,
    currentTime: 0,
  });
}

beforeEach(() => {
  seed();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useDawStore.setState({ exportModalOpen: false });
});

const tokens = (el: Element): string[] => (el as HTMLElement).className.split(/\s+/);

describe('Fidelidad al sistema de diseño (UI-13, UI-14)', () => {
  it('D1: los clips usan esquinas de 3px, no rounded-lg', () => {
    render(
      <WaveformCanvas
        clip={{
          id: 'c1', trackId: 't1', name: 'Toma', startTime: 0, duration: 4,
          offset: 0, audioBuffer: null, peaks: new Float32Array([0, 0.5]),
          color: '#a855f7',
        }}
        width={200}
        height={88}
        isSelected={false}
      />,
    );
    const clip = screen.getByRole('option', { name: /Clip Toma/ });
    expect(tokens(clip)).toContain('rounded-[3px]');
    expect(tokens(clip)).not.toContain('rounded-lg');
  });

  it('D2: tiempos, dB, knobs y BPM llevan tabular-nums', () => {
    const { container } = render(<TransportBar />);
    // Timecode de transporte.
    const timecode = container.querySelector('div.font-mono.text-sm') as HTMLElement;
    expect(timecode).not.toBeNull();
    expect(tokens(timecode)).toContain('tabular-nums');
    // BPM.
    expect(tokens(screen.getByLabelText('Tempo en BPM'))).toContain('tabular-nums');
    cleanup();

    const track = useDawStore.getState().tracks[0]!;
    render(<ChannelStrip track={track} levels={{ rms: 0, peak: 0 }} />);
    expect(tokens(screen.getByRole('button', { name: /restablecer a 0 dB/i }))).toContain('tabular-nums');
    cleanup();

    render(
      <Knob label="Cutoff" value={2500} min={100} max={12000} step={50} defaultValue={2500} unit="Hz" onChange={() => {}} />,
    );
    expect(tokens(screen.getByRole('button', { name: /editar cutoff/i }))).toContain('tabular-nums');
  });

  it('D3: las animaciones infinitas llevan prefijo motion-safe:', () => {
    render(<TransportBar />);
    expect(tokens(screen.getByRole('button', { name: 'Grabar' }))).toContain('motion-safe:animate-pulse');
    expect(tokens(screen.getByRole('button', { name: 'Grabar' }))).not.toContain('animate-pulse');
    cleanup();

    const track = useDawStore.getState().tracks[0]!;
    render(<TrackHeader track={track} isSelected={false} />);
    const rec = screen.getByRole('button', { name: `Armar pista ${track.name} para grabación` });
    expect(tokens(rec)).toContain('motion-safe:animate-pulse');
    expect(tokens(rec)).not.toContain('animate-pulse');
    cleanup();

    render(<ChannelStrip track={track} levels={{ rms: 0, peak: 0 }} />);
    const armed = screen.getAllByTitle('Armar para grabación')[0] as HTMLElement;
    expect(tokens(armed)).toContain('motion-safe:animate-pulse');
    expect(tokens(armed)).not.toContain('animate-pulse');
    cleanup();

    render(<VUMeter peak={1} rms={0.9} />);
    const led = document.querySelector('[title="Clip Warning (>= 0 dBFS)"]') as HTMLElement;
    expect(tokens(led)).toContain('motion-safe:animate-ping');
    expect(tokens(led)).not.toContain('animate-ping');
  });

  it('D4: index.css incluye la guarda prefers-reduced-motion', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('D5: los spinners de carga también llevan motion-safe:', () => {
    render(
      <StartScreen
        savedName={null}
        lookingUp
        busy={null}
        onContinue={() => {}}
        onBlank={() => {}}
        onPickFile={() => {}}
      />,
    );
    const busy = Array.from(document.querySelectorAll('svg')).filter((el) =>
      (el as SVGElement).className.baseVal.split(/\s+/).some((t: string) => t.includes('animate-spin')),
    );
    expect(busy.length).toBeGreaterThan(0);
    busy.forEach((el) => {
      const toks = (el as SVGElement).className.baseVal.split(/\s+/);
      expect(toks).toContain('motion-safe:animate-spin');
    });
    cleanup();

    // ExportModal: el render offline no resuelve nunca ⇒ el spinner se queda.
    useDawStore.setState({
      exportModalOpen: true,
      projectName: 'Test',
      masterVolume: 1,
      masterMute: false,
      tracks: [
        {
          id: 't1', name: 'Voz', type: 'vocal' as const, color: '#a855f7',
          volume: 1, pan: 0, mute: false, solo: false, armed: false, plugins: [],
        },
      ],
      clips: [
        {
          id: 'c1', trackId: 't1', name: 'C1', startTime: 0, duration: 1,
          offset: 0, audioBuffer: null, peaks: new Float32Array(0),
        },
      ],
    });
    vi.spyOn(audioEngine, 'renderOfflineMixdown').mockImplementation(
      () => new Promise(() => {}) as unknown as Promise<AudioBuffer>,
    );
    const { container } = render(<ExportModal />);
    fireEvent.click(screen.getByText('Exportar Mezcla Completa'));
    const spins = Array.from(container.querySelectorAll('svg')).filter((el) =>
      (el as unknown as SVGElement).className.baseVal
        .split(/\s+/)
        .some((t: string) => t.includes('animate-spin')),
    );
    expect(spins.length).toBeGreaterThan(0);
    spins.forEach((el) => {
      const toks = (el as unknown as SVGElement).className.baseVal.split(/\s+/);
      expect(toks).toContain('motion-safe:animate-spin');
    });
  });
});
