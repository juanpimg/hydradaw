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
// Fix(waveB): inputs de rango de loop con ESTADO LOCAL + commit en onBlur/Enter.
// Mismo motivo que BpmInput: el padre se re-renderiza a 60fps por currentTime y
// un value={loopStart} directo pisaría la edición. Valida fin > inicio y clamp
// 0..duration (duration solo se lee, nunca se modifica).
const LoopRangeInputs: React.FC<{
  loopStart: number;
  loopEnd: number;
  duration: number;
  setLoopRange: (start: number, end: number) => void;
}> = React.memo(({ loopStart, loopEnd, duration, setLoopRange }) => {
  const [startText, setStartText] = useState(String(loopStart));
  const [endText, setEndText] = useState(String(loopEnd));
  const [editingStart, setEditingStart] = useState(false);
  const [editingEnd, setEditingEnd] = useState(false);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  // Fix(waveB): sincroniza solo cuando no se edita (cambios externos/persistencia).
  useEffect(() => {
    if (!editingStart) setStartText(String(loopStart));
  }, [loopStart, editingStart]);
  useEffect(() => {
    if (!editingEnd) setEndText(String(loopEnd));
  }, [loopEnd, editingEnd]);

  const clamp1 = (v: number) => Math.min(duration, Math.max(0, Math.round(v * 10) / 10));

  const commitStart = () => {
    const parsed = Number(startText);
    let next = clamp1(Number.isFinite(parsed) ? parsed : loopStart);
    // Fix(waveB): valida fin > inicio con paso mínimo de 0.1s.
    if (next >= loopEnd) next = clamp1(loopEnd - 0.1);
    setStartText(String(next));
    setEditingStart(false);
    if (next !== loopStart) setLoopRange(next, loopEnd);
  };

  const commitEnd = () => {
    const parsed = Number(endText);
    let next = clamp1(Number.isFinite(parsed) ? parsed : loopEnd);
    // Fix(waveB): valida fin > inicio con paso mínimo de 0.1s.
    if (next <= loopStart) next = clamp1(loopStart + 0.1);
    setEndText(String(next));
    setEditingEnd(false);
    if (next !== loopEnd) setLoopRange(loopStart, next);
  };

  const inputClass =
    'w-10 bg-transparent text-slate-200 font-mono text-xs font-semibold focus:outline-none';

  return (
    <div
      className="flex items-center space-x-1 bg-dark-surfaceLight px-1.5 py-1 rounded-lg border border-dark-border"
      title="Rango del bucle en segundos"
    >
      <input
        ref={startRef}
        type="number"
        min={0}
        max={duration}
        step={0.1}
        value={startText}
        aria-label="Inicio del bucle en segundos"
        title="Inicio del bucle (segundos)"
        onFocus={() => setEditingStart(true)}
        onChange={(e) => {
          setEditingStart(true);
          setStartText(e.target.value);
        }}
        onBlur={commitStart}
        onKeyDown={(e) => {
          if (e.key === 'Enter') startRef.current?.blur();
          if (e.key === 'Escape') {
            setStartText(String(loopStart));
            setEditingStart(false);
            startRef.current?.blur();
          }
        }}
        className={inputClass}
      />
      <span aria-hidden="true" className="text-slate-600 text-xs">-</span>
      <input
        ref={endRef}
        type="number"
        min={0}
        max={duration}
        step={0.1}
        value={endText}
        aria-label="Fin del bucle en segundos"
        title="Fin del bucle (segundos)"
        onFocus={() => setEditingEnd(true)}
        onChange={(e) => {
          setEditingEnd(true);
          setEndText(e.target.value);
        }}
        onBlur={commitEnd}
        onKeyDown={(e) => {
          if (e.key === 'Enter') endRef.current?.blur();
          if (e.key === 'Escape') {
            setEndText(String(loopEnd));
            setEditingEnd(false);
            endRef.current?.blur();
          }
        }}
        className={inputClass}
      />
    </div>
  );
});
LoopRangeInputs.displayName = 'LoopRangeInputs';

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

interface TimeDisplayProps {
  bpm: number;
  timeSignature: [number, number];
}

