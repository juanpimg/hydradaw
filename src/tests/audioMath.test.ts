import { describe, it, expect } from 'vitest';
import {
  dbToLinear,
  linearToDb,
  secondsToSamples,
  samplesToSeconds,
  calculateLinearPan,
  calculateConstantPowerPan,
  calculatePeakAndRMS,
} from '../audio/audioMath';

describe('HydraDAW Audio Math & DSP Calculations', () => {
  describe('Tier 1: Feature Coverage (dBFS <-> Linear Gain)', () => {
    it('converts 0 dBFS to linear unity gain 1.0', () => {
      expect(dbToLinear(0)).toBeCloseTo(1.0, 5);
      expect(linearToDb(1.0)).toBeCloseTo(0.0, 5);
    });

    it('converts -6 dBFS to approximately 0.5012 linear gain', () => {
      const linear = dbToLinear(-6);
      expect(linear).toBeCloseTo(0.501187, 4);
      expect(linearToDb(linear)).toBeCloseTo(-6.0, 4);
    });

    it('converts -20 dBFS to 0.1000 linear gain', () => {
      expect(dbToLinear(-20)).toBeCloseTo(0.1, 4);
      expect(linearToDb(0.1)).toBeCloseTo(-20.0, 4);
    });

    it('converts +6 dBFS boost to approximately 1.995 linear gain', () => {
      expect(dbToLinear(6)).toBeCloseTo(1.99526, 4);
      expect(linearToDb(1.99526)).toBeCloseTo(6.0, 4);
    });

    it('calculates the studio brickwall limiter ceiling at -0.1 dBFS', () => {
      const ceiling = dbToLinear(-0.1);
      expect(ceiling).toBeCloseTo(0.988553, 5);
      expect(linearToDb(ceiling)).toBeCloseTo(-0.1, 4);
    });
  });

  describe('Tier 1: Feature Coverage (Stereo Panning Laws)', () => {
    it('balances stereo channels equally at center pan (pan = 0)', () => {
      const lin = calculateLinearPan(0);
      expect(lin.left).toBeCloseTo(0.5, 5);
      expect(lin.right).toBeCloseTo(0.5, 5);

      const constPower = calculateConstantPowerPan(0);
      expect(constPower.left).toBeCloseTo(Math.SQRT1_2, 5); // ~0.7071 (-3dB)
      expect(constPower.right).toBeCloseTo(Math.SQRT1_2, 5);
      expect(constPower.left * constPower.left + constPower.right * constPower.right).toBeCloseTo(1.0, 5);
    });

    it('silences right channel and isolates left channel at hard left (pan = -1)', () => {
      const lin = calculateLinearPan(-1);
      expect(lin.left).toBeCloseTo(1.0, 5);
      expect(lin.right).toBeCloseTo(0.0, 5);

      const cp = calculateConstantPowerPan(-1);
      expect(cp.left).toBeCloseTo(1.0, 5);
      expect(cp.right).toBeCloseTo(0.0, 5);
    });

    it('silences left channel and isolates right channel at hard right (pan = +1)', () => {
      const lin = calculateLinearPan(1);
      expect(lin.left).toBeCloseTo(0.0, 5);
      expect(lin.right).toBeCloseTo(1.0, 5);

      const cp = calculateConstantPowerPan(1);
      expect(cp.left).toBeCloseTo(0.0, 5);
      expect(cp.right).toBeCloseTo(1.0, 5);
    });

    it('preserves energy conservation across 5 intermediate pan positions', () => {
      const panPositions = [-0.75, -0.5, -0.25, 0.25, 0.5, 0.75];
      for (const p of panPositions) {
        const { left, right } = calculateConstantPowerPan(p);
        const energySum = left * left + right * right;
        expect(energySum).toBeCloseTo(1.0, 5);
      }
    });

    it('clamps out-of-range pan values beyond [-1, 1] without NaN', () => {
      const under = calculateConstantPowerPan(-2.5);
      expect(under.left).toBeCloseTo(1.0, 5);
      expect(under.right).toBeCloseTo(0.0, 5);

      const over = calculateConstantPowerPan(3.14);
      expect(over.left).toBeCloseTo(0.0, 5);
      expect(over.right).toBeCloseTo(1.0, 5);
    });
  });

  describe('Tier 1: Feature Coverage (Time <-> Sample Conversions)', () => {
    it('converts seconds to exact sample indices at 44.1 kHz', () => {
      expect(secondsToSamples(1.0, 44100)).toBe(44100);
      expect(secondsToSamples(0.5, 44100)).toBe(22050);
      expect(secondsToSamples(0.125, 44100)).toBe(5512); // 16th note at 120 bpm
    });

    it('converts seconds to exact sample indices at 48.0 kHz', () => {
      expect(secondsToSamples(1.0, 48000)).toBe(48000);
      expect(secondsToSamples(0.25, 48000)).toBe(12000);
      expect(secondsToSamples(0.001, 48000)).toBe(48); // 1 millisecond
    });

    it('converts sample count back to accurate fractional seconds', () => {
      expect(samplesToSeconds(44100, 44100)).toBeCloseTo(1.0, 6);
      expect(samplesToSeconds(24000, 48000)).toBeCloseTo(0.5, 6);
      expect(samplesToSeconds(96000, 96000)).toBeCloseTo(1.0, 6);
    });

    it('computes exact samples for musical bar lengths (4/4 at 120 BPM)', () => {
      // 120 BPM = 2 beats per second => 1 bar (4 beats) = 2.0 seconds
      const barDurationSec = (60 / 120) * 4;
      expect(barDurationSec).toBe(2.0);
      const samplesInBar = secondsToSamples(barDurationSec, 48000);
      expect(samplesInBar).toBe(96000);
    });

    it('computes exact samples for 140 BPM EDM tempo', () => {
      const beatSec = 60 / 140;
      const samplesPerBeat = secondsToSamples(beatSec, 44100);
      expect(samplesPerBeat).toBe(18900);
    });
  });

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('handles negative or zero linear gain properly', () => {
      expect(linearToDb(0)).toBe(-Infinity);
      expect(linearToDb(-1.5)).toBe(-Infinity);
    });

    it('handles extreme attenuation (-100 dBFS or lower) by returning 0 gain', () => {
      expect(dbToLinear(-100)).toBe(0);
      expect(dbToLinear(-144)).toBe(0); // 24-bit dynamic range floor
    });

    it('handles empty sample buffers without division by zero', () => {
      const empty = new Float32Array(0);
      const { peak, rms } = calculatePeakAndRMS(empty);
      expect(peak).toBe(0);
      expect(rms).toBe(0);
    });

    it('handles negative seconds gracefully', () => {
      expect(secondsToSamples(-1.5, 44100)).toBe(0);
    });

    it('handles invalid sample rate gracefully', () => {
      expect(samplesToSeconds(1000, 0)).toBe(0);
      expect(samplesToSeconds(1000, -44100)).toBe(0);
    });
  });

  describe('Tier 3: Peak and RMS Dynamics Verification', () => {
    it('calculates true theoretical RMS (0.7071) for a pure sine tone', () => {
      const sampleRate = 44100;
      const freq = 440;
      const length = sampleRate; // 1 second
      const sine = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        sine[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
      }

      const { peak, rms } = calculatePeakAndRMS(sine);
      expect(peak).toBeCloseTo(1.0, 3);
      expect(rms).toBeCloseTo(Math.SQRT1_2, 2); // 1 / sqrt(2) ≈ 0.7071
    });

    it('measures peak and RMS for silence as exactly zero', () => {
      const silence = new Float32Array(1024);
      const { peak, rms } = calculatePeakAndRMS(silence);
      expect(peak).toBe(0);
      expect(rms).toBe(0);
    });

    it('measures peak for a full-scale DC spike as 1.0', () => {
      const spike = new Float32Array(100);
      spike[50] = 1.0;
      const { peak, rms } = calculatePeakAndRMS(spike);
      expect(peak).toBe(1.0);
      expect(rms).toBeCloseTo(Math.sqrt(1 / 100), 5); // 0.1
    });
  });
});
