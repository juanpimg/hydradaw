import React, { useRef } from 'react';
import { useDawStore } from '../../store/useDawStore';
import { importAudioFiles } from '../../audio/importAudio';
import { 
  Music, 
  Layers, 
  Sliders, 
  Download, 
  Plus, 
  Sparkles,
  ExternalLink,
  Github,
  Upload
} from 'lucide-react';

export const Header: React.FC = () => {
  const projectName = useDawStore((s) => s.projectName);
  const setProjectName = useDawStore((s) => s.setProjectName);
  const activeView = useDawStore((s) => s.activeView);
  const setActiveView = useDawStore((s) => s.setActiveView);
  const addTrack = useDawStore((s) => s.addTrack);
  const loadDemoProject = useDawStore((s) => s.loadDemoProject);
  const setExportModalOpen = useDawStore((s) => s.setExportModalOpen);
  const trackCount = useDawStore((s) => s.tracks.length);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    await importAudioFiles(files, {});
  };

  return (
    // Fix(waveA): scroll horizontal en viewports estrechos para no recortar acciones.
    <header className="h-14 bg-dark-surface border-b border-dark-border px-4 flex items-center justify-between gap-3 z-30 select-none overflow-x-auto">
      {/* Brand & Project Name */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2 text-cyan-400 font-bold tracking-wider text-base">
          <div className="p-1.5 bg-cyan-950/60 border border-cyan-500/40 rounded-lg text-cyan-400">
            <Music className="w-5 h-5" />
          </div>
          <span className="text-white font-extrabold tracking-tight">
            Hydra<span className="text-cyan-400">DAW</span>
          </span>
          <span className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/40 text-cyan-300 border border-cyan-700/50 uppercase font-mono">
            Local 100%
          </span>
        </div>

        <div className="h-4 w-px bg-dark-border" />

        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Nombre del proyecto"
          className="bg-dark-surfaceLight/60 hover:bg-dark-surfaceLight text-slate-200 text-sm font-medium px-2.5 py-1 rounded border border-dark-border focus:border-cyan-500 focus:outline-none transition-colors w-24 sm:w-28 md:w-48 truncate"
          title="Nombre del Proyecto"
        />
      </div>

      {/* View Switcher: Timeline vs Mixer */}
      {/* Fix(waveA): grupo etiquetado + aria-pressed en la vista activa. */}
      <div role="group" aria-label="Selector de vista" className="flex items-center bg-dark-surfaceLight/80 p-0.5 rounded-lg border border-dark-border">
        <button
          onClick={() => setActiveView('timeline')}
          aria-pressed={activeView === 'timeline'}
          aria-label="Ver timeline"
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
            activeView === 'timeline'
              ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/20'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Timeline</span>
        </button>
        <button
          onClick={() => setActiveView('mixer')}
          aria-pressed={activeView === 'mixer'}
          aria-label="Ver mixer"
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
            activeView === 'mixer'
              ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/20'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Mixer</span>
        </button>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center space-x-2.5">
        {trackCount === 0 && (
          <button
            onClick={() => loadDemoProject()}
            aria-label="Cargar proyecto de demostración"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-colors motion-safe:animate-pulse"
            title="Cargar stems instrumentales de demostración"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Cargar Demo</span>
          </button>
        )}

        <button
          onClick={() => addTrack()}
          aria-label="Añadir nueva pista"
          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-surfaceLight hover:bg-dark-border text-slate-200 border border-dark-border transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Nueva Pista</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          aria-label="Importar audio"
          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-surfaceLight hover:bg-dark-border text-slate-200 border border-dark-border transition-colors"
          title="Importar archivos de audio desde tu dispositivo"
        >
          <Upload className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Importar audio</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          aria-label="Seleccionar archivos de audio"
          className="hidden"
          onChange={handleImportFiles}
        />

        <button
          onClick={() => setExportModalOpen(true)}
          aria-label="Abrir diálogo de masterización y exportación"
          className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-md shadow-emerald-500/20 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Masterizar & Exportar</span>
        </button>

        <a
          href="https://github.com/juanpimg/hydradaw"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ver HydraDAW en GitHub (pestaña nueva)"
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-dark-surfaceLight rounded-md transition-colors"
          title="Ver código en GitHub — ¡contribuye!"
        >
          <Github className="w-4 h-4" />
        </a>

        <a
          href="../"
          aria-label="Volver a la suite Hydra"
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-dark-surfaceLight rounded-md transition-colors"
          title="Volver a la suite Hydra"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
};
