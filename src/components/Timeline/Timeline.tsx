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
  const tracks = useDawStore((s) => s.tracks);
  const clips = useDawStore((s) => s.clips);
  const zoom = useDawStore((s) => s.zoom);
  const setZoom = useDawStore((s) => s.setZoom);
  const duration = useDawStore((s) => s.duration);
  const bpm = useDawStore((s) => s.bpm);
  const timeSignature = useDawStore((s) => s.timeSignature);
  const selectedTrackId = useDawStore((s) => s.selectedTrackId);
  const selectedClipId = useDawStore((s) => s.selectedClipId);
  const setSelectedClip = useDawStore((s) => s.setSelectedClip);
  const splitClip = useDawStore((s) => s.splitClip);
  const addClip = useDawStore((s) => s.addClip);
  const addTrack = useDawStore((s) => s.addTrack);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const pushToast = useDawStore((s) => s.pushToast);
  const snapMode = useDawStore((s) => s.snapMode);
  const setSnapMode = useDawStore((s) => s.setSnapMode);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const canSplit = Boolean(selectedClip);

  const lanesScrollRef = useRef<HTMLDivElement>(null);
  const headersScrollRef = useRef<HTMLDivElement>(null);
  const headerColRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  // Banderas de reentrada: programar el scrollTop del otro contenedor no debe
  // rebotar de vuelta (ping-pong entre los dos onScroll).
  const isSyncingFromHeaders = useRef(false);
  const isSyncingFromLanes = useRef(false);
  // Ancho REAL medido de la columna de headers: el ancho de lanes y regla se
  // deriva de él, no de la constante w-60, para no desincronizar en responsive.
  const [headerWidth, setHeaderWidth] = useState(240);

  useEffect(() => {
    const el = headerColRef.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect().width || el.offsetWidth;
      if (w > 0) setHeaderWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleHeadersScroll = () => {
    const headers = headersScrollRef.current;
    const lanes = lanesScrollRef.current;
    if (!headers || !lanes) return;
    if (isSyncingFromHeaders.current) {
      isSyncingFromHeaders.current = false;
      return;
    }
    if (Math.abs(lanes.scrollTop - headers.scrollTop) > 0.5) {
      isSyncingFromLanes.current = true;
      lanes.scrollTop = headers.scrollTop;
    }
  };

  const handleLanesScroll = () => {
    const headers = headersScrollRef.current;
    const lanes = lanesScrollRef.current;
    if (!headers || !lanes) return;
    if (isSyncingFromLanes.current) {
      isSyncingFromLanes.current = false;
      return;
    }
    if (Math.abs(headers.scrollTop - lanes.scrollTop) > 0.5) {
      isSyncingFromHeaders.current = true;
      headers.scrollTop = lanes.scrollTop;
    }
  };

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
  // Playhead smooth position sync: runs at 60fps via rAF ONLY when playing,
  // and syncs immediately on zoom or time updates when paused.
  useEffect(() => {
    let animId: number;
    const updatePlayhead = () => {
      if (playheadRef.current) {
        const time = audioEngine.getCurrentTime();
        playheadRef.current.style.transform = `translateX(${time * zoom}px)`;
      }
    };
    updatePlayhead();

    const unsub = audioEngine.onTimeUpdate((time) => {
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${time * zoom}px)`;
      }
    });

    if (isPlaying) {
      const syncPlayhead = () => {
        updatePlayhead();
        animId = requestAnimationFrame(syncPlayhead);
      };
      animId = requestAnimationFrame(syncPlayhead);
    }

    return () => {
      unsub();
      if (animId) cancelAnimationFrame(animId);
    };
  }, [zoom, isPlaying]);

  // Handle Drag & Drop of Audio Files directly onto Timeline
  const handleDrop = async (e: React.DragEvent, trackId?: string) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('audio/'));
    if (files.length === 0) return;

    const ctx = await audioEngine.ensureContext();

    // Fix(waveA): repartir los clips en cascada para no apilarlos todos en currentTime.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Fix(waveB-ts): files[i] es File|undefined en tipo; en la práctica i < length.
      if (!file) continue;
      try {
        const audioBuffer = await decodeAudioFile(file, ctx);
        const peaks = generateWaveformPeaks(audioBuffer, 800);
        const targetTrackId = trackId || addTrack(file.name.replace(/\.[^/.]+$/, ''));
        const dur = audioBuffer.duration;
        const rawStart = audioEngine.getCurrentTime() + i * (dur + 0.5);
        // Fix(waveA): snap magnético al colocar el clip importado.
        const liveClips = useDawStore.getState().clips;
        const { snappedTime } = calculateMagneticSnap(rawStart, bpm, timeSignature, liveClips, 0.1, snapMode);

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
        // Fix(waveB-shell): toast no bloqueante en vez de alert().
        pushToast('Error al importar archivo de audio: ' + err);
      }
    }
  };

  // Fix(waveA): ancho de lanes = viewport menos la columna de headers MEDIDA
  // (ResizeObserver), misma fórmula que Ruler para alinear rejilla y clips.
  const totalWidth = Math.max(viewportWidth - headerWidth, duration * zoom);

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
          onClick={() => {
            if (!selectedClip) return;
            const curTime = audioEngine.getCurrentTime();
            if (curTime > selectedClip.startTime && curTime < selectedClip.startTime + selectedClip.duration) {
              splitClip(selectedClip.id, curTime);
            } else {
              pushToast('El cursor de reproducción debe estar dentro del clip para cortar');
            }
          }}
          disabled={!canSplit}
          className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-semibold bg-dark-surfaceLight hover:bg-dark-border disabled:opacity-40 text-cyan-400"
          title={!selectedClip ? 'Selecciona un clip para cortar' : "Cortar clip seleccionado en el cursor ('S')"}
        >
          <Scissors className="w-3.5 h-3.5" />
          <span>Cortar ('S')</span>
        </button>

        <div className="h-4 w-px bg-dark-border mx-1" />

        <div className="flex items-center space-x-1.5">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Snap</span>
          <select
            value={snapMode}
            onChange={(e) => setSnapMode(e.target.value as any)}
            className="bg-dark-surfaceLight border border-dark-border/80 text-cyan-400 text-xs rounded px-1.5 py-0.5 outline-none focus:border-cyan-500 cursor-pointer"
            title="Rejilla de Snap Magnético"
          >
            <option value="bar">1 Bar</option>
            <option value="1/2">1/2</option>
            <option value="1/4">1/4</option>
            <option value="1/8">1/8</option>
            <option value="1/16">1/16</option>
            <option value="1/32">1/32</option>
            <option value="triplet">1/3 Triolet</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>

      {/* Timeline Main Layout: Headers on left, Scrollable Lanes on right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Track Headers Column */}
        <div ref={headerColRef} data-testid="headers-col" className="w-60 flex-shrink-0 flex flex-col bg-dark-surface border-r border-dark-border z-20">
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
          <div
            ref={headersScrollRef}
            data-testid="headers-scroll"
            onScroll={handleHeadersScroll}
            className="flex-1 overflow-y-auto"
          >
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
          ref={lanesScrollRef}
          data-testid="lanes-scroll"
          onScroll={handleLanesScroll}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e)}
          className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#07090e]"
        >
          {/* Timeline Ruler */}
          <Ruler lanesWidth={totalWidth} />

          {/* Track Lanes */}
          <div data-testid="lanes-inner" className="relative" style={{ width: `${totalWidth}px` }}>
            {/* Smooth 60 FPS Playhead Vertical Line */}
            <div
              ref={playheadRef}
              className="absolute top-0 bottom-0 w-px bg-cyan-400 shadow-md shadow-cyan-400/50 z-20 pointer-events-none"
              style={{
                height: `${Math.max(tracks.length * 96, 400)}px`,
                willChange: 'transform',
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
