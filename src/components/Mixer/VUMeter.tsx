import React from 'react';
import { useDawStore } from '../../store/useDawStore';

interface VUMeterProps {
  peak: number; // 0..1 (lineal, puede superar 1 hasta ~1.5 por el fader)
  rms: number;  // 0..1 (lineal)
  height?: number;
}

// Fix(waveA): escala dB coherente con las marcas +6/0/-6/-12/-24/-∞.
// pct = 100*(1 + db/60) con floor en -60dB: 0dB -> 100%, -6dB -> 90%,
// -12dB -> 80%, -24dB -> 60%, <=-60dB (o silencio) -> 0%. +6dB satura a 100%.
const toDbPct = (linear: number): number => {
  if (!(linear > 0)) return 0;
  const db = 20 * Math.log10(linear);
  if (db <= -60) return 0;
  return Math.min(100, Math.max(0, 100 * (1 + db / 60)));
};

export const VUMeter: React.FC<VUMeterProps> = ({ peak, rms, height = 180 }) => {
  // Fix(waveA): usa peak para la línea de hold y rms para la barra de energía,
  // ambos mapeados a escala dB (antes era lineal y no cuadraba con las marcas).
  const peakPct = toDbPct(peak);
  const rmsPct = toDbPct(rms);

  // Fix(waveA): LED clip con hold + decaimiento que se apaga cuando !isPlaying.
  // Antes el último peak quedaba congelado al pausar saturado y el LED latía
  // eterno porque ya no llegaban niveles. Suscrito a isPlaying para forzar el
  // re-render al pausar aunque los niveles dejen de actualizarse.
  const isPlaying = useDawStore((s) => s.isPlaying);
  const [clipHold, setClipHold] = React.useState(false);

  React.useEffect(() => {
    // Fix(waveA): al pausar, apaga el LED aunque el último peak siga alto.
    if (!isPlaying) {
      setClipHold(false);
      return;
    }
    if (peak >= 0.98) {
      setClipHold(true);
      // Decaimiento: se apaga solo tras ~1.5s sin nuevos clips.
      const id = setTimeout(() => setClipHold(false), 1500);
      return () => clearTimeout(id);
    }
  }, [peak, isPlaying]);

  const isClipping = clipHold;

  return (
    <div className="flex flex-col items-center select-none">
      {/* Clip LED Indicator */}
      <div
        className={`w-2 h-2 rounded-full mb-1 transition-colors ${
          isClipping ? 'bg-red-500 shadow-md shadow-red-500/80 motion-safe:animate-ping' : 'bg-red-950/40 border border-red-900/40'
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

        {/* RMS Level Bar (Smoothed energy, escala dB) */}
        <div
          className="w-full bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500 transition-all duration-75 rounded-sm"
          style={{ height: `${rmsPct}%` }}
        />

        {/* Instant Peak Hold Line (posición en escala dB) */}
        <div
          className="absolute left-0 right-0 h-0.5 bg-white shadow-sm pointer-events-none"
          style={{ bottom: `${peakPct}%` }}
        />
      </div>
    </div>
  );
};
