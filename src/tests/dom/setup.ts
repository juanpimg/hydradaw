import { ensureMockAudioContext } from './audioContextStub';

declare global {
  var __canvasOps: Array<{ op: string; args: unknown[] }> | undefined;
  var __resetCanvasOps: (() => void) | undefined;
  var __hydraDomSetup: boolean | undefined;
}

// Módulo con efecto colateral, sin exports públicos. Se carga vía
// `test.setupFiles` de `vite.config.ts`, por tanto se ejecuta también en los
// tests con entorno node: instala los stubs SOLO si hay DOM, de modo que la
// capa node no se ve afectada. Idempotente.
if (typeof document !== 'undefined' && !globalThis.__hydraDomSetup) {
  globalThis.__hydraDomSetup = true;
  globalThis.__canvasOps ??= [];
  const canvasOps: Array<{ op: string; args: unknown[] }> = globalThis.__canvasOps;

  const record = (op: string, args: unknown[]): void => {
    canvasOps.push({ op, args });
  };

  // Vía de escape para que los tests no dependan del orden de ejecución.
  globalThis.__resetCanvasOps = (): void => {
    canvasOps.length = 0;
  };

  interface Ctx2DStub {
    canvas: HTMLCanvasElement | null;
    fillStyle: string | CanvasGradient;
    strokeStyle: string;
    lineWidth: number;
    fillRect: (...args: number[]) => void;
    clearRect: (...args: number[]) => void;
    fillText: (...args: unknown[]) => void;
    beginPath: () => void;
    moveTo: (...args: number[]) => void;
    lineTo: (...args: number[]) => void;
    closePath: () => void;
    fill: (...args: unknown[]) => void;
    stroke: (...args: unknown[]) => void;
    createLinearGradient: (...args: number[]) => { addColorStop: (...stop: unknown[]) => void };
    scale: (...args: number[]) => void;
    save: () => void;
    restore: () => void;
  }

  // Stub 2D no-op con todos los métodos usados por `WaveformCanvas`.
  // Registra las llamadas (con argumentos) en `globalThis.__canvasOps` para
  // poder afirmar qué geometría se dibuja. Cada `getContext()` devuelve un
  // objeto NUEVO (sin estado de estilo compartido); el registro es común.
  const makeCtx2dStub = (): Ctx2DStub => ({
    canvas: null,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    fillRect: (...args: number[]): void => {
      record('fillRect', args);
    },
    clearRect: (...args: number[]): void => {
      record('clearRect', args);
    },
    fillText: (...args: unknown[]): void => {
      record('fillText', args);
    },
    beginPath: (): void => {
      record('beginPath', []);
    },
    moveTo: (...args: number[]): void => {
      record('moveTo', args);
    },
    lineTo: (...args: number[]): void => {
      record('lineTo', args);
    },
    closePath: (): void => {
      record('closePath', []);
    },
    fill: (...args: unknown[]): void => {
      record('fill', args);
    },
    stroke: (...args: unknown[]): void => {
      record('stroke', args);
    },
    createLinearGradient: (...args: number[]): { addColorStop: (...stop: unknown[]) => void } => {
      record('createLinearGradient', args);
      return {
        addColorStop: (...stop: unknown[]): void => {
          record('addColorStop', stop);
        },
      };
    },
    scale: (...args: number[]): void => {
      record('scale', args);
    },
    save: (): void => {
      record('save', []);
    },
    restore: (): void => {
      record('restore', []);
    },
  });

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string) {
    // Solo el contexto '2d' existe en el arnés: un componente que pida
    // 'webgl'/'webgl2' debe recibir null, como en un navegador sin soporte.
    if (contextId !== '2d') return null;
    const ctx = makeCtx2dStub();
    ctx.canvas = this as HTMLCanvasElement;
    return ctx;
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
