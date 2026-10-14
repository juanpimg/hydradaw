import React, { useState } from 'react';

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

  // Fix(waveA): eventos pointer (táctil/lápiz/ratón) en vez de solo mouse.
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.altKey) {
      e.preventDefault();
      onChange(defaultValue);
      return;
    }
    e.preventDefault();
    const startY = e.clientY;
    const startVal = value;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const range = max - min;
      const stepChange = (deltaY / 150) * range;
      onChange(clampToStep(startVal + stepChange));
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
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

  // Fix(waveA): rueda del ratón para ajuste fino sin arrastrar.
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const fine = e.shiftKey ? 0.1 : 1;
    const delta = e.deltaY < 0 ? step * fine : -step * fine;
    onChange(clampToStep(value + delta));
  };

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
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuetext={`${Math.round(value * 10) / 10}${unit}`}
        className="relative rounded-full bg-gradient-to-b from-dark-surfaceLight to-dark-surface border-2 border-dark-border hover:border-cyan-500/60 focus-visible:border-cyan-400 focus-visible:outline-none shadow-md cursor-ns-resize transition-colors flex items-center justify-center"
        style={{ width: `${size}px`, height: `${size}px` }}
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
          className="w-12 text-[10px] font-mono text-center bg-dark-bg text-cyan-300 border border-cyan-500 rounded px-0.5 mt-1 outline-none"
        />
      ) : (
        <span
          onClick={() => {
            setEditVal(String(Math.round(value * 100) / 100));
            setEditing(true);
          }}
          className="text-[10px] font-mono text-slate-300 mt-1 cursor-pointer hover:text-cyan-400 hover:underline"
          title="Clic para editar valor numérico"
        >
          {Math.round(value * 10) / 10}{unit}
        </span>
      )}
    </div>
  );
};
