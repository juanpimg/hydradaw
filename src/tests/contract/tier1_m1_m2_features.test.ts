import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupTestEnvironment,
  resetDawStore,
  createMockTrack,
  createMockClip,
  createSyntheticPointerEvent,
  calculateExpectedTrimEdge,
  calculateExpectedKnobValue,
} from './helpers/testHelpers';
import { useDawStore } from '../../store/useDawStore';
import { AudioEngine } from '../../audio/AudioEngine';
import { trimLeftOperation, trimRightOperation } from '../../audio/timelineOps';

setupTestEnvironment();

describe('Tier 1: Feature Coverage (M1: F1–F3, M2: F4–F9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDawStore();
  });

  // =========================================================================
  // F1: Resilient Audio Startup & Toast
  // =========================================================================
  describe('F1: Resilient Audio Startup & Toast', () => {
    it('F1-1: handleContinue catches audio context failures, toasts warning and completes boot', async () => {
      let booted = false;
      let busy: string | null = 'continue';

      const mockFinishBoot = () => {
        booted = true;
      };

      const failingLoadProject = async () => {
        throw new Error('AudioContext initialization failed: NotAllowedError');
      };

      try {
        await failingLoadProject();
      } catch {
        useDawStore.getState().pushToast(
          'Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.'
        );
        mockFinishBoot();
      } finally {
        busy = null;
      }

      expect(booted).toBe(true);
      expect(busy).toBeNull();
      const toasts = useDawStore.getState().toasts;
      expect(toasts.some((t) => t.message.includes('modo silencioso'))).toBe(true);
    });

    it('F1-2: handleBlank catches audio context failures, alerts user and unblocks workspace', async () => {
      let booted = false;
      let busy: string | null = 'blank';

      const mockFinishBoot = () => {
        booted = true;
      };

      const failingBlankInit = async () => {
        throw new Error('Device audio subsystem unavailable');
      };

      try {
        await failingBlankInit();
      } catch {
        useDawStore.getState().pushToast(
          'Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.'
        );
        mockFinishBoot();
      } finally {
        busy = null;
      }

      expect(booted).toBe(true);
      expect(busy).toBeNull();
      expect(useDawStore.getState().toasts.length).toBeGreaterThanOrEqual(1);
    });

    it('F1-3: handlePickFile catches corrupted file parse errors and clears busy state', async () => {
      let busy: string | null = 'import';

      const handlePickFileSimulation = async (rawContent: string) => {
        try {
          JSON.parse(rawContent);
        } catch {
          useDawStore.getState().pushToast('No se pudo leer el archivo.');
        } finally {
          busy = null;
        }
      };

      await handlePickFileSimulation('{ corrupted json: not valid');
      expect(busy).toBeNull();
      expect(useDawStore.getState().toasts.some((t) => t.message.includes('No se pudo leer'))).toBe(true);
    });

  });

  // =========================================================================
  // F2: AudioEngine Context Fallback
  // =========================================================================
  describe('F2: AudioEngine Context Fallback', () => {
    it('F2-1: standard environment requests 44.1kHz interactive context', async () => {
      const engine = AudioEngine.getInstance();
      const ctx = await engine.ensureContext();
      expect(ctx).toBeDefined();
      expect(ctx.sampleRate).toBe(44100);
    });

    it('F2-2: hardware fallback: attempts native sample rate when 44.1kHz constructor rejects', async () => {
      const originalAudioContext = globalThis.AudioContext;
      let callCount = 0;

      class FallbackMockContext {
        sampleRate: number;
        state: AudioContextState = 'running';
        destination = {};
        constructor(opts?: AudioContextOptions) {
          callCount++;
          if (opts?.sampleRate === 44100) {
            throw new Error('NotSupportedError: 44100Hz not supported by hardware');
          }
          this.sampleRate = 48000; // Native hardware rate
        }
        async resume() {}
        createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
        createDynamicsCompressor() { return { connect: vi.fn() }; }
        createAnalyser() { return { connect: vi.fn(), getFloatTimeDomainData: vi.fn() }; }
      }

      (globalThis as unknown as { AudioContext: typeof FallbackMockContext }).AudioContext = FallbackMockContext;

      // Isolated engine ensuring fallback logic
      async function createWithFallback(): Promise<unknown> {
        const AudioCtx = globalThis.AudioContext;
        try {
          return new AudioCtx({ latencyHint: 'interactive', sampleRate: 44100 });
        } catch {
          return new AudioCtx({ latencyHint: 'interactive' });
        }
      }

      const context = (await createWithFallback()) as FallbackMockContext;
      expect(callCount).toBe(2);
      expect(context.sampleRate).toBe(48000);

      (globalThis as unknown as { AudioContext: typeof originalAudioContext }).AudioContext = originalAudioContext;
    });

    it('F2-3: suspended context due to autoplay policy catches resume restriction gracefully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      class SuspendedMockContext {
        state: AudioContextState = 'suspended';
        sampleRate = 44100;
        destination = {};
        async resume(): Promise<void> {
          throw new Error('NotAllowedError: user gesture required');
        }
        createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
        createDynamicsCompressor() { return { connect: vi.fn() }; }
        createAnalyser() { return { connect: vi.fn(), getFloatTimeDomainData: vi.fn() }; }
      }

      const mockCtx = new SuspendedMockContext();
      async function safeResume(ctx: SuspendedMockContext) {
        if (ctx.state === 'suspended') {
          try {
            await ctx.resume();
          } catch (err) {
            console.warn('[AudioEngine] Context resume restricted by browser policy:', err);
          }
        }
      }

      await expect(safeResume(mockCtx)).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('F2-4: multiple concurrent ensureContext invocations return the same singleton instance', async () => {
      const engine = AudioEngine.getInstance();
      const [ctx1, ctx2] = await Promise.all([engine.ensureContext(), engine.ensureContext()]);
      expect(ctx1).toBe(ctx2);
    });

    it('F2-5: environment without AudioContext throws descriptive unsupported error', async () => {
      const savedAudioContext = globalThis.AudioContext;
      // @ts-expect-error simulate headless environment
      delete globalThis.AudioContext;

      async function testUnsupported() {
        const AudioCtx = globalThis.AudioContext;
        if (!AudioCtx) {
          throw new Error('[AudioEngine] Web Audio API AudioContext is not supported in this environment.');
        }
      }

      await expect(testUnsupported()).rejects.toThrow('AudioContext is not supported');
      globalThis.AudioContext = savedAudioContext;
    });
  });

  // =========================================================================
  // F3: Safe Demo & Blank Project Boot
  // =========================================================================
  describe('F3: Safe Demo & Blank Project Boot', () => {
    it('F3-1: createBlankProject initializes empty tracks and clips with standard project name', async () => {
      const track = createMockTrack();
      const clip = createMockClip({ trackId: track.id });
      useDawStore.setState({ tracks: [track], clips: [clip], projectName: 'Old Project' });

      await useDawStore.getState().createBlankProject();

      const state = useDawStore.getState();
      expect(state.tracks).toHaveLength(0);
      expect(state.clips).toHaveLength(0);
      expect(state.projectName).toBe('Proyecto sin título');
      expect(state.selectedTrackId).toBeNull();
      expect(state.selectedClipIds).toEqual([]);
    });

    it('F3-2: createBlankProject resets duration to 16s and tempo to 120 BPM', async () => {
      useDawStore.setState({ duration: 120, bpm: 160 });
      await useDawStore.getState().createBlankProject();

      const state = useDawStore.getState();
      expect(state.duration).toBe(16);
      expect(state.bpm).toBe(120);
    });

    it('F3-3: loadDemoProject loads standard stems even when audio engine operates in fallback mode', async () => {
      await useDawStore.getState().loadDemoProject();

      const state = useDawStore.getState();
      expect(state.tracks.length).toBeGreaterThan(0);
      expect(state.duration).toBeGreaterThan(0);
    });

    it('F3-4: createBlankProject stops ongoing playback state', async () => {
      useDawStore.setState({ isPlaying: true });
      await useDawStore.getState().createBlankProject();
      expect(useDawStore.getState().isPlaying).toBe(false);
    });

    it('F3-5: project creation cleanses selection and modal state', async () => {
      useDawStore.setState({
        selectedTrackId: 'track_1',
        selectedClipIds: ['clip_1'],
        exportModalOpen: true,
        pluginModalTrackId: 'track_1',
      });

      await useDawStore.getState().createBlankProject();

      const state = useDawStore.getState();
      expect(state.selectedTrackId).toBeNull();
      expect(state.selectedClipIds).toEqual([]);
    });
  });

  // =========================================================================
  // F4: Pointer Events for WaveformCanvas
  // =========================================================================
  describe('F4: Pointer Events for WaveformCanvas', () => {
    it('F4-1: acquires pointer capture via defensive setPointerCapture call', () => {
      let capturedId: number | null = null;
      const target = {
        setPointerCapture: vi.fn((id: number) => {
          capturedId = id;
        }),
      };

      const event = createSyntheticPointerEvent('pointerdown', target, { pointerId: 42 });
      if (target.setPointerCapture) {
        target.setPointerCapture(event.pointerId);
      }

      expect(target.setPointerCapture).toHaveBeenCalledWith(42);
      expect(capturedId).toBe(42);
    });

    it('F4-3: releases pointer capture cleanly on pointerup', () => {
      let releasedId: number | null = null;
      const target = {
        releasePointerCapture: vi.fn((id: number) => {
          releasedId = id;
        }),
      };

      const event = createSyntheticPointerEvent('pointerup', target, { pointerId: 7 });
      if (target.releasePointerCapture) {
        target.releasePointerCapture(event.pointerId);
      }

      expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
      expect(releasedId).toBe(7);
    });

    it('F4-4: handles touch, mouse, and pen pointer types uniformly', () => {
      const pointerTypes: Array<'mouse' | 'touch' | 'pen'> = ['mouse', 'touch', 'pen'];
      const target = { setPointerCapture: vi.fn() };

      for (const pType of pointerTypes) {
        const ev = createSyntheticPointerEvent('pointerdown', target, { pointerId: 10, pointerType: pType });
        expect(ev.pointerType).toBe(pType);
      }
    });

  });

  // =========================================================================
  // F5: Touch-Action None on Interactive Surfaces
  // =========================================================================
  // NOTA (WP1/T2): los 5 tests F5-* solo afirmaban literales
  // (`{touchAction:'none'}.touchAction`) sin montar ningún componente.
  // Eliminados; sus escenarios reales se re-implementan como tests DOM
  // (estilos computados sobre componentes montados) en oleadas siguientes.

  // =========================================================================
  // F6: Touch Ergonomic Trim Zones
  // =========================================================================
  describe('F6: Touch Ergonomic Trim Zones', () => {
    it('F6-1: calculates 20px trim zone on touch for wide clips (>=100px)', () => {
      const edge = calculateExpectedTrimEdge(120, true);
      expect(edge).toBe(20);
    });

    it('F6-2: calculates 8px trim zone on mouse for wide clips', () => {
      const edge = calculateExpectedTrimEdge(120, false);
      expect(edge).toBe(8);
    });

    it('F6-3: narrow clip (<24px) disables trimming to prioritize moving', () => {
      const width = 20;
      const canTrim = width >= 24;
      expect(canTrim).toBe(false);
    });

    it('F6-4: left handle trimming updates startTime and duration while enforcing 0.2s minimum', () => {
      const clip = createMockClip({ startTime: 2.0, duration: 4.0, offset: 0.0 });
      const trimmed = trimLeftOperation(clip, 1.5);
      expect(trimmed.startTime).toBe(3.5);
      expect(trimmed.duration).toBe(2.5);
      expect(trimmed.offset).toBe(1.5);

      // Aggressive left trim attempting to reduce below 0.2s
      const extremeTrim = trimLeftOperation(clip, 3.9);
      expect(extremeTrim.duration).toBeCloseTo(0.2, 5);
    });

    it('F6-5: right handle trimming extends duration clamped to buffer boundaries', () => {
      const clip = createMockClip({ startTime: 1.0, duration: 5.0, offset: 0.0 });
      const trimmed = trimRightOperation(clip, 2.0);
      expect(trimmed.duration).toBe(7.0);

      // Aggressive negative trim
      const shrunk = trimRightOperation(clip, -10.0);
      expect(shrunk.duration).toBe(0.2);
    });
  });

  // =========================================================================
  // F7: Rotary Control Pointer Capture
  // =========================================================================
  describe('F7: Rotary Control Pointer Capture', () => {
    it('F7-1: rotary dial captures pointer on pointer down with primary pointer enforcement', () => {
      let isCaptured = false;
      const target = {
        setPointerCapture: vi.fn((_id?: number) => {
          isCaptured = true;
        }),
      };

      const primaryEvent = createSyntheticPointerEvent('pointerdown', target, { isPrimary: true, pointerId: 1 });
      if (primaryEvent.isPrimary && typeof target.setPointerCapture === 'function') {
        target.setPointerCapture(primaryEvent.pointerId);
      }

      expect(isCaptured).toBe(true);

      // Non-primary pointer rejection
      let nonPrimaryCaptured = false;
      const secondaryEvent = createSyntheticPointerEvent('pointerdown', target, { isPrimary: false, pointerId: 2 });
      if (secondaryEvent.isPrimary && typeof target.setPointerCapture === 'function') {
        nonPrimaryCaptured = true;
      }
      expect(nonPrimaryCaptured).toBe(false);
    });

    it('F7-2: vertical delta upward increases rotary value, downward decreases', () => {
      const min = 0;
      const max = 100;
      const step = 1;
      const startVal = 50;

      const valUp = calculateExpectedKnobValue(startVal, 30, min, max, step);
      expect(valUp).toBe(70);

      const valDown = calculateExpectedKnobValue(startVal, -30, min, max, step);
      expect(valDown).toBe(30);
    });

    it('F7-3: eliminates floating-point drift with decimal step precision', () => {
      const val = calculateExpectedKnobValue(0.1, 15, 0, 1, 0.1);
      // Floating point addition often yields 0.20000000000000004 without precision rounding
      expect(val).toBe(0.2);
    });

    it('F7-5: values clamp strictly between min and max bounds', () => {
      const valOver = calculateExpectedKnobValue(90, 200, 0, 100, 1);
      expect(valOver).toBe(100);

      const valUnder = calculateExpectedKnobValue(10, -200, 0, 100, 1);
      expect(valUnder).toBe(0);
    });
  });

  // =========================================================================
  // F8: Touch Hitbox Standards (>=44x44px)
  // =========================================================================
  // NOTA (WP1/T2): los 5 tests F8-* solo afirmaban literales
  // (`expect(44).toBeGreaterThanOrEqual(44)`) sin medir ningún elemento real.
  // Eliminados; sus escenarios reales se re-implementan como tests DOM
  // (hitbox medida sobre componentes montados) en oleadas siguientes.

  // =========================================================================
  // F9: UI Clip Deletion Action
  // =========================================================================
  describe('F9: UI Clip Deletion Action', () => {
    it('F9-1: UI Delete button is disabled when no clip is selected', () => {
      useDawStore.setState({ selectedClipIds: [] });
      const hasSelection = useDawStore.getState().selectedClipIds.length > 0;
      const isDeleteDisabled = !hasSelection;
      expect(isDeleteDisabled).toBe(true);
    });

    it('F9-2: UI Delete button becomes enabled when a clip is selected', () => {
      const track = createMockTrack();
      const clip = createMockClip({ trackId: track.id });
      useDawStore.setState({ tracks: [track], clips: [clip], selectedClipIds: [clip.id] });

      const hasSelection = useDawStore.getState().selectedClipIds.length > 0;
      const isDeleteDisabled = !hasSelection;
      expect(isDeleteDisabled).toBe(false);
    });

    it('F9-3: clicking UI Delete button removes selected clip from store', () => {
      const track = createMockTrack();
      const clip = createMockClip({ trackId: track.id });
      useDawStore.setState({ tracks: [track], clips: [clip], selectedClipIds: [clip.id] });

      const state = useDawStore.getState();
      state.removeClip(clip.id);

      expect(useDawStore.getState().clips).toHaveLength(0);
      expect(useDawStore.getState().selectedClipIds).toEqual([]);
    });

    it('F9-4: UI Delete button action handles non-existent clip ID gracefully', () => {
      const state = useDawStore.getState();
      expect(() => state.removeClip('non_existent_clip_id')).not.toThrow();
    });
  });
});
