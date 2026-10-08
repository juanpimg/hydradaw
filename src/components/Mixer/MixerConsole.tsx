import React, { useState, useEffect } from 'react';
import { useDawStore } from '../../store/useDawStore';
import { audioEngine } from '../../audio/AudioEngine';
import { ChannelStrip } from './ChannelStrip';
import { VUMeter } from './VUMeter';
import { ShieldAlert, VolumeX, Volume2 } from 'lucide-react';

export const MixerConsole: React.FC = () => {
  const {
    tracks,
    masterVolume,
    setMasterVolume,
    masterMute,
    setMasterMute,
  } = useDawStore();

  const [meterLevels, setMeterLevels] = useState<{
    master: { rms: number; peak: number };
    tracks: Record<string, { rms: number; peak: number }>;
  }>({
    master: { rms: 0, peak: 0 },
    tracks: {},
  });

  // 60 FPS Metering telemetry
  useEffect(() => {
    const unsub = audioEngine.onMeterUpdate((levels) => {
      setMeterLevels(levels);
    });
    return unsub;
  }, []);

  const masterDb = masterVolume === 0 ? -Infinity : 20 * Math.log10(masterVolume);

  return (
    <div className="flex-1 bg-dark-bg p-6 overflow-x-auto flex space-x-4 select-none">
      {/* Individual Track Strips */}
      <div className="flex space-x-3 overflow-x-auto pb-4">
        {tracks.map((track) => (
          <ChannelStrip
            key={track.id}
            track={track}
            levels={meterLevels.tracks[track.id] || { rms: 0, peak: 0 }}
          />
        ))}

        {tracks.length === 0 && (
          <div className="flex items-center justify-center p-12 text-slate-500 text-sm italic">
            No hay pistas en la mezcla. Añade pistas desde el Timeline o la barra superior.
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="w-px bg-dark-border self-stretch my-2" />

      {/* MASTER BUS CHANNEL STRIP */}
      <div className="w-32 flex-shrink-0 bg-dark-surface border-2 border-cyan-500/30 rounded-xl flex flex-col justify-between p-2.5 shadow-2xl shadow-cyan-950/20">
        {/* Master Tag & Limiter Badge */}
        <div className="flex flex-col items-center pb-2 border-b border-dark-border">
          <div className="flex items-center space-x-1 text-cyan-400 mb-1">
            <span className="text-xs font-black tracking-widest uppercase">MASTER BUS</span>
          </div>

          <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-[9px] font-bold text-emerald-400">
            <ShieldAlert className="w-2.5 h-2.5" />
            <span>LIMITER -0.1dB</span>
          </div>
        </div>

        {/* Master Mute */}
        <div className="my-3 flex justify-center">
          <button
            onClick={() => setMasterMute(!masterMute)}
            className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center space-x-1 ${
              masterMute
                ? 'bg-red-500 text-white shadow-md shadow-red-500/40'
                : 'bg-dark-surfaceLight text-slate-300 hover:text-white border border-dark-border'
            }`}
          >
            {masterMute ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span>MUTE</span>
          </button>
        </div>

        {/* Master Fader & Stereo VU Meter */}
        <div className="flex items-center justify-center space-x-2 my-2 h-44">
          <div className="flex flex-col justify-between h-40 text-[8px] font-mono text-slate-500 text-right pr-0.5">
            <span>+6</span>
            <span>0</span>
            <span>-6</span>
            <span>-12</span>
            <span>-24</span>
            <span>-∞</span>
          </div>

          {/* Master Vertical Fader */}
          <div className="h-40 flex items-center">
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={masterVolume}
              onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
              className="h-36 w-6 accent-cyan-400 cursor-ns-resize"
              style={{
                writingMode: 'vertical-lr',
                direction: 'rtl',
              }}
            />
          </div>

          {/* Stereo Master Meter Bar */}
          <VUMeter peak={meterLevels.master.peak} rms={meterLevels.master.rms} height={145} />
        </div>

        {/* Master dB Readout */}
        <div className="pt-2 border-t border-dark-border text-center">
          <span className="text-[11px] font-mono font-bold text-cyan-400">
            {masterDb === -Infinity ? '-∞ dB' : `${masterDb.toFixed(1)} dB`}
          </span>
        </div>
      </div>
    </div>
  );
};
