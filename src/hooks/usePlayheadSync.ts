import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { audioEngine } from '../audio/AudioEngine';

// Un SOLO bucle de playhead para toda la app (UI-07, UI-12).
//
// Antes, `Timeline` y `Ruler` tenían cada uno su propio `requestAnimationFrame`
// MÁS su propia suscripción a `onTimeUpdate`: un mismo playhead recibía hasta
// cuatro escrituras de posición por frame. Este módulo comparte UNA suscripción
// y UN rAF entre todas las superficies montadas (contador de referencias), y
// además se encarga del seguimiento de scroll: cuando el playhead se acerca al
// borde del contenedor de lanes, el contenedor lo sigue.

interface PlayheadTarget {
  getElement: () => HTMLElement | null;
  getContainer: () => HTMLElement | null;
  getZoom: () => number;
}

const targets = new Set<PlayheadTarget>();
let engineUnsub: (() => void) | null = null;
let rafId = 0;

// Margen en px antes del borde: con el playhead a menos de esto del borde
// visible, el contenedor hace scroll para mantenerlo a la vista.
const FOLLOW_MARGIN = 40;

function writePlayhead(time: number): void {
  targets.forEach((t) => {
    const el = t.getElement();
    if (!el) return;
    const x = time * t.getZoom();
    el.style.transform = `translateX(${x}px)`;
    const container = t.getContainer();
    if (container && container.clientWidth > 0) {
      const viewRight = container.scrollLeft + container.clientWidth;
      if (x > viewRight - FOLLOW_MARGIN) {
        container.scrollLeft = x - container.clientWidth + FOLLOW_MARGIN;
      } else if (x < container.scrollLeft) {
        container.scrollLeft = Math.max(0, x - FOLLOW_MARGIN);
      }
    }
  });
}

function startSharedLoop(): void {
  if (engineUnsub) return;
  engineUnsub = audioEngine.onTimeUpdate(writePlayhead);
  const tick = () => {
    writePlayhead(audioEngine.getCurrentTime());
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopSharedLoop(): void {
  if (engineUnsub) {
    engineUnsub();
    engineUnsub = null;
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

export function usePlayheadSync({
  containerRef,
  zoom,
}: {
  /** Contenedor con scroll que sigue al playhead; omitirlo desactiva el seguimiento. */
  containerRef?: RefObject<HTMLElement | null>;
  /** Píxeles por segundo vigentes. */
  zoom: number;
}): RefObject<HTMLDivElement> {
  const playheadRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const containerRefRef = useRef(containerRef);
  containerRefRef.current = containerRef;

  useEffect(() => {
    const target: PlayheadTarget = {
      getElement: () => playheadRef.current,
      getContainer: () => containerRefRef.current?.current ?? null,
      getZoom: () => zoomRef.current,
    };
    targets.add(target);
    if (targets.size === 1) startSharedLoop();
    // Posición inmediata al montar (también en pausa, sin esperar un frame).
    writePlayhead(audioEngine.getCurrentTime());
    return () => {
      targets.delete(target);
      if (targets.size === 0) stopSharedLoop();
    };
  }, []);

  return playheadRef;
}
