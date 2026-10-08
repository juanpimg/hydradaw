import React from 'react';

interface VUMeterProps {
  peak: number; // 0..1
  rms: number;  // 0..1
  height?: number;
}

export const VUMeter: React.FC<VUMeterProps> = ({ peak, rms, height = 180 }) => {
  const peakPct = Math.min(100, Math.max(0, peak * 100));
  const rmsPct = Math.min(100, Math.max(0, rms * 100));

  const isClipping = peak >= 0.98;

  return (
    <div className="flex flex-col items-center select-none">
      {/* Clip LED Indicator */}
      <div
        className={`w-2 h-2 rounded-full mb-1 transition-colors ${
          isClipping ? 'bg-red-500 shadow-md shadow-red-500/80 animate-ping' : 'bg-red-950/40 border border-red-900/40'
        }`}
        title="Clip Warning (>= 0 dBFS)"
      />

      {/* Meter Bar Container */}
      <div
        className="w-2.5 bg-dark-bg border border-dark-border/80 rounded-sm overflow-hidden relative flex flex-col justify-end"
        style={{ height: `${height}px` }}
      >
        {/* Background gradient scale: Green (low) -> Yellow (mid) -> Red (high) */}
        <div className="absolute inset-0 bg-gradient-to-t from-emerald-600 via-amber-500 to-red-500 opacity-20 pointer-events-none" />

        {/* RMS Level Bar (Smoothed energy) */}
        <div
          className="w-full bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500 transition-all duration-75 rounded-sm"
          style={{ height: `${rmsPct}%` }}
        />

        {/* Instant Peak Hold Line */}
        <div
          className="absolute left-0 right-0 h-0.5 bg-white shadow-sm pointer-events-none"
          style={{ bottom: `${peakPct}%` }}
        />
      </div>
    </div>
  );
};
