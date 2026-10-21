// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useDawStore } from '../../store/useDawStore';
import { ExportModal } from '../../components/Export/ExportModal';
import { PluginRackModal } from '../../components/Plugins/PluginRackModal';

function seedExport() {
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
    clips: [],
    pluginModalTrackId: null,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

function seedRack() {
  useDawStore.setState({
    exportModalOpen: false,
    pluginModalTrackId: 't1',
    pluginModalInstanceId: null,
    tracks: [
      {
        id: 't1', name: 'Voz', type: 'vocal' as const, color: '#a855f7',
        volume: 1, pan: 0, mute: false, solo: false, armed: false, plugins: [],
      },
    ],
    clips: [],
  });
}

beforeEach(() => {
  seedExport();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useDawStore.setState({ exportModalOpen: false, pluginModalTrackId: null });
});

describe('Trampa de foco en los modales (UI-11)', () => {
  it('F1: Tab en el último foco del export vuelve al primero', () => {
    render(
      <>
        <div>
          <button>Fondo</button>
        </div>
        <ExportModal />
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Exportar mezcla' });
    const focusables = dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('F2: Shift+Tab en el primer foco del export va al último', () => {
    render(
      <>
        <div>
          <button>Fondo</button>
        </div>
        <ExportModal />
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Exportar mezcla' });
    const focusables = dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('F3: el fondo queda inerte y oculto mientras el export está abierto', () => {
    render(
      <div data-testid="app">
        <div data-testid="fondo">
          <button>Fondo</button>
        </div>
        <ExportModal />
      </div>,
    );
    const fondo = screen.getByTestId('fondo');
    expect(fondo).toHaveAttribute('inert');
    expect(fondo).toHaveAttribute('aria-hidden', 'true');
  });

  it('F4: el rack de plugins también atrapa el Tab y marca el fondo inerte', () => {
    seedRack();
    render(
      <div data-testid="app">
        <div data-testid="fondo">
          <button>Fondo</button>
        </div>
        <PluginRackModal />
      </div>,
    );
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    expect(screen.getByTestId('fondo')).toHaveAttribute('inert');
    expect(screen.getByTestId('fondo')).toHaveAttribute('aria-hidden', 'true');
  });
});
