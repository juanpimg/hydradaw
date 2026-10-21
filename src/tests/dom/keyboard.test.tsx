// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useDawStore } from '../../store/useDawStore';
import { TrackHeader } from '../../components/Timeline/TrackHeader';
import { Timeline } from '../../components/Timeline/Timeline';
import { ChannelStrip } from '../../components/Mixer/ChannelStrip';
import { MixerConsole } from '../../components/Mixer/MixerConsole';
import { Knob } from '../../components/Plugins/Knob';

function seed() {
  useDawStore.setState({
    tracks: [
      {
        id: 't1', name: 'Voz', type: 'vocal' as const, color: '#a855f7',
        volume: 0.5, pan: 0, mute: false, solo: false, armed: false, plugins: [],
      },
    ],
    clips: [
      {
        id: 'c1', trackId: 't1', name: 'Toma', startTime: 0, duration: 4,
        offset: 0, audioBuffer: null, peaks: new Float32Array([0, 0.5]),
        color: '#a855f7',
      },
    ],
    zoom: 50,
    duration: 16,
    bpm: 120,
    timeSignature: [4, 4] as [number, number],
    snapMode: 'off',
    selectedClipId: null,
    selectedTrackId: null,
    isPlaying: false,
    currentTime: 0,
    masterVolume: 0.5,
    masterMute: false,
  });
}

beforeEach(() => {
  seed();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Teclado en selección y valores (UI-10)', () => {
  it('K1: TrackHeader es focuseable (tabIndex 0)', () => {
    const track = useDawStore.getState().tracks[0]!;
    const { container } = render(<TrackHeader track={track} isSelected={false} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.tabIndex).toBe(0);
  });

  it('K2: Enter en el TrackHeader selecciona la pista', () => {
    const track = useDawStore.getState().tracks[0]!;
    const { container } = render(<TrackHeader track={track} isSelected={false} />);
    const root = container.firstElementChild as HTMLElement;
    root.focus();
    fireEvent.keyDown(root, { key: 'Enter' });
    expect(useDawStore.getState().selectedTrackId).toBe('t1');
  });

  it('K3: Espacio en el TrackHeader selecciona la pista', () => {
    const track = useDawStore.getState().tracks[0]!;
    const { container } = render(<TrackHeader track={track} isSelected={false} />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(root, { key: ' ' });
    expect(useDawStore.getState().selectedTrackId).toBe('t1');
  });

  it('K4: el lane de clips tiene role listbox como ancestro de las opciones', () => {
    render(<Timeline />);
    const listbox = screen.getByRole('listbox');
    const option = screen.getByRole('option', { name: /Clip Toma/ });
    expect(listbox.contains(option)).toBe(true);
  });

  it('K5: el readout dB del strip es un botón que restablece a 0 dB', () => {
    const track = useDawStore.getState().tracks[0]!;
    render(<ChannelStrip track={track} levels={{ rms: 0, peak: 0 }} />);
    const readout = screen.getByRole('button', { name: /restablecer a 0 dB/i });
    expect(readout.tagName).toBe('BUTTON');
    fireEvent.click(readout);
    expect(useDawStore.getState().tracks[0]!.volume).toBe(1);
  });

  it('K6: el readout master es un botón que restablece a 0 dB', () => {
    render(<MixerConsole />);
    const readout = screen.getByRole('button', { name: /volumen master.*restablecer a 0 dB/i });
    fireEvent.click(readout);
    expect(useDawStore.getState().masterVolume).toBe(1);
  });

  it('K7: el valor del knob es un botón que abre el editor exacto', () => {
    const onChange = vi.fn();
    render(
      <Knob label="Cutoff" value={2500} min={100} max={12000} step={50} defaultValue={2500} unit="Hz" onChange={onChange} />,
    );
    const editor = screen.getByRole('button', { name: /editar cutoff/i });
    expect(editor.tagName).toBe('BUTTON');
    fireEvent.click(editor);
    const input = screen.getByDisplayValue('2500');
    fireEvent.change(input, { target: { value: '3000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(3000);
  });
});
