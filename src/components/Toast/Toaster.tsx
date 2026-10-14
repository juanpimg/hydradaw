import { useEffect } from 'react';
import { useDawStore } from '../../store/useDawStore';

// Fix(waveB-shell): un toast = un timer propio de 4s (no se rearma al llegar otro).
function ToastItem({ id, message, onDone }: { id: number; message: string; onDone: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDone(id), 4000);
    return () => clearTimeout(t);
  }, [id, onDone]);

  return (
    <div className="flex items-center gap-2 max-w-xs bg-dark-surfaceLight border border-dark-border rounded-xl px-3 py-2 shadow-xl text-xs text-slate-200">
      <span className="flex-1">{message}</span>
      <button
        onClick={() => onDone(id)}
        aria-label="Descartar notificación"
        className="text-slate-400 hover:text-white px-1"
      >
        ✕
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useDawStore((s) => s.toasts);
  const dismissToast = useDawStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className="fixed top-16 right-4 z-[60] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} message={t.message} onDone={dismissToast} />
      ))}
    </div>
  );
}

export default Toaster;
