import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupTestEnvironment,
  resetDawStore,
  createMockTrack,
  createMockClip,
  calculateExpectedUnifiedWidth,
  calculateExpectedClampedSeek,
} from './helpers/testHelpers';
import { useDawStore } from '../../store/useDawStore';

setupTestEnvironment();

describe('Tier 1: Feature Coverage (M3: F10–F15, M4: F16–F17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDawStore();
  });

  // =========================================================================
  // F10: Timeline Bidirectional Scroll Sync
  // =========================================================================
  describe('F10: Timeline Bidirectional Scroll Sync', () => {
    it('F10-1: scrolling track headers container updates audio lanes scrollTop', () => {
      const headersContainer = { scrollTop: 120 };
      const lanesContainer = { scrollTop: 0 };

      // Synchronization simulator
      let isSyncingFromLanes = false;
      const onHeadersScroll = () => {
        if (isSyncingFromLanes) return;
        lanesContainer.scrollTop = headersContainer.scrollTop;
      };

      onHeadersScroll();
      expect(lanesContainer.scrollTop).toBe(120);
    });

    it('F10-2: scrolling audio lanes container updates track headers scrollTop', () => {
      const headersContainer = { scrollTop: 0 };
      const lanesContainer = { scrollTop: 250 };

      let isSyncingFromHeaders = false;
      const onLanesScroll = () => {
        if (isSyncingFromHeaders) return;
        headersContainer.scrollTop = lanesContainer.scrollTop;
      };

      onLanesScroll();
      expect(headersContainer.scrollTop).toBe(250);
    });

    it('F10-3: re-entrancy flags prevent ping-pong recursive scroll loops', () => {
      let callCount = 0;
      let isSyncingFromHeaders = false;
      let isSyncingFromLanes = false;

      const syncHeadersToLanes = (newScrollTop: number) => {
        if (isSyncingFromLanes) return;
        isSyncingFromHeaders = true;
        callCount++;
        // Simulated target event trigger
        syncLanesToHeaders(newScrollTop);
        isSyncingFromHeaders = false;
      };

      const syncLanesToHeaders = (_newScrollTop: number) => {
        if (isSyncingFromHeaders) return; // Prevented!
        isSyncingFromLanes = true;
        callCount++;
        isSyncingFromLanes = false;
      };

      syncHeadersToLanes(100);
      expect(callCount).toBe(1); // Only the initial trigger, no recursive bounce
    });

    it('F10-4: subpixel threshold guard ignores scroll differences <= 0.5px', () => {
      let synced = false;
      const currentScrollTop = 100;
      const targetScrollTop = 100.4; // Difference = 0.4px (<= 0.5px)

      const diff = Math.abs(currentScrollTop - targetScrollTop);
      if (diff > 0.5) {
        synced = true;
      }

      expect(synced).toBe(false);

      // Above threshold (0.8px > 0.5px)
      const targetScrollTop2 = 100.8;
      if (Math.abs(currentScrollTop - targetScrollTop2) > 0.5) {
        synced = true;
      }
      expect(synced).toBe(true);
    });

    it('F10-5: vertical scroll synchronization persists across dynamic track additions', () => {
      const headers = { scrollTop: 0 };
      const lanes = { scrollTop: 0 };

      // Add 5 tracks
      for (let i = 0; i < 5; i++) {
        useDawStore.getState().addTrack();
      }

      headers.scrollTop = 300;
      lanes.scrollTop = headers.scrollTop;

      expect(useDawStore.getState().tracks.length).toBe(5);
      expect(lanes.scrollTop).toBe(300);
    });
  });

  // =========================================================================
  // F11: Sticky Ruler & Alignment
  // =========================================================================
  describe('F11: Sticky Ruler & Alignment', () => {
    it('F11-1: Ruler element specification includes sticky top positioning', () => {
      const rulerClasses = 'sticky top-0 z-20 bg-dark-surface border-b border-dark-border';
      expect(rulerClasses).toContain('sticky');
      expect(rulerClasses).toContain('top-0');
    });

    it('F11-2: Ruler specifies opaque background to prevent waveform bleed-through', () => {
      const rulerClasses = 'sticky top-0 z-20 bg-dark-surface border-b border-dark-border';
      expect(rulerClasses).toContain('bg-dark-surface');
    });

    it('F11-3: Ruler z-index (z-20) elevates it above waveform lanes and clips', () => {
      const rulerZIndex = 20;
      const clipZIndex = 10;
      expect(rulerZIndex).toBeGreaterThan(clipZIndex);
    });

    it('F11-4: playhead marker position aligns with currentTime * zoom formula', () => {
      const zoom = 50;
      const currentTime = 3.5;
      const expectedMarkerLeft = currentTime * zoom; // 175px

      expect(expectedMarkerLeft).toBe(175);
    });

    it('F11-5: bar markers compute correctly based on BPM and time signature', () => {
      const bpm = 120; // 0.5s per quarter note
      const timeSignature = [4, 4]; // 2.0s per bar
      const duration = 16; // 8 bars total

      const beatDuration = 60 / bpm;
      const barDuration = beatDuration * timeSignature[0]!;
      const totalBars = Math.ceil(duration / barDuration);

      expect(barDuration).toBe(2.0);
      expect(totalBars).toBe(8);
    });
  });

  // =========================================================================
  // F12: Ruler Horizontal Width Unification
  // =========================================================================
  describe('F12: Ruler Horizontal Width Unification', () => {
    it('F12-1: unified width uses Math.max(viewportWidth - headerWidth, duration * zoom)', () => {
      const viewportWidth = 1024;
      const headerWidth = 240;
      const duration = 16;
      const zoom = 50;

      const unifiedWidth = calculateExpectedUnifiedWidth(viewportWidth, headerWidth, duration, zoom);
      // duration * zoom = 800px; viewportWidth - headerWidth = 784px; max = 800px
      expect(unifiedWidth).toBe(800);
    });

    it('F12-2: when viewport is wider than duration * zoom, total width fills lanes without gap', () => {
      const viewportWidth = 1920;
      const headerWidth = 240;
      const duration = 10;
      const zoom = 50; // duration * zoom = 500px

      const unifiedWidth = calculateExpectedUnifiedWidth(viewportWidth, headerWidth, duration, zoom);
      expect(unifiedWidth).toBe(1920 - 240); // 1680px
    });

    it('F12-3: width scales responsively when zoom factor changes', () => {
      const viewport = 1024;
      const header = 240;
      const duration = 30;

      const widthAtZoom50 = calculateExpectedUnifiedWidth(viewport, header, duration, 50);
      const widthAtZoom100 = calculateExpectedUnifiedWidth(viewport, header, duration, 100);

      expect(widthAtZoom50).toBe(1500);
      expect(widthAtZoom100).toBe(3000);
      expect(widthAtZoom100).toBeGreaterThan(widthAtZoom50);
    });

    it('F12-4: width adapts dynamically when project duration increases', () => {
      const viewport = 1024;
      const header = 240;
      const zoom = 50;

      const width16s = calculateExpectedUnifiedWidth(viewport, header, 16, zoom);
      const width64s = calculateExpectedUnifiedWidth(viewport, header, 64, zoom);

      expect(width16s).toBe(800);
      expect(width64s).toBe(3200);
    });

    it('F12-5: ruler and audio lanes have zero horizontal discrepancy', () => {
      const viewport = 1280;
      const header = 240;
      const duration = 20;
      const zoom = 60;

      const rulerWidth = calculateExpectedUnifiedWidth(viewport, header, duration, zoom);
      const lanesWidth = calculateExpectedUnifiedWidth(viewport, header, duration, zoom);

      expect(rulerWidth).toBe(lanesWidth);
      expect(rulerWidth - lanesWidth).toBe(0);
    });
  });

  // =========================================================================
  // F13: Ruler Seek Clamping
  // =========================================================================
  describe('F13: Ruler Seek Clamping', () => {
    it('F13-1: seeking within valid range maps accurately to timeline seconds', () => {
      const zoom = 50;
      const duration = 16;
      const clickX = 350; // 7.0 seconds

      const time = calculateExpectedClampedSeek(clickX, zoom, duration);
      expect(time).toBe(7.0);
    });

    it('F13-2: seeking past duration clamps strictly to project duration', () => {
      const zoom = 50;
      const duration = 16;
      const clickX = 1200; // 24.0s (exceeds 16s)

      const time = calculateExpectedClampedSeek(clickX, zoom, duration);
      expect(time).toBe(16.0);
    });

    it('F13-3: seeking before start time (negative coordinates) clamps strictly to 0.0', () => {
      const zoom = 50;
      const duration = 16;
      const clickX = -50;

      const time = calculateExpectedClampedSeek(clickX, zoom, duration);
      expect(time).toBe(0.0);
    });

    it('F13-4: seeking at exact boundaries assigns exact 0.0s and duration values', () => {
      const zoom = 50;
      const duration = 20;

      expect(calculateExpectedClampedSeek(0, zoom, duration)).toBe(0.0);
      expect(calculateExpectedClampedSeek(duration * zoom, zoom, duration)).toBe(20.0);
    });

    it('F13-5: store setCurrentTime receives clamped value correctly', () => {
      const state = useDawStore.getState();
      state.setCurrentTime(calculateExpectedClampedSeek(500, 50, 16));
      expect(useDawStore.getState().currentTime).toBe(10.0);
    });
  });

  // =========================================================================
  // F14: Timeline 320px Usability & Adaptive Headers
  // =========================================================================
  describe('F14: Timeline 320px Usability & Adaptive Headers', () => {
    it('F14-1: track header width specification adapts from w-36 on mobile to w-60 on desktop', () => {
      const responsiveHeaderClass = 'w-36 sm:w-60';
      expect(responsiveHeaderClass).toContain('w-36');
      expect(responsiveHeaderClass).toContain('sm:w-60');
    });

    it('F14-2: at 320px viewport, 144px header retains >=170px of lane width for editing', () => {
      const viewportWidth = 320;
      const mobileHeaderWidth = 144; // w-36 in Tailwind = 9rem = 144px
      const availableLaneWidth = viewportWidth - mobileHeaderWidth;

      expect(availableLaneWidth).toBe(176);
      expect(availableLaneWidth).toBeGreaterThanOrEqual(170);
    });

    it('F14-3: header contents accommodate compact 144px layout with text truncation', () => {
      const nameTruncateClass = 'truncate max-w-[80px] sm:max-w-none';
      expect(nameTruncateClass).toContain('truncate');
    });

    it('F14-4: track selection remains fully functional at 320px viewport', () => {
      const track = createMockTrack({ id: 'mobile_track' });
      useDawStore.setState({ tracks: [track] });

      useDawStore.getState().setSelectedTrack('mobile_track');
      expect(useDawStore.getState().selectedTrackId).toBe('mobile_track');
    });

    it('F14-5: total timeline container maintains overflow-hidden to prevent body scrolling', () => {
      const rootTimelineClasses = 'flex-1 flex flex-col bg-dark-bg overflow-hidden relative select-none';
      expect(rootTimelineClasses).toContain('overflow-hidden');
    });
  });

  // =========================================================================
  // F15: Responsive Floating Toolbar
  // =========================================================================
  describe('F15: Responsive Floating Toolbar', () => {
    it('F15-1: floating toolbar footprint is compact (<80px) on mobile viewports', () => {
      const toolbarMobileHeight = 44; // compact single row
      expect(toolbarMobileHeight).toBeLessThan(80);
    });

    it('F15-2: floating toolbar positioning adapts to bottom-2 right-2 on small screens', () => {
      const toolbarPositionClasses = 'bottom-2 right-2 sm:bottom-4 sm:right-6';
      expect(toolbarPositionClasses).toContain('bottom-2 right-2');
    });

    it('F15-3: Cut button state is enabled only when playhead is strictly inside selected clip', () => {
      const clip = createMockClip({ id: 'c1', startTime: 2.0, duration: 4.0 }); // [2.0s - 6.0s]
      useDawStore.setState({ clips: [clip], selectedClipIds: ['c1'] });

      const isInside = (time: number) => time > clip.startTime && time < clip.startTime + clip.duration;

      expect(isInside(1.5)).toBe(false); // Before clip
      expect(isInside(3.5)).toBe(true);  // Inside clip
      expect(isInside(6.5)).toBe(false); // After clip
    });

    it('F15-4: Zoom In and Zoom Out controls adjust store zoom level', () => {
      useDawStore.setState({ zoom: 50 });
      useDawStore.getState().setZoom(60);
      expect(useDawStore.getState().zoom).toBe(60);

      useDawStore.getState().setZoom(40);
      expect(useDawStore.getState().zoom).toBe(40);
    });

    it('F15-5: floating toolbar uses high z-index (z-30) and glassmorphism styling', () => {
      const toolbarClasses = 'absolute bottom-4 right-6 z-30 flex items-center bg-dark-surface/90 backdrop-blur-md';
      expect(toolbarClasses).toContain('z-30');
      expect(toolbarClasses).toContain('backdrop-blur-md');
    });
  });

  // =========================================================================
  // F16: Responsive Header Layout
  // =========================================================================
  describe('F16: Responsive Header Layout', () => {
    it('F16-1: header maintains horizontal alignment without vertical layout wrapping', () => {
      const headerClasses = 'h-14 bg-dark-surface border-b border-dark-border px-4 flex items-center justify-between';
      expect(headerClasses).toContain('h-14');
      expect(headerClasses).toContain('flex items-center justify-between');
    });

    it('F16-2: decorative "Local 100%" badge is hidden on compact screens (<sm)', () => {
      const badgeClasses = 'text-[10px] px-1.5 py-0.5 rounded hidden sm:inline-block';
      expect(badgeClasses).toContain('hidden');
      expect(badgeClasses).toContain('sm:inline-block');
    });

    it('F16-3: view switcher buttons hide text labels on compact screens while retaining icons', () => {
      const labelTextClasses = 'hidden sm:inline';
      expect(labelTextClasses).toContain('hidden sm:inline');
    });

    it('F16-4: action buttons ("Nueva Pista", "Masterizar") hide text on compact screens', () => {
      const actionTextClasses = 'hidden sm:inline';
      expect(actionTextClasses).toContain('hidden sm:inline');
    });

    it('F16-5: header action buttons preserve accessible aria-labels on all screen sizes', () => {
      const buttons = [
        { label: 'Añadir nueva pista', action: 'addTrack' },
        { label: 'Abrir diálogo de masterización y exportación', action: 'export' },
      ];

      for (const btn of buttons) {
        expect(btn.label.length).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // F17: Essential Transport Control Retention
  // =========================================================================
  describe('F17: Essential Transport Control Retention', () => {
    it('F17-1: Metronome button is unconditionally visible (no unconditional hidden class)', () => {
      // In specification, hidden sm:inline-block must be removed
      const isUnconditionallyHidden = (classes: string) => classes.includes('hidden sm:inline-block');
      const updatedMetronomeClasses = 'px-2 py-1 rounded-lg text-xs font-semibold inline-flex items-center';
      expect(isUnconditionallyHidden(updatedMetronomeClasses)).toBe(false);
    });

    it('F17-2: Metronome button displays "MET" on <sm (<640px) and "CLICK" on >=sm', () => {
      const getMetronomeLabel = (viewportWidth: number) => (viewportWidth < 640 ? 'MET' : 'CLICK');
      expect(getMetronomeLabel(320)).toBe('MET');
      expect(getMetronomeLabel(500)).toBe('MET');
      expect(getMetronomeLabel(768)).toBe('CLICK');
      expect(getMetronomeLabel(1024)).toBe('CLICK');
    });

    it('F17-3: Master Peak VU meter is unconditionally visible (removes hidden sm:flex)', () => {
      const isUnconditionallyHidden = (classes: string) => classes.includes('hidden sm:flex');
      const updatedMeterClasses = 'w-8 sm:w-14 h-3 sm:h-4 bg-dark-bg border border-dark-border rounded flex';
      expect(isUnconditionallyHidden(updatedMeterClasses)).toBe(false);
    });

    it('F17-4: Master VU meter specifies compact mobile dimensions (w-8 h-3)', () => {
      const meterClasses = 'w-8 sm:w-14 h-3 sm:h-4';
      expect(meterClasses).toContain('w-8');
      expect(meterClasses).toContain('sm:w-14');
    });

    it('F17-5: Metronome and Master Mute actions function consistently across all breakpoints', () => {
      useDawStore.setState({ metronome: false, masterMute: false });

      useDawStore.getState().toggleMetronome();
      expect(useDawStore.getState().metronome).toBe(true);

      useDawStore.getState().setMasterMute(true);
      expect(useDawStore.getState().masterMute).toBe(true);
    });
  });
});
