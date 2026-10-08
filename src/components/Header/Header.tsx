import React from 'react';
import { useDawStore } from '../../store/useDawStore';
import { 
  Music, 
  Layers, 
  Sliders, 
  Download, 
  Plus, 
  Sparkles,
  ExternalLink
} from 'lucide-react';

export const Header: React.FC = () => {
  const { 
    projectName, 
    setProjectName, 
    activeView, 
    setActiveView, 
    addTrack, 
    loadDemoProject, 
    setExportModalOpen,
    tracks
  } = useDawStore();

  return (
    <header className="h-14 bg-dark-surface border-b border-dark-border px-4 flex items-center justify-between z-30 select-none">
      {/* Brand & Project Name */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2 text-cyan-400 font-bold tracking-wider text-base">
          <div className="p-1.5 bg-cyan-950/60 border border-cyan-500/40 rounded-lg text-cyan-400">
            <Music className="w-5 h-5" />
          </div>
          <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
            HydraDAW
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/40 text-cyan-300 border border-cyan-700/50 uppercase font-mono">
            Local 100%
          </span>
        </div>

        <div className="h-4 w-px bg-dark-border" />

        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="bg-dark-surfaceLight/60 hover:bg-dark-surfaceLight text-slate-200 text-sm font-medium px-2.5 py-1 rounded border border-dark-border focus:border-cyan-500 focus:outline-none transition-colors w-48 truncate"
          title="Nombre del Proyecto"
        />
      </div>

      {/* View Switcher: Timeline vs Mixer */}
      <div className="flex items-center bg-dark-surfaceLight/80 p-0.5 rounded-lg border border-dark-border">
        <button
          onClick={() => setActiveView('timeline')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
            activeView === 'timeline'
              ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/20'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Timeline</span>
        </button>
        <button
          onClick={() => setActiveView('mixer')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
            activeView === 'mixer'
              ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/20'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Mixer</span>
        </button>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center space-x-2.5">
        {tracks.length === 0 && (
          <button
            onClick={() => loadDemoProject()}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-colors animate-pulse"
            title="Cargar stems instrumentales de demostración"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Cargar Demo</span>
          </button>
        )}

        <button
          onClick={() => addTrack()}
          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-surfaceLight hover:bg-dark-border text-slate-200 border border-dark-border transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-cyan-400" />
          <span>Nueva Pista</span>
        </button>

        <button
          onClick={() => setExportModalOpen(true)}
          className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-md shadow-emerald-500/20 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Masterizar & Exportar</span>
        </button>

        <a
          href="../"
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-dark-surfaceLight rounded-md transition-colors"
          title="Volver a la suite Hydra"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
};
