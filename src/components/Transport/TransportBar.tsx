import React, { useEffect, useRef, useState } from 'react';
import { useDawStore } from '../../store/useDawStore';
import { audioEngine } from '../../audio/AudioEngine';
import {
  Play,
  Pause,
  Square,
  Circle,
  Repeat,
  Volume2,
  VolumeX,
  Gauge
} from 'lucide-react';

// Fix(waveA): input BPM con ESTADO LOCAL + commit en onBlur/Enter (clamp 40-260).
// El TransportBar padre se re-renderiza a 60fps por currentTime; si el <input>
// leyera value={bpm} del store, cada tecla se pisaría / perdería el foco y los
// dígitos parciales ("1", "12") dispararían setBpm intermedios. Al vivir el
// draft en este subcomponente, los re-renders del padre conservan su estado y
// el foco, y el store solo se toca al confirmar.
const BpmInput: React.FC<{ bpm: number; setBpm: (bpm: number) => void }> = React.memo(({ bpm, setBpm }) => {
  const [text, setText] = useState(String(bpm));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fix(waveA): sincroniza el texto solo cuando no se está editando (cambios externos/demo).
  useEffect(() => {
    if (!editing) setText(String(bpm));
  }, [bpm, editing]);

  const commit = () => {
    const parsed = Number(text);
    const next = Math.min(260, Math.max(40, Number.isFinite(parsed) ? Math.round(parsed) : bpm));
    setText(String(next));
    setEditing(false);
    if (next !== bpm) setBpm(next);
  };

  return (
    <input
      ref={inputRef}
      type="number"
      min={40}
      max={260}
      value={text}
      aria-label="Tempo en BPM"
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true);
        setText(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') inputRef.current?.blur();
        if (e.key === 'Escape') {
          setText(String(bpm));
          setEditing(false);
          inputRef.current?.blur();
        }
      }}
      className="w-12 bg-transparent text-slate-200 font-mono text-xs font-semibold focus:outline-none"
    />
  );
});
BpmInput.displayName = 'BpmInput';

