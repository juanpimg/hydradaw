import React, { useRef } from 'react';
import { Play, FilePlus2, Upload, Loader2, Disc } from 'lucide-react';

interface StartScreenProps {
  /** Nombre del proyecto guardado, o null si no hay ninguno. */
  savedName: string | null;
  /** Aún buscando en IndexedDB. */
  lookingUp: boolean;
  /** Acción en curso ('continue' | 'blank' | 'import'), o null. */
  busy: 'continue' | 'blank' | 'import' | null;
  onContinue: () => void;
  onBlank: () => void;
  onPickFile: (file: File) => void;
}

/**
 * Pantalla de inicio: al abrir la web se pregunta si seguir editando el
 * proyecto guardado, empezar uno en blanco o importar un archivo.
 * No se toca el store hasta elegir (el arranque es perezoso).
 */
export const StartScreen: React.FC<StartScreenProps> = ({
  savedName,
  lookingUp,
  busy,
  onContinue,
  onBlank,
  onPickFile,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const disabled = busy !== null || lookingUp;

  const spin = (key: 'continue' | 'blank' | 'import') =>
    busy === key ? <Loader2 className="w-5 h-5 motion-safe:animate-spin" /> : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pantalla de inicio de HydraDAW"
      className="fixed inset-0 z-50 bg-dark-bg flex items-center justify-center p-4 select-none"
    >
      <div className="w-full max-w-md bg-dark-surface border border-dark-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-4 text-center border-b border-dark-border bg-dark-surfaceLight/40">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-cyan-950 border border-cyan-500/40 text-cyan-400 flex items-center justify-center">
            <Disc className="w-7 h-7" />
          </div>
          <h1 className="mt-3 text-xl font-bold text-slate-100">HydraDAW</h1>
          <p className="mt-1 text-xs text-slate-400">
            Estación de audio 100% local — nada sale de tu navegador
          </p>
        </div>

        <div className="p-5 space-y-3">
          {lookingUp ? (
            <p className="text-xs text-slate-400 text-center py-4 flex items-center justify-center space-x-2">
              <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
              <span>Buscando proyecto guardado…</span>
            </p>
          ) : (
            <>
              <button
                autoFocus
                disabled={disabled}
                onClick={onContinue}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-left bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-50"
              >
                {spin('continue') || <Play className="w-5 h-5 flex-shrink-0" />}
                <span>
                  <span className="block text-sm font-bold">
                    {savedName ? 'Seguir editando' : 'Empezar con la demo'}
                  </span>
                  <span className="block text-[11px] opacity-80 truncate max-w-[280px]">
                    {savedName ? `«${savedName}»` : 'Proyecto demo con 4 pistas'}
                  </span>
                </span>
              </button>

              <button
                disabled={disabled}
                onClick={onBlank}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-left bg-dark-bg border border-dark-border hover:border-cyan-500/60 transition-colors disabled:opacity-50"
              >
                {spin('blank') || <FilePlus2 className="w-5 h-5 flex-shrink-0 text-cyan-400" />}
                <span>
                  <span className="block text-sm font-bold text-slate-100">Nuevo proyecto en blanco</span>
                  <span className="block text-[11px] text-slate-400">
                    Lienzo vacío, sin pistas ni clips
                  </span>
                </span>
              </button>

              <button
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-left bg-dark-bg border border-dark-border hover:border-cyan-500/60 transition-colors disabled:opacity-50"
              >
                {spin('import') || <Upload className="w-5 h-5 flex-shrink-0 text-cyan-400" />}
                <span>
                  <span className="block text-sm font-bold text-slate-100">Cargar proyecto desde archivo</span>
                  <span className="block text-[11px] text-slate-400">
                    Importar .hydra o .json (el audio grabado se reimporta)
                  </span>
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".hydra,.json,application/json"
                className="hidden"
                aria-label="Elegir archivo de proyecto"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) onPickFile(file);
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};
