import React, { useState } from 'react';
import { useDawStore } from '../../store/useDawStore';
import { audioEngine } from '../../audio/AudioEngine';
import { encodeWav, downloadAudioBlob } from '../../audio/WavExporter';
import { 
  X, 
  Download, 
  CheckCircle, 
  Disc, 
  ShieldCheck,
  Loader2 
} from 'lucide-react';

export const ExportModal: React.FC = () => {
  const { 
    exportModalOpen, 
    setExportModalOpen, 
    tracks, 
    clips, 
    projectName 
  } = useDawStore();

  const [bitDepth, setBitDepth] = useState<16 | 24>(16);
  const [sampleRate, setSampleRate] = useState<number>(44100);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportComplete, setExportComplete] = useState<boolean>(false);
  const [fileSizeMb, setFileSizeMb] = useState<number>(0);

  if (!exportModalOpen) return null;

  const handleStartExport = async () => {
    setIsExporting(true);
    setExportComplete(false);

    try {
      // Find actual project end time from clips
      let maxTime = 4;
      for (const clip of clips) {
        maxTime = Math.max(maxTime, clip.startTime + clip.duration);
      }
      // Add 1.5 seconds tail for reverb/delay rings
      const exportDuration = maxTime + 1.5;

      // 1. Offline faster-than-realtime render
      const renderedBuffer = await audioEngine.renderOfflineMixdown(
        tracks,
        clips,
        exportDuration,
        sampleRate
      );

      // 2. Encode to WAV
      const wavBytes = encodeWav(renderedBuffer, bitDepth);
      const blob = new Blob([wavBytes as unknown as BlobPart], { type: 'audio/wav' });

      setFileSizeMb(Math.round((blob.size / (1024 * 1024)) * 100) / 100);
      setExportComplete(true);

      // 3. Trigger download
      const cleanName = (projectName || 'cancion_master').replace(/\s+/g, '_');
      downloadAudioBlob(blob, `${cleanName}_${bitDepth}bit.wav`);
    } catch (err) {
      alert('Error durante la exportación de audio: ' + err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-dark-surface border border-dark-border w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col">
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
            onClick={() => setExportModalOpen(false)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-dark-border"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Options */}
        <div className="p-5 space-y-4">
          <div className="p-3.5 bg-dark-bg border border-dark-border rounded-xl flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-200">Formato de Audio</span>
              <p className="text-[11px] text-slate-400">WAV PCM Lineal sin compresión destructiva</p>
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
            onClick={() => setExportModalOpen(false)}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-dark-border transition-colors"
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
