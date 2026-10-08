import React, { useEffect, useRef, useState } from 'react';
import { useDawStore } from '../../store/useDawStore';
import type { AudioClip } from '../../types/daw';
import { audioEngine } from '../../audio/AudioEngine';
import { encodeWav, downloadAudioBlob } from '../../audio/WavExporter';
// Fix(waveC): sonoridad BS.1770 + export AAC (WebCodecs + ADTS manual).
import {
  measureLoudness,
  computeNormalizeGain,
  applyGainInPlace,
  NORMALIZE_TARGET_LUFS,
  type LoudnessResult,
} from '../../audio/loudness';
import { encodeAacAdts, isAacSupported } from '../../audio/aacExporter';
import { linearToDb } from '../../audio/audioMath';
import {
  X,
  Download,
  CheckCircle,
  Disc,
  ShieldCheck,
  Loader2
} from 'lucide-react';

// Fix(waveA): duración de exportación como función pura (mínimo 4s + 1.5s de cola).
export const computeExportDuration = (
  clips: Pick<AudioClip, 'startTime' | 'duration'>[]
): number => {
  let maxTime = 4;
  for (const clip of clips) {
    maxTime = Math.max(maxTime, clip.startTime + clip.duration);
  }
  return maxTime + 1.5;
};

// Fix(waveC): formato de export (WAV existente intacto; AAC vía WebCodecs+ADTS).
export type ExportFormat = 'wav' | 'aac';
export type AacBitrate = 128_000 | 192_000 | 256_000;

// Fix(waveC): formateo de sonoridad para la UI (puro, sin efectos).
export const formatLufs = (v: number): string =>
  Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : '-∞ LUFS';
export const formatPeakDbfs = (peakLinear: number): string => {
  const db = linearToDb(Math.max(0, peakLinear));
  return Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : '-∞ dBFS';
};
// Fix(waveA): antes solo se reemplazaban espacios; ahora todo lo no seguro [^a-z0-9_-].
export const sanitizeExportFilename = (name: string): string => {
  const base = (name || '').trim() || 'cancion_master';
  return base.replace(/[^a-z0-9_-]+/gi, '_');
};

