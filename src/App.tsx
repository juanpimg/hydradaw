import { useEffect, useRef } from 'react';
import { useDawStore } from './store/useDawStore';
import { loadSavedProject, startAutosave } from './store/persistence';
import { Header } from './components/Header/Header';
import { Timeline } from './components/Timeline/Timeline';
import { MixerConsole } from './components/Mixer/MixerConsole';
import { TransportBar } from './components/Transport/TransportBar';
import { PluginRackModal } from './components/Plugins/PluginRackModal';
import { ExportModal } from './components/Export/ExportModal';

export default function App() {
  const { activeView, loadDemoProject } = useDawStore();

  // Restaura el proyecto guardado (o demo si no hay nada) + autosave.
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
      <PluginRackModal />
      <ExportModal />
    </div>
  );
}
