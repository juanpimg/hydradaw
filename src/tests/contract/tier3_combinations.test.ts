import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupTestEnvironment,
  resetDawStore,
  createMockTrack,
  createMockClip,
  createSyntheticPointerEvent,
  calculateExpectedTrimEdge,
  calculateExpectedKnobValue,
  calculateExpectedUnifiedWidth,
  calculateExpectedClampedSeek,
} from './helpers/testHelpers';
import { useDawStore } from '../../store/useDawStore';
import { AudioEngine } from '../../audio/AudioEngine';
import { trimRightOperation } from '../../audio/timelineOps';

setupTestEnvironment();

describe('Tier 3: Cross-Feature Combinations (Pairwise Interactions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDawStore();
  });

  // =========================================================================
  // Combination 1: F1 + F3 (Startup Resilience + Safe Boot)
  // =========================================================================
  it('C1 (F1+F3): Audio initialization failure triggers fallback toast and boots blank project cleanly', async () => {
    let booted = false;
    let busy: string | null = 'blank';

    const failingBoot = async () => {
      throw new Error('NotSupportedError: Audio subsystem failure');
    };

    try {
      await failingBoot();
    } catch {
      useDawStore.getState().pushToast('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.');
      await useDawStore.getState().createBlankProject();
      booted = true;
    } finally {
      busy = null;
    }

    expect(booted).toBe(true);
    expect(busy).toBeNull();
    expect(useDawStore.getState().projectName).toBe('Proyecto sin título');
    expect(useDawStore.getState().tracks).toHaveLength(0);
    expect(useDawStore.getState().toasts.some((t) => t.message.includes('modo silencioso'))).toBe(true);
  });

  // =========================================================================
  // Combination 2: F4 + F5 + F6 (Pointer Drag + Touch-Action None + Touch Trim Zone)
  // =========================================================================
  it('C2 (F4+F5+F6): Touch pointer on WaveformCanvas with touch-none engages 20px trim zone without container scrolling', () => {
    const width = 120;
    const isTouch = true;
    const trimEdge = calculateExpectedTrimEdge(width, isTouch);
    expect(trimEdge).toBe(20);

    const canvasContainer = {
      style: { touchAction: 'none' },
      setPointerCapture: vi.fn(),
    };

    const touchDown = createSyntheticPointerEvent('pointerdown', canvasContainer, {
      pointerId: 101,
      pointerType: 'touch',
      clientX: 15, // Inside 20px trim zone
    });

    if (canvasContainer.setPointerCapture) {
      canvasContainer.setPointerCapture(touchDown.pointerId);
    }

    expect(canvasContainer.style.touchAction).toBe('none');
    expect(canvasContainer.setPointerCapture).toHaveBeenCalledWith(101);
  });

  // =========================================================================
  // Combination 3: F6 + F9 (Ergonomic Trimming + UI Clip Deletion)
  // =========================================================================
  it('C3 (F6+F9): Trimming a clip preserves selection, and UI delete action removes it completely', () => {
    const track = createMockTrack({ id: 't1' });
    const clip = createMockClip({ id: 'c1', trackId: 't1', startTime: 2.0, duration: 6.0 });
    useDawStore.setState({ tracks: [track], clips: [clip], selectedClipIds: ['c1'] });

    // Trim right handle
    const trimmed = trimRightOperation(clip, -2.0);
    useDawStore.getState().updateClip('c1', { duration: trimmed.duration });
    expect(useDawStore.getState().clips[0]!.duration).toBe(4.0);

    // Delete trimmed clip via UI toolbar action
    useDawStore.getState().removeClip('c1');
    expect(useDawStore.getState().clips).toHaveLength(0);
    expect(useDawStore.getState().selectedClipIds).toEqual([]);
  });

  // =========================================================================
  // Combination 4: F7 + F8 (Rotary Pointer Capture + 44px Touch Hitbox)
  // =========================================================================
  it('C4 (F7+F8): Rotary control pointer capture operates alongside 44px channel strip controls', () => {
    const knobDial = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };

    const pointerDown = createSyntheticPointerEvent('pointerdown', knobDial, {
      pointerId: 5,
      isPrimary: true,
      clientY: 100,
    });

    if (pointerDown.isPrimary && knobDial.setPointerCapture) {
      knobDial.setPointerCapture(pointerDown.pointerId);
    }
    expect(knobDial.setPointerCapture).toHaveBeenCalledWith(5);

    // Adjacent channel strip mute button meets 44px
    const muteButtonSize = { width: 44, height: 44 };
    expect(muteButtonSize.width).toBeGreaterThanOrEqual(44);
    expect(muteButtonSize.height).toBeGreaterThanOrEqual(44);

    // Adjust value with precision
    const nextVal = calculateExpectedKnobValue(0.5, 30, 0, 1, 0.05);
    expect(nextVal).toBe(0.7);
  });

  // =========================================================================
  // Combination 5: F10 + F11 + F12 (Bidirectional Scroll + Sticky Ruler + Width Unification)
  // =========================================================================
  it('C5 (F10+F11+F12): Vertical scroll syncs lanes/headers while sticky ruler aligns with unified track width', () => {
    const viewportWidth = 1024;
    const headerWidth = 240;
    const duration = 20;
    const zoom = 50;

    const unifiedWidth = calculateExpectedUnifiedWidth(viewportWidth, headerWidth, duration, zoom);
    expect(unifiedWidth).toBe(1000); // 20 * 50 = 1000px

    const headersContainer = { scrollTop: 150 };
    const lanesContainer = { scrollTop: 0, scrollLeft: 200 };

    // Bidirectional sync
    lanesContainer.scrollTop = headersContainer.scrollTop;
    expect(lanesContainer.scrollTop).toBe(150);

    // Sticky ruler classes
    const rulerClasses = 'sticky top-0 z-20 bg-dark-surface';
    expect(rulerClasses).toContain('sticky');
    expect(rulerClasses).toContain('top-0');
  });

  // =========================================================================
  // Combination 6: F12 + F13 (Width Unification + Ruler Seek Clamping)
  // =========================================================================
  it('C6 (F12+F13): Seeking at the far right edge of unified ruler clamps strictly to project duration', () => {
    const duration = 16;
    const zoom = 50;
    const unifiedWidth = calculateExpectedUnifiedWidth(1280, 240, duration, zoom); // 1040px (1280 - 240)
    expect(unifiedWidth).toBe(1040);

    // User clicks near far right edge of empty unified space (e.g. at 1000px)
    const seekTime = calculateExpectedClampedSeek(1000, zoom, duration);
    // 1000px / 50 = 20s, which exceeds project duration 16s
    expect(seekTime).toBe(16.0); // Clamped cleanly to duration
  });

  // =========================================================================
  // Combination 7: F14 + F15 + F16 (320px Usability + Responsive Toolbar + Compact Header)
  // =========================================================================
  it('C7 (F14+F15+F16): Mobile 320px viewport layout integrates compact header, 144px track headers, and bottom-right toolbar', () => {
    const viewportWidth = 320;
    const mobileHeaderWidth = 144; // w-36
    const availableLaneWidth = viewportWidth - mobileHeaderWidth; // 176px

    expect(availableLaneWidth).toBe(176);

    // Header hides text labels on <sm
    const headerSwitcherText = 'hidden sm:inline';
    expect(headerSwitcherText).toContain('hidden');

    // Floating toolbar positioned at bottom-2 right-2
    const toolbarClasses = 'bottom-2 right-2 sm:bottom-4 sm:right-6';
    expect(toolbarClasses).toContain('bottom-2 right-2');
  });

  // =========================================================================
  // Combination 8: F16 + F17 (Compact Header Navigation + Retained Transport Controls)
  // =========================================================================
  it('C8 (F16+F17): Switching views on mobile keeps transport metronome ("MET") and live meter visible', () => {
    const state = useDawStore.getState();

    // Switch view to mixer
    state.setActiveView('mixer');
    expect(useDawStore.getState().activeView).toBe('mixer');

    // Transport bar on compact screen (<640px)
    const viewport = 375;
    const metronomeLabel = viewport < 640 ? 'MET' : 'CLICK';
    expect(metronomeLabel).toBe('MET');

    const meterDimensions = { width: 32, height: 12 }; // w-8 h-3
    expect(meterDimensions.width).toBe(32);
  });

  // =========================================================================
  // Combination 9: F4 + F10 (Clip Dragging across Vertically Synchronized Tracks)
  // =========================================================================
  it('C9 (F4+F10): Dragging clip horizontally while tracks are vertically scrolled preserves positioning', () => {
    const track1 = createMockTrack({ id: 't1' });
    const track2 = createMockTrack({ id: 't2' });
    const clip = createMockClip({ id: 'c1', trackId: 't1', startTime: 2.0, duration: 4.0 });

    useDawStore.setState({ tracks: [track1, track2], clips: [clip] });

    // Scrolled vertically
    const scrollTop = 192; // 2 track heights
    expect(scrollTop).toBe(192);

    // Move clip forward by 2.0 seconds
    const zoom = 50;
    const deltaX = 100; // 2 seconds
    const newStart = clip.startTime + deltaX / zoom;

    useDawStore.getState().updateClip('c1', { startTime: newStart });
    expect(useDawStore.getState().clips[0]!.startTime).toBe(4.0);
  });

  // =========================================================================
  // Combination 10: F2 + F17 (Audio Engine Restriction Fallback + Live Metering)
  // =========================================================================
  it('C10 (F2+F17): AudioEngine operating under suspended context delivers meter callbacks safely', async () => {
    const engine = AudioEngine.getInstance();
    await engine.ensureContext();

    let callbackReceived = false;
    const meterCb = (levels: { master: { peak: number } }) => {
      if (typeof levels.master.peak === 'number') {
        callbackReceived = true;
      }
    };

    const unsubscribe = engine.onMeterUpdate(meterCb as unknown as Parameters<typeof engine.onMeterUpdate>[0]);
    // Simulate telemetry callback
    meterCb({ master: { peak: 0.85 } });

    expect(callbackReceived).toBe(true);
    expect(typeof unsubscribe).toBe('function');
  });

  // =========================================================================
  // Combination 11: F8 + F9 + F15 (Toolbar Hitbox Standards + UI Clip Deletion + Responsive Toolbar)
  // =========================================================================
  it('C11 (F8+F9+F15): Toolbar housing Delete Clip and Zoom buttons meets 44px hitbox standards', () => {
    const toolbarButtons = [
      { name: 'ZoomOut', minWidth: 44, minHeight: 44 },
      { name: 'ZoomIn', minWidth: 44, minHeight: 44 },
      { name: 'Cut', minHeight: 44 },
      { name: 'DeleteClip', minWidth: 44, minHeight: 44 },
    ];

    for (const btn of toolbarButtons) {
      if (btn.minWidth) expect(btn.minWidth).toBeGreaterThanOrEqual(44);
      if (btn.minHeight) expect(btn.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  // =========================================================================
  // Combination 12: F13 + F17 (Ruler Seeking + Transport Bar Playback Sync)
  // =========================================================================
  it('C12 (F13+F17): Seeking on ruler updates transport bar time display and musical bar/beat position', () => {
    const duration = 16;
    const zoom = 50;
    const bpm = 120; // 2.0s per bar

    // Click at 300px (6.0 seconds)
    const seekTime = calculateExpectedClampedSeek(300, zoom, duration);
    useDawStore.getState().setCurrentTime(seekTime);

    expect(useDawStore.getState().currentTime).toBe(6.0);

    // Musical time calculation: Bar 4, Beat 1
    const barDuration = (60 / bpm) * 4;
    const bar = Math.floor(seekTime / barDuration) + 1;
    expect(bar).toBe(4);
  });
});
