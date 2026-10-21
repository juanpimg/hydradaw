import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// SW-01: test de la POLÍTICA — lee public/sw.js como texto y afirma la
// estrategia de caché. No ejecuta el worker.
const SW_PATH = join(process.cwd(), 'public', 'sw.js');

function swSource(): string {
  return readFileSync(SW_PATH, 'utf8');
}

describe('SW-01: service worker versionado y con política por rutas', () => {
  it('la versión de caché deriva del build (__SW_VERSION__ inyectado por Vite)', () => {
    const src = swSource();
    expect(src).toContain('__SW_VERSION__');
    expect(src).toMatch(/CACHE_NAME[\s\S]{0,200}__SW_VERSION__|__SW_VERSION__[\s\S]{0,200}CACHE_NAME/);
    // Sin nombre fijo que ningún release cambie: el viejo 'hydradaw-v1' no vuelve.
    expect(src).not.toContain("hydradaw-v1");
  });

  it('las navegaciones (app shell) van network-first', () => {
    const src = swSource();
    expect(src).toContain('network-first');
    expect(src).toContain('navigate');
  });

  it('los assets con hash (/assets/*) van cache-first', () => {
    const src = swSource();
    expect(src).toContain('cache-first');
    expect(src).toContain('/assets/');
  });
});
