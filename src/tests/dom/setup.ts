import '@testing-library/jest-dom/vitest';
import { ensureMockAudioContext } from './audioContextStub';

declare global {
  var __canvasOps: string[] | undefined;
  var __hydraDomSetup: boolean | undefined;
}

// Módulo con efecto colateral, sin exports públicos. Se carga vía
// `test.setupFiles` de `vite.config.ts`, por tanto se ejecuta también en los
// tests con entorno node: instala los stubs SOLO si hay DOM, de modo que la
// capa node no se ve afectada. Idempotente.
if (typeof document !== 'undefined' && !globalThis.__hydraDomSetup) {
  globalThis.__hydraDomSetup = true;
  globalThis.__canvasOps ??= [];
  const canvasOps: string[] = globalThis.__canvasOps;

  const record = (op: string): void => {
    canvasOps.push(op);
  };

  // Stub 2D no-op con todos los métodos usados por `WaveformCanvas`.
  // Registra las llamadas en `globalThis.__canvasOps` para poder afirmar que se dibuja.
  const ctx2dStub = {
    canvas: null,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    fillRect: (..._args: number[]): void => {
      record('fillRect');
    },
    clearRect: (..._args: number[]): void => {
      record('clearRect');
    },
    fillText: (..._args: unknown[]): void => {
      record('fillText');
    },
    beginPath: (): void => {
      record('beginPath');
    },
    moveTo: (..._args: number[]): void => {
      record('moveTo');
    },
    lineTo: (..._args: number[]): void => {
      record('lineTo');
    },
    closePath: (): void => {
      record('closePath');
    },
    fill: (..._args: unknown[]): void => {
      record('fill');
    },
    stroke: (..._args: unknown[]): void => {
      record('stroke');
    },
    createLinearGradient: (..._args: number[]): { addColorStop: (..._stop: unknown[]) => void } => {
      record('createLinearGradient');
      return {
        addColorStop: (..._stop: unknown[]): void => {
          record('addColorStop');
        },
      };
    },
    scale: (..._args: number[]): void => {
      record('scale');
    },
    save: (): void => {
      record('save');
    },
    restore: (): void => {
      record('restore');
    },
  };

  HTMLCanvasElement.prototype.getContext = function () {
    return ctx2dStub;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;

  interface StubPointerEventInit extends MouseEventInit {
    pointerId?: number;
    pointerType?: string;
    isPrimary?: boolean;
    width?: number;
    height?: number;
    pressure?: number;
  }

  class StubPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    readonly width: number;
    readonly height: number;
    readonly pressure: number;

    constructor(type: string, init: StubPointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0;
    }
  }

  (globalThis as unknown as { PointerEvent: typeof StubPointerEvent }).PointerEvent =
    StubPointerEvent;

  ensureMockAudioContext();

  if (typeof globalThis.matchMedia === 'undefined') {
    const stubMatchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: (): void => {},
        removeListener: (): void => {},
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
        dispatchEvent: (): boolean => false,
      }) as unknown as MediaQueryList;
    (globalThis as unknown as { matchMedia: typeof stubMatchMedia }).matchMedia =
      stubMatchMedia;
  }

  if (typeof globalThis.ResizeObserver === 'undefined') {
    class StubResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver =
      StubResizeObserver;
  }
}
