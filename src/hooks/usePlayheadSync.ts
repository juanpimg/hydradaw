import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { useDawStore } from '../store/useDawStore';

// Un SOLO bucle de playhead para toda la app (UI-07, UI-12).
//
// Antes, `Timeline` y `Ruler` tenían cada uno su propio `requestAnimationFrame`
// MÁS su propia suscripción a `onTimeUpdate`: un mismo playhead recibía hasta
// cuatro escrituras de posición por frame. Este módulo comparte UNA suscripción
// y UN rAF entre todas las superficies montadas (contador de referencias).
//
// Regla de seguimiento (el timeline NO pelea con el scroll del usuario):
// 1. Solo mientras suena (`isPlaying`): en pausa el usuario inspecciona
//    libremente y ningún frame le mueve las lanes.
// 2. El bucle de 60 fps solo corre mientras suena; en pausa la posición llega
//    por la suscripción (eventos) y al montar / cambiar el zoom.
// 3. Un scroll manual aparca el follow 3 s: si el usuario mueve las lanes por
//    su cuenta mientras suena, su gesto manda; al quedar quieto, el follow
//    retoma. Los ecos (el evento `scroll` que el navegador emite por NUESTRA
//    escritura programada) se absorben por marca temporal y nunca cuentan
//    como gesto manual.

interface PlayheadTarget {
  getElement: () => HTMLElement | null;
  getContainer: () => HTMLElement | null;
  getZoom: () => number;
}

const targets = new Set<PlayheadTarget>();
let engineUnsub: (() => void) | null = null;
let playingUnsub: (() => void) | null = null;
let rafId = 0;

// Margen en px antes del borde: con el playhead a menos de esto del borde
// visible (y sin gesto manual reciente), el contenedor lo sigue.
const FOLLOW_MARGIN = 40;
// Ventana en ms: un `scroll` llegado justo tras nuestra escritura es su eco.
const ECHO_WINDOW_MS = 500;
// Tras un scroll manual, el follow se aparca este tiempo.
const MANUAL_PAUSE_MS = 3000;

interface ContainerState {
  users: number;
  selfScrollAt: number;
  manualScrollAt: number;
  onScroll: () => void;
}

const containers = new Map<HTMLElement, ContainerState>();

function trackContainer(container: HTMLElement): void {
  const existing = containers.get(container);
  if (existing) {
    existing.users += 1;
    return;
  }
  const state: ContainerState = {
    users: 1,
    selfScrollAt: 0,
    manualScrollAt: 0,
    onScroll: () => {},
  };
  state.onScroll = () => {
    // Eco de nuestra propia escritura ⇒ no es un gesto del usuario.
    if (Date.now() - state.selfScrollAt < ECHO_WINDOW_MS) return;
    state.manualScrollAt = Date.now();
  };
  containers.set(container, state);
  container.addEventListener('scroll', state.onScroll);
}

function untrackContainer(container: HTMLElement): void {
  const state = containers.get(container);
  if (!state) return;
  state.users -= 1;
  if (state.users <= 0) {
    container.removeEventListener('scroll', state.onScroll);
    containers.delete(container);
  }
}

// Solo posiciones, sin scroll: vale en pausa y corriendo.
function writePositions(time: number): void {
  targets.forEach((t) => {
    const el = t.getElement();
    if (!el) return;
    el.style.transform = `translateX(${time * t.getZoom()}px)`;
  });
}

// Seguimiento con las tres compuertas de la regla (ver cabecera).
function maybeFollow(time: number): void {
  if (!useDawStore.getState().isPlaying) return;
  const now = Date.now();
  targets.forEach((t) => {
    const container = t.getContainer();
    if (!container || container.clientWidth <= 0) return;
    const state = containers.get(container);
    if (state && now - state.manualScrollAt < MANUAL_PAUSE_MS) return;
    const x = time * t.getZoom();
    const viewRight = container.scrollLeft + container.clientWidth;
    if (x > viewRight - FOLLOW_MARGIN) {
      if (state) state.selfScrollAt = Date.now();
      container.scrollLeft = x - container.clientWidth + FOLLOW_MARGIN;
    } else if (x < container.scrollLeft) {
      if (state) state.selfScrollAt = Date.now();
      container.scrollLeft = Math.max(0, x - FOLLOW_MARGIN);
    }
  });
}

function writePlayhead(time: number): void {
  writePositions(time);
  maybeFollow(time);
}

// El rAF solo tiene sentido mientras suena (comportamiento pre-rework).
function syncRaf(): void {
  const shouldRun = targets.size > 0 && useDawStore.getState().isPlaying;
  if (shouldRun && !rafId) {
    const tick = () => {
      writePlayhead(audioEngine.getCurrentTime());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  } else if (!shouldRun && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function ensureShared(): void {
  if (!engineUnsub) {
    engineUnsub = audioEngine.onTimeUpdate(writePlayhead);
    // Una sola suscripción al transporte para todo el módulo: las
    // transiciones pausa↔play arrancan/detienen el rAF vengan de donde vengan.
    playingUnsub = useDawStore.subscribe(() => {
      syncRaf();
    });
  }
  syncRaf();
}

function releaseShared(): void {
  if (targets.size === 0) {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (engineUnsub) {
      engineUnsub();
      engineUnsub = null;
    }
    if (playingUnsub) {
      playingUnsub();
      playingUnsub = null;
    }
  } else {
    syncRaf();
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
    const container = containerRefRef.current?.current ?? null;
    if (container) trackContainer(container);
    ensureShared();
    // Posición inmediata al montar (también en pausa, sin esperar un frame).
    writePlayhead(audioEngine.getCurrentTime());
    return () => {
      targets.delete(target);
      if (container) untrackContainer(container);
      releaseShared();
    };
  }, []);

  // Reposiciona de inmediato al cambiar el zoom, también en pausa
  // (antes lo hacía el efecto local con deps [zoom, isPlaying]).
  useEffect(() => {
    const el = playheadRef.current;
    if (el) el.style.transform = `translateX(${audioEngine.getCurrentTime() * zoom}px)`;
  }, [zoom]);

  return playheadRef;
}
