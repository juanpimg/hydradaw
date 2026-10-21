// @vitest-environment jsdom
// M4: la carga de plugins locales tiene tope (lo que el host persiste).
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { useDawStore } from '../../store/useDawStore';
import { PluginRackModal } from '../../components/Plugins/PluginRackModal';
import { MAX_CUSTOM_PLUGIN_CODE_BYTES } from '../../audio/PluginHost';

function openEditor() {
  useDawStore.setState({
    pluginModalTrackId: 't1',
    tracks: [
      {
        id: 't1', name: 'Voz', type: 'vocal' as const, color: '#a855f7',
        volume: 1, pan: 0, mute: false, solo: false, armed: false,
        plugins: [],
      },
    ],
    toasts: [],
  });
  const utils = render(<PluginRackModal />);
  fireEvent.click(screen.getByText('Editor de Código VST'));
  const textarea = utils.container.querySelector('textarea') as HTMLTextAreaElement;
  const fileInput = utils.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { ...utils, textarea, fileInput };
}

beforeEach(() => {
  useDawStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  useDawStore.setState({ pluginModalTrackId: null, toasts: [] });
});

describe('M4: presupuesto de carga de plugins locales', () => {
  it('un .js por encima del tope se rechaza con toast y no toca el editor', async () => {
    const { textarea, fileInput } = openEditor();
    const before = textarea.value;
    expect(before.length).toBeGreaterThan(0);
    const big = new File(['x'.repeat(MAX_CUSTOM_PLUGIN_CODE_BYTES + 1024)], 'grande.js', {
      type: 'text/javascript',
    });
    fireEvent.change(fileInput, { target: { files: [big] } });
    // Los toasts los pinta <Toaster/> (no montado aquí): se afirma el estado.
    await vi.waitFor(() => {
      expect(
        useDawStore.getState().toasts.some((t) => t.message.includes('demasiado grande')),
      ).toBe(true);
    });
    expect(textarea.value).toBe(before);
  });

  it('un .js dentro del tope se carga en el editor con normalidad', async () => {
    const { textarea, fileInput } = openEditor();
    const small = new File(['const customPlugin = {};'], 'mini.js', { type: 'text/javascript' });
    fireEvent.change(fileInput, { target: { files: [small] } });
    await screen.findByDisplayValue('const customPlugin = {};');
    expect(textarea.value).toBe('const customPlugin = {};');
  });
});
