import React, { useEffect, useRef } from 'react';
import { AudioClip } from '../../types/daw';
import { useDawStore } from '../../store/useDawStore';

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
  const { zoom, updateClip, setSelectedClip } = useDawStore();

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
      const min = peaks[i * 2];
      const max = peaks[i * 2 + 1];

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
  }, [clip.peaks, width, height, clip.color]);

  // Handle Drag Move & Trim
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedClip(clip.id);

    const startX = e.clientX;
    const initialStartTime = clip.startTime;
    const initialDuration = clip.duration;

    // Detect if clicking near left or right edge for trimming
    const rect = e.currentTarget.getBoundingClientRect();
    const clickOffset = e.clientX - rect.left;
    const isTrimLeft = clickOffset < 12;
    const isTrimRight = clickOffset > rect.width - 12;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaTime = deltaX / zoom;

      if (isTrimLeft) {
        const newStart = Math.max(0, initialStartTime + deltaTime);
        const newDuration = Math.max(0.2, initialDuration - deltaTime);
        updateClip(clip.id, { startTime: newStart, duration: newDuration });
      } else if (isTrimRight) {
        const newDuration = Math.max(0.2, initialDuration + deltaTime);
        updateClip(clip.id, { duration: newDuration });
      } else {
        // Move clip
        const newStart = Math.max(0, initialStartTime + deltaTime);
        updateClip(clip.id, { startTime: newStart });
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
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

      {/* Trimming Grab Handles */}
      <div className="absolute top-0 bottom-0 left-0 w-2.5 hover:bg-cyan-400/40 cursor-ew-resize opacity-0 hover:opacity-100 transition-opacity" />
      <div className="absolute top-0 bottom-0 right-0 w-2.5 hover:bg-cyan-400/40 cursor-ew-resize opacity-0 hover:opacity-100 transition-opacity" />
    </div>
  );
};
