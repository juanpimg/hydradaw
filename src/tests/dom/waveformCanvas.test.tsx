// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useDawStore } from '../../store/useDawStore';
import { WaveformCanvas } from '../../components/Timeline/WaveformCanvas';

const CLIP_WIDTH = 200; // duration 4 s × zoom 50 px/s
const CLIP_LEFT = 100;

function baseClip() {
  return {
    id: 'c1',
    trackId: 't1',
    name: 'Prueba',
    startTime: 2,
    duration: 4,
    offset: 0,
    audioBuffer: null,
    peaks: new Float32Array([0, 0.5, -0.5, 0.5]),
    color: '#06b6d4',
  };
}

function renderClip() {
  const utils = render(
    <WaveformCanvas clip={baseClip()} width={CLIP_WIDTH} height={88} isSelected={false} />,
  );
  const el = utils.getByRole('option') as HTMLElement;
  // jsdom no calcula layout: el rect del clip es el que usaría el navegador.
  el.getBoundingClientRect = () =>
    ({
      left: CLIP_LEFT,
      top: 0,
      width: CLIP_WIDTH,
      height: 88,
      right: CLIP_LEFT + CLIP_WIDTH,
      bottom: 88,
      x: CLIP_LEFT,
      y: 0,
      toJSON: () => {},
    }) as DOMRect;
  // jsdom no implementa captura de puntero: se espía, no se polifillea.
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  return { ...utils, el };
}

function pointerEvent(type: string, init: PointerEventInit & { pointerId?: number; pointerType?: string }) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
}

beforeEach(() => {
  useDawStore.setState({
    tracks: [],
    clips: [baseClip()],
    zoom: 50,
    duration: 32,
    snapMode: 'off',
    selectedClipIds: [],
    selectedTrackId: null,
    isPlaying: false,
    currentTime: 0,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WaveformCanvas con Pointer Events (UI-03, F4, F5, F6)', () => {
  it('W1: pointerdown en un clip ⇒ setPointerCapture llamado con el pointerId', () => {
    const { el } = renderClip();
    el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 150 }));
    expect(el.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('W2: el clip declara touch-action: none (clase + estilo en línea)', () => {
    // jsdom (cssstyle) no implementa la propiedad `touch-action`: el estilo
    // COMPUTADO real se verifica en el navegador (B7). Aquí se afirma la
    // causa: la clase Tailwind `touch-none` y el estilo en línea, que en un
    // navegador con cascada real computan a `none`.
    const { el } = renderClip();
    expect(el.className).toContain('touch-none');
    expect(el.style.touchAction).toBe('none');
  });

  it('W3: pointermove táctil a 5 px del borde ⇒ recorta (cambia duration)', () => {
    const { el } = renderClip();
    // Borde derecho en x=300; 5 px dentro de la zona táctil (20 px).
    el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 295 }));
    el.dispatchEvent(pointerEvent('pointermove', { pointerId: 3, pointerType: 'touch', clientX: 315 }));
    el.dispatchEvent(pointerEvent('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 315 }));
    const clip = useDawStore.getState().clips.find((c) => c.id === 'c1');
    expect(clip?.duration).toBeCloseTo(4.4, 5);
  });

  it('W4: pointermove de ratón a 12 px del borde ⇒ no recorta (mueve)', () => {
    const { el } = renderClip();
    // Zona de ratón: 8 px; a 12 px del borde derecho es zona de movimiento.
    el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 288 }));
    el.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 298 }));
    el.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 298 }));
    const clip = useDawStore.getState().clips.find((c) => c.id === 'c1');
    expect(clip?.duration).toBeCloseTo(4, 5);
    expect(clip?.startTime).toBeCloseTo(2.2, 5);
  });

  it('W5: pointercancel ⇒ no se aplica ningún cambio pendiente', () => {
    const { el } = renderClip();
    el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 295 }));
    el.dispatchEvent(pointerEvent('pointermove', { pointerId: 3, pointerType: 'touch', clientX: 315 }));
    el.dispatchEvent(pointerEvent('pointercancel', { pointerId: 3, pointerType: 'touch', clientX: 315 }));
    const clip = useDawStore.getState().clips.find((c) => c.id === 'c1');
    expect(clip?.duration).toBeCloseTo(4, 5);
    expect(clip?.startTime).toBeCloseTo(2, 5);
  });

  it('W6: pointercancel a mitad de trim ⇒ se restaura el visual (ancho y transform)', () => {
    const { el } = renderClip();
    el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 295 }));
    el.dispatchEvent(pointerEvent('pointermove', { pointerId: 3, pointerType: 'touch', clientX: 315 }));
    // El trim a medio gesto escribe ancho visual (4.4 s × 50 px/s ≈ 220 px).
    expect(parseFloat(el.style.width)).toBeCloseTo(220, 5);
    el.dispatchEvent(pointerEvent('pointercancel', { pointerId: 3, pointerType: 'touch', clientX: 315 }));
    expect(el.style.transform).toBe('');
    expect(el.style.width).toBe('');
    const clip = useDawStore.getState().clips.find((c) => c.id === 'c1');
    expect(clip?.duration).toBeCloseTo(4, 5);
  });

  it('W7: un segundo puntero no puede secuestrar el arrastre', () => {
    const { el } = renderClip();
    // Dedo 1 empieza un trim-right táctil.
    el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 295 }));
    // Dedo 2 apoya en zona de movimiento e intenta mover: se ignora.
    el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 250 }));
    el.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 270 }));
    el.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 295 }));
    const clip = useDawStore.getState().clips.find((c) => c.id === 'c1');
    expect(clip?.duration).toBeCloseTo(4, 5);
    expect(clip?.startTime).toBeCloseTo(2, 5);
  });

  it('W8: el pointerup de otro puntero no mata la sesión activa', () => {
    const { el } = renderClip();
    el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 288 }));
    // Up ajeno: no compromete nada ni cierra la sesión del puntero 1.
    el.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, pointerType: 'mouse', clientX: 288 }));
    el.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 298 }));
    el.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 298 }));
    const clip = useDawStore.getState().clips.find((c) => c.id === 'c1');
    expect(clip?.duration).toBeCloseTo(4, 5);
    expect(clip?.startTime).toBeCloseTo(2.2, 5);
  });

  it('W9: desmontar a mitad de arrastre no revienta y no compromete nada', () => {
    const { el, unmount } = renderClip();
    el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 295 }));
    el.dispatchEvent(pointerEvent('pointermove', { pointerId: 3, pointerType: 'touch', clientX: 315 }));
    expect(() => unmount()).not.toThrow();
    const clip = useDawStore.getState().clips.find((c) => c.id === 'c1');
    expect(clip?.duration).toBeCloseTo(4, 5);
    expect(clip?.startTime).toBeCloseTo(2, 5);
  });
});
