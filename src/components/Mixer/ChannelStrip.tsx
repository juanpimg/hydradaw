import React, { memo } from 'react';
import type { AudioTrack } from '../../types/daw';
import { useDawStore } from '../../store/useDawStore';
import { Knob } from '../Plugins/Knob';
import { VUMeter } from './VUMeter';
import { Plus } from 'lucide-react';

interface ChannelStripProps {
  track: AudioTrack;
  levels: { rms: number; peak: number };
}

// Fix(waveA): memo(ChannelStrip) con comparador a medida — solo re-renderiza si
// cambia la referencia del track o los valores numéricos de levels. Técnica
// combinada con el throttle a ~15fps del MixerConsole padre: sin memo, cada
// tick de meters re-renderizaría los N strips aunque su track no haya cambiado
// (faders, knobs, inserts); con memo + throttle cada strip se actualiza como
// mucho 15 veces/segundo y solo cuando sus propios niveles cambian.
const ChannelStripInner: React.FC<ChannelStripProps> = ({ track, levels }) => {
  const updateTrack = useDawStore((s) => s.updateTrack);
  const setPluginModal = useDawStore((s) => s.setPluginModal);

  const handleFaderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateTrack(track.id, { volume: parseFloat(e.target.value) });
  };

  const volumeDb = track.volume === 0 ? -Infinity : 20 * Math.log10(track.volume);

  return (
    <div className="w-40 flex-shrink-0 bg-dark-surface border border-dark-border rounded-xl flex flex-col justify-between p-2.5 shadow-lg select-none">
      {/* Top Header Tag */}
      <div className="flex flex-col items-center pb-2 border-b border-dark-border">
        <div
          className="w-full h-1.5 rounded-full mb-1.5"
          style={{ backgroundColor: track.color }}
        />
        <span className="text-xs font-bold text-slate-200 truncate w-full text-center" title={track.name}>
          {track.name}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono">
          {track.type}
        </span>
      </div>

      {/* Insert Effects Slots */}
      <div className="my-2 flex flex-col space-y-1">
        <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 uppercase">
          <span>Inserts</span>
          <button
            onClick={() => setPluginModal(track.id, null)}
            aria-label="Añadir efecto"
            className="text-cyan-400 hover:text-cyan-300 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
            title="Añadir Efecto VST"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        <div className="flex flex-col space-y-1 max-h-20 overflow-y-auto">
          {track.plugins.map((p) => (
            <button
              key={p.instanceId}
              onClick={() => setPluginModal(track.id, p.instanceId)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium truncate text-left border transition-colors ${
                p.enabled
                  ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300 hover:border-cyan-400'
                  : 'bg-dark-surfaceLight/60 border-dark-border text-slate-500 line-through'
              }`}
              title={`${p.name} (Clic para editar)`}
            >
              {p.name.replace(/^(Vintage|Pro|Analog|Studio)\s*/, '')}
            </button>
          ))}

          {track.plugins.length === 0 && (
            <button
              onClick={() => setPluginModal(track.id, null)}
              className="py-1 rounded text-[9px] text-slate-500 border border-dashed border-dark-border hover:border-slate-400 hover:text-slate-300"
            >
              + Slot VST
            </button>
          )}
        </div>
      </div>

      {/* Stereo Panning Rotary Knob */}
      <div className="my-1.5 flex justify-center">
        <Knob
          label="PAN"
          value={track.pan}
          min={-1}
          max={1}
          step={0.05}
          defaultValue={0}
          size={36}
          onChange={(val) => updateTrack(track.id, { pan: val })}
        />
      </div>

      {/* Mute, Solo & Rec Arm */}
      <div className="flex justify-between items-center my-2 px-1">
        <button
          onClick={() => updateTrack(track.id, { mute: !track.mute })}
          className={`w-6 h-6 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded text-xs font-bold transition-all ${
            track.mute
              ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/30'
              : 'bg-dark-surfaceLight text-slate-400 hover:text-slate-200 border border-dark-border'
          }`}
          title="Mute"
        >
          M
        </button>

        <button
          onClick={() => updateTrack(track.id, { solo: !track.solo })}
          className={`w-6 h-6 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded text-xs font-bold transition-all ${
            track.solo
              ? 'bg-yellow-400 text-slate-950 shadow-sm shadow-yellow-400/30'
              : 'bg-dark-surfaceLight text-slate-400 hover:text-slate-200 border border-dark-border'
          }`}
          title="Solo"
        >
          S
        </button>

        <button
          onClick={() => updateTrack(track.id, { armed: !track.armed })}
          className={`w-6 h-6 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded text-xs font-bold transition-all ${
            track.armed
              ? 'bg-red-500 text-white shadow-sm shadow-red-500/40 ring-1 ring-red-400 animate-pulse'
              : 'bg-dark-surfaceLight text-slate-400 hover:text-red-400 border border-dark-border'
          }`}
          title="Record Arm"
        >
          R
        </button>
      </div>

      {/* Fader & VU Meter Section */}
      <div className="flex items-center justify-center space-x-2 my-2 h-44">
        {/* dB Scale Markings */}
        <div className="flex flex-col justify-between h-40 text-[8px] font-mono text-slate-500 text-right pr-0.5">
          <span>+6</span>
          <span>0</span>
          <span>-6</span>
          <span>-12</span>
          <span>-24</span>
          <span>-∞</span>
        </div>

        {/* Vertical Volume Fader */}
        <div className="h-40 flex items-center">
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={track.volume}
            onChange={handleFaderChange}
            onDoubleClick={() => updateTrack(track.id, { volume: 1.0 })}
            onClick={(e) => {
              if (e.altKey) updateTrack(track.id, { volume: 1.0 });
            }}
            className="h-36 w-6 accent-cyan-400 cursor-ns-resize"
            title="Volumen (Doble clic o Alt+Clic para resetear a 0 dB)"
            style={{
              writingMode: 'vertical-lr',
              direction: 'rtl',
            }}
          />
        </div>

        {/* Live VU Meter */}
        <VUMeter peak={levels.peak} rms={levels.rms} height={145} />
      </div>

      {/* Numeric dB Value Readout (botón: teclado + clic restablecen a 0 dB) */}
      <div className="pt-2 border-t border-dark-border text-center">
        <button
          type="button"
          onClick={() => updateTrack(track.id, { volume: 1.0 })}
          aria-label={`${track.name}: ${volumeDb === -Infinity ? '-∞ dB' : `${volumeDb.toFixed(1)} dB`}, restablecer a 0 dB`}
          title="Clic para restablecer a 0 dB"
          className="text-[10px] font-mono font-bold text-slate-300 hover:text-cyan-400 cursor-pointer"
        >
          {volumeDb === -Infinity ? '-∞ dB' : `${volumeDb.toFixed(1)} dB`}
        </button>
      </div>
    </div>
  );
};

export const ChannelStrip: React.FC<ChannelStripProps> = memo(
  ChannelStripInner,
  (prev, next) =>
    prev.track === next.track &&
    prev.levels.peak === next.levels.peak &&
    prev.levels.rms === next.levels.rms,
);
ChannelStrip.displayName = 'ChannelStrip';
