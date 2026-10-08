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

// Fix(waveB-shell): modales pesados fuera del chunk inicial (se cargan al abrirse).
const PluginRackModal = lazy(() => import('./components/Plugins/PluginRackModal'));
const ExportModal = lazy(() => import('./components/Export/ExportModal'));

type BootBusy = 'continue' | 'blank' | 'import' | null;

export default function App() {
  const { activeView, loadDemoProject, createBlankProject, pushToast } = useDawStore();
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
    void saveProjectNow();
    stopAutosaveRef.current = startAutosave();
    setBooted(true);
  };

  const handleContinue = async () => {
    setBusy('continue');
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
  };

  const handleBlank = async () => {
    setBusy('blank');
    await createBlankProject();
    finishBoot();
  };

  const handlePickFile = async (file: File) => {
    setBusy('import');
    try {
      const raw: unknown = JSON.parse(await file.text());
      const res = await importProjectFromJson(raw);
      if (res.ok) {
        pushToast(`Proyecto «${res.name ?? file.name}» importado.`);
        finishBoot();
      } else {
        pushToast('El archivo no es un proyecto HydraDAW válido.');
        setBusy(null);
      }
    } catch {
      pushToast('No se pudo leer el archivo.');
      setBusy(null);
    }
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
