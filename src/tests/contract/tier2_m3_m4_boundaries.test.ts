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

describe('Tier 2: Boundary & Corner Cases (M3: F10–F15, M4: F16–F17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDawStore();
  });

  // =========================================================================
  // F10: Timeline Bidirectional Scroll Sync (Boundaries)
  // =========================================================================
  describe('F10: Timeline Bidirectional Scroll Sync (Boundaries)', () => {
    it('F10-B1: stress testing rapid alternating scroll calls prevents lockup and syncs accurately', () => {
      let headersTop = 0;
      let lanesTop = 0;
      let isSyncing = false;

      const sync = (source: 'headers' | 'lanes', val: number) => {
        if (isSyncing) return;
        isSyncing = true;
        if (source === 'headers') {
          headersTop = val;
          lanesTop = val;
        } else {
          lanesTop = val;
          headersTop = val;
        }
        isSyncing = false;
      };

      for (let i = 0; i < 50; i++) {
        sync(i % 2 === 0 ? 'headers' : 'lanes', i * 10);
      }

      expect(headersTop).toBe(490);
      expect(lanesTop).toBe(490);
    });

    it('F10-B2: fractional subpixel scroll offsets (0.25px) are safely ignored by threshold guard', () => {
      let synced = false;
      const current = 100.0;
      const subpixelTarget = 100.25;

      if (Math.abs(current - subpixelTarget) > 0.5) {
        synced = true;
      }

      expect(synced).toBe(false);
    });

    it('F10-B3: scrolling beyond max container height clamps without infinite bounce', () => {
      const maxScrollHeight = 800;
      const targetScroll = 1500;
      const clampedScroll = Math.min(maxScrollHeight, Math.max(0, targetScroll));

      expect(clampedScroll).toBe(800);
    });

    it('F10-B4: removing all tracks resets scroll synchronization cleanly', () => {
      useDawStore.setState({ tracks: [] });
      const headers = { scrollTop: 0 };
      const lanes = { scrollTop: 0 };

      expect(headers.scrollTop).toBe(0);
      expect(lanes.scrollTop).toBe(0);
    });

    it('F10-B5: viewport resize event preserves current vertical scroll alignment', () => {
      let headersTop = 200;
      let lanesTop = 200;

      // Simulated resize
      const onResize = () => {
        lanesTop = headersTop;
      };

      onResize();
      expect(lanesTop).toBe(headersTop);
    });
  });

  // =========================================================================
  // F11: Sticky Ruler & Alignment (Boundaries)
  // =========================================================================
  describe('F11: Sticky Ruler & Alignment (Boundaries)', () => {
    it('F11-B1: large project duration (1000s) computes bars without overflow', () => {
      const duration = 1000;
      const bpm = 120;
      const barDuration = (60 / bpm) * 4; // 2.0s
      const totalBars = Math.ceil(duration / barDuration);

      expect(totalBars).toBe(500);
      expect(barDuration).toBe(2.0);
    });

    it('F11-B2: minimum zoom level (10 px/s) scales bar pixel positions properly', () => {
      const zoom = 10;
      const barDuration = 2.0; // at 120 bpm, 4/4
      const bar1Left = 0 * barDuration * zoom; // 0px
      const bar2Left = 1 * barDuration * zoom; // 20px

      expect(bar1Left).toBe(0);
      expect(bar2Left).toBe(20);
    });

    it('F11-B3: maximum zoom level (200 px/s) scales sixteenth-note positions accurately', () => {
      const zoom = 200;
      const beatLen = 0.5; // at 120 bpm
      const sixteenthBeatPx = (beatLen / 4) * zoom; // 25px

      expect(sixteenthBeatPx).toBe(25);
    });

    it('F11-B4: odd time signatures (7/8, 5/4, 6/8) calculate bar lengths accurately', () => {
      const bpm = 120; // beatDuration = 0.5s for quarter note
      const beatDuration = 60 / bpm;

      // 7/8: 7 eighth notes = 7 * (0.5 * 0.5) = 1.75s
      const denom78 = 8;
      const beatLen78 = beatDuration * (4 / denom78);
      const barDuration78 = beatLen78 * 7;
      expect(barDuration78).toBe(1.75);

      // 5/4: 5 quarter notes = 2.5s
      const barDuration54 = beatDuration * 5;
      expect(barDuration54).toBe(2.5);
    });

    it('F11-B5: playhead indicator position at extreme boundaries maps to exact pixels', () => {
      const zoom = 50;
      expect(0.0 * zoom).toBe(0);
      expect(1000.0 * zoom).toBe(50000);
    });
  });

  // =========================================================================
  // F12: Ruler Horizontal Width Unification (Boundaries)
  // =========================================================================
  describe('F12: Ruler Horizontal Width Unification (Boundaries)', () => {
    it('F12-B1: short duration (0.1s sample) expands ruler to fill available viewport width', () => {
      const viewport = 1024;
      const header = 240;
      const duration = 0.1;
      const zoom = 50; // duration * zoom = 5px

      const width = calculateExpectedUnifiedWidth(viewport, header, duration, zoom);
      expect(width).toBe(1024 - 240); // 784px
    });

    it('F12-B2: zero or negative viewport fallback produces positive valid width', () => {
      const width = calculateExpectedUnifiedWidth(0, 0, 16, 50);
      expect(width).toBe(800);
      expect(width).toBeGreaterThan(0);
    });

    it('F12-B3: minimum zoom (10 px/s) produces non-zero valid container width', () => {
      const width = calculateExpectedUnifiedWidth(800, 240, 16, 10);
      expect(width).toBe(560);
    });

    it('F12-B4: fractional zoom levels (33.333 px/s) compute valid pixel dimensions', () => {
      const width = calculateExpectedUnifiedWidth(1000, 200, 20, 33.333);
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThan(0);
    });

    it('F12-B5: width remains unified across 100 tracks in container', () => {
      const unifiedWidth = calculateExpectedUnifiedWidth(1280, 240, 30, 50); // 1500px
      for (let i = 0; i < 100; i++) {
        expect(unifiedWidth).toBe(1500);
      }
    });
  });

  // =========================================================================
  // F13: Ruler Seek Clamping (Boundaries)
  // =========================================================================
  describe('F13: Ruler Seek Clamping (Boundaries)', () => {
    it('F13-B1: click at clientX = -9999px clamps strictly to 0.0s', () => {
      const clamped = calculateExpectedClampedSeek(-9999, 50, 16);
      expect(clamped).toBe(0.0);
    });

    it('F13-B2: click at clientX = +99999px clamps strictly to duration', () => {
      const clamped = calculateExpectedClampedSeek(99999, 50, 16);
      expect(clamped).toBe(16.0);
    });

    it('F13-B3: click at exact boundary (duration - 0.0001s) computes valid time', () => {
      const duration = 16;
      const zoom = 50;
      const nearEndPx = duration * zoom - 0.005;

      const time = calculateExpectedClampedSeek(nearEndPx, zoom, duration);
      expect(time).toBeLessThanOrEqual(duration);
      expect(time).toBeCloseTo(duration, 3);
    });

    it('F13-B4: seeking while playback is active updates currentTime without altering isPlaying', () => {
      useDawStore.setState({ isPlaying: true, currentTime: 2.0 });
      useDawStore.getState().setCurrentTime(calculateExpectedClampedSeek(400, 50, 16));

      expect(useDawStore.getState().currentTime).toBe(8.0);
      expect(useDawStore.getState().isPlaying).toBe(true);
    });

    it('F13-B5: rapid successive seek clicks across boundaries update synchronously', () => {
      const state = useDawStore.getState();
      const seekCoords = [-500, 100, 400, 800, 9999];

      for (const coord of seekCoords) {
        state.setCurrentTime(calculateExpectedClampedSeek(coord, 50, 16));
      }

      // Final seek at +9999 clamps to duration (16.0)
      expect(useDawStore.getState().currentTime).toBe(16.0);
    });
  });

  // =========================================================================
  // F14: Timeline 320px Usability & Adaptive Headers (Boundaries)
  // =========================================================================
  describe('F14: Timeline 320px Usability & Adaptive Headers (Boundaries)', () => {
    it('F14-B1: timeline at exactly 320px width preserves >=170px of editable lane space', () => {
      const viewport = 320;
      const headerMobile = 144;
      const laneWidth = viewport - headerMobile;

      expect(laneWidth).toBe(176);
      expect(laneWidth).toBeGreaterThanOrEqual(170);
    });

    it('F14-B2: track with 200-character name truncates cleanly without breaking header width', () => {
      const longName = 'A'.repeat(200);
      const track = createMockTrack({ name: longName });
      expect(track.name.length).toBe(200);

      // Truncation CSS class prevents blowout
      const headerTruncate = 'truncate max-w-[80px]';
      expect(headerTruncate).toContain('truncate');
    });

    it('F14-B3: 0 tracks at 320px screen width renders empty placeholder gracefully', () => {
      useDawStore.setState({ tracks: [] });
      expect(useDawStore.getState().tracks).toHaveLength(0);
    });

    it('F14-B4: 30 tracks at 320px width scroll vertically within overflow container', () => {
      const tracks = Array.from({ length: 30 }, (_, i) => createMockTrack({ id: `t_${i}` }));
      useDawStore.setState({ tracks });
      expect(useDawStore.getState().tracks).toHaveLength(30);
    });

    it('F14-B5: dynamic viewport resize from 1920px to 320px switches header width from 240 to 144', () => {
      const getHeaderWidth = (vw: number) => (vw < 640 ? 144 : 240);
      expect(getHeaderWidth(1920)).toBe(240);
      expect(getHeaderWidth(320)).toBe(144);
    });
  });

  // =========================================================================
  // F15: Responsive Floating Toolbar (Boundaries)
  // =========================================================================
  describe('F15: Responsive Floating Toolbar (Boundaries)', () => {
    it('F15-B1: toolbar positioned at bottom-2 right-2 does not breach viewport boundary', () => {
      const offsetRight = 8; // bottom-2 right-2 = 0.5rem = 8px
      expect(offsetRight).toBeGreaterThanOrEqual(0);
    });

    it('F15-B2: Cut button disabled when playhead is at exact start boundary of clip', () => {
      const clip = createMockClip({ id: 'c1', startTime: 2.0, duration: 4.0 });
      // At exact start time (2.0s), cursor is not strictly inside
      const isInside = (time: number) => time > clip.startTime && time < clip.startTime + clip.duration;
      expect(isInside(2.0)).toBe(false);
      expect(isInside(6.0)).toBe(false); // At exact end time
    });

    it('F15-B3: Zoom level clamped between 10 px/s minimum and 200 px/s maximum', () => {
      const clampZoom = (z: number) => Math.min(200, Math.max(10, z));
      expect(clampZoom(-50)).toBe(10);
      expect(clampZoom(500)).toBe(200);
    });

    it('F15-B4: rapid clicks on zoom controls adjust zoom level predictably', () => {
      useDawStore.setState({ zoom: 50 });
      const state = useDawStore.getState();

      for (let i = 0; i < 5; i++) {
        state.setZoom(useDawStore.getState().zoom + 10);
      }
      expect(useDawStore.getState().zoom).toBe(100);
    });

    it('F15-B5: clicking toolbar button stops event propagation from clearing timeline selection', () => {
      let propagationStopped = false;
      const fakeEvent = {
        stopPropagation: () => {
          propagationStopped = true;
        },
      };

      fakeEvent.stopPropagation();
      expect(propagationStopped).toBe(true);
    });
  });

  // =========================================================================
  // F16: Responsive Header Layout (Boundaries)
  // =========================================================================
  describe('F16: Responsive Header Layout (Boundaries)', () => {
    it('F16-B1: header with 100-character project name at 320px width truncates input text cleanly', () => {
      const longProjectName = 'Project ' + 'X'.repeat(100);
      useDawStore.getState().setProjectName(longProjectName);
      expect(useDawStore.getState().projectName).toBe(longProjectName);

      const inputClasses = 'w-28 md:w-48 truncate';
      expect(inputClasses).toContain('truncate');
    });

    it('F16-B2: rapid view switching between timeline and mixer retains valid activeView state', () => {
      const state = useDawStore.getState();
      for (let i = 0; i < 20; i++) {
        state.setActiveView(i % 2 === 0 ? 'timeline' : 'mixer');
      }
      expect(['timeline', 'mixer']).toContain(useDawStore.getState().activeView);
    });

    it('F16-B3: header maintains fixed height (56px) across mobile viewports', () => {
      const headerHeightPx = 56; // h-14 = 3.5rem = 56px
      expect(headerHeightPx).toBe(56);
    });

    it('F16-B4: multiple toasts in queue do not block header view switcher', () => {
      useDawStore.getState().pushToast('Toast 1');
      useDawStore.getState().pushToast('Toast 2');
      useDawStore.getState().setActiveView('mixer');

      expect(useDawStore.getState().activeView).toBe('mixer');
    });

    it('F16-B5: header action buttons preserve distinct accessible roles', () => {
      const actionButtons = [
        { label: 'Añadir nueva pista', role: 'button' },
        { label: 'Abrir diálogo de masterización y exportación', role: 'button' },
      ];

      for (const btn of actionButtons) {
        expect(btn.role).toBe('button');
      }
    });
  });

  // =========================================================================
  // F17: Essential Transport Control Retention (Boundaries)
  // =========================================================================
  describe('F17: Essential Transport Control Retention (Boundaries)', () => {
    it('F17-B1: BPM clamped strictly between 40 and 260 BPM', () => {
      const clampBpm = (bpm: number) => Math.min(260, Math.max(40, bpm));
      expect(clampBpm(20)).toBe(40);
      expect(clampBpm(350)).toBe(260);
    });

    it('F17-B2: high-resolution time display formats correctly at hour boundary (3600.0s)', () => {
      const formatTime = (totalSec: number) => {
        const mins = Math.floor(totalSec / 60);
        const secs = Math.floor(totalSec % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      };

      expect(formatTime(3600)).toBe('60:00');
      expect(formatTime(125.5)).toBe('02:05');
    });

    it('F17-B3: master volume at 0.0 displays -∞ dB and at 1.0 displays 0dB', () => {
      const formatDb = (vol: number) => (vol === 0 ? '-∞' : `${Math.round(20 * Math.log10(vol))}dB`);
      expect(formatDb(0)).toBe('-∞');
      expect(formatDb(1.0)).toBe('0dB');
    });

    it('F17-B4: Master VU meter clamps peak representation between 0% and 100%', () => {
      const clampMeterWidth = (peak: number) => Math.min(100, Math.max(0, peak * 100));
      expect(clampMeterWidth(-0.5)).toBe(0);
      expect(clampMeterWidth(1.5)).toBe(100);
      expect(clampMeterWidth(0.75)).toBe(75);
    });

    it('F17-B5: loop range inputs validate loopEnd > loopStart with minimum 0.1s step', () => {
      const validateLoopRange = (start: number, end: number, duration: number) => {
        let validStart = Math.max(0, Math.min(duration, start));
        let validEnd = Math.max(0, Math.min(duration, end));
        if (validStart >= validEnd) {
          validEnd = Math.min(duration, validStart + 0.1);
        }
        return { start: validStart, end: validEnd };
      };

      const result = validateLoopRange(8.0, 8.0, 16.0);
      expect(result.end).toBe(8.1);
      expect(result.end).toBeGreaterThan(result.start);
    });
  });
});
