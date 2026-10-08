import React, { useEffect, useRef, useState } from 'react';
import { useDawStore } from '../../store/useDawStore';
import { pluginHost } from '../../audio/PluginHost';
import { Knob } from './Knob';
import { 
  X, 
  Power, 
  Trash2, 
  Plus, 
  Upload, 
  Sparkles,
  Sliders
} from 'lucide-react';

export const PluginRackModal: React.FC = () => {
  const {
    pluginModalTrackId,
    setPluginModal,
    tracks,
    togglePlugin,
    removePluginFromTrack,
    updatePluginParam,
    addPluginToTrack,
    pushToast,
  } = useDawStore();

  const [selectedCatalogPlugin, setSelectedCatalogPlugin] = useState<string>('eq3');
  const [importingCustom, setImportingCustom] = useState<boolean>(false);
  const [customCode, setCustomCode] = useState<string>(`// Plantilla de Plugin Local VST / WAM en JavaScript
const customPlugin = {
  id: 'custom_filter_' + Date.now(),
  name: 'Filtro Resonante Personalizado',
  category: 'custom',
  description: 'Filtro paso bajo analógico con resonancia Q',
  parameters: [
    { id: 'cutoff', name: 'Cutoff', min: 100, max: 12000, step: 50, defaultValue: 2500, unit: 'Hz' },
    { id: 'resonance', name: 'Q', min: 0.5, max: 12, step: 0.2, defaultValue: 3.0 }
  ],
  createDSPNode: (context, params) => {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = params.cutoff ?? 2500;
    filter.Q.value = params.resonance ?? 3.0;
    return {
      inputNode: filter,
      outputNode: filter,
      updateParameter: (id, val) => {
        if (id === 'cutoff') filter.frequency.setTargetAtTime(val, context.currentTime, 0.02);
        if (id === 'resonance') filter.Q.setTargetAtTime(val, context.currentTime, 0.02);
      }
    };
  }
};`);

  // Fix(waveA): foco inicial al abrir + devolver foco al cerrar + cierre con ESC.
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!pluginModalTrackId) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPluginModal(null, null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      prevFocusRef.current?.focus?.();
    };
  }, [pluginModalTrackId, setPluginModal]);

  if (!pluginModalTrackId) return null;

  const track = tracks.find((t) => t.id === pluginModalTrackId);
  if (!track) return null;

  const allPlugins = pluginHost.getAllPluginDefinitions();

  const handleImportCustom = () => {
    try {
      const def = pluginHost.registerCustomPlugin(customCode);
      addPluginToTrack(track.id, def.id);
      setImportingCustom(false);
      // Fix(waveB-shell): toast no bloqueante en vez de alert().
      pushToast(`Plugin local "${def.name}" importado e insertado en el rack.`);
    } catch (err) {
      pushToast('Error al compilar plugin local: ' + err);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setCustomCode(text);
      setImportingCustom(true);
    };
    reader.readAsText(file);
  };

  return (
    // Fix(waveA): cierre por click en overlay (target === currentTarget: no dentro del panel).
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 select-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setPluginModal(null, null);
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Rack de efectos de ${track.name}`}
        className="bg-dark-surface border border-dark-border w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden focus:outline-none"
      >
        {/* Modal Header */}
        <div className="h-14 px-5 border-b border-dark-border flex items-center justify-between bg-dark-surfaceLight/50">
          <div className="flex items-center space-x-3">
            <div className="p-1.5 rounded-lg bg-cyan-950 border border-cyan-500/40 text-cyan-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <span>Rack de Efectos VST</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono font-medium" style={{ backgroundColor: `${track.color}25`, color: track.color }}>
                  {track.name}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Encadena ecualizadores, compresores, reverberación y plugins locales WAM / WebCLAP.
              </p>
            </div>
          </div>

          <button
            onClick={() => setPluginModal(null, null)}
            aria-label="Cerrar rack de efectos"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-dark-border transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Active Chain */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
              <span>Cadena de Inserción Activa</span>
              <span className="text-cyan-400 font-mono">({track.plugins.length})</span>
            </h3>

            {track.plugins.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-dark-border rounded-xl text-slate-500 text-xs">
                No hay efectos insertados en esta pista. Selecciona un plugin abajo o importa uno local.
              </div>
            ) : (
              track.plugins.map((plugin, index) => {
                const def = pluginHost.getPluginDefinition(plugin.pluginId);
                return (
                  <div
                    key={plugin.instanceId}
                    className={`border rounded-xl p-4 transition-all ${
                      plugin.enabled
                        ? 'bg-dark-bg/80 border-dark-border shadow-md'
                        : 'bg-dark-bg/40 border-dark-border/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between pb-3 border-b border-dark-border/60 mb-3">
                      <div className="flex items-center space-x-2.5">
                        <span className="w-5 h-5 rounded-full bg-cyan-950 border border-cyan-500/40 text-[10px] font-mono text-cyan-400 flex items-center justify-center font-bold">
                          {index + 1}
                        </span>
                        <div>
                          <h4 className="text-xs font-bold text-slate-200">{plugin.name}</h4>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {def?.description || 'Efecto de audio DSP en tiempo real'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* Bypass Button */}
                        <button
                          onClick={() => togglePlugin(track.id, plugin.instanceId)}
                          className={`p-1.5 rounded-lg border transition-all ${
                            plugin.enabled
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-sm shadow-emerald-500/20'
                              : 'bg-dark-surfaceLight border-dark-border text-slate-500'
                          }`}
                          title={plugin.enabled ? 'Desactivar efecto (Bypass)' : 'Activar efecto'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>

                        {/* Remove Button */}
                        <button
                          onClick={() => removePluginFromTrack(track.id, plugin.instanceId)}
                          className="p-1.5 rounded-lg border border-dark-border hover:border-red-500/40 text-slate-400 hover:text-red-400 transition-colors"
                          title="Eliminar del rack"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Parameter Knobs Grid */}
                    <div className="flex flex-wrap gap-5 items-center justify-start pt-1">
                      {def?.parameters.map((param) => {
                        const val = plugin.parameters[param.id] ?? param.defaultValue;
                        return (
                          <Knob
                            key={param.id}
                            label={param.name}
                            value={val}
                            min={param.min}
                            max={param.max}
                            step={param.step}
                            defaultValue={param.defaultValue}
                            unit={param.unit}
                            size={42}
                            onChange={(newVal) =>
                              updatePluginParam(track.id, plugin.instanceId, param.id, newVal)
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Add New Plugin Section */}
          <div className="pt-4 border-t border-dark-border flex flex-col space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Añadir Efecto al Rack
            </h3>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedCatalogPlugin}
                onChange={(e) => setSelectedCatalogPlugin(e.target.value)}
                className="bg-dark-surfaceLight border border-dark-border rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 flex-1 min-w-[200px]"
              >
                {allPlugins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} [{p.category.toUpperCase()}]
                  </option>
                ))}
              </select>

              <button
                onClick={() => addPluginToTrack(track.id, selectedCatalogPlugin)}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-md shadow-cyan-500/20"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Insertar Plugin</span>
              </button>

              <label className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-dark-surfaceLight hover:bg-dark-border border border-dark-border text-slate-200 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5 text-purple-400" />
                <span>Cargar VST Local (.js/.wam)</span>
                <input
                  type="file"
                  accept=".js,.json,.wam"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <button
                onClick={() => setImportingCustom(!importingCustom)}
                className="flex items-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium bg-dark-surfaceLight hover:bg-dark-border border border-dark-border text-purple-300 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Editor de Código VST</span>
              </button>
            </div>

            {/* Custom VST Code Editor Area */}
            {importingCustom && (
              <div className="mt-3 p-4 bg-dark-bg border border-dark-border rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-300">
                    Módulo DSP Local en JavaScript (Web Audio API / WAM)
                  </span>
                  <button
                    onClick={handleImportCustom}
                    className="px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-600/30"
                  >
                    Compilar e Insertar
                  </button>
                </div>
                <textarea
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  rows={8}
                  className="w-full bg-[#05070a] text-slate-200 font-mono text-xs p-3 rounded-lg border border-dark-border focus:border-purple-500 focus:outline-none"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Fix(waveB-shell): default para React.lazy.
export default PluginRackModal;
