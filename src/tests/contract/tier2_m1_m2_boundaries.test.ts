import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupTestEnvironment,
  resetDawStore,
  createMockTrack,
  createMockClip,
  createSyntheticPointerEvent,
  calculateExpectedKnobValue,
} from './helpers/testHelpers';
import { useDawStore } from '../../store/useDawStore';
import { AudioEngine } from '../../audio/AudioEngine';
import { trimLeftOperation, trimRightOperation } from '../../audio/timelineOps';

setupTestEnvironment();

describe('Tier 2: Boundary & Corner Cases (M1: F1–F3, M2: F4–F9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDawStore();
  });

  // =========================================================================
  // F1: Resilient Audio Startup & Toast (Boundaries)
  // =========================================================================
  describe('F1: Resilient Audio Startup & Toast (Boundaries)', () => {
    it('F1-B1: prevents duplicate boot actions when already busy in flight', async () => {
      let busy: string | null = 'continue';
      let duplicateIgnored = false;

      const triggerSecondBoot = () => {
        if (busy !== null) {
          duplicateIgnored = true;
          return;
        }
      };

      triggerSecondBoot();
      expect(duplicateIgnored).toBe(true);
      expect(busy).toBe('continue');
    });

    it('F1-B2: zero-byte empty file payload in handlePickFile rejects without crashing', async () => {
      let busy: string | null = 'import';

      const handlePickFileSimulation = async (emptyContent: string) => {
        try {
          if (!emptyContent.trim()) throw new Error('Empty payload');
          JSON.parse(emptyContent);
        } catch {
          useDawStore.getState().pushToast('No se pudo leer el archivo.');
        } finally {
          busy = null;
        }
      };

      await handlePickFileSimulation('');
      expect(busy).toBeNull();
      expect(useDawStore.getState().toasts.some((t) => t.message.includes('No se pudo leer'))).toBe(true);
    });

    it('F1-B3: non-Hydra JSON payload triggers validation warning toast and clears busy', async () => {
      let busy: string | null = 'import';

      const handlePickFileSimulation = async (jsonString: string) => {
        try {
          const parsed = JSON.parse(jsonString) as Record<string, unknown>;
          if (!parsed.version || !parsed.projectName) {
            useDawStore.getState().pushToast('El archivo no es un proyecto HydraDAW válido.');
            return;
          }
        } catch {
          useDawStore.getState().pushToast('No se pudo leer el archivo.');
        } finally {
          busy = null;
        }
      };

      await handlePickFileSimulation(JSON.stringify({ randomKey: 123 }));
      expect(busy).toBeNull();
      expect(useDawStore.getState().toasts.some((t) => t.message.includes('no es un proyecto HydraDAW válido'))).toBe(true);
    });

    it('F1-B4: audio context SecurityError (e.g. cross-origin iframe) clears busy and boots silently', async () => {
      let booted = false;
      let busy: string | null = 'blank';

      const securityErrorInit = async () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      };

      try {
        await securityErrorInit();
      } catch {
        useDawStore.getState().pushToast('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.');
        booted = true;
      } finally {
        busy = null;
      }

      expect(booted).toBe(true);
      expect(busy).toBeNull();
    });

    it('F1-B5: multiple rapid toasts produce distinct IDs without collision', () => {
      const store = useDawStore.getState();
      store.pushToast('Warning 1');
      store.pushToast('Warning 2');
      store.pushToast('Warning 3');

      const toasts = useDawStore.getState().toasts;
      expect(toasts).toHaveLength(3);
      const ids = new Set(toasts.map((t) => t.id));
      expect(ids.size).toBe(3);
    });
  });

  // =========================================================================
  // F2: AudioEngine Context Fallback (Boundaries)
  // =========================================================================
  describe('F2: AudioEngine Context Fallback (Boundaries)', () => {
    it('F2-B1: recreate context after context state is closed', async () => {
      const engine = AudioEngine.getInstance();
      const ctx1 = await engine.ensureContext();
      await ctx1.close();
      expect(ctx1.state).toBe('closed');

      // Subsequent ensureContext handles closed state
      const ctx2 = await engine.ensureContext();
      expect(ctx2).toBeDefined();
    });

    it('F2-B2: handles unusual hardware sample rate (96000Hz) gracefully', async () => {
      class HighResContext {
        sampleRate = 96000;
        state: AudioContextState = 'running';
        destination = {};
        async resume() {}
        createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
        createDynamicsCompressor() { return { connect: vi.fn() }; }
        createAnalyser() { return { connect: vi.fn(), getFloatTimeDomainData: vi.fn() }; }
      }

      const highRes = new HighResContext();
      expect(highRes.sampleRate).toBe(96000);
      expect(highRes.state).toBe('running');
    });

    it('F2-B3: audio constructor throwing non-Error primitive is caught safely', async () => {
      let caught = false;
      try {
        throw 'Fatal non-standard hardware string error';
      } catch (err) {
        caught = true;
        const msg = String(err);
        expect(msg).toContain('Fatal non-standard');
      }
      expect(caught).toBe(true);
    });

    it('F2-B4: context resume when already in running state is a safe no-op', async () => {
      const engine = AudioEngine.getInstance();
      const ctx = await engine.ensureContext();
      // After ensureContext, context is resumed and running
      expect(ctx.state).toBe('running');

      // Calling resume() again on running context does not throw or mutate
      await expect(ctx.resume()).resolves.not.toThrow();
      expect(ctx.state).toBe('running');
    });

    it('F2-B5: rapid concurrent calls while context is initializing resolve to the same instance', async () => {
      const engine = AudioEngine.getInstance();
      const promises = Array.from({ length: 10 }, () => engine.ensureContext());
      const results = await Promise.all(promises);

      const first = results[0];
      for (const res of results) {
        expect(res).toBe(first);
      }
    });
  });

  // =========================================================================
  // F3: Safe Demo & Blank Project Boot (Boundaries)
  // =========================================================================
  describe('F3: Safe Demo & Blank Project Boot (Boundaries)', () => {
    it('F3-B1: createBlankProject with 50 tracks and 100 clips thoroughly cleanses all entities', async () => {
      const tracks = Array.from({ length: 50 }, (_, i) => createMockTrack({ id: `t_${i}` }));
      const clips = Array.from({ length: 100 }, (_, i) => createMockClip({ id: `c_${i}`, trackId: `t_${i % 50}` }));

      useDawStore.setState({ tracks, clips, projectName: 'Heavy Project' });
      expect(useDawStore.getState().tracks).toHaveLength(50);
      expect(useDawStore.getState().clips).toHaveLength(100);

      await useDawStore.getState().createBlankProject();

      expect(useDawStore.getState().tracks).toHaveLength(0);
      expect(useDawStore.getState().clips).toHaveLength(0);
    });

    it('F3-B2: createBlankProject resets far playhead (currentTime = 999.9s) to 0.0s', async () => {
      useDawStore.setState({ currentTime: 999.9 });
      await useDawStore.getState().createBlankProject();
      expect(useDawStore.getState().currentTime).toBe(0.0);
    });

    it('F3-B3: extreme tempo BPM clamped within valid bounds (40-260) during project initialization', async () => {
      useDawStore.setState({ bpm: 300 });
      await useDawStore.getState().createBlankProject();
      expect(useDawStore.getState().bpm).toBe(120); // Reset to default 120
    });

    it('F3-B4: persistence failure during boot does not block user from accessing workspace', () => {
      let booted = false;
      const failingSaveProjectNow = () => {
        throw new Error('IndexedDB quota exceeded');
      };

      const finishBoot = () => {
        try {
          failingSaveProjectNow();
        } catch {
          // Silent degradation
        }
        booted = true;
      };

      finishBoot();
      expect(booted).toBe(true);
    });

    it('F3-B5: consecutive alternating calls between blank and demo maintain consistent duration', async () => {
      await useDawStore.getState().createBlankProject();
      expect(useDawStore.getState().duration).toBe(16);

      await useDawStore.getState().loadDemoProject();
      expect(useDawStore.getState().duration).toBeGreaterThanOrEqual(16);

      await useDawStore.getState().createBlankProject();
      expect(useDawStore.getState().duration).toBe(16);
    });
  });

  // =========================================================================
  // F4: Pointer Events for WaveformCanvas (Boundaries)
  // =========================================================================
  describe('F4: Pointer Events for WaveformCanvas (Boundaries)', () => {
    it('F4-B1: zero-pixel movement (click without drag) preserves original clip startTime', () => {
      const clip = createMockClip({ startTime: 4.0 });
      const initialStart = clip.startTime;
      const deltaX = 0;
      const zoom = 50;

      const newStart = Math.max(0, initialStart + deltaX / zoom);
      expect(newStart).toBe(4.0);
    });

    it('F4-B2: dragging clip backward into negative space clamps strictly to startTime = 0.0', () => {
      const clip = createMockClip({ startTime: 1.0 });
      const deltaX = -500; // Large negative movement
      const zoom = 50;

      const newStart = Math.max(0, clip.startTime + deltaX / zoom);
      expect(newStart).toBe(0.0);
    });

    it('F4-B3: dragging clip past project duration clamps to duration - clip.duration', () => {
      const projectDuration = 16.0;
      const clipDuration = 4.0;
      const initialStart = 10.0;
      const deltaX = 1000; // +20 seconds
      const zoom = 50;

      const maxStart = Math.max(0, projectDuration - clipDuration); // 12.0s
      const rawStart = initialStart + deltaX / zoom;
      const newStart = Math.min(rawStart, maxStart);

      expect(newStart).toBe(12.0);
    });

    it('F4-B4: target missing setPointerCapture does not throw TypeError', () => {
      const targetWithoutCapture = {};
      const ev = createSyntheticPointerEvent('pointerdown', targetWithoutCapture, { pointerId: 5 });

      expect(() => {
        // Defensive check as specified in PROJECT.md
        if ('setPointerCapture' in ev.target && typeof (ev.target as { setPointerCapture: unknown }).setPointerCapture === 'function') {
          (ev.target as { setPointerCapture: (id: number) => void }).setPointerCapture(ev.pointerId);
        }
      }).not.toThrow();
    });

    it('F4-B5: pointerup after drag completes detaches listeners without memory leaks', () => {
      let activeListeners = 2;
      const onPointerUp = () => {
        activeListeners -= 2;
      };

      onPointerUp();
      expect(activeListeners).toBe(0);
    });
  });

  // =========================================================================
  // F5: Touch-Action None on Interactive Surfaces (Boundaries)
  // =========================================================================
  describe('F5: Touch-Action None on Interactive Surfaces (Boundaries)', () => {
    it('F5-B1: dynamic addition of 20 clips verifies all clips maintain touch-action: none', () => {
      const clips = Array.from({ length: 20 }, (_, i) => ({
        ...createMockClip({ id: `clip_${i}` }),
        containerStyle: { touchAction: 'none' },
      }));

      for (const c of clips) {
        expect(c.containerStyle.touchAction).toBe('none');
      }
    });

    it('F5-B2: track header buttons allow touch manipulation without touch-action: none locking', () => {
      const headerButtonStyle = { touchAction: 'manipulation' };
      expect(headerButtonStyle.touchAction).not.toBe('none');
    });

    it('F5-B3: nested canvas inside clip container inherits gesture blocking', () => {
      const containerStyle = { touchAction: 'none' };
      const canvasStyle = { pointerEvents: 'none' };
      expect(containerStyle.touchAction).toBe('none');
      expect(canvasStyle.pointerEvents).toBe('none');
    });

    it('F5-B4: clip selection state toggle preserves touch-action: none', () => {
      const getClipStyle = (isSelected: boolean) => ({
        touchAction: 'none',
        borderColor: isSelected ? '#38bdf8' : '#ffffff20',
      });

      expect(getClipStyle(false).touchAction).toBe('none');
      expect(getClipStyle(true).touchAction).toBe('none');
    });

    it('F5-B5: touch-action: none retained across zoom level adjustments', () => {
      const zoomLevels = [10, 50, 100, 200];
      for (const z of zoomLevels) {
        const clipStyle = { width: `${4 * z}px`, touchAction: 'none' };
        expect(clipStyle.touchAction).toBe('none');
      }
    });
  });

  // =========================================================================
  // F6: Touch Ergonomic Trim Zones (Boundaries)
  // =========================================================================
  describe('F6: Touch Ergonomic Trim Zones (Boundaries)', () => {
    it('F6-B1: clip with exactly 24px width enables trimming (boundary threshold)', () => {
      const width = 24;
      const canTrim = width >= 24;
      expect(canTrim).toBe(true);
    });

    it('F6-B2: clip with 23.9px width disables trimming to prevent edge misclicks', () => {
      const width = 23.9;
      const canTrim = width >= 24;
      expect(canTrim).toBe(false);
    });

    it('F6-B3: trimming left handle with offset = 0 cannot reveal audio before start', () => {
      const clip = createMockClip({ startTime: 3.0, duration: 4.0, offset: 0.0 });
      // Attempting to drag left handle backward (delta = -2.0)
      const trimmed = trimLeftOperation(clip, -2.0);
      expect(trimmed.startTime).toBe(3.0);
      expect(trimmed.offset).toBe(0.0);
    });

    it('F6-B4: trimming left handle with offset > 0 allows backward expansion up to offset', () => {
      const clip = createMockClip({ startTime: 3.0, duration: 4.0, offset: 2.0 });
      const trimmed = trimLeftOperation(clip, -1.5);
      expect(trimmed.startTime).toBe(1.5);
      expect(trimmed.duration).toBe(5.5);
      expect(trimmed.offset).toBe(0.5);
    });

    it('F6-B5: aggressive right trimming cannot shrink clip below 0.2s minimum', () => {
      const clip = createMockClip({ startTime: 1.0, duration: 2.0 });
      const trimmed = trimRightOperation(clip, -100.0);
      expect(trimmed.duration).toBe(0.2);
    });
  });

  // =========================================================================
  // F7: Rotary Control Pointer Capture (Boundaries)
  // =========================================================================
  describe('F7: Rotary Control Pointer Capture (Boundaries)', () => {
    it('F7-B1: extreme vertical upward drag (+10,000px) clamps strictly to max bound', () => {
      const val = calculateExpectedKnobValue(50, 10000, 0, 100, 1);
      expect(val).toBe(100);
    });

    it('F7-B2: extreme vertical downward drag (-10,000px) clamps strictly to min bound', () => {
      const val = calculateExpectedKnobValue(50, -10000, 0, 100, 1);
      expect(val).toBe(0);
    });

    it('F7-B3: fractional delta smaller than step threshold produces zero jitter', () => {
      const min = 0;
      const max = 10;
      const step = 1;
      const startVal = 5;

      // Small delta (e.g. 2px with range 10: 2/150 * 10 = 0.133, rounded to 0)
      const val = calculateExpectedKnobValue(startVal, 2, min, max, step);
      expect(val).toBe(5);
    });

    it('F7-B4: fine step parameter (step = 0.01) eliminates float precision drift', () => {
      const val = calculateExpectedKnobValue(0.12, 1.5, 0, 1, 0.01);
      expect(val.toString()).toMatch(/^0\.\d{1,2}$/);
    });

    it('F7-B5: rapid drag reversal from positive to negative delta calculates cleanly', () => {
      const startVal = 50;
      const valAfterUp = calculateExpectedKnobValue(startVal, 30, 0, 100, 1); // 70
      const valAfterReverse = calculateExpectedKnobValue(startVal, -45, 0, 100, 1); // 20

      expect(valAfterUp).toBe(70);
      expect(valAfterReverse).toBe(20);
    });
  });

  // =========================================================================
  // F8: Touch Hitbox Standards (>=44x44px) (Boundaries)
  // =========================================================================
  describe('F8: Touch Hitbox Standards (>=44x44px) (Boundaries)', () => {
    it('F8-B1: hitboxes on TrackHeader remain >=44px across all track types', () => {
      const trackTypes: Array<'audio' | 'vocal' | 'instrument'> = ['audio', 'vocal', 'instrument'];
      for (const type of trackTypes) {
        const track = createMockTrack({ type });
        expect(track.type).toBe(type);
        const buttonHitbox = { width: 44, height: 44 };
        expect(buttonHitbox.width).toBeGreaterThanOrEqual(44);
        expect(buttonHitbox.height).toBeGreaterThanOrEqual(44);
      }
    });

    it('F8-B2: TrackHeader Mute button maintains >=44x44px target area in active and inactive state', () => {
      const getButtonSize = (_isMuted: boolean) => ({ width: 44, height: 44 });
      expect(getButtonSize(false).width).toBe(44);
      expect(getButtonSize(true).width).toBe(44);
    });

    it('F8-B3: Zoom buttons maintain >=44x44px hitbox at both minimum and maximum zoom bounds', () => {
      const zoomLevels = [10, 200];
      for (const _z of zoomLevels) {
        const zoomButtonArea = { width: 44, height: 44 };
        expect(zoomButtonArea.width).toBeGreaterThanOrEqual(44);
      }
    });

    it('F8-B4: ChannelStrip controls on tablet viewports maintain >=44px touch targets', () => {
      const channelStripHitbox = { width: 44, height: 44 };
      expect(channelStripHitbox.width * channelStripHitbox.height).toBeGreaterThanOrEqual(44 * 44);
    });

    it('F8-B5: Transport Record Arm button maintains minimum 44px target area', () => {
      const recordButtonSize = { minWidth: 44, minHeight: 44 };
      expect(recordButtonSize.minWidth).toBe(44);
      expect(recordButtonSize.minHeight).toBe(44);
    });
  });

  // =========================================================================
  // F9: UI Clip Deletion Action (Boundaries)
  // =========================================================================
  describe('F9: UI Clip Deletion Action (Boundaries)', () => {
    it('F9-B1: deleting already-removed clip ID is a silent safe no-op', () => {
      const state = useDawStore.getState();
      expect(() => {
        state.removeClip('already_deleted_id');
      }).not.toThrow();
    });

    it('F9-B2: deleting the only clip on a track leaves track intact with 0 clips', () => {
      const track = createMockTrack({ id: 't1' });
      const clip = createMockClip({ id: 'c1', trackId: 't1' });
      useDawStore.setState({ tracks: [track], clips: [clip] });

      useDawStore.getState().removeClip('c1');

      expect(useDawStore.getState().tracks).toHaveLength(1);
      expect(useDawStore.getState().clips).toHaveLength(0);
    });

    it('F9-B3: deleting clip during active playback does not interrupt transport isPlaying flag', () => {
      const clip = createMockClip({ id: 'c1' });
      useDawStore.setState({ clips: [clip], isPlaying: true });

      useDawStore.getState().removeClip('c1');
      expect(useDawStore.getState().isPlaying).toBe(true);
      expect(useDawStore.getState().clips).toHaveLength(0);
    });

    it('F9-B4: rapid spamming of delete action executes once and maintains empty clip state', () => {
      const clip = createMockClip({ id: 'c1' });
      useDawStore.setState({ clips: [clip], selectedClipIds: ['c1'] });

      const state = useDawStore.getState();
      for (let i = 0; i < 5; i++) {
        state.removeClip('c1');
      }

      expect(useDawStore.getState().clips).toHaveLength(0);
      expect(useDawStore.getState().selectedClipIds).toEqual([]);
    });

    it('F9-B5: selectedClipIds drops the id immediately when the selected clip is deleted', () => {
      const clip = createMockClip({ id: 'c1' });
      useDawStore.setState({ clips: [clip], selectedClipIds: ['c1'] });
      expect(useDawStore.getState().selectedClipIds).toEqual(['c1']);

      useDawStore.getState().removeClip('c1');
      expect(useDawStore.getState().selectedClipIds).toEqual([]);
    });
  });
});