const TransportTimeDisplay: React.FC<TimeDisplayProps> = React.memo(({ bpm, timeSignature }) => {
  const [time, setTime] = useState(() => audioEngine.getCurrentTime());

  useEffect(() => {
    const unsub = audioEngine.onTimeUpdate((curr) => {
      setTime(curr);
    });
    return unsub;
  }, []);

  const beatDuration = 60 / bpm;
  const currentBeatTotal = time / beatDuration;
  const currentBar = Math.floor(currentBeatTotal / timeSignature[0]) + 1;
  const currentBeatInBar = Math.floor(currentBeatTotal % timeSignature[0]) + 1;
  const sixteenth = Math.floor((currentBeatTotal % 1) * 4) + 1;

  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  const millis = Math.floor((time % 1) * 100);

  const format2 = (n: number) => n.toString().padStart(2, '0');
  const format3 = (n: number) => n.toString().padStart(3, '0');

  return (
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
  );
});
TransportTimeDisplay.displayName = 'TransportTimeDisplay';

export const TransportBar: React.FC = () => {
  const duration = useDawStore((s) => s.duration);
  const bpm = useDawStore((s) => s.bpm);
  const setBpm = useDawStore((s) => s.setBpm);
  const timeSignature = useDawStore((s) => s.timeSignature);
  const setTimeSignature = useDawStore((s) => s.setTimeSignature);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const isRecording = useDawStore((s) => s.isRecording);
  const isLooping = useDawStore((s) => s.isLooping);
  const loopStart = useDawStore((s) => s.loopStart);
  const loopEnd = useDawStore((s) => s.loopEnd);
  const setLoopRange = useDawStore((s) => s.setLoopRange);
  const metronome = useDawStore((s) => s.metronome);
  const play = useDawStore((s) => s.play);
  const pause = useDawStore((s) => s.pause);
  const stop = useDawStore((s) => s.stop);
  const toggleRecord = useDawStore((s) => s.toggleRecord);
  const toggleLoop = useDawStore((s) => s.toggleLoop);
  const toggleMetronome = useDawStore((s) => s.toggleMetronome);
  const masterVolume = useDawStore((s) => s.masterVolume);
  const setMasterVolume = useDawStore((s) => s.setMasterVolume);
  const masterMute = useDawStore((s) => s.masterMute);
  const setMasterMute = useDawStore((s) => s.setMasterMute);

  const [masterPeak, setMasterPeak] = useState({ rms: 0, peak: 0 });
  const peakRef = useRef(masterPeak);

  // Listen to audio meters (throttled ~15fps)
  useEffect(() => {
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
      unsubMeter();
      clearInterval(meterInterval);
    };
  }, []);

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
        {/* Fix(waveB): aria-pressed existente conservado; inputs de rango junto al botón. */}
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
        {/* Fix(waveB): rango 0-16 editable; dentro del mismo grupo flex-shrink-0 para no romper overflow-x-auto. */}
        <LoopRangeInputs
          loopStart={loopStart}
          loopEnd={loopEnd}
          duration={duration}
          setLoopRange={setLoopRange}
        />
      </div>

      {/* High-Resolution Isolated Time Display */}
      <TransportTimeDisplay bpm={bpm} timeSignature={timeSignature} />

      {/* Tempo, Time Signature & Metronome */}
      <div className="flex items-center space-x-3 flex-shrink-0">
        <div className="flex items-center space-x-1.5 bg-dark-surfaceLight px-2.5 py-1 rounded-lg border border-dark-border">
          <Gauge className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-400 uppercase font-bold">BPM</span>
          <BpmInput bpm={bpm} setBpm={setBpm} />
        </div>

        {/* Fix(waveA): compás de solo lectura con aria-label. */}
        {/* Fix(waveB): selector de compás con setTimeSignature existente (bonus trivial). */}
        <select
          value={`${timeSignature[0]}/${timeSignature[1]}`}
          aria-label="Compás"
          title="Rejilla (no estira el audio)"
          onChange={(e) => {
            const [n, d] = e.target.value.split('/').map(Number);
            // Fix(waveB-ts): destructuring de number[] da number|undefined en tipo.
            if (n !== undefined && d !== undefined && Number.isFinite(n) && Number.isFinite(d) && n > 0 && d > 0) setTimeSignature([n, d]);
          }}
          className="bg-dark-surfaceLight px-1 py-1 rounded-lg border border-dark-border text-xs text-slate-300 font-mono focus:outline-none cursor-pointer"
        >
          {['2/4', '3/4', '4/4', '5/4', '6/8', '7/8'].map((sig) => (
            <option key={sig} value={sig}>
              {sig}
            </option>
          ))}
          {!['2/4', '3/4', '4/4', '5/4', '6/8', '7/8'].includes(`${timeSignature[0]}/${timeSignature[1]}`) && (
            <option value={`${timeSignature[0]}/${timeSignature[1]}`}>
              {timeSignature[0]}/{timeSignature[1]}
            </option>
          )}
        </select>

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
