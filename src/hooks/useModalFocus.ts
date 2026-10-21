import React, { useEffect } from 'react';

// Selector de focos tabulables dentro de un panel modal. Sin filtro de
// visibilidad por layout (jsdom no calcula layout: offsetParent siempre es
// null); los deshabilitados se excluyen por atributo.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Atrapa el Tab dentro del panel: al tabular desde el último foco se vuelve
 * al primero (y al revés con Shift+Tab). Sin esto, el Tab escapa del diálogo
 * al fondo aunque el panel declare aria-modal="true" (UI-11).
 */
export function trapTabKey(e: React.KeyboardEvent, panel: HTMLElement | null): void {
  if (e.key !== 'Tab' || !panel) return;
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !active || !panel.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Marca como inertes (`inert` + `aria-hidden`) a los hermanos del overlay
 * mientras el modal está abierto, y los restaura al cerrar. Los hermanos que
 * contienen otro diálogo se respetan (dos modales nunca se abren a la vez en
 * la práctica, pero no se pisa el de al lado).
 */
export function useModalBackgroundInert(
  open: boolean,
  overlayRef: React.RefObject<HTMLElement>,
): void {
  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    const parent = overlay?.parentElement;
    if (!parent) return;
    const marked: Element[] = [];
    Array.from(parent.children).forEach((child) => {
      if (child === overlay) return;
      if (child.querySelector('[role="dialog"]')) return;
      child.setAttribute('inert', '');
      child.setAttribute('aria-hidden', 'true');
      marked.push(child);
    });
    return () => {
      marked.forEach((el) => {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      });
    };
  }, [open, overlayRef]);
}
