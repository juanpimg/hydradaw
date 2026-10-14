import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDawStore } from '../store/useDawStore';
import { AudioEngine } from '../audio/AudioEngine';
import {
  runHandleContinue,
  runHandleBlank,
  runHandlePickFile,
  type BootBusy,
} from '../App';

describe('M1 Audio Boot Resilience & Startup Error Handling', () => {
  let originalAudioContext: unknown;
  let originalWindow: unknown;
  let originalRaf: unknown;
  let originalCaf: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    originalWindow = (globalThis as unknown as { window?: unknown }).window;
    originalRaf = (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    originalCaf = (globalThis as unknown as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;

    // Polyfill animation frames for Node test environment
    (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = vi.fn(
      (cb: FrameRequestCallback) => setTimeout(cb, 16)
    );
    (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = vi.fn(
      (id: number) => clearTimeout(id)
    );

    // Reset DAW store to known state
    useDawStore.setState({
      projectName: 'Proyecto Inicial',
      bpm: 120,
      duration: 16,
      tracks: [],
      clips: [],
      toasts: [],
      selectedTrackId: null,
      selectedClipId: null,
      currentTime: 0,
      isPlaying: false,
      isRecording: false,
    });
  });

  afterEach(() => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = originalRaf;
    (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = originalCaf;
    AudioEngine.getInstance().dispose();
  });

  // =========================================================================
  // Grupo 1: AudioEngine Context Fallbacks & Resume Policies (F2)
  // =========================================================================
  describe('Grupo 1: AudioEngine Fallback de Sample Rate y Resume Autoplay', () => {
    it('debe recurrir a la tasa nativa del dispositivo cuando 44.1kHz lanza NotSupportedError', async () => {
      const optionCalls: AudioContextOptions[] = [];

      class MockHardwareContext {
        sampleRate = 48000;
        state: AudioContextState = 'running';
        createGain = () => ({ connect: vi.fn(), gain: { value: 1, setTargetAtTime: vi.fn() } });
        createDynamicsCompressor = () => ({
          connect: vi.fn(),
          threshold: { value: 0 },
          knee: { value: 0 },
          ratio: { value: 0 },
          attack: { value: 0 },
          release: { value: 0 },
        });
        createAnalyser = () => ({ fftSize: 256, connect: vi.fn(), getFloatTimeDomainData: vi.fn() });
        resume = vi.fn().mockResolvedValue(undefined);
        close = vi.fn().mockResolvedValue(undefined);
      }

      const MockAudioContext = vi.fn().mockImplementation((opts?: AudioContextOptions) => {
        optionCalls.push(opts || {});
        if (opts?.sampleRate === 44100) {
          throw new DOMException('The operation is not supported by audio hardware', 'NotSupportedError');
        }
        return new MockHardwareContext();
      });

      (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;

      const engine = AudioEngine.getInstance();
      const ctx = await engine.ensureContext();

      expect(ctx).toBeDefined();
      expect(MockAudioContext).toHaveBeenCalledTimes(2);
      expect(optionCalls[0]).toEqual({ latencyHint: 'interactive', sampleRate: 44100 });
      expect(optionCalls[1]).toEqual({ latencyHint: 'interactive' });
      expect(ctx.sampleRate).toBe(48000);
    });

    it('debe recurrir al constructor por defecto sin opciones si latencyHint falla', async () => {
      const optionCalls: (AudioContextOptions | undefined)[] = [];

      class MockBasicContext {
        sampleRate = 44100;
        state: AudioContextState = 'running';
        createGain = () => ({ connect: vi.fn(), gain: { value: 1, setTargetAtTime: vi.fn() } });
        createDynamicsCompressor = () => ({
          connect: vi.fn(),
          threshold: { value: 0 },
          knee: { value: 0 },
          ratio: { value: 0 },
          attack: { value: 0 },
          release: { value: 0 },
        });
        createAnalyser = () => ({ fftSize: 256, connect: vi.fn(), getFloatTimeDomainData: vi.fn() });
        resume = vi.fn().mockResolvedValue(undefined);
        close = vi.fn().mockResolvedValue(undefined);
      }

      const MockAudioContext = vi.fn().mockImplementation((opts?: AudioContextOptions) => {
        optionCalls.push(opts);
        if (opts && Object.keys(opts).length > 0) {
          throw new DOMException('Options rejected by legacy browser', 'NotSupportedError');
        }
        return new MockBasicContext();
      });

      (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;

      const engine = AudioEngine.getInstance();
      const ctx = await engine.ensureContext();

      expect(ctx).toBeDefined();
      expect(MockAudioContext).toHaveBeenCalledTimes(3);
      expect(optionCalls[2]).toBeUndefined();
    });

    it('no debe abortar la inicialización si context.resume() es rechazado por políticas de autoplay', async () => {
      class MockSuspendedContext {
        sampleRate = 44100;
        state: AudioContextState = 'suspended';
        createGain = () => ({ connect: vi.fn(), gain: { value: 1, setTargetAtTime: vi.fn() } });
        createDynamicsCompressor = () => ({
          connect: vi.fn(),
          threshold: { value: 0 },
          knee: { value: 0 },
          ratio: { value: 0 },
          attack: { value: 0 },
          release: { value: 0 },
        });
        createAnalyser = () => ({ fftSize: 256, connect: vi.fn(), getFloatTimeDomainData: vi.fn() });
        resume = vi.fn().mockRejectedValue(new DOMException('Autoplay blocked: user gesture required', 'NotAllowedError'));
        close = vi.fn().mockResolvedValue(undefined);
      }

      (globalThis as unknown as { AudioContext: unknown }).AudioContext = vi.fn().mockImplementation(
        () => new MockSuspendedContext()
      );

      const engine = AudioEngine.getInstance();
      const ctx = await engine.ensureContext();

      expect(ctx).toBeDefined();
      expect(ctx.state).toBe('suspended');
    });

    it('syncTracks(), play() y stop() degradan de forma segura si AudioContext falla totalmente', async () => {
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = vi.fn().mockImplementation(() => {
        throw new Error('Web Audio hardware subsystem unavailable');
      });

      const engine = AudioEngine.getInstance();
      await expect(engine.syncTracks([])).resolves.not.toThrow();
      await expect(engine.play([], [], 0)).resolves.not.toThrow();
      expect(engine.stop()).toBe(0);
    });
  });

  // =========================================================================
  // Grupo 2: useDawStore Safe Project Boot (F3)
  // =========================================================================
  describe('Grupo 2: useDawStore Inicialización Segura de Demo y Blanco', () => {
    it('loadDemoProject inicializa 4 pistas y 4 clips con buffers nulos si ensureContext falla', async () => {
      const engine = AudioEngine.getInstance();
      vi.spyOn(engine, 'ensureContext').mockRejectedValueOnce(
        new Error('AudioContext initialization failed: NotSupportedError')
      );
      vi.spyOn(engine, 'syncTracks').mockRejectedValueOnce(
        new Error('syncTracks failed in silent mode')
      );

      await expect(useDawStore.getState().loadDemoProject()).resolves.not.toThrow();

      const state = useDawStore.getState();
      expect(state.tracks).toHaveLength(4);
      expect(state.clips).toHaveLength(4);
      expect(state.projectName).toBe('Proyecto Demo — Hydra Groove');
      expect(state.bpm).toBe(120);
      expect(state.duration).toBe(20);

      // Todos los clips deben degradar con audioBuffer nulo y picos vacíos (sin TypeError)
      state.clips.forEach((clip) => {
        expect(clip.audioBuffer).toBeNull();
        expect(clip.peaks.length).toBe(0);
      });

      // Debe haber emitido toast informativo
      expect(state.toasts.some((t) => t.message.includes('modo silencioso'))).toBe(true);
    });

    it('createBlankProject resetea el lienzo a blanco incluso si syncTracks arroja error', async () => {
      const engine = AudioEngine.getInstance();
      vi.spyOn(engine, 'syncTracks').mockRejectedValueOnce(new Error('Hardware context detached'));

      useDawStore.setState({
        tracks: [
          {
            id: 't1',
            name: 'Vieja',
            type: 'audio',
            color: '#3b82f6',
            volume: 1,
            pan: 0,
            mute: false,
            solo: false,
            armed: false,
            plugins: [],
          },
        ],
        clips: [
          {
            id: 'c1',
            trackId: 't1',
            name: 'Viejo',
            startTime: 0,
            duration: 4,
            offset: 0,
            audioBuffer: null,
            peaks: new Float32Array(0),
          },
        ],
        projectName: 'Viejo Proyecto',
        bpm: 140,
        duration: 32,
      });

      await expect(useDawStore.getState().createBlankProject()).resolves.not.toThrow();

      const state = useDawStore.getState();
      expect(state.tracks).toHaveLength(0);
      expect(state.clips).toHaveLength(0);
      expect(state.projectName).toBe('Proyecto sin título');
      expect(state.bpm).toBe(120);
      expect(state.duration).toBe(16);
      expect(state.selectedTrackId).toBeNull();
    });
  });

  // =========================================================================
  // Grupo 3: Flujo de Arranque en App.tsx (F1)
  // =========================================================================
  describe('Grupo 3: Garantía de busy: null y Toasts en App.tsx', () => {
    it('runHandleContinue: resetea busy a null en finally y llama finishBoot tras fallo de audio', async () => {
      const busyStates: BootBusy[] = [];
      let booted = false;
      const pushedToasts: string[] = [];

      const setBusy = (b: BootBusy) => busyStates.push(b);
      const finishBoot = () => {
        booted = true;
      };
      const pushToast = (msg: string) => pushedToasts.push(msg);

      const failingLoadDemo = async () => {
        throw new Error('Fatal audio context error');
      };

      await runHandleContinue({
        savedName: null,
        setBusy,
        finishBoot,
        loadSavedProject: async () => false,
        loadDemoProject: failingLoadDemo,
        pushToast,
      });

      expect(busyStates[0]).toBe('continue');
      expect(busyStates[busyStates.length - 1]).toBeNull();
      expect(booted).toBe(true);
      expect(
        pushedToasts.some((t) =>
          t.includes('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.')
        )
      ).toBe(true);
    });

    it('runHandleContinue: si loadSavedProject devuelve false, avisa y recurre a demo', async () => {
      let booted = false;
      let demoLoaded = false;
      const busyStates: BootBusy[] = [];
      const toasts: string[] = [];

      await runHandleContinue({
        savedName: 'Proyecto Inaccesible',
        setBusy: (b) => busyStates.push(b),
        finishBoot: () => {
          booted = true;
        },
        loadSavedProject: async () => false,
        loadDemoProject: async () => {
          demoLoaded = true;
        },
        pushToast: (msg) => toasts.push(msg),
      });

      expect(demoLoaded).toBe(true);
      expect(booted).toBe(true);
      expect(busyStates[busyStates.length - 1]).toBeNull();
      expect(toasts).toContain('No se pudo abrir el proyecto guardado; se carga la demo.');
    });

    it('runHandleBlank: garantiza setBusy(null) en finally ante cualquier error y descongela la UI', async () => {
      const busyStates: BootBusy[] = [];
      let booted = false;
      const toasts: string[] = [];

      await runHandleBlank({
        setBusy: (b) => busyStates.push(b),
        finishBoot: () => {
          booted = true;
        },
        createBlankProject: async () => {
          throw new Error('Blank creation hardware rejection');
        },
        pushToast: (msg) => toasts.push(msg),
      });

      expect(busyStates[0]).toBe('blank');
      expect(busyStates[busyStates.length - 1]).toBeNull();
      expect(booted).toBe(true);
      expect(
        toasts.some((t) =>
          t.includes('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.')
        )
      ).toBe(true);
    });

    it('runHandlePickFile: archivo JSON inválido emite toast de lectura y limpia busy sin arrancar', async () => {
      const busyStates: BootBusy[] = [];
      let booted = false;
      const toasts: string[] = [];

      const mockFile = {
        name: 'corrupto.json',
        text: async () => '{ esto no es json válido',
      } as unknown as File;

      await runHandlePickFile({
        file: mockFile,
        setBusy: (b) => busyStates.push(b),
        finishBoot: () => {
          booted = true;
        },
        importProjectFromJson: async () => ({ ok: false }),
        pushToast: (msg) => toasts.push(msg),
      });

      expect(busyStates[0]).toBe('import');
      expect(busyStates[busyStates.length - 1]).toBeNull();
      expect(booted).toBe(false);
      expect(toasts).toContain('No se pudo leer el archivo.');
    });

    it('runHandlePickFile: archivo con formato HydraDAW no válido emite toast y limpia busy', async () => {
      const busyStates: BootBusy[] = [];
      let booted = false;
      const toasts: string[] = [];

      const mockFile = {
        name: 'otro.json',
        text: async () => JSON.stringify({ notADawProject: true }),
      } as unknown as File;

      await runHandlePickFile({
        file: mockFile,
        setBusy: (b) => busyStates.push(b),
        finishBoot: () => {
          booted = true;
        },
        importProjectFromJson: async () => ({ ok: false }),
        pushToast: (msg) => toasts.push(msg),
      });

      expect(busyStates[0]).toBe('import');
      expect(busyStates[busyStates.length - 1]).toBeNull();
      expect(booted).toBe(false);
      expect(toasts).toContain('El archivo no es un proyecto HydraDAW válido.');
    });

    it('runHandlePickFile: importación válida completa arranque y limpia busy', async () => {
      const busyStates: BootBusy[] = [];
      let booted = false;
      const toasts: string[] = [];

      const mockFile = {
        name: 'proyecto.json',
        text: async () => JSON.stringify({ version: 1 }),
      } as unknown as File;

      await runHandlePickFile({
        file: mockFile,
        setBusy: (b) => busyStates.push(b),
        finishBoot: () => {
          booted = true;
        },
        importProjectFromJson: async () => ({ ok: true, name: 'Mi Hit' }),
        pushToast: (msg) => toasts.push(msg),
      });

      expect(busyStates[0]).toBe('import');
      expect(busyStates[busyStates.length - 1]).toBeNull();
      expect(booted).toBe(true);
      expect(toasts.some((t) => t.includes('«Mi Hit» importado'))).toBe(true);
    });

    it('runHandlePickFile: fallo inesperado de audio captura error, notifica y entra en modo seguro', async () => {
      const busyStates: BootBusy[] = [];
      let booted = false;
      const toasts: string[] = [];

      const mockFile = {
        name: 'proyecto.json',
        text: async () => JSON.stringify({ version: 1 }),
      } as unknown as File;

      await runHandlePickFile({
        file: mockFile,
        setBusy: (b) => busyStates.push(b),
        finishBoot: () => {
          booted = true;
        },
        importProjectFromJson: async () => {
          throw new Error('Fatal audio driver panic');
        },
        pushToast: (msg) => toasts.push(msg),
      });

      expect(busyStates[0]).toBe('import');
      expect(busyStates[busyStates.length - 1]).toBeNull();
      expect(booted).toBe(true);
      expect(
        toasts.some((t) =>
          t.includes('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.')
        )
      ).toBe(true);
    });
  });

  // =========================================================================
  // Grupo 4: Integración Completa End-to-End
  // =========================================================================
  describe('Grupo 4: Integración Completa de Arranque en Modo Degradado', () => {
    it('flujo completo de arranque ante Web Audio destruido entra a la DAW con toast y proyecto visible', async () => {
      (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;

      const engine = AudioEngine.getInstance();
      vi.spyOn(engine, 'ensureContext').mockRejectedValue(new Error('No AudioContext'));
      vi.spyOn(engine, 'syncTracks').mockRejectedValue(new Error('No AudioContext'));

      const busyStates: BootBusy[] = [];
      let booted = false;

      await runHandleContinue({
        savedName: null,
        setBusy: (b) => busyStates.push(b),
        finishBoot: () => {
          booted = true;
        },
        loadSavedProject: async () => false,
        loadDemoProject: () => useDawStore.getState().loadDemoProject(),
        pushToast: (msg) => useDawStore.getState().pushToast(msg),
      });

      expect(booted).toBe(true);
      expect(busyStates[busyStates.length - 1]).toBeNull();
      expect(useDawStore.getState().tracks).toHaveLength(4);
      expect(useDawStore.getState().toasts.length).toBeGreaterThan(0);
    });
  });
});
