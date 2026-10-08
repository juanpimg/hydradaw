import React, { useRef } from 'react';

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
  const knobRef = useRef<HTMLDivElement>(null);

  // Normalize value to 0..1
  const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Angle: -135deg to +135deg (total 270 degrees)
  const angle = -135 + normalized * 270;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startVal = value;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const range = max - min;
      const stepChange = (deltaY / 150) * range;
      let newVal = Math.max(min, Math.min(max, startVal + stepChange));

      if (step > 0) {
        newVal = Math.round(newVal / step) * step;
      }
      onChange(newVal);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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
        ref={knobRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className="relative rounded-full bg-gradient-to-b from-dark-surfaceLight to-dark-surface border-2 border-dark-border hover:border-cyan-500/60 shadow-md cursor-ns-resize transition-colors flex items-center justify-center"
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

      <span className="text-[10px] font-mono text-slate-300 mt-1">
        {Math.round(value * 10) / 10}{unit}
      </span>
    </div>
  );
};
