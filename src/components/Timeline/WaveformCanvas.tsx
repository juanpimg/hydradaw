import React, { useEffect, useRef } from 'react';
import type { AudioClip } from '../../types/daw';
import { useDawStore } from '../../store/useDawStore';
import { calculateMagneticSnap } from '../../audio/timelineOps';
import { audioEngine } from '../../audio/AudioEngine';

interface WaveformCanvasProps {
  clip: AudioClip;
  width: number;
  height: number;
  isSelected: boolean;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  clip,
  width,
  height,
  isSelected,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoom = useDawStore((s) => s.zoom);
  const updateClip = useDawStore((s) => s.updateClip);
  const setSelectedClip = useDawStore((s) => s.setSelectedClip);
  const setSelectedTrack = useDawStore((s) => s.setSelectedTrack);
  const removeClip = useDawStore((s) => s.removeClip);
  const splitClip = useDawStore((s) => s.splitClip);

  // Fix(waveA): al seleccionar el clip, sincronizar también la pista seleccionada.
  const selectClip = () => {
    setSelectedClip(clip.id);
    setSelectedTrack(clip.trackId);
  };

  // Draw 60 FPS waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Draw background
    ctx.fillStyle = clip.color ? `${clip.color}15` : 'rgba(6, 182, 212, 0.08)';
    ctx.fillRect(0, 0, width, height);

    const peaks = clip.peaks;
    const numPairs = peaks ? peaks.length / 2 : 0;
    if (numPairs === 0) return;

    const halfHeight = height / 2;

