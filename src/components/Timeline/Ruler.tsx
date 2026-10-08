import React, { useRef } from 'react';
import { useDawStore } from '../../store/useDawStore';

export const Ruler: React.FC = () => {
  const { duration, zoom, bpm, timeSignature, currentTime, setCurrentTime } = useDawStore();
  const rulerRef = useRef<HTMLDivElement>(null);

  const beatDuration = 60 / bpm;
  const barDuration = beatDuration * timeSignature[0];
  const totalBars = Math.ceil(duration / barDuration);
  const totalWidth = duration * zoom;

  const handleSeek = (e: React.MouseEvent) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = Math.max(0, clickX / zoom);
    setCurrentTime(newTime);
  };

  const bars = [];
  for (let bar = 1; bar <= totalBars; bar++) {
    const leftPx = (bar - 1) * barDuration * zoom;
    bars.push(
      <div
        key={bar}
        className="absolute top-0 bottom-0 border-l border-dark-border/80 flex flex-col justify-between pl-1 pointer-events-none"
        style={{ left: `${leftPx}px` }}
      >
        <span className="text-[10px] font-mono text-slate-400 font-medium">{bar}</span>
        <div className="flex space-x-2">
          {Array.from({ length: timeSignature[0] - 1 }).map((_, beatIdx) => (
            <div
              key={beatIdx}
              className="h-1.5 w-px bg-dark-border/40"
              style={{ marginLeft: `${beatDuration * zoom}px` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rulerRef}
      onClick={handleSeek}
      className="h-7 bg-dark-surfaceLight/50 border-b border-dark-border relative cursor-pointer select-none overflow-hidden"
      style={{ width: `${Math.max(window.innerWidth, totalWidth)}px` }}
    >
      {bars}

      {/* Playhead marker indicator on ruler */}
      <div
        className="absolute top-0 bottom-0 w-2.5 -ml-[5px] flex items-center justify-center z-10 pointer-events-none"
        style={{ left: `${currentTime * zoom}px` }}
      >
        <div className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[8px] border-t-cyan-400" />
      </div>
    </div>
  );
};
