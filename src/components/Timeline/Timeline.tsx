import React, { useEffect, useRef, useState } from 'react';
import { useDawStore } from '../../store/useDawStore';
import { audioEngine } from '../../audio/AudioEngine';
import { Ruler } from './Ruler';
import { TrackHeader } from './TrackHeader';
import { WaveformCanvas } from './WaveformCanvas';
import { decodeAudioFile, generateWaveformPeaks } from '../../audio/waveformUtils';
import { calculateMagneticSnap } from '../../audio/timelineOps';
import { ZoomIn, ZoomOut, Scissors, Plus } from 'lucide-react';

export const Timeline: React.FC = () => {
  const {
    tracks,
    clips,
    zoom,
    setZoom,
    duration,
    currentTime,
    bpm,
    timeSignature,
    selectedTrackId,
    selectedClipId,
    setSelectedClip,
    splitClip,
    removeClip,
    addClip,
    addTrack,
    play,
    pause,
    isPlaying,
  } = useDawStore();

  // Fix(waveA): clip seleccionado + si el cursor está dentro (para habilitar/deshabilitar Cortar).
  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const canSplit =
    !!selectedClip && currentTime > selectedClip.startTime &&
    currentTime < selectedClip.startTime + selectedClip.duration;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  // Fix: viewport reactivo con listener de resize + cleanup en lugar de leer window.innerWidth en render.
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 0
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Fix (doble loop rAF): se mantiene este loop local del playhead (mutación directa del DOM sin
  // re-renders) separado del loop de telemetría del engine (meters + time callbacks). Unificarlos
  // obligaría al playhead a pasar por estado React o a los meters a tocar el DOM; la separación evita
  // re-renders a 60fps. Playhead smooth position sync at 60 FPS
  useEffect(() => {
    let animId: number;
    const syncPlayhead = () => {
      if (playheadRef.current) {
        const time = audioEngine.getCurrentTime();
        playheadRef.current.style.transform = `translateX(${time * zoom}px)`;
      }
      animId = requestAnimationFrame(syncPlayhead);
    };
    animId = requestAnimationFrame(syncPlayhead);
    return () => cancelAnimationFrame(animId);
  }, [zoom]);

  // Global Keyboard Shortcuts (Space, S for Split, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Fix(waveA): no corromper la edición en campos de texto/botones/selects.
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable="true"]')) return;

      if (e.code === 'Space') {
        // Fix(waveA): Space en BUTTON/SELECT activa el control, no el transporte.
        if (t.closest('button,select') || t.tagName === 'BUTTON' || t.tagName === 'SELECT') return;
        e.preventDefault();
        if (isPlaying) pause();
        else play();
      } else if (e.key === 's' || e.key === 'S') {
        if (selectedClipId) {
          splitClip(selectedClipId, currentTime);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipId) {
          removeClip(selectedClipId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, selectedClipId, currentTime, play, pause, splitClip, removeClip]);

  // Handle Drag & Drop of Audio Files directly onto Timeline
  const handleDrop = async (e: React.DragEvent, trackId?: string) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('audio/'));
    if (files.length === 0) return;

    const ctx = await audioEngine.ensureContext();

    // Fix(waveA): repartir los clips en cascada para no apilarlos todos en currentTime.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const audioBuffer = await decodeAudioFile(file, ctx);
        const peaks = generateWaveformPeaks(audioBuffer, 800);
        const targetTrackId = trackId || addTrack(file.name.replace(/\.[^/.]+$/, ''));
        const dur = audioBuffer.duration;
        const rawStart = currentTime + i * (dur + 0.5);
        // Fix(waveA): snap magnético al colocar el clip importado.
        const liveClips = useDawStore.getState().clips;
        const { snappedTime } = calculateMagneticSnap(rawStart, bpm, timeSignature, liveClips);

        addClip({
          id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          trackId: targetTrackId,
          name: file.name,
          startTime: snappedTime,
          duration: dur,
          offset: 0,
          audioBuffer,
          peaks,
          color: '#06b6d4',
        });
      } catch (err) {
        alert('Error al importar archivo de audio: ' + err);
      }
    }
  };

  // Fix(waveA): ancho de lanes = viewport menos columna de headers (w-60 = 240px),
  // misma fórmula que Ruler para alinear rejilla y clips.
  const totalWidth = Math.max(viewportWidth - 240, duration * zoom);

  return (
    <div className="flex-1 flex flex-col bg-dark-bg overflow-hidden relative select-none">
      {/* Zoom & Editing Toolbar Floating Overlay */}
      <div className="absolute bottom-4 right-6 z-30 flex items-center space-x-1.5 bg-dark-surface/90 border border-dark-border/80 backdrop-blur-md px-2.5 py-1.5 rounded-xl shadow-xl">
        <button
          onClick={() => setZoom(zoom - 10)}
          className="p-1 rounded text-slate-300 hover:text-white hover:bg-dark-surfaceLight"
          title="Alejar Zoom (-)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-[11px] font-mono text-slate-400 w-12 text-center">{Math.round(zoom)} px/s</span>
        <button
          onClick={() => setZoom(zoom + 10)}
          className="p-1 rounded text-slate-300 hover:text-white hover:bg-dark-surfaceLight"
          title="Acercar Zoom (+)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-dark-border mx-1" />

        <button
          onClick={() => { if (canSplit && selectedClip) splitClip(selectedClip.id, currentTime); }}
          disabled={!canSplit}
          className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-semibold bg-dark-surfaceLight hover:bg-dark-border disabled:opacity-40 text-cyan-400"
          title={
            !selectedClip
              ? 'Selecciona un clip para cortar'
              : !canSplit
                ? 'El cursor debe estar dentro del clip seleccionado para cortar'
                : "Cortar clip seleccionado en el cursor ('S')"
          }
        >
          <Scissors className="w-3.5 h-3.5" />
          <span>Cortar ('S')</span>
        </button>
      </div>

      {/* Timeline Main Layout: Headers on left, Scrollable Lanes on right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Track Headers Column */}
        <div className="w-60 flex-shrink-0 flex flex-col bg-dark-surface border-r border-dark-border z-20">
          {/* Header Placeholder above tracks aligning with Ruler */}
          <div className="h-7 bg-dark-surfaceLight/80 border-b border-dark-border px-3 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Pistas ({tracks.length})</span>
            <button
              onClick={() => addTrack()}
              className="p-1 text-slate-400 hover:text-cyan-400"
              title="Añadir Pista"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Track Headers List */}
          <div className="flex-1 overflow-y-auto">
            {tracks.map((track) => (
              <TrackHeader
                key={track.id}
                track={track}
                isSelected={selectedTrackId === track.id}
              />
            ))}

            {tracks.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500">
                No hay pistas activas. Haz clic en "Nueva Pista" o arrastra un archivo de audio.
              </div>
            )}
          </div>
        </div>

        {/* Right: Horizontally Scrollable Lanes + Ruler */}
        <div
          ref={scrollContainerRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e)}
          className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#07090e]"
        >
          {/* Timeline Ruler */}
          <Ruler />

          {/* Track Lanes */}
          <div className="relative" style={{ width: `${totalWidth}px` }}>
            {/* Smooth 60 FPS Playhead Vertical Line */}
            <div
              ref={playheadRef}
              className="absolute top-0 bottom-0 w-px bg-cyan-400 shadow-md shadow-cyan-400/50 z-20 pointer-events-none"
              style={{
                height: `${Math.max(tracks.length * 96, 400)}px`,
                transform: `translateX(${currentTime * zoom}px)`,
              }}
            >
              <div className="w-2.5 h-2.5 -ml-[4px] rounded-full bg-cyan-400 border-2 border-slate-950" />
            </div>

            {tracks.map((track) => {
              const trackClips = clips.filter((c) => c.trackId === track.id);
              return (
                <div
                  key={track.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.stopPropagation();
                    handleDrop(e, track.id);
                  }}
                  onClick={() => setSelectedClip(null)}
                  className={`h-24 border-b border-dark-border/60 relative transition-colors ${
                    selectedTrackId === track.id ? 'bg-dark-surfaceLight/20' : 'hover:bg-dark-surfaceLight/10'
                  }`}
                >
                  {/* Grid Lines per Bar */}
                  <div className="absolute inset-0 pointer-events-none opacity-20">
                    {/* Background grid */}
                  </div>

                  {/* Render Clips */}
                  {trackClips.map((clip) => (
                    <WaveformCanvas
                      key={clip.id}
                      clip={clip}
                      width={clip.duration * zoom}
                      height={88}
                      isSelected={selectedClipId === clip.id}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
