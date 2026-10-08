import { lazy, Suspense, useEffect, useRef } from 'react';
import { useDawStore } from './store/useDawStore';
import { loadSavedProject, startAutosave } from './store/persistence';
import { Header } from './components/Header/Header';
import { Timeline } from './components/Timeline/Timeline';
import { MixerConsole } from './components/Mixer/MixerConsole';
import { TransportBar } from './components/Transport/TransportBar';
import { Toaster } from './components/Toast/Toaster';

// Fix(waveB-shell): modales pesados fuera del chunk inicial (se cargan al abrirse).
const PluginRackModal = lazy(() => import('./components/Plugins/PluginRackModal'));
const ExportModal = lazy(() => import('./components/Export/ExportModal'));

export default function App() {
  const { activeView, loadDemoProject } = useDawStore();
  // Fix(waveB-shell): flags para montaje diferido (el lazy solo fetchea al abrir).
  const exportModalOpen = useDawStore((s) => s.exportModalOpen);
  const pluginModalTrackId = useDawStore((s) => s.pluginModalTrackId);

  // Restaura el proyecto guardado (o demo si no hay nada) + autosave.
  // Fix(waveA): startAutosave filtra por snapshot persistible (excluye
  // currentTime/isPlaying): el reloj de reproducción ya no rearma el debounce.
  // Guard contra React StrictMode (efecto doble en dev).
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let stopAutosave: (() => void) | undefined;
    (async () => {
      const restored = await loadSavedProject();
      if (!restored) {
        await loadDemoProject();
      }
      stopAutosave = startAutosave();
    })();
    return () => {
      stopAutosave?.();
    };
  }, []);

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
    </div>
  );
}
