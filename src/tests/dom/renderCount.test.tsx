// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import React, { Profiler } from 'react';
import { useDawStore } from '../../store/useDawStore';
import { audioEngine } from '../../audio/AudioEngine';
import { MixerConsole } from '../../components/Mixer/MixerConsole';

const TARGETS = [
  'src/components/Mixer/MixerConsole.tsx',
  'src/components/Timeline/TrackHeader.tsx',
  'src/components/Plugins/PluginRackModal.tsx',
  'src/components/Export/ExportModal.tsx',
];

function readSource(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

beforeEach(() => {
  useDawStore.setState({
    tracks: [],
    clips: [],
    toasts: [],
    selectedClipIds: [],
    selectedTrackId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Selectores granulares en Zustand (UI-06)', () => {
  it('R1: ningún componente se suscribe al store completo', () => {
    const offenders = TARGETS.filter((f) => /useDawStore\(\s*\)/.test(readSource(f)));
    expect(offenders).toEqual([]);
  });

  it('R2: un cambio no relacionado (toast) no re-renderiza un hijo con selector granular', () => {
    const renders = { current: 0 };
    const Probe: React.FC<{ holder: { current: number } }> = ({ holder }) => {
      const tracks = useDawStore((s) => s.tracks);
      holder.current += 1;
      return <div data-testid="probe">{tracks.length}</div>;
    };
    render(<Probe holder={renders} />);
    expect(renders.current).toBe(1);
    act(() => {
      useDawStore.getState().pushToast('aviso no relacionado');
    });
    expect(renders.current).toBe(1);
  });

  it('R3: los ficheros usan useShallow cuando seleccionan varios campos', () => {
    const withMulti = TARGETS.filter((f) => /useShallow/.test(readSource(f)));
    // Al menos los tres con múltiples campos deben usarlo.
    expect(withMulti.length).toBeGreaterThanOrEqual(3);
  });

  it('R4: MixerConsole (producto real) no se re-renderiza ante un toast', () => {
    // Evidencia conductual de UI-06 sobre el componente real: con la
    // suscripción al store completo, el toast re-renderiza el mixer (falla);
    // con selectores granulares, no hay ningún commit nuevo (pasa).
    useDawStore.setState({
      tracks: [
        {
          id: 't1', name: 'Voz', type: 'vocal' as const, color: '#a855f7',
          volume: 1, pan: 0, mute: false, solo: false, armed: false, plugins: [],
        },
      ],
      masterVolume: 1,
      masterMute: false,
    });
    // Los meters del engine no emiten en jsdom: se fija el unsub para que
    // ningún tick real contamine el conteo de commits.
    vi.spyOn(audioEngine, 'onMeterUpdate').mockReturnValue(() => {});
    const onRender = vi.fn();
    render(
      <Profiler id="mixer" onRender={onRender}>
        <MixerConsole />
      </Profiler>,
    );
    const mounted = onRender.mock.calls.length;
    expect(mounted).toBeGreaterThan(0);
    act(() => {
      useDawStore.getState().pushToast('aviso no relacionado');
    });
    expect(onRender.mock.calls.length).toBe(mounted);
  });
});
