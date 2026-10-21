import React, { useEffect, useRef, useState } from 'react';
import { useDawStore } from '../../store/useDawStore';
import { audioEngine } from '../../audio/AudioEngine';

export const Ruler: React.FC<{ lanesWidth?: number }> = ({ lanesWidth }) => {
  const duration = useDawStore((s) => s.duration);
  const zoom = useDawStore((s) => s.zoom);
  const bpm = useDawStore((s) => s.bpm);
  const timeSignature = useDawStore((s) => s.timeSignature);
  const setCurrentTime = useDawStore((s) => s.setCurrentTime);
  const isPlaying = useDawStore((s) => s.isPlaying);

  const rulerRef = useRef<HTMLDivElement>(null);
  const playheadMarkerRef = useRef<HTMLDivElement>(null);
  // Fix: suscribe al resize con listener + cleanup en lugar de leer window.innerWidth solo en render.
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 0
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let animId: number;
    const updateMarker = () => {
      if (playheadMarkerRef.current) {
        const time = audioEngine.getCurrentTime();
        playheadMarkerRef.current.style.transform = `translateX(${time * zoom}px)`;
      }
    };
    updateMarker();

    const unsub = audioEngine.onTimeUpdate((time) => {
      if (playheadMarkerRef.current) {
        playheadMarkerRef.current.style.transform = `translateX(${time * zoom}px)`;
      }
    });

    if (isPlaying) {
      const loop = () => {
        updateMarker();
        animId = requestAnimationFrame(loop);
      };
      animId = requestAnimationFrame(loop);
    }

    return () => {
      unsub();
      if (animId) cancelAnimationFrame(animId);
    };
  }, [zoom, isPlaying]);

  const beatDuration = 60 / bpm;
  // Fix: usa el denominador del compás (p.ej. 6/8 → pulso de corchea = mitad de negra).
  const denom = timeSignature[1] || 4;
  const beatLen = beatDuration * (4 / denom);
  const barDuration = beatLen * timeSignature[0];
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
        {/* Fix(waveA): ticks posicionados en absoluto por beat, sin doble espaciado. */}
        <div className="relative h-1.5">
          {Array.from({ length: timeSignature[0] - 1 }).map((_, i) => {
            const beatIdx = i + 1;
            return (
              <div
                key={beatIdx}
                className="absolute bottom-0 h-1.5 w-px bg-dark-border/40"
                style={{ left: `${beatIdx * beatLen * zoom}px` }}
              />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rulerRef}
      data-testid="ruler"
      onClick={handleSeek}
      // Sticky: la regla (números de compás + superficie de seek) no se va con
      // el scroll vertical. Fondo OPACO para que las lanes no se transparenten.
      className="sticky top-0 z-20 h-7 bg-dark-surface border-b border-dark-border relative cursor-pointer select-none overflow-hidden"
      style={{ width: `${lanesWidth ?? Math.max(viewportWidth, totalWidth)}px` }}
    >
      {bars}

      {/* Playhead marker indicator on ruler */}
      <div
        ref={playheadMarkerRef}
        className="absolute top-0 bottom-0 w-2.5 -ml-[5px] flex items-center justify-center z-10 pointer-events-none"
        style={{ willChange: 'transform' }}
      >
        <div className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[8px] border-t-cyan-400" />
      </div>
    </div>
  );
};
