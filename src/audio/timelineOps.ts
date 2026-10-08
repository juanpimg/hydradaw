/*
 * DIVERGENCIA DETECTADA con useDawStore.splitClip (src/store/useDawStore.ts:277)
 * para que la siguiente iteración unifique el store con este módulo:
 * 1. minDuration: este módulo exige 0.2 s mínimos por slice (rechaza splits a
 *    < 0.2 s de cualquier borde y satura los trims a 0.2 s). El store solo
 *    comprueba `atTime <= startTime || atTime >= startTime + duration`, por lo
 *    que permite slices arbitrariamente pequeños (p. ej. 0.1 s o 1 muestra).
 * 2. ids: este módulo genera `clip_split_<parentId>_<ms>_<base36time>_<rand>`
 *    (único incluso en splits secuenciales dentro del mismo ms). El store usa
 *    `'clip_' + Date.now()` (colisionable: dos splits en el mismo ms generan el
 *    mismo id y rompen selección/referencia). Además pierde el parentId y el
 *    punto de corte, útiles para depurar/deshacer.
 * 3. trim: el store no expone trimLeft/trimRight (solo updateClip genérico);
 *    este módulo aporta trimLeftOperation (ajusta start/duration/offset, nunca
 *    start < 0 ni offset < 0) y trimRightOperation (satura a minDuration y a
 *    `buffer.duration - offset` cuando hay AudioBuffer disponible).
 * Acción propuesta (otra iteración): hacer que splitClip/trim del store deleguen
 * en splitClipOperation/trimLeftOperation/trimRightOperation de este módulo.
 */

import type { AudioClip } from '../types/daw';

/** Minimum clip/trim duration in seconds. */
export const MIN_CLIP_DURATION = 0.2;

export interface SplitResult {
  clip1: AudioClip;
  clip2: AudioClip;
}

/**
 * Splits a clip into two contiguous slices at `atTime`.
 * Returns null when the cut is outside bounds or would leave a slice
 * shorter than `minDuration`. The second slice gets a unique id.
 */
export function splitClipOperation(
  clip: AudioClip,
  atTime: number,
  minDuration: number = MIN_CLIP_DURATION
): SplitResult | null {
  // Must be strictly within bounds and respect minimum duration for both resulting slices
  if (atTime <= clip.startTime + minDuration || atTime >= clip.startTime + clip.duration - minDuration) {
    return null;
  }

  const firstDuration = atTime - clip.startTime;
  let secondDuration = clip.duration - firstDuration;
  const secondOffset = clip.offset + firstDuration;

  // Fix(waveA): capar secondDuration al audio fuente disponible
  // (`audioBuffer.duration - secondOffset`); null si el resto < minDuration.
  // Fix(waveB): tolerancia legacy en runtime — datos viejos pueden traer `buffer`
  // en lugar de `audioBuffer` (el tipo ya solo declara `audioBuffer`).
  const sourceDuration = clip.audioBuffer?.duration ?? (clip as unknown as { buffer?: AudioBuffer | null }).buffer?.duration;
  if (typeof sourceDuration === 'number' && Number.isFinite(sourceDuration)) {
    const maxSecond = sourceDuration - secondOffset;
    if (maxSecond < minDuration) {
      return null;
    }
    secondDuration = Math.min(secondDuration, maxSecond);
    if (secondDuration < minDuration) {
      return null;
    }
  }

  const clip1: AudioClip = {
    ...clip,
    duration: firstDuration,
  };

  const clip2: AudioClip = {
    ...clip,
    id: `clip_split_${clip.id}_${Math.round(atTime * 1000)}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`,
    startTime: atTime,
    duration: secondDuration,
    offset: secondOffset,
  };

  return { clip1, clip2 };
}

/**
 * Trims the left handle by `deltaSeconds` (> 0 shortens from the left).
 * Adjusts startTime/duration/offset; clamps start >= 0, offset >= 0 and
 * duration >= `minDuration`.
 */
export function trimLeftOperation(
  clip: AudioClip,
  deltaSeconds: number,
  minDuration: number = MIN_CLIP_DURATION
): AudioClip {
  // Fix(waveA): clampedDelta = clamp(delta, max(-startTime, -offset), duration - minDuration).
  const maxDelta = clip.duration - minDuration;
  const lowerBound = Math.max(-clip.startTime, -clip.offset);
  const clampedDelta = Math.max(lowerBound, Math.min(maxDelta, deltaSeconds));
  const newStart = Math.max(0, clip.startTime + clampedDelta);
  const newDuration = Math.max(minDuration, clip.duration - clampedDelta);
  const newOffset = Math.max(0, clip.offset + clampedDelta);

  return {
    ...clip,
    startTime: newStart,
    duration: newDuration,
    offset: newOffset,
  };
}