export const ExportModal: React.FC = () => {
  const {
    exportModalOpen,
    setExportModalOpen,
    tracks,
    clips,
    projectName,
    pushToast
  } = useDawStore();

  const [bitDepth, setBitDepth] = useState<16 | 24>(16);
  const [sampleRate, setSampleRate] = useState<number>(44100);
  const [includeMetronome, setIncludeMetronome] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportComplete, setExportComplete] = useState<boolean>(false);
  const [fileSizeMb, setFileSizeMb] = useState<number>(0);
  // Fix(waveC): formato WAV/AAC + bitrate AAC + sonoridad + normalización.
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav');
  const [aacBitrate, setAacBitrate] = useState<AacBitrate>(128_000);
  const [loudness, setLoudness] = useState<LoudnessResult | null>(null);
  const [normalizeToMinus14, setNormalizeToMinus14] = useState<boolean>(false);
  const [normalizeGainDb, setNormalizeGainDb] = useState<number | null>(null);
  const [normalizeLimited, setNormalizeLimited] = useState<boolean>(false);
  const [normalizeWouldClip, setNormalizeWouldClip] = useState<boolean>(false);
  const [aacSupported, setAacSupported] = useState<boolean | null>(null);

  // Fix(waveA): foco inicial al abrir + devolver foco al cerrar + cierre con ESC.
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  // Fix(waveA): ref viva para que el handler de ESC vea el estado actual de exportación.
  const exportingRef = useRef(isExporting);
  exportingRef.current = isExporting;
  useEffect(() => {
    if (!exportModalOpen) return;
    // Fix(waveA): resetea el estado de éxito anterior al abrir el modal.
    setExportComplete(false);
    setFileSizeMb(0);
    // Fix(waveC): resetea la lectura de sonoridad al abrir (conserva formato/opciones).
    setLoudness(null);
    setNormalizeGainDb(null);
    setNormalizeLimited(false);
    setNormalizeWouldClip(false);
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !exportingRef.current) {
        setExportModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      prevFocusRef.current?.focus?.();
    };
    // Fix(waveA): solo al abrir/cerrar; isExporting se lee vía ref estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportModalOpen]);

  // Fix(waveC): sondea soporte AAC (WebCodecs) al abrir o cambiar la tasa.
  useEffect(() => {
    if (!exportModalOpen) return;
    let cancelled = false;
    setAacSupported(null);
    void isAacSupported({ sampleRate, numberOfChannels: 2, bitrate: aacBitrate })
      .then((ok) => {
        if (!cancelled) setAacSupported(ok);
      })
      .catch(() => {
        if (!cancelled) setAacSupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exportModalOpen, sampleRate, aacBitrate]);

  if (!exportModalOpen) return null;

  const closeModal = () => {
    // Fix(waveA): no cerrar mientras se renderiza para no perder el resultado.
    if (isExporting) return;
    setExportModalOpen(false);
  };

  const handleStartExport = async () => {
    setIsExporting(true);
    setExportComplete(false);

    try {
      // Fix(waveA): duración extraída a función pura testeable.
      const exportDuration = computeExportDuration(clips);

      // 1. Offline faster-than-realtime render
      // Fix(waveA): respeta la opción de click de metrónomo (firma: opts?: { metronome?: boolean }).
      const renderedBuffer = await audioEngine.renderOfflineMixdown(
        tracks,
        clips,
        exportDuration,
        sampleRate,
        { metronome: includeMetronome }
      );

      // Fix(waveC): mide sonoridad integrada + pico sobre el render (solo lectura).
      const measured = measureLoudness(renderedBuffer);
      let finalLoudness: LoudnessResult = measured;
      let appliedGainDb: number | null = null;
      let limited = false;
      let wouldClip = false;

      // Fix(waveC): normalización a -14 LUFS (ganancia pre-codificación, WAV y AAC).
      if (normalizeToMinus14) {
        const plan = computeNormalizeGain(
          measured.integratedLUFS,
          Math.max(measured.peak, measured.truePeakEstimate),
          NORMALIZE_TARGET_LUFS,
        );
        appliedGainDb = plan.gainDb;
        limited = plan.limitedByCap;
        wouldClip = plan.wouldClip;
        if (plan.gainLinear !== 1) {
          applyGainInPlace(renderedBuffer, plan.gainLinear);
          finalLoudness = {
            integratedLUFS: Number.isFinite(measured.integratedLUFS)
              ? measured.integratedLUFS + plan.gainDb
              : measured.integratedLUFS,
            peak: measured.peak * plan.gainLinear,
            truePeakEstimate: measured.truePeakEstimate * plan.gainLinear,
          };
        }
      }
      setLoudness(finalLoudness);
      setNormalizeGainDb(appliedGainDb);
      setNormalizeLimited(limited);
      setNormalizeWouldClip(wouldClip);

      const cleanName = sanitizeExportFilename(projectName);
      if (exportFormat === 'aac') {
        // Fix(waveC): AAC-LC vía WebCodecs + ADTS; error descriptivo → toast (misma vía waveB-shell).
        const aacBytes = await encodeAacAdts(renderedBuffer, { bitrate: aacBitrate });
        const blob = new Blob([aacBytes as unknown as BlobPart], { type: 'audio/aac' });
        setFileSizeMb(Math.round((blob.size / (1024 * 1024)) * 100) / 100);
        setExportComplete(true);
        downloadAudioBlob(blob, `${cleanName}_aac${Math.round(aacBitrate / 1000)}k.aac`);
      } else {
        // 2. Encode to WAV (flujo existente intacto cuando AAC no se elige).
        const wavBytes = encodeWav(renderedBuffer, bitDepth);
        const blob = new Blob([wavBytes as unknown as BlobPart], { type: 'audio/wav' });

        setFileSizeMb(Math.round((blob.size / (1024 * 1024)) * 100) / 100);
        setExportComplete(true);

        // 3. Trigger download
        downloadAudioBlob(blob, `${cleanName}_${bitDepth}bit.wav`);
      }
    } catch (err) {
      // Fix(waveB-shell): toast no bloqueante en vez de alert().
      pushToast('Error durante la exportación de audio: ' + err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    // Fix(waveA): cierre por click en overlay (target === currentTarget: no dentro del panel).
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Exportar mezcla"
        className="bg-dark-surface border border-dark-border w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col focus:outline-none"
      >
        {/* Header */}
        <div className="h-14 px-5 border-b border-dark-border flex items-center justify-between bg-dark-surfaceLight/50">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-950 border border-emerald-500/40 text-emerald-400">
              <Disc className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">Masterización & Bouncing Offline</h2>
              <p className="text-[11px] text-slate-400">Exportación acelerada 100% en el cliente sin servidores</p>
            </div>
          </div>

          <button
            onClick={closeModal}
            disabled={isExporting}
            aria-label="Cerrar diálogo de exportación"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-dark-border disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Options */}
        <div className="p-5 space-y-4">
          {/* Fix(waveC): selector de formato WAV/AAC (AAC vía WebCodecs + ADTS manual). */}
          <div className="p-3.5 bg-dark-bg border border-dark-border rounded-xl flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-200">Formato de Audio</span>
              <p className="text-[11px] text-slate-400">
                {exportFormat === 'wav'
                  ? 'WAV PCM Lineal sin compresión destructiva'
                  : 'AAC-LC comprimido (WebCodecs, contenedor ADTS)'}
              </p>
            </div>
            <div className="flex bg-dark-surfaceLight p-1 rounded-lg border border-dark-border space-x-1">
              <button
                onClick={() => setExportFormat('wav')}
                className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                  exportFormat === 'wav' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                WAV
              </button>
              <button
                onClick={() => setExportFormat('aac')}
                className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                  exportFormat === 'aac' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                AAC
              </button>
            </div>
          </div>

          {exportFormat === 'wav' ? (
            <div className="p-3.5 bg-dark-bg border border-dark-border rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-200">Profundidad de Bits</span>
                <p className="text-[11px] text-slate-400">Resolución PCM del WAV</p>
              </div>
              <div className="flex bg-dark-surfaceLight p-1 rounded-lg border border-dark-border space-x-1">
                <button
                  onClick={() => setBitDepth(16)}
                  className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                    bitDepth === 16 ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  16-bit (CD)
                </button>
                <button
                  onClick={() => setBitDepth(24)}
                  className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                    bitDepth === 24 ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  24-bit (Studio)
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3.5 bg-dark-bg border border-dark-border rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-200">Bitrate AAC</span>
                  <p className="text-[11px] text-slate-400">Calidad del AAC-LC (mp4a.40.2)</p>
                </div>
                <div className="flex bg-dark-surfaceLight p-1 rounded-lg border border-dark-border space-x-1">
                  {([128_000, 192_000, 256_000] as const).map((b) => (
                    <button
                      key={b}
                      onClick={() => setAacBitrate(b)}
                      className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                        aacBitrate === b ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {Math.round(b / 1000)}k
                    </button>
                  ))}
                </div>
              </div>
              {aacSupported === false && (
                <p className="text-[11px] text-amber-400">
                  Este navegador no soporta AAC (sin AudioEncoder WebCodecs, p. ej. Safari): la
                  exportación AAC fallará. Usa WAV.
                </p>
              )}
            </div>
          )}

          <div className="p-3.5 bg-dark-bg border border-dark-border rounded-xl flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-200">Frecuencia de Muestreo</span>
              <p className="text-[11px] text-slate-400">Tasa de samples por segundo</p>
            </div>
            <select
              value={sampleRate}
              onChange={(e) => setSampleRate(Number(e.target.value))}
              className="bg-dark-surfaceLight border border-dark-border text-slate-200 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-cyan-500"
            >
              <option value={44100}>44.1 kHz (Estándar)</option>
              <option value={48000}>48.0 kHz (Audiovisual)</option>
            </select>
          </div>

          {/* Fix(waveA): opción de click de metrónomo en el bounce (renderOfflineMixdown acepta opts.metronome). */}
          <label className="p-3.5 bg-dark-bg border border-dark-border rounded-xl flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeMetronome}
              onChange={(e) => setIncludeMetronome(e.target.checked)}
              className="w-4 h-4 accent-emerald-500"
            />
            <span>
              <span className="text-xs font-bold text-slate-200 block">Incluir click de metrónomo</span>
              <span className="text-[11px] text-slate-400">Añade la guía de tempo al archivo exportado</span>
            </span>
          </label>

          {/* Fix(waveC): normalización a -14 LUFS pre-codificación (WAV y AAC). */}
          <label className="p-3.5 bg-dark-bg border border-dark-border rounded-xl flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={normalizeToMinus14}
              onChange={(e) => setNormalizeToMinus14(e.target.checked)}
              className="w-4 h-4 accent-emerald-500"
            />
            <span>
              <span className="text-xs font-bold text-slate-200 block">
                Normalizar a {NORMALIZE_TARGET_LUFS} LUFS
              </span>
              <span className="text-[11px] text-slate-400">
                Aplica ganancia antes de codificar (tope +12dB)
              </span>
            </span>
          </label>

          {/* Fix(waveC): lectura de sonoridad tras el render (integrada + pico + true peak estimado). */}
          {loudness && (
            <div className="p-3 bg-slate-950/40 border border-slate-500/30 rounded-xl text-[11px] text-slate-300 space-y-1">
              <p>
                Integrada: {formatLufs(loudness.integratedLUFS)} · Pico: {formatPeakDbfs(loudness.peak)} ·
                Pico verdadero (estimado): {formatPeakDbfs(loudness.truePeakEstimate)}
              </p>
              {normalizeGainDb !== null && (
                <p className="text-slate-400">
                  Ganancia aplicada: {normalizeGainDb >= 0 ? '+' : ''}
                  {normalizeGainDb.toFixed(1)}dB
                  {normalizeLimited ? ' (limitada a +12dB)' : ''}
                </p>
              )}
              {normalizeWouldClip && (
                <p className="text-amber-400">
                  Aviso: la normalización deja el pico por encima de 0dBFS y podría clipear.
                </p>
              )}
            </div>
          )}

          {/* Master Bus Protection Info */}
          <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl flex items-center space-x-3">
            <ShieldCheck className="w-6 h-6 text-emerald-400 flex-shrink-0" />
            <div className="text-[11px] text-slate-300">
              <strong className="text-emerald-400 block font-semibold">Master Brickwall Limiter Activo</strong>
              El bus master protege contra clipeo digital manteniendo el techo estricto a -0.1 dBFS.
            </div>
          </div>

          {/* Export Status */}
          {exportComplete && (
            <div className="p-3 bg-cyan-950/40 border border-cyan-500/40 rounded-xl flex items-center space-x-3 text-cyan-300 text-xs">
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
              <span>
                ¡Exportación completada! Archivo descargado con éxito ({fileSizeMb} MB).
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-dark-border bg-dark-surfaceLight/30 flex items-center justify-end space-x-3">
          <button
            onClick={closeModal}
            disabled={isExporting}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-dark-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cerrar
          </button>

          <button
            onClick={handleStartExport}
            disabled={isExporting}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Renderizando en CPU...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Exportar Mezcla Completa</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Fix(waveB-shell): default para React.lazy (se conservan los named exports usados en tests).
export default ExportModal;
