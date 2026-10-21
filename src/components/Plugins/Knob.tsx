import React, { useEffect, useRef, useState } from 'react';

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  unit?: string;
  onChange: (val: number) => void;
  size?: number;
}

export const Knob: React.FC<KnobProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue = 0,
  unit = '',
  onChange,
  size = 40,
}) => {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(String(value));
  const dialRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startVal: number } | null>(null);

  // Normalize value to 0..1
  const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Angle: -135deg to +135deg (total 270 degrees)
  const angle = -135 + normalized * 270;

  // Fix(waveA): normaliza un valor al rango y al paso para teclado/rueda/arrastre.
  const clampToStep = (raw: number): number => {
    let next = Math.max(min, Math.min(max, raw));
    if (step > 0) {
      next = Math.round(next / step) * step;
    }
    // Fix(waveA): evita deriva de punto flotante (p. ej. 0.30000000000000004).
    next = Math.min(max, Math.max(min, Number(next.toFixed(6))));
    return next;
  };

  // Fix(waveA): eventos pointer (táctil/lápiz/ratón) en vez de solo mouse,
  // con captura SOBRE EL ELEMENTO para que el gesto no se pierda fuera de él.
  // Un solo gesto activo: los punteros que no son dueños se ignoran.
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.altKey) {
      e.preventDefault();
      onChange(defaultValue);
      return;
    }
    if (dragRef.current) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    if (el.setPointerCapture) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // jsdom o puntero ya liberado: el arrastre sigue funcionando.
      }
    }
    dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startVal: value };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const deltaY = drag.startY - e.clientY;
    const range = max - min;
    const stepChange = (deltaY / 150) * range;
    onChange(clampToStep(drag.startVal + stepChange));
  };

  const endPointerDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    const el = e.currentTarget as HTMLElement;
    if (el.releasePointerCapture) {
      try {
        el.releasePointerCapture(drag.pointerId);
      } catch {
        // Sin captura activa: nada que liberar.
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    endPointerDrag(e);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    endPointerDrag(e);
  };

  // Fix(waveA): teclado accesible — flechas ±step (Shift fino ×0.1), Home/End.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const fine = e.shiftKey ? 0.1 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      next = value + step * fine;
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      next = value - step * fine;
    } else if (e.key === 'Home') {
      next = min;
    } else if (e.key === 'End') {
      next = max;
    }
    if (next !== null) {
      e.preventDefault();
      onChange(clampToStep(next));
    }
  };

  // Fix: rueda con listener NATIVO no pasivo. El `onWheel` sintético de React
  // se registra como pasivo y su `preventDefault()` es un no-op: la página
  // hacía scroll al girar el knob. El nativo con `{ passive: false }` sí frena.
  // El listener se registra UNA vez: los params vivos viajan en un ref para
  // no des/suscribir en cada tick de valor (cada paso re-renderiza).
  const wheelLiveRef = useRef({ value, step, onChange, clampToStep });
  wheelLiveRef.current = { value, step, onChange, clampToStep };
  useEffect(() => {
    const el = dialRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const live = wheelLiveRef.current;
      const fine = e.shiftKey ? 0.1 : 1;
      const delta = e.deltaY < 0 ? live.step * fine : -live.step * fine;
      live.onChange(live.clampToStep(live.value + delta));
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheelNative);
    };
  }, []);

  const handleDoubleClick = () => {
    onChange(defaultValue);
  };

  return (
    <div className="flex flex-col items-center select-none" title={`${label}: ${value}${unit} (Doble clic para restablecer)`}>
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-tight mb-1 truncate max-w-[64px]">
        {label}
      </span>

      {/* Rotary Dial */}
      <div
        ref={dialRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuetext={`${Math.round(value * 10) / 10}${unit}`}
        className="relative rounded-full bg-gradient-to-b from-dark-surfaceLight to-dark-surface border-2 border-dark-border hover:border-cyan-500/60 focus-visible:border-cyan-400 focus-visible:outline-none shadow-md cursor-ns-resize transition-colors flex items-center justify-center touch-none"
        style={{ width: `${size}px`, height: `${size}px`, touchAction: 'none' }}
      >
        {/* Indicator Needle */}
        <div
          className="absolute w-full h-full rounded-full flex items-start justify-center pt-1 pointer-events-none"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="w-1 h-3 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400/80" />
        </div>
      </div>

      {editing ? (
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          autoFocus
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={() => {
            const parsed = parseFloat(editVal);
            if (!isNaN(parsed)) onChange(clampToStep(parsed));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const parsed = parseFloat(editVal);
              if (!isNaN(parsed)) onChange(clampToStep(parsed));
              setEditing(false);
            } else if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
          className="w-12 text-[10px] font-mono tabular-nums text-center bg-dark-bg text-cyan-300 border border-cyan-500 rounded px-0.5 mt-1 outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditVal(String(Math.round(value * 100) / 100));
            setEditing(true);
          }}
          aria-label={`Editar ${label}`}
          className="text-[10px] font-mono tabular-nums text-slate-300 mt-1 cursor-pointer hover:text-cyan-400 hover:underline bg-transparent border-0 p-0"
          title="Clic para editar valor numérico"
        >
          {Math.round(value * 10) / 10}{unit}
        </button>
      )}
    </div>
  );
};
