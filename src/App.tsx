import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useDawStore } from './store/useDawStore';
import {
  peekSavedProjectName,
  loadSavedProject,
  importProjectFromJson,
  saveProjectNow,
  startAutosave,
} from './store/persistence';
import { Header } from './components/Header/Header';
import { Timeline } from './components/Timeline/Timeline';
import { MixerConsole } from './components/Mixer/MixerConsole';
import { TransportBar } from './components/Transport/TransportBar';
import { Toaster } from './components/Toast/Toaster';
import { StartScreen } from './components/Start/StartScreen';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

// Fix(waveB-shell): modales pesados fuera del chunk inicial (se cargan al abrirse).
const PluginRackModal = lazy(() => import('./components/Plugins/PluginRackModal'));
const ExportModal = lazy(() => import('./components/Export/ExportModal'));

export type BootBusy = 'continue' | 'blank' | 'import' | null;

export interface BootContinueOptions {
  savedName: string | null;
  setBusy: (b: BootBusy) => void;
  finishBoot: () => void;
  loadSavedProject: () => Promise<boolean>;
  loadDemoProject: () => Promise<void>;
  pushToast: (msg: string) => void;
}

export async function runHandleContinue({
  savedName,
  setBusy,
  finishBoot,
  loadSavedProject,
  loadDemoProject,
  pushToast,
}: BootContinueOptions): Promise<void> {
  setBusy('continue');
  try {
    if (savedName) {
      const ok = await loadSavedProject();
      if (!ok) {
        pushToast('No se pudo abrir el proyecto guardado; se carga la demo.');
        await loadDemoProject();
      }
    } else {
      await loadDemoProject();
    }
    finishBoot();
  } catch (err) {
    console.error('[boot] Error al continuar el proyecto:', err);
    pushToast('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.');
    finishBoot();
  } finally {
    setBusy(null);
  }
}

export interface BootBlankOptions {
  setBusy: (b: BootBusy) => void;
  finishBoot: () => void;
  createBlankProject: () => Promise<void>;
  pushToast: (msg: string) => void;
}

export async function runHandleBlank({
  setBusy,
  finishBoot,
  createBlankProject,
  pushToast,
}: BootBlankOptions): Promise<void> {
  setBusy('blank');
  try {
    await createBlankProject();
    finishBoot();
  } catch (err) {
    console.error('[boot] Error al crear proyecto en blanco:', err);
    pushToast('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.');
    finishBoot();
  } finally {
    setBusy(null);
  }
}

export interface BootPickFileOptions {
  file: File;
  setBusy: (b: BootBusy) => void;
  finishBoot: () => void;
  importProjectFromJson: (raw: unknown) => Promise<{ ok: boolean; name?: string }>;
  pushToast: (msg: string) => void;
}

/**
 * ST-08/SEC-02: presupuesto de importación. Los archivos por encima de 25 MB
 * se rechazan con un toast ANTES de leerlos (`file.text()` cargaría todo el
 * archivo en memoria y el `JSON.parse` sin cota congelaría la pestaña).
 */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

export async function runHandlePickFile({
  file,
  setBusy,
  finishBoot,
  importProjectFromJson,
  pushToast,
}: BootPickFileOptions): Promise<void> {
  setBusy('import');
  try {
    if (typeof file.size === 'number' && file.size > MAX_IMPORT_FILE_BYTES) {
      pushToast('El archivo es demasiado grande (límite 25 MB).');
      return;
    }
    let raw: unknown;
    try {
      const text = await file.text();
      if (text.length > MAX_IMPORT_FILE_BYTES) {
        pushToast('El archivo es demasiado grande (límite 25 MB).');
        return;
      }
      raw = JSON.parse(text);
    } catch {
      pushToast('No se pudo leer el archivo.');
      return;
    }

    const res = await importProjectFromJson(raw);
    if (res.ok) {
      pushToast(`Proyecto «${res.name ?? file.name}» importado.`);
      finishBoot();
    } else {
      pushToast('El archivo no es un proyecto HydraDAW válido.');
    }
  } catch (err) {
    console.error('[boot] Error al importar proyecto desde archivo:', err);
    pushToast('Aviso: Fallo o restricción en el motor de audio. Se inicia en modo silencioso.');
    finishBoot();
  } finally {
    setBusy(null);
  }
}