/**
 * Trims the right handle by `deltaSeconds` (> 0 extends).
 * Clamps duration to >= `minDuration` and, when an AudioBuffer is available,
 * to <= `audioBuffer.duration - offset` so the clip never exceeds its source.
 * Fix(waveB): alias `buffer` eliminado — unificado en `audioBuffer` (con fallback legacy en runtime).
 */
export function trimRightOperation(
  clip: AudioClip,
  deltaSeconds: number,
  minDuration: number = MIN_CLIP_DURATION
): AudioClip {
  // Fix(waveB): tolerancia legacy en runtime — datos viejos pueden traer `buffer`
  // en lugar de `audioBuffer` (el tipo ya solo declara `audioBuffer`).
  const sourceDuration = clip.audioBuffer?.duration ?? (clip as unknown as { buffer?: AudioBuffer | null }).buffer?.duration;
  let maxDuration = Infinity;
  if (typeof sourceDuration === 'number' && Number.isFinite(sourceDuration)) {
    maxDuration = Math.max(minDuration, sourceDuration - clip.offset);
  }
  const newDuration = Math.min(maxDuration, Math.max(minDuration, clip.duration + deltaSeconds));
  return {
    ...clip,
    duration: newDuration,
  };
}

export interface SnapTarget {
  time: number;
  type: 'grid' | 'clip-start' | 'clip-end';
}

/**
 * Magnetic snap: snaps `targetTime` to the nearest sixteenth-note grid line
 * or clip boundary within `thresholdSeconds`. Clip boundaries win ties.
 *
 * Fix(waveA): la rejilla usa el denominador del compás
 * (sixteenth = (60/bpm) * (4/den) / 4) en vez de asumir 4/4, y la ventana de
 * grid cubre todas las líneas con |t - target| <= threshold (no ±2 fijos).
 */
export function calculateMagneticSnap(
  targetTime: number,
  bpm: number,
  timeSignature: [number, number],
  existingClips: AudioClip[],
  thresholdSeconds: number = 0.1
): { snappedTime: number; isSnapped: boolean; target?: SnapTarget } {
  const den = timeSignature?.[1] > 0 ? timeSignature[1] : 4;
  const beatSec = 60 / bpm;
  // Fix(waveA): denominador del compás (en 6/8 la corchea lleva el pulso).
  const sixteenthSec = (beatSec * (4 / den)) / 4;

  const snapTargets: SnapTarget[] = [];

  // 1. Grid targets: todas las líneas con |t - target| <= threshold.
  const lo = Math.max(0, targetTime - thresholdSeconds);
  const hi = targetTime + thresholdSeconds;
  const firstIndex = Math.max(0, Math.floor(lo / sixteenthSec));
  const lastIndex = Math.ceil(hi / sixteenthSec);
  for (let idx = firstIndex; idx <= lastIndex; idx++) {
    const gridTime = idx * sixteenthSec;
    if (gridTime >= 0 && Math.abs(gridTime - targetTime) <= thresholdSeconds) {
      snapTargets.push({ time: gridTime, type: 'grid' });
    }
  }

  // 2. Existing clip boundaries
  for (const c of existingClips) {
    snapTargets.push({ time: c.startTime, type: 'clip-start' });
    snapTargets.push({ time: c.startTime + c.duration, type: 'clip-end' });
  }

  // Find closest snap target within threshold
  let bestTarget: SnapTarget | null = null;
  let minDiff = Infinity;

  // Prioritize clip boundary targets over grid targets if equidistant
  const sortedTargets = [...snapTargets].sort((a, b) => {
    const aIsClip = a.type !== 'grid';
    const bIsClip = b.type !== 'grid';
    if (aIsClip && !bIsClip) return -1;
    if (!aIsClip && bIsClip) return 1;
    return 0;
  });

  for (const target of sortedTargets) {
    const diff = Math.abs(target.time - targetTime);
    if (diff <= thresholdSeconds && diff < minDiff - 0.0001) {
      minDiff = diff;
      bestTarget = target;
    }
  }

  if (bestTarget) {
    return { snappedTime: bestTarget.time, isSnapped: true, target: bestTarget };
  }

  return { snappedTime: targetTime, isSnapped: false };
}