export const TransportBar: React.FC = () => {
  const {
    currentTime,
    bpm,
    setBpm,
    timeSignature,
    isPlaying,
    isRecording,
    isLooping,
    metronome,
    play,
    pause,
    stop,
    toggleRecord,
    toggleLoop,
    toggleMetronome,
    masterVolume,
    setMasterVolume,
    masterMute,
    setMasterMute,
  } = useDawStore();

  const [masterPeak, setMasterPeak] = useState({ rms: 0, peak: 0 });
  // Fix(waveA): throttle de meters a ~15fps — se guarda el último nivel en un
  // ref a 60fps y se vacía al estado con intervalo de 66ms para no re-renderizar
  // el transporte 60 veces/segundo por el medidor (el tiempo sí sigue a 60fps).
  const peakRef = useRef(masterPeak);

  // Listen to 60 FPS audio engine telemetry
  useEffect(() => {
    const unsubTime = audioEngine.onTimeUpdate((time) => {
      // Direct fast UI update without store re-render loop
      useDawStore.setState({ currentTime: time });
    });

    const unsubMeter = audioEngine.onMeterUpdate((levels) => {
      peakRef.current = levels.master;
    });

    const meterInterval = setInterval(() => {
      const next = peakRef.current;
      setMasterPeak((prev) =>
        prev.rms === next.rms && prev.peak === next.peak ? prev : { rms: next.rms, peak: next.peak },
      );
    }, 66);

    return () => {
      unsubTime();
      unsubMeter();
      clearInterval(meterInterval);
    };
  }, []);

  // Format Bar : Beat : 16th
  const beatDuration = 60 / bpm;
  const currentBeatTotal = currentTime / beatDuration;
  const currentBar = Math.floor(currentBeatTotal / timeSignature[0]) + 1;
  const currentBeatInBar = Math.floor(currentBeatTotal % timeSignature[0]) + 1;
  const sixteenth = Math.floor((currentBeatTotal % 1) * 4) + 1;

  // Format mm:ss.ms
  const minutes = Math.floor(currentTime / 60);
  const seconds = Math.floor(currentTime % 60);
  const millis = Math.floor((currentTime % 1) * 100);

  const format2 = (n: number) => n.toString().padStart(2, '0');
  const format3 = (n: number) => n.toString().padStart(3, '0');

  return (
    // Fix(waveA): responsive — overflow-x-auto para que el transporte no rompa en pantallas estrechas.
    <div className="h-14 bg-dark-surface border-t border-dark-border px-4 flex items-center justify-between gap-4 overflow-x-auto select-none z-20">
      {/* Primary Transport Controls */}
      <div className="flex items-center space-x-2 flex-shrink-0">
        <button
          onClick={stop}
          className="p-2 rounded-lg bg-dark-surfaceLight hover:bg-dark-border text-slate-300 hover:text-white transition-colors"
          title="Detener y volver al inicio (0:00)"
        >
          <Square className="w-4 h-4 fill-current" />
        </button>

        <button
          onClick={isPlaying ? pause : play}
          className={`p-2.5 rounded-xl font-bold transition-all ${
            isPlaying
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-md shadow-cyan-500/20'
          }`}
          title={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>

        <button
          onClick={toggleRecord}
          className={`p-2.5 rounded-xl transition-all ${
            isRecording
              ? 'bg-red-600 text-white animate-pulse shadow-lg shadow-red-600/40 ring-2 ring-red-400'
              : 'bg-dark-surfaceLight hover:bg-red-500/20 text-red-500 border border-red-500/30'
          }`}
          title="Grabar pista armada (Micrófono local)"
        >
          <Circle className="w-4 h-4 fill-current" />
        </button>

        {/* Fix(waveA): loop con aria-pressed para lectores de pantalla. */}
        <button
          onClick={toggleLoop}
          aria-pressed={isLooping}
          className={`p-2 rounded-lg transition-colors ${
            isLooping
              ? 'bg-cyan-950 border border-cyan-500 text-cyan-400'
              : 'bg-dark-surfaceLight text-slate-400 hover:text-slate-200'
          }`}
          title="Bucle / Loop"
        >
          <Repeat className="w-4 h-4" />
        </button>
      </div>

      {/* High-Resolution Time Display */}
      {/* Fix(waveA): display de compás con title aclarando que la rejilla no estira el audio (los stems son buffers fijos). */}
      <div
        className="flex items-center space-x-3 bg-dark-bg px-3.5 py-1.5 rounded-xl border border-dark-border font-mono text-sm shadow-inner flex-shrink-0"
        title="Rejilla (no estira el audio)"
      >
        <div className="flex items-baseline space-x-1">
          <span className="text-cyan-400 font-bold text-base">{format3(currentBar)}</span>
          <span className="text-slate-600">:</span>
          <span className="text-slate-200 font-semibold">{currentBeatInBar}</span>
          <span className="text-slate-600">:</span>
          <span className="text-slate-400 text-xs">{format2(sixteenth)}</span>
        </div>
        <div className="h-4 w-px bg-dark-border" />
        <div className="text-slate-400 text-xs">
          {format2(minutes)}:{format2(seconds)}.<span className="text-slate-500">{format2(millis)}</span>
        </div>
      </div>

      {/* Tempo, Time Signature & Metronome */}
      <div className="flex items-center space-x-3 flex-shrink-0">
        <div className="flex items-center space-x-1.5 bg-dark-surfaceLight px-2.5 py-1 rounded-lg border border-dark-border">
          <Gauge className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-400 uppercase font-bold">BPM</span>
          <BpmInput bpm={bpm} setBpm={setBpm} />
        </div>

        {/* Fix(waveA): compás de solo lectura con aria-label. */}
        <div
          role="img"
          aria-label={`Compás ${timeSignature[0]} por ${timeSignature[1]}`}
          title="Rejilla (no estira el audio)"
          className="bg-dark-surfaceLight px-2 py-1 rounded-lg border border-dark-border text-xs text-slate-300 font-mono"
        >
          {timeSignature[0]}/{timeSignature[1]}
        </div>

        {/* Fix(waveA): metrónomo con aria-pressed; oculto en pantallas pequeñas. */}
        <button
          onClick={toggleMetronome}
          aria-pressed={metronome}
          className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors hidden sm:inline-block ${
            metronome
              ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300'
              : 'bg-dark-surfaceLight border border-dark-border text-slate-400 hover:text-slate-200'
          }`}
          title="Metrónomo"
        >
          CLICK
        </button>
      </div>

      {/* Master Volume & Live Peak VU Meter */}
      <div className="flex items-center space-x-3 flex-shrink-0">
        <button
          onClick={() => setMasterMute(!masterMute)}
          className={`p-1.5 rounded transition-colors ${masterMute ? 'text-red-400 bg-red-950/40' : 'text-slate-400 hover:text-white'}`}
          title="Silenciar Master"
        >
          {masterMute ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <div className="flex items-center space-x-1.5">
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={masterVolume}
            onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
            className="w-20 accent-cyan-400 h-1.5 bg-dark-border rounded-lg cursor-pointer"
            title={`Volumen Master: ${Math.round(masterVolume * 100)}%`}
          />
          <span className="text-[11px] font-mono text-slate-400 w-8">
            {masterVolume === 0 ? '-∞' : `${Math.round(20 * Math.log10(masterVolume))}dB`}
          </span>
        </div>

        {/* Fix(waveA): medidor oculto en pantallas pequeñas (visible desde sm). */}
        {/* 15 FPS Stereo Master Meter Bar (throttled, ver efecto de arriba) */}
        <div className="w-14 h-4 bg-dark-bg border border-dark-border rounded hidden sm:flex overflow-hidden p-0.5" title="Medidor de pico Master (0 dBFS)">
          <div
            className="h-full rounded-sm transition-all duration-75"
            style={{
              width: `${Math.min(100, masterPeak.peak * 100)}%`,
              backgroundColor: masterPeak.peak > 0.95 ? '#ef4444' : masterPeak.peak > 0.7 ? '#f59e0b' : '#10b981',
            }}
          />
        </div>
      </div>
    </div>
  );
};
