// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect } from 'vitest';
import type { AudioClip } from '../types/daw';
import {
  splitClipOperation,
  trimLeftOperation,
  trimRightOperation,
  calculateMagneticSnap,
} from '../audio/timelineOps';

describe('HydraDAW Timeline Operations & Manipulation Math', () => {
  const baseClip: AudioClip = {
    id: 'clip_sample_1',
    trackId: 'track_1',
    name: 'Guitar_Solo.wav',
    startTime: 2.0,
    duration: 8.0,
    offset: 0.0,
    audioBuffer: null,
    peaks: new Float32Array([0, 0]),
  };

  describe('Tier 1: Feature Coverage (Split Clip at Playhead)', () => {
    it('splits a clip into two continuous slices at exact playhead position', () => {
      const splitTime = 5.0; // 3 seconds into the 8-second clip
      const result = splitClipOperation(baseClip, splitTime);

      expect(result).not.toBeNull();
      const { clip1, clip2 } = result!;

      expect(clip1.startTime).toBe(2.0);
      expect(clip1.duration).toBe(3.0);
      expect(clip1.offset).toBe(0.0);

      expect(clip2.startTime).toBe(5.0);
      expect(clip2.duration).toBe(5.0);
      expect(clip2.offset).toBe(3.0); // Continues from exactly 3.0s into buffer
    });

    it('preserves total time and buffer duration after splitting', () => {
      const splitTime = 4.5;
      const result = splitClipOperation(baseClip, splitTime);
      expect(result).not.toBeNull();
      const { clip1, clip2 } = result!;

      expect(clip1.duration + clip2.duration).toBeCloseTo(baseClip.duration, 5);
      expect(clip2.startTime).toBe(clip1.startTime + clip1.duration);
    });

    it('creates a unique ID for the newly generated second clip slice', () => {
      const result = splitClipOperation(baseClip, 6.0);
      expect(result).not.toBeNull();
      expect(result!.clip2.id).not.toBe(baseClip.id);
      expect(result!.clip2.id).toContain('split');
    });

    it('supports sequential splitting: slice 1 can be split again', () => {
      const firstSplit = splitClipOperation(baseClip, 6.0)!;
      expect(firstSplit).not.toBeNull();

      // Split the second piece (from 6.0 to 10.0) at 8.0
      const secondSplit = splitClipOperation(firstSplit.clip2, 8.0)!;
      expect(secondSplit).not.toBeNull();

      expect(secondSplit.clip1.startTime).toBe(6.0);
      expect(secondSplit.clip1.duration).toBe(2.0);
      expect(secondSplit.clip2.startTime).toBe(8.0);
      expect(secondSplit.clip2.duration).toBe(2.0);
      expect(secondSplit.clip2.offset).toBe(firstSplit.clip2.offset + 2.0);
    });

    it('preserves trackId and clip name across split operations', () => {
      const result = splitClipOperation(baseClip, 4.0)!;
      expect(result.clip1.trackId).toBe('track_1');
      expect(result.clip2.trackId).toBe('track_1');
      expect(result.clip1.name).toBe(baseClip.name);
      expect(result.clip2.name).toBe(baseClip.name);
    });
  });

  describe('Tier 1: Feature Coverage (Trim In / Trim Out Bounds)', () => {
    it('trims the left handle forward, adjusting start time, duration, and buffer offset', () => {
      const trimmed = trimLeftOperation(baseClip, 1.5);
      expect(trimmed.startTime).toBe(3.5);
      expect(trimmed.duration).toBe(6.5);
      expect(trimmed.offset).toBe(1.5);
    });

    it('trims the left handle backward, extending earlier when timeline start allows', () => {
      // Fix(waveA): la extensión a la izquierda queda capada por max(-startTime, -offset);
      // con offset 0 no hay audio fuente anterior que revelar -> no-op.
      const trimmed = trimLeftOperation(baseClip, -1.0);
      expect(trimmed.startTime).toBe(2.0);
      expect(trimmed.duration).toBe(8.0);
      expect(trimmed.offset).toBe(0.0);
    });

    it('trims the left handle backward revealing earlier source audio when offset allows', () => {
      // Fix(waveA): con offset > 0 sí se puede extender a la izquierda.
      const withOffset: AudioClip = { ...baseClip, offset: 2.0 };
      const trimmed = trimLeftOperation(withOffset, -1.0);
      expect(trimmed.startTime).toBe(1.0);
      expect(trimmed.duration).toBe(9.0);
      expect(trimmed.offset).toBe(1.0);
    });

    it('trims the right handle forward, extending duration', () => {
      const trimmed = trimRightOperation(baseClip, 2.0);
      expect(trimmed.startTime).toBe(2.0);
      expect(trimmed.duration).toBe(10.0);
      expect(trimmed.offset).toBe(0.0);
    });

    it('trims the right handle backward, shortening duration', () => {
      const trimmed = trimRightOperation(baseClip, -3.0);
      expect(trimmed.startTime).toBe(2.0);
      expect(trimmed.duration).toBe(5.0);
    });

    it('enforces minimum clip duration of 0.2s on aggressive right trimming', () => {
      const trimmed = trimRightOperation(baseClip, -100.0);
      expect(trimmed.duration).toBe(0.2);
    });
  });

  describe('Tier 1: Feature Coverage (Magnetic Snapping Math)', () => {
    it('snaps playhead close to beat boundary (e.g. 1.98s -> 2.00s at 120 BPM)', () => {
      const snap = calculateMagneticSnap(1.98, 120, [4, 4], []);
      expect(snap.isSnapped).toBe(true);
      expect(snap.snappedTime).toBeCloseTo(2.0, 4);
    });

    it('snaps to sixteenth-note grid divisions (e.g. 0.13s -> 0.125s at 120 BPM)', () => {
      const snap = calculateMagneticSnap(0.13, 120, [4, 4], []);
      expect(snap.isSnapped).toBe(true);
      expect(snap.snappedTime).toBeCloseTo(0.125, 4);
    });

    it('does not snap if outside magnetic attraction threshold', () => {
      // 0.30s is halfway between 0.25 and 0.375 (diff = 0.05s, test with small threshold 0.02s)
      const snap = calculateMagneticSnap(0.30, 120, [4, 4], [], 0.02);
      expect(snap.isSnapped).toBe(false);
      expect(snap.snappedTime).toBe(0.30);
    });

    it('prioritizes snapping to existing clip start boundaries', () => {
      const clips = [baseClip]; // starts at 2.0, ends at 10.0
      const snap = calculateMagneticSnap(9.96, 120, [4, 4], clips, 0.1);
      expect(snap.isSnapped).toBe(true);
      expect(snap.snappedTime).toBeCloseTo(10.0, 4);
      expect(snap.target?.type).toBe('clip-end');
    });

    it('snaps cleanly to bar 1 beat 1 (time 0.0)', () => {
      const snap = calculateMagneticSnap(0.04, 120, [4, 4], []);
      expect(snap.isSnapped).toBe(true);
      expect(snap.snappedTime).toBeCloseTo(0.0, 4);
    });
  });

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('rejects split attempt before or exactly at clip startTime', () => {
      expect(splitClipOperation(baseClip, 2.0)).toBeNull();
      expect(splitClipOperation(baseClip, 1.5)).toBeNull();
      expect(splitClipOperation(baseClip, 0.0)).toBeNull();
    });

    it('rejects split attempt at or beyond clip endTime (startTime + duration)', () => {
      expect(splitClipOperation(baseClip, 10.0)).toBeNull();
      expect(splitClipOperation(baseClip, 12.5)).toBeNull();
    });

    it('rejects split attempt too close to boundaries (< 0.2s minimum duration)', () => {
      expect(splitClipOperation(baseClip, 2.1)).toBeNull(); // 0.1s slice
      expect(splitClipOperation(baseClip, 9.9)).toBeNull(); // 0.1s remaining slice
    });

    it('prevents left trim from moving clip start into negative time (< 0.0)', () => {
      // Fix(waveA): con offset suficiente el trim llega hasta 0.0 pero no más allá.
      const withOffset: AudioClip = { ...baseClip, offset: 3.0 };
      const trimmed = trimLeftOperation(withOffset, -50.0);
      expect(trimmed.startTime).toBe(0.0);
      expect(trimmed.offset).toBe(1.0);
    });

    it('prevents left trim beyond available source offset (offset 0 -> no-op)', () => {
      // Fix(waveA): clampedDelta = clamp(delta, max(-startTime, -offset), ...); offset 0 bloquea.
      const trimmed = trimLeftOperation(baseClip, -50.0);
      expect(trimmed.startTime).toBe(2.0);
      expect(trimmed.offset).toBe(0.0);
    });

    it('prevents left trim from shrinking duration below 0.2s', () => {
      const trimmed = trimLeftOperation(baseClip, 50.0);
      expect(trimmed.duration).toBeCloseTo(0.2, 5);
    });
  });

  describe('Tier 3: Cross-Feature Combinations', () => {
    it('combines split and snap: split at snapped beat position', () => {
      const rawPlayheadTime = 4.02; // near bar 3 (4.0s at 120 bpm)
      const snap = calculateMagneticSnap(rawPlayheadTime, 120, [4, 4], []);
      expect(snap.isSnapped).toBe(true);

      const split = splitClipOperation(baseClip, snap.snappedTime);
      expect(split).not.toBeNull();
      expect(split!.clip1.duration).toBeCloseTo(2.0, 4);
      expect(split!.clip2.startTime).toBeCloseTo(4.0, 4);
    });

    it('verifies non-overlapping contiguous clip placement across multiple splits', () => {
      let currentClip = baseClip;
      const splitTimes = [4.0, 6.0, 8.0];
      const pieces: AudioClip[] = [];

      for (const time of splitTimes) {
        const res = splitClipOperation(currentClip, time);
        expect(res).not.toBeNull();
        pieces.push(res!.clip1);
        currentClip = res!.clip2;
      }
      pieces.push(currentClip);

      expect(pieces.length).toBe(4);
      for (let i = 0; i < pieces.length - 1; i++) {
        expect(pieces[i]!.startTime + pieces[i]!.duration).toBeCloseTo(pieces[i + 1]!.startTime, 5);
      }
    });
  });
});