export default function App() {
  useGlobalShortcuts();

  const activeView = useDawStore((s) => s.activeView);
  const loadDemoProject = useDawStore((s) => s.loadDemoProject);
  const createBlankProject = useDawStore((s) => s.createBlankProject);
  const pushToast = useDawStore((s) => s.pushToast);
  // Fix(waveB-shell): flags para montaje diferido (el lazy solo fetchea al abrir).
  const exportModalOpen = useDawStore((s) => s.exportModalOpen);
  const pluginModalTrackId = useDawStore((s) => s.pluginModalTrackId);

  // Pantalla de inicio: no se carga nada hasta elegir. Se mira si hay
  // proyecto guardado solo para mostrar su nombre en la opción continuar.
  const [booted, setBooted] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [peeking, setPeeking] = useState(true);
  const [busy, setBusy] = useState<BootBusy>(null);
  const stopAutosaveRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    peekSavedProjectName()
      .then((name) => {
        if (!cancelled) {
          setSavedName(name);
          setPeeking(false);
        }
      })
      .catch(() => {
        if (!cancelled) setPeeking(false);
      });
    return () => {
      cancelled = true;
      stopAutosaveRef.current?.();
    };
  }, []);

  // Fix(waveA): startAutosave filtra por snapshot persistible (excluye
  // currentTime/isPlaying): el reloj de reproducción ya no rearma el debounce.
  // Guardado inmediato del punto de partida: el autosave solo dispara ante
  // cambios, así que sin esto una demo recién abierta nunca se persistiría
  // y "seguir editando" no aparecería tras recargar. `saveProjectNow`
  // nunca lanza (degrada en silencio).
  const finishBoot = () => {
    try {
      void saveProjectNow();
      stopAutosaveRef.current = startAutosave();
    } catch (err) {
      console.warn('[boot] Error al inicializar persistencia tras arranque:', err);
    } finally {
      setBooted(true);
    }
  };

  const handleContinue = async () => {
    if (busy !== null) return;
    await runHandleContinue({
      savedName,
      setBusy,
      finishBoot,
      loadSavedProject,
      loadDemoProject,
      pushToast,
    });
  };

  const handleBlank = async () => {
    if (busy !== null) return;
    await runHandleBlank({
      setBusy,
      finishBoot,
      createBlankProject,
      pushToast,
    });
  };

  const handlePickFile = async (file: File) => {
    if (busy !== null) return;
    await runHandlePickFile({
      file,
      setBusy,
      finishBoot,
      importProjectFromJson,
      pushToast,
    });
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-dark-bg text-slate-100 overflow-hidden select-none font-sans">
      {/* Top Application Header */}
      <Header />

      {/* Main Workspace Area: Timeline or Mixer Console */}
      <main className="flex-1 flex overflow-hidden relative">
        {activeView === 'timeline' ? <Timeline /> : <MixerConsole />}
      </main>

      {/* Bottom Transport Bar */}
      <TransportBar />

      {/* Dialog Modals */}
      <Suspense fallback={null}>
        {pluginModalTrackId && <PluginRackModal />}
        {exportModalOpen && <ExportModal />}
      </Suspense>
      {/* Fix(waveB-shell): toasts no bloqueantes. */}
      <Toaster />

      {/* Pantalla de inicio: bloquea hasta elegir proyecto. */}
      {!booted && (
        <StartScreen
          savedName={savedName}
          lookingUp={peeking}
          busy={busy}
          onContinue={handleContinue}
          onBlank={handleBlank}
          onPickFile={handlePickFile}
        />
      )}
    </div>
  );
}
