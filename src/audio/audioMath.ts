/**
 * Standard audio math utilities (dBFS <-> linear gain, pan laws, time/sample
 * conversions, peak/RMS metering).
 * Authoritative implementations matching AES and Web Audio API specifications.
 * MasterBus ceiling (-0.1 dBFS) and limiter ranges derive from {@link dbToLinear}.
 */

/** Converts dBFS to linear gain. Floors at -100 dBFS (returns 0). */
export function dbToLinear(db: number): number {
  if (db <= -100) return 0;
  return Math.pow(10, db / 20);
}

/** Converts linear gain to dBFS. Returns -Infinity for non-positive input. */
export function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

/** Converts seconds to sample frames (floored). Returns 0 for negative time. */
export function secondsToSamples(seconds: number, sampleRate: number): number {
  if (seconds < 0) return 0;
  return Math.floor(seconds * sampleRate);
}

/** Converts sample frames to seconds. Returns 0 for invalid rate/count. */
export function samplesToSeconds(samples: number, sampleRate: number): number {
  if (samples < 0 || sampleRate <= 0) return 0;
  return samples / sampleRate;
}

/** Linear stereo pan law. Pan is clamped to [-1, 1]. */
export function calculateLinearPan(pan: number): { left: number; right: number } {
  // Clamped between -1 and +1
  const clampedPan = Math.max(-1, Math.min(1, pan));
  return {
    left: (1 - clampedPan) / 2,
    right: (1 + clampedPan) / 2,
  };
}

/** Constant-power (-3 dB center) stereo pan law. Pan is clamped to [-1, 1]. */
export function calculateConstantPowerPan(pan: number): { left: number; right: number } {
  const clampedPan = Math.max(-1, Math.min(1, pan));
  const angle = ((clampedPan + 1) * Math.PI) / 4; // 0 to PI/2
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    left: Math.abs(cos) < 1e-10 ? 0 : cos,
    right: Math.abs(sin) < 1e-10 ? 0 : sin,
  };
}

/**
 * Default studio pan law (constant-power). Alias of
 * {@link calculateConstantPowerPan}.
 */
export const panLaw = calculateConstantPowerPan;

/** Computes peak amplitude and RMS level of a mono sample buffer. */
export function calculatePeakAndRMS(samples: Float32Array): { peak: number; rms: number } {
  if (samples.length === 0) return { peak: 0, rms: 0 };
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    // Fix(waveB-ts): noUncheckedIndexedAccess → samples[i] es number|undefined.
    const abs = Math.abs(samples[i] ?? 0);
    if (abs > peak) peak = abs;
    sum += abs * abs;
  }
  return {
    peak,
    rms: Math.sqrt(sum / samples.length),
  };
}

/** Alias of {@link calculatePeakAndRMS} (meter-friendly name). */
export const peakRMS = calculatePeakAndRMS;

/** Peak amplitude only (meter helper). Returns 0 for empty buffers. */
export function calculatePeak(samples: Float32Array): number {
  return calculatePeakAndRMS(samples).peak;
}

/** RMS level only (meter helper). Returns 0 for empty buffers. */
export function calculateRMS(samples: Float32Array): number {
  return calculatePeakAndRMS(samples).rms;
}
