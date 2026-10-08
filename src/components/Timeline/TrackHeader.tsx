import React from 'react';
import { AudioTrack } from '../../types/daw';
import { useDawStore } from '../../store/useDawStore';
import { 
  Volume2, 
  Sliders, 
  Trash2, 
  Mic, 
  Music, 
  Radio
} from 'lucide-react';

interface TrackHeaderProps {
  track: AudioTrack;
  isSelected: boolean;
}

export const TrackHeader: React.FC<TrackHeaderProps> = ({ track, isSelected }) => {
  const { 
    updateTrack, 
    removeTrack, 
    setSelectedTrack, 
    setPluginModal 
  } = useDawStore();

  const activePluginsCount = track.plugins.filter((p) => p.enabled).length;

  return (
    <div
      onClick={() => setSelectedTrack(track.id)}
      className={`h-24 w-60 border-r border-b border-dark-border px-3 py-2 flex flex-col justify-between transition-colors cursor-pointer select-none relative ${
        isSelected
          ? 'bg-dark-surfaceLight/90 border-l-4'
          : 'bg-dark-surface hover:bg-dark-surfaceLight/50'
      }`}
      style={{ borderLeftColor: track.color }}
    >
      {/* Top Row: Icon, Name & Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 truncate">
          <div className="text-slate-400">
            {track.type === 'vocal' ? (
              <Mic className="w-3.5 h-3.5 text-purple-400" />
            ) : track.type === 'instrument' ? (
              <Music className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
            )}
          </div>
          <span className="text-xs font-semibold text-slate-200 truncate">{track.name}</span>
        </div>

        <div className="flex items-center space-x-1">
          {/* FX Rack Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPluginModal(track.id, null);
            }}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors flex items-center space-x-1 ${
              activePluginsCount > 0
                ? 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300'
                : 'bg-dark-border/40 border-dark-border text-slate-400 hover:text-slate-200'
            }`}
            title="Abrir Rack de Efectos e Inserciones VST"
            aria-label={`Abrir rack de efectos de ${track.name}: ${activePluginsCount} de ${track.plugins.length} activos`}
          >
            <Sliders className="w-2.5 h-2.5" />
            {/* Fix(waveA): contador activos/total en vez de solo activos. */}
            <span>FX ({activePluginsCount}/{track.plugins.length})</span>
          </button>

          {/* Delete Track */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`¿Eliminar ${track.name}?`)) {
                removeTrack(track.id);
              }
            }}
            className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/20 transition-colors"
            title="Eliminar Pista"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Middle Row: Mute, Solo & Record Arm buttons */}
      <div className="flex items-center space-x-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { mute: !track.mute });
          }}
          aria-pressed={track.mute}
          aria-label={`Silenciar pista ${track.name}`}
          className={`w-9 h-9 rounded text-xs font-bold transition-all ${
            track.mute
              ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/30'
              : 'bg-dark-surfaceLight text-slate-400 hover:text-slate-200 border border-dark-border'
          }`}
          title="Silenciar (Mute)"
        >
          M
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { solo: !track.solo });
          }}
          aria-pressed={track.solo}
          aria-label={`Pista ${track.name} en solo`}
          className={`w-9 h-9 rounded text-xs font-bold transition-all ${
            track.solo
              ? 'bg-yellow-400 text-slate-950 shadow-sm shadow-yellow-400/30'
              : 'bg-dark-surfaceLight text-slate-400 hover:text-slate-200 border border-dark-border'
          }`}
          title="Solo"
        >
          S
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { armed: !track.armed });
          }}
          aria-pressed={track.armed}
          aria-label={`Armar pista ${track.name} para grabación`}
          className={`w-9 h-9 rounded text-xs font-bold transition-all ${
            track.armed
              ? 'bg-red-500 text-white shadow-sm shadow-red-500/40 ring-1 ring-red-400 animate-pulse'
              : 'bg-dark-surfaceLight text-slate-400 hover:text-red-400 border border-dark-border'
          }`}
          title="Armar para Grabación (Record Arm)"
        >
          R
        </button>

        {/* Pan Dial / Slider */}
        <div className="flex items-center space-x-1 flex-1 ml-1" onClick={(e) => e.stopPropagation()}>
          <span className="text-[9px] font-mono text-slate-400">PAN</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={track.pan}
            onChange={(e) => updateTrack(track.id, { pan: parseFloat(e.target.value) })}
            aria-label={`Panorama de ${track.name}`}
            className="w-full h-1 accent-cyan-400 bg-dark-border rounded cursor-pointer"
            title={`Pan: ${track.pan < 0 ? `L${Math.round(Math.abs(track.pan) * 100)}` : track.pan > 0 ? `R${Math.round(track.pan * 100)}` : 'C'}`}
          />
        </div>
      </div>

      {/* Bottom Row: Volume Slider */}
      <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
        <Volume2 className="w-3 h-3 text-slate-400" />
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={track.volume}
          onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
          aria-label={`Volumen de ${track.name}`}
          className="flex-1 h-1.5 accent-cyan-400 bg-dark-border rounded cursor-pointer"
          title={`Volumen: ${Math.round(track.volume * 100)}%`}
        />
        <span className="text-[10px] font-mono text-slate-400 w-8 text-right">
          {track.volume === 0 ? '-∞' : `${Math.round(20 * Math.log10(track.volume))}dB`}
        </span>
      </div>
    </div>
  );
};