    // Gradient styling for peaks
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    const color = clip.color || '#06b6d4';
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, color);

    ctx.fillStyle = grad;

    const step = width / numPairs;

    for (let i = 0; i < numPairs; i++) {
      // Fix(waveB-ts): noUncheckedIndexedAccess → picos tipados como number|undefined.
      const min = peaks[i * 2] ?? 0;
      const max = peaks[i * 2 + 1] ?? 0;

      const x = i * step;
      const yTop = halfHeight - Math.abs(max) * (halfHeight - 4);
      const yBottom = halfHeight + Math.abs(min) * (halfHeight - 4);
      const barHeight = Math.max(1.5, yBottom - yTop);

      ctx.fillRect(x, yTop, Math.max(1, step * 0.9), barHeight);
    }

    // Center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, halfHeight);
    ctx.lineTo(width, halfHeight);
    ctx.stroke();

    // Render Fade-In visual overlay
    if (clip.fadeIn && clip.fadeIn > 0 && clip.duration > 0) {
      const fadeWidth = Math.min(width, (clip.fadeIn / clip.duration) * width);
      ctx.fillStyle = 'rgba(6, 182, 212, 0.25)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(fadeWidth, 0);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)';
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(fadeWidth, 0);
      ctx.stroke();
    }

    // Render Fade-Out visual overlay
    if (clip.fadeOut && clip.fadeOut > 0 && clip.duration > 0) {
      const fadeWidth = Math.min(width, (clip.fadeOut / clip.duration) * width);
      const startX = width - fadeWidth;
      ctx.fillStyle = 'rgba(6, 182, 212, 0.25)';
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(width, 0);
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)';
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(width, height);
      ctx.stroke();
    }
  }, [clip.peaks, width, height, clip.color, clip.fadeIn, clip.fadeOut, clip.duration]);

  // Handle Drag Move & Trim
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectClip();

    const startX = e.clientX;
    const initialStartTime = clip.startTime;
    const initialDuration = clip.duration;
    const initialOffset = clip.offset;
    // Fix: duración máxima disponible en el buffer para clampear trimRight.
    // Fix(waveB): solo `audioBuffer` (alias `buffer` eliminado).
    const bufferDuration = clip.audioBuffer?.duration ?? Number.POSITIVE_INFINITY;

    const clipEl = e.currentTarget as HTMLElement;
    let pendingUpdates: Partial<typeof clip> | null = null;
    let hasMoved = false;

    // Detect if clicking near left or right edge for trimming
    const rect = e.currentTarget.getBoundingClientRect();
    const clickOffset = e.clientX - rect.left;
    // Fix: zona trim ergonómica ampliada a 12px con cursor col-resize.
    const edge = Math.min(12, Math.max(8, width * 0.2));
    const canTrim = width >= 20;
    const isTrimLeft = canTrim && clickOffset < edge;
    const isTrimRight = canTrim && clickOffset > rect.width - edge;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      if (Math.abs(deltaX) > 2) hasMoved = true;
      const deltaTime = deltaX / zoom;

      if (isTrimLeft) {
        // Fix: clamp del delta y actualización visual inmediata
        const maxDelta = initialDuration - 0.2;
        const clampedDelta = Math.max(-initialStartTime, -initialOffset, Math.min(maxDelta, deltaTime));
        const newStart = Math.max(0, initialStartTime + clampedDelta);
        const newDuration = Math.max(0.2, initialDuration - clampedDelta);
        const newOffset = Math.max(0, initialOffset + clampedDelta);
        pendingUpdates = { startTime: newStart, duration: newDuration, offset: newOffset };
        clipEl.style.transform = `translateX(${clampedDelta * zoom}px)`;
        clipEl.style.width = `${newDuration * zoom}px`;
      } else if (isTrimRight) {
        // Fix: clamp contra buffer.duration para no extender más allá del audio disponible.
        const maxDuration = Math.max(0.2, bufferDuration - initialOffset);
        const newDuration = Math.min(Math.max(0.2, initialDuration + deltaTime), maxDuration);
        pendingUpdates = { duration: newDuration };
        clipEl.style.width = `${newDuration * zoom}px`;
      } else {
        // Move clip con transformación suave en tiempo real sin reiniciar audio a cada pixel
        const st = useDawStore.getState();
        const rawStart = Math.max(0, initialStartTime + deltaTime);
        const others = st.clips.filter((c) => c.id !== clip.id);
        const { snappedTime } = calculateMagneticSnap(rawStart, st.bpm, st.timeSignature, others, 0.1, st.snapMode);
        const maxStart = Math.max(0, st.duration - initialDuration);
        const newStart = Math.min(Math.max(0, snappedTime), maxStart);
        pendingUpdates = { startTime: newStart };
        clipEl.style.transform = `translateX(${(newStart - initialStartTime) * zoom}px)`;
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      clipEl.style.transform = '';
      if (hasMoved && pendingUpdates) {
        updateClip(clip.id, pendingUpdates);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Fix(waveA): clip focuseable con borrado/corte por teclado.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation();
      removeClip(clip.id);
    } else if (e.key === 's' || e.key === 'S') {
      e.stopPropagation();
      const currTime = audioEngine.getCurrentTime();
      splitClip(clip.id, currTime);
    }
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      // Fix: el lane deselecciona en onClick; sin esto el click posterior al
      // mousedown borraba la selección y ningún clip quedaba seleccionable con ratón.
      onClick={(e) => e.stopPropagation()}
      onFocus={selectClip}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="option"
      aria-selected={isSelected}
      aria-label={`Clip ${clip.name}`}
      className={`absolute top-1 bottom-1 rounded-lg overflow-hidden cursor-move border transition-shadow select-none ${
        isSelected
          ? 'border-white ring-2 ring-cyan-400 shadow-lg shadow-cyan-500/30 z-10'
          : 'border-white/20 hover:border-white/50'
      }`}
      style={{
        left: `${clip.startTime * zoom}px`,
        width: `${width}px`,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: `${width}px`, height: `${height}px` }}
        className="block"
      />

      {/* Clip Name Header Badge */}
      <div className="absolute top-1 left-2 flex items-center space-x-1.5 pointer-events-none">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-white border border-white/20 truncate max-w-[140px]"
        >
          {clip.name}
        </span>
        <span className="text-[9px] font-mono text-slate-300 bg-black/40 px-1 py-0.2 rounded">
          {clip.duration.toFixed(1)}s
        </span>
      </div>

      {/* Trimming Grab Handles (12px, high visibility on hover/touch) */}
      <div
        className="absolute top-0 bottom-0 left-0 w-3 hover:bg-cyan-400/50 cursor-col-resize opacity-25 hover:opacity-100 transition-opacity flex items-center justify-center bg-gradient-to-r from-cyan-400/30 to-transparent"
        title="Recortar inicio (Trim Izq)"
      >
        <div className="w-0.5 h-3.5 bg-cyan-200/80 rounded-full pointer-events-none" />
      </div>
      <div
        className="absolute top-0 bottom-0 right-0 w-3 hover:bg-cyan-400/50 cursor-col-resize opacity-25 hover:opacity-100 transition-opacity flex items-center justify-center bg-gradient-to-l from-cyan-400/30 to-transparent"
        title="Recortar final (Trim Der)"
      >
        <div className="w-0.5 h-3.5 bg-cyan-200/80 rounded-full pointer-events-none" />
      </div>
    </div>
  );
};
