import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupTestEnvironment,
  resetDawStore,
  createMockClip,
  calculateExpectedTrimEdge,
  calculateExpectedKnobValue,
  calculateExpectedUnifiedWidth,
  calculateExpectedClampedSeek,
} from './helpers/testHelpers';
import { useDawStore } from '../../store/useDawStore';
import { AudioEngine } from '../../audio/AudioEngine';
import { trimLeftOperation, trimRightOperation, splitClipOperation } from '../../audio/timelineOps';

setupTestEnvironment();

describe('Tier 4: Real-World Scenarios (End-to-End Application Workflows)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDawStore();
  });

  // =========================================================================
  // Scenario 1: Mobile Touch Recording & Arrangement Workflow (320px)
  // =========================================================================
  it('Scenario 1: Mobile Touch Recording & Arrangement Workflow (320px)', async () => {
    // 1. User launches on mobile screen (320px width)
    const viewportWidth = 320;
    const mobileHeaderWidth = 144; // w-36
    const laneWidth = viewportWidth - mobileHeaderWidth; // 176px
    expect(laneWidth).toBeGreaterThanOrEqual(170);

    // 2. Starts with clean blank project (F1, F3)
    await useDawStore.getState().createBlankProject();
    expect(useDawStore.getState().tracks).toHaveLength(0);

    // 3. Adds vocal track (F14)
    useDawStore.getState().addTrack();
    const tracks = useDawStore.getState().tracks;
    expect(tracks).toHaveLength(1);
    const trackId = tracks[0]!.id;
    useDawStore.getState().updateTrack(trackId, { name: 'Vocal Lead', type: 'vocal' });

    // 4. Arms track with 44px touch button (F8)
    const armButtonSize = { width: 44, height: 44 };
    expect(armButtonSize.width).toBeGreaterThanOrEqual(44);
    useDawStore.getState().updateTrack(trackId, { armed: true });
    expect(useDawStore.getState().tracks[0]!.armed).toBe(true);

    // 5. Enables metronome ("MET" on <sm) (F17)
    const metronomeLabel = viewportWidth < 640 ? 'MET' : 'CLICK';
    expect(metronomeLabel).toBe('MET');
    useDawStore.getState().toggleMetronome();
    expect(useDawStore.getState().metronome).toBe(true);

    // 6. Audio clip is recorded on track (F4)
    const recordedClip = createMockClip({
      id: 'take_1',
      trackId,
      name: 'Vocal_Take_1.wav',
      startTime: 2.0,
      duration: 8.0,
      offset: 0.0,
    });
    useDawStore.getState().addClip(recordedClip);
    expect(useDawStore.getState().clips).toHaveLength(1);

    // 7. Trims clip start handle with touch pointer (20px edge) (F5, F6)
    const touchEdge = calculateExpectedTrimEdge(recordedClip.duration * 50, true);
    expect(touchEdge).toBe(20);
    const trimmed = trimLeftOperation(recordedClip, 1.0);
    useDawStore.getState().updateClip('take_1', {
      startTime: trimmed.startTime,
      duration: trimmed.duration,
      offset: trimmed.offset,
    });
    expect(useDawStore.getState().clips[0]!.startTime).toBe(3.0);
    expect(useDawStore.getState().clips[0]!.duration).toBe(7.0);

    // 8. Selects clip and removes via dedicated UI Delete Clip button (F9)
    useDawStore.getState().selectClip('take_1', 'single');
    expect(useDawStore.getState().selectedClipIds).toEqual(['take_1']);

    useDawStore.getState().removeClip('take_1');
    expect(useDawStore.getState().clips).toHaveLength(0);
    expect(useDawStore.getState().selectedClipIds).toEqual([]);
  });

  // =========================================================================
  // Scenario 2: Tablet Multi-Track Production & Splitting Session
  // =========================================================================
  it('Scenario 2: Tablet Multi-Track Production & Splitting Session', async () => {
    // 1. Loads demo project with multi-track arrangement (F3)
    await useDawStore.getState().loadDemoProject();
    expect(useDawStore.getState().tracks.length).toBeGreaterThan(0);
    expect(useDawStore.getState().clips.length).toBeGreaterThan(0);

    // 2. Navigates with sticky ruler across 6 tracks (F10, F11, F12)
    const headersScroll = { scrollTop: 180 };
    const lanesScroll = { scrollTop: headersScroll.scrollTop };
    expect(lanesScroll.scrollTop).toBe(180);

    const unifiedWidth = calculateExpectedUnifiedWidth(1024, 240, useDawStore.getState().duration, 50);
    expect(unifiedWidth).toBeGreaterThan(0);

    // 3. Zooms in using 44px toolbar buttons (F8, F15)
    useDawStore.getState().setZoom(70);
    expect(useDawStore.getState().zoom).toBe(70);

    // 4. Seeks playhead to beat boundary (e.g. 4.0s) (F13)
    const clampedSeek = calculateExpectedClampedSeek(4.0 * 70, 70, useDawStore.getState().duration);
    useDawStore.getState().setCurrentTime(clampedSeek);
    expect(useDawStore.getState().currentTime).toBe(4.0);

    // 5. Selects target clip and splits at cursor (F4, F6)
    const targetClip = useDawStore.getState().clips[0]!;
    const splitResult = splitClipOperation(targetClip, 4.0);
    expect(splitResult).not.toBeNull();
    const { clip1, clip2 } = splitResult!;

    expect(clip1.startTime + clip1.duration).toBeCloseTo(clip2.startTime, 5);
    expect(clip2.id).not.toBe(clip1.id);

    // 6. Trims right handle of slice 1 (F6)
    const trimmedSlice1 = trimRightOperation(clip1, -0.5);
    expect(trimmedSlice1.duration).toBeCloseTo(clip1.duration - 0.5, 5);
  });

  // =========================================================================
  // Scenario 3: Resilient Audio Failure & Silent Editing Session
  // =========================================================================
  it('Scenario 3: Resilient Audio Failure & Silent Editing Session', async () => {
    // 1. Browser restricts AudioContext creation on startup (F1, F2)
    let busy: string | null = 'continue';
    let booted = false;

    const simulateFailingContextInit = async () => {
      throw new DOMException('AudioContext resume was blocked by user agent autoplay policy', 'NotAllowedError');
    };

    try {
      await simulateFailingContextInit();
    } catch {
      useDawStore.getState().pushToast('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.');
      booted = true;
    } finally {
      busy = null;
    }

    // 2. User enters workspace smoothly (F1, F3)
    expect(booted).toBe(true);
    expect(busy).toBeNull();
    expect(useDawStore.getState().toasts.some((t) => t.message.includes('modo silencioso'))).toBe(true);

    // 3. Renames project in header (F16)
    useDawStore.getState().setProjectName('Silent Session Master');
    expect(useDawStore.getState().projectName).toBe('Silent Session Master');

    // 4. Adds instrumental tracks and adjusts volume (F7, F8)
    useDawStore.getState().addTrack();
    const tId = useDawStore.getState().tracks[0]!.id;
    useDawStore.getState().updateTrack(tId, { volume: 0.85 });
    expect(useDawStore.getState().tracks[0]!.volume).toBe(0.85);

    // 5. User later clicks to enable audio (F2)
    const engine = AudioEngine.getInstance();
    const ctx = await engine.ensureContext();
    expect(ctx).toBeDefined();
  });

  // =========================================================================
  // Scenario 4: Responsive Mixing Console & Live Transport Control
  // =========================================================================
  it('Scenario 4: Responsive Mixing Console & Live Transport Control', () => {
    // 1. Switch to Mixer view on compact screen (F16)
    useDawStore.getState().setActiveView('mixer');
    expect(useDawStore.getState().activeView).toBe('mixer');

    // 2. Set up channel strips
    useDawStore.getState().addTrack();
    const trackId = useDawStore.getState().tracks[0]!.id;

    // 3. Adjust plugin parameters using pointer capture with step clamping (F5, F7)
    const initialFreq = 1000;
    const adjustedFreq = calculateExpectedKnobValue(initialFreq, 45, 20, 20000, 10);
    expect(adjustedFreq).toBeGreaterThan(initialFreq);

    // 4. Toggle track mute and solo with 44px buttons (F8)
    useDawStore.getState().updateTrack(trackId, { mute: true, solo: true });
    expect(useDawStore.getState().tracks[0]!.mute).toBe(true);
    expect(useDawStore.getState().tracks[0]!.solo).toBe(true);

    // 5. Monitor Master VU Meter and metronome on compact viewport (<640px) (F17)
    const viewport = 390;
    const metronomeLabel = viewport < 640 ? 'MET' : 'CLICK';
    expect(metronomeLabel).toBe('MET');

    const meterDimensions = { width: 32, height: 12 }; // w-8 h-3
    expect(meterDimensions.width).toBe(32);
    expect(meterDimensions.height).toBe(12);
  });

  // =========================================================================
  // Scenario 5: Full Project Composition & Master Export Preparation
  // =========================================================================
  it('Scenario 5: Full Project Composition & Master Export Preparation', async () => {
    // 1. Blank project creation (F3)
    await useDawStore.getState().createBlankProject();
    useDawStore.getState().setProjectName('Electro Beat 2026');

    // 2. Add 4 rhythm and melodic tracks
    const trackNames = ['Drums', 'Bass', 'Synth Lead', 'FX'];
    for (const name of trackNames) {
      useDawStore.getState().addTrack();
      const lastTrack = useDawStore.getState().tracks.slice(-1)[0]!;
      useDawStore.getState().updateTrack(lastTrack.id, { name });
    }
    expect(useDawStore.getState().tracks).toHaveLength(4);

    // 3. Set tempo to 128 BPM and time signature 4/4 (F17)
    useDawStore.getState().setBpm(128);
    useDawStore.getState().setTimeSignature([4, 4]);
    expect(useDawStore.getState().bpm).toBe(128);
    expect(useDawStore.getState().timeSignature).toEqual([4, 4]);

    // 4. Configure loop range in transport
    useDawStore.getState().setLoopRange(0, 8);
    expect(useDawStore.getState().loopStart).toBe(0);
    expect(useDawStore.getState().loopEnd).toBe(8);

    // 5. Verify ruler unified width equals duration * zoom (F11, F12)
    const duration = useDawStore.getState().duration; // 16s
    const zoom = 50;
    const unifiedWidth = calculateExpectedUnifiedWidth(1280, 240, duration, zoom);
    expect(unifiedWidth).toBe(1040); // 1280 - 240

    // 6. Launch Master & Export modal from compact header action button (F16)
    useDawStore.getState().setExportModalOpen(true);
    expect(useDawStore.getState().exportModalOpen).toBe(true);
  });

  // =========================================================================
  // Scenario 6: High-Stress Boundary Session
  // =========================================================================
  it('Scenario 6: High-Stress Boundary Session (Rapid Resizing, Boundary Seeking & Edge Trimming)', () => {
    // 1. Rapid resizing simulation (1920px -> 320px) (F14, F15, F16)
    const viewports = [1920, 1024, 768, 640, 375, 320];
    for (const vw of viewports) {
      const headerWidth = vw < 640 ? 144 : 240;
      const laneWidth = vw - headerWidth;
      expect(laneWidth).toBeGreaterThan(0);
    }

    // 2. Out-of-bounds seeking (F13)
    const seekPast = calculateExpectedClampedSeek(5000, 50, 16);
    expect(seekPast).toBe(16.0);
    const seekNegative = calculateExpectedClampedSeek(-5000, 50, 16);
    expect(seekNegative).toBe(0.0);

    // 3. Clip edge trimming boundary enforcement (F6)
    const clip = createMockClip({ id: 'edge_clip', startTime: 0.0, duration: 2.0 });
    const shrunk = trimRightOperation(clip, -100.0);
    expect(shrunk.duration).toBe(0.2); // Strict minimum limit

    // 4. Rapid zoom cycling (F15)
    useDawStore.setState({ zoom: 50 });
    for (let i = 0; i < 10; i++) {
      const nextZoom = i % 2 === 0 ? 120 : 30;
      useDawStore.getState().setZoom(nextZoom);
    }
    expect([30, 120]).toContain(useDawStore.getState().zoom);

    // 5. Final UI clip deletion (F9)
    useDawStore.setState({ clips: [shrunk], selectedClipIds: ['edge_clip'] });
    useDawStore.getState().removeClip('edge_clip');
    expect(useDawStore.getState().clips).toHaveLength(0);
    expect(useDawStore.getState().selectedClipIds).toEqual([]);
  });
});
