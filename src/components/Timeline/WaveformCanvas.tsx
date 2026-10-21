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
  const selectClipAction = useDawStore((s) => s.selectClip);
  const setSelectedTrack = useDawStore((s) => s.setSelectedTrack);
  const removeClip = useDawStore((s) => s.removeClip);
  const removeSelectedClips = useDawStore((s) => s.removeSelectedClips);
  const splitClip = useDawStore((s) => s.splitClip);

  // Fix(waveA): al seleccionar el clip, sincronizar también la pista seleccionada.
  // Click = simple; Ctrl/Cmd+click = toggle; Shift+click = rango (G5).
  const selectClip = (e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    if (e && (e.ctrlKey || e.metaKey)) selectClipAction(clip.id, 'toggle');
    else if (e && e.shiftKey) selectClipAction(clip.id, 'range');
    else selectClipAction(clip.id, 'single');
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

  // Handle Drag Move & Trim con Pointer Events sobre el propio elemento:
  // captura defensiva para que el gesto no lo robe el scroll táctil ni otro
  // elemento, y `touch-action: none` (ver className) para que el navegador no
  // compita con el arrastre. La zona de trim es dinámica según el puntero.
  interface DragSession {
    el: HTMLElement;
    pointerId: number;
    startX: number;
    initialStartTime: number;
    initialDuration: number;
    initialOffset: number;
    bufferDuration: number;
    mode: 'move' | 'trimLeft' | 'trimRight';
    pendingUpdates: Partial<typeof clip> | null;
    hasMoved: boolean;
  }
  const dragRef = useRef<DragSession | null>(null);

  const getTrimEdge = (pointerType: string): number => {
    const isTouch = pointerType !== 'mouse';
    return isTouch ? Math.min(20, width * 0.28) : Math.min(8, width * 0.2);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    selectClip(e);

    // Un solo gesto activo: un segundo puntero (multitáctil) no secuestra
    // ni reinicia el arrastre en curso.
    if (dragRef.current) return;

    const el = e.currentTarget as HTMLElement;
    if (el.setPointerCapture) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // jsdom o puntero ya liberado: el arrastre sigue funcionando.
      }
    }

    const startX = e.clientX;
    const initialStartTime = clip.startTime;
    const initialDuration = clip.duration;
    const initialOffset = clip.offset;
    // Fix: duración máxima disponible en el buffer para clampear trimRight.
    // Fix(waveB): solo `audioBuffer` (alias `buffer` eliminado).
    const bufferDuration = clip.audioBuffer?.duration ?? Number.POSITIVE_INFINITY;

    // Detect if pressing near left or right edge for trimming.
    // La zona depende del tipo de puntero: táctil más generosa.
    const rect = e.currentTarget.getBoundingClientRect();
    const clickOffset = e.clientX - rect.left;
    const edge = getTrimEdge(e.pointerType);
    const canTrim = width >= 20;
    const isTrimLeft = canTrim && clickOffset < edge;
    const isTrimRight = canTrim && clickOffset > rect.width - edge;

    dragRef.current = {
      el,
      pointerId: e.pointerId,
      startX,
      initialStartTime,
      initialDuration,
      initialOffset,
      bufferDuration,
      mode: isTrimLeft ? 'trimLeft' : isTrimRight ? 'trimRight' : 'move',
      pendingUpdates: null,
      hasMoved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    // Solo el puntero dueño de la sesión mueve; los demás se ignoran.
    if (!drag || e.pointerId !== drag.pointerId) return;
    const deltaX = e.clientX - drag.startX;
    if (Math.abs(deltaX) > 2) drag.hasMoved = true;
    // Zoom vivo del store, no el del render: si el zoom cambia a mitad de
    // gesto, el delta sigue calculado con el valor vigente. El MODO de
    // arrastre (move/trim) queda fijado en el pointerdown por diseño.
    const liveZoom = useDawStore.getState().zoom;
    const deltaTime = deltaX / liveZoom;

    if (drag.mode === 'trimLeft') {
      // Fix: clamp del delta y actualización visual inmediata
      const maxDelta = drag.initialDuration - 0.2;
      const clampedDelta = Math.max(-drag.initialStartTime, -drag.initialOffset, Math.min(maxDelta, deltaTime));
      const newStart = Math.max(0, drag.initialStartTime + clampedDelta);
      const newDuration = Math.max(0.2, drag.initialDuration - clampedDelta);
      const newOffset = Math.max(0, drag.initialOffset + clampedDelta);
      drag.pendingUpdates = { startTime: newStart, duration: newDuration, offset: newOffset };
      drag.el.style.transform = `translateX(${clampedDelta * liveZoom}px)`;
      drag.el.style.width = `${newDuration * liveZoom}px`;
    } else if (drag.mode === 'trimRight') {
      // Fix: clamp contra buffer.duration para no extender más allá del audio disponible.
      const maxDuration = Math.max(0.2, drag.bufferDuration - drag.initialOffset);
      const newDuration = Math.min(Math.max(0.2, drag.initialDuration + deltaTime), maxDuration);
      drag.pendingUpdates = { duration: newDuration };
      drag.el.style.width = `${newDuration * liveZoom}px`;
    } else {
      // Move clip con transformación suave en tiempo real sin reiniciar audio a cada pixel
      const st = useDawStore.getState();
      const rawStart = Math.max(0, drag.initialStartTime + deltaTime);
      const others = st.clips.filter((c) => c.id !== clip.id);
      const { snappedTime } = calculateMagneticSnap(rawStart, st.bpm, st.timeSignature, others, 0.1, st.snapMode);
      const maxStart = Math.max(0, st.duration - drag.initialDuration);
      const newStart = Math.min(Math.max(0, snappedTime), maxStart);
      drag.pendingUpdates = { startTime: newStart };
      drag.el.style.transform = `translateX(${(newStart - drag.initialStartTime) * liveZoom}px)`;
    }
  };

  // Restaura el visual que el arrastre escribe en línea (transform + width).
  // Único punto de restauración: tanto el commit como la cancelación pasan por
  // aquí para que no puedan divergir (el commit parecía funcionar solo porque
  // el update del store re-renderizaba y reescribía el width por accidente).
  const clearDragVisual = (el: HTMLElement) => {
    el.style.transform = '';
    el.style.width = '';
  };

  const endDrag = (commit: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.el.releasePointerCapture) {
      try {
        drag.el.releasePointerCapture(drag.pointerId);
      } catch {
        // Sin captura activa: nada que liberar.
      }
    }
    clearDragVisual(drag.el);
    if (commit && drag.hasMoved && drag.pendingUpdates) {
      updateClip(clip.id, drag.pendingUpdates);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    // El up de otro puntero no cierra la sesión ajena.
    if (dragRef.current && e.pointerId !== dragRef.current.pointerId) return;
    endDrag(true);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    // El gesto se abortó (llamada, alerta del SO…): se descarta lo pendiente
    // y se restaura el visual a medio gesto. Solo el puntero dueño cancela.
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    clearDragVisual(drag.el);
  };

  // Limpieza al desmontar: un arrastre en vuelo no deja referencia rancia
  // (el store ya no se toca desde un componente desmontado).
  useEffect(() => {
    return () => {
      dragRef.current = null;
    };
  }, []);

  // Fix(waveA): clip focuseable con borrado/corte por teclado.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation();
      // G5: con varios seleccionados (incluido este) se borra la selección
      // entera, igual que el atajo global; si no, solo este clip.
      const ids = useDawStore.getState().selectedClipIds;
      if (ids.includes(clip.id) && ids.length > 1) removeSelectedClips();
      else removeClip(clip.id);
    } else if (e.key === 's' || e.key === 'S') {
      e.stopPropagation();
      const currTime = audioEngine.getCurrentTime();
      splitClip(clip.id, currTime);
    }
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      // Fix: el lane deselecciona en onClick; sin esto el click posterior al
      // pointerdown borraba la selección y ningún clip quedaba seleccionable con ratón.
      onClick={(e) => e.stopPropagation()}
      onFocus={() => selectClip()}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="option"
      aria-selected={isSelected}
      aria-label={`Clip ${clip.name}`}
      className={`absolute top-1 bottom-1 rounded-[3px] overflow-hidden cursor-move border transition-shadow select-none touch-none ${
        isSelected
          ? 'border-white ring-2 ring-cyan-400 shadow-lg shadow-cyan-500/30 z-10'
          : 'border-white/20 hover:border-white/50'
      }`}
      style={{
        left: `${clip.startTime * zoom}px`,
        width: `${width}px`,
        // touch-action en línea además de `touch-none`: garantiza el valor
        // computado aunque Tailwind no cargue, y bloquea el scroll del
        // navegador durante el arrastre táctil del clip.
        touchAction: 'none',
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
        <span className="text-[9px] font-mono tabular-nums text-slate-300 bg-black/40 px-1 py-0.2 rounded">
          {clip.duration.toFixed(1)}s
        </span>
      </div>

      {/* Trimming Grab Handles (12px, high visibility on hover/touch) */}
      <div
        className="absolute top-0 bottom-0 left-0 w-3 hover:bg-cyan-400/50 cursor-col-resize opacity-60 hover:opacity-100 transition-opacity flex items-center justify-center bg-gradient-to-r from-cyan-400/30 to-transparent"
        title="Recortar inicio (Trim Izq)"
      >
        <div className="w-0.5 h-3.5 bg-cyan-200/80 rounded-full pointer-events-none" />
      </div>
      <div
        className="absolute top-0 bottom-0 right-0 w-3 hover:bg-cyan-400/50 cursor-col-resize opacity-60 hover:opacity-100 transition-opacity flex items-center justify-center bg-gradient-to-l from-cyan-400/30 to-transparent"
        title="Recortar final (Trim Der)"
      >
        <div className="w-0.5 h-3.5 bg-cyan-200/80 rounded-full pointer-events-none" />
      </div>
    </div>
  );
};
