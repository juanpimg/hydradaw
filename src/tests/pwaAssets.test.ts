import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// CFG-01 / HDR-01 / SEO-01 / CFG-02: la app es instalable (iconos PNG
// reales), sirve cabeceras de seguridad y meta social, y el build funciona
// en sub-path (base relativa).
const ROOT = process.cwd();
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('CFG-01: PWA instalable con iconos PNG reales', () => {
  it('el manifest referencia iconos PNG con purpose correcto (sin data:)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as any;
    expect(Array.isArray(manifest.icons)).toBe(true);
    const icons = manifest.icons as Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
    expect(icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of icons) {
      expect(icon.src ?? '').not.toMatch(/^data:/);
      expect(icon.type).toBe('image/png');
    }
    const bySrc = new Map(icons.map((i) => [i.src, i]));
    expect(bySrc.get('/icons/icon-192.png')?.sizes).toBe('192x192');
    expect(bySrc.get('/icons/icon-512.png')?.sizes).toBe('512x512');
    expect(bySrc.get('/icons/icon-512-maskable.png')?.purpose).toContain('maskable');
  });

  it('los PNG existen y tienen firma PNG válida', () => {
    for (const rel of [
      'public/icons/icon-192.png',
      'public/icons/icon-512.png',
      'public/icons/icon-512-maskable.png',
    ]) {
      const full = join(ROOT, rel);
      expect(existsSync(full)).toBe(true);
      const head = readFileSync(full).subarray(0, 8);
      expect(Buffer.from(head).equals(PNG_SIGNATURE)).toBe(true);
    }
  });

  it('index.html incluye apple-touch-icon y og:image', () => {
    const html = read('index.html');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('icons/icon-192.png');
    expect(html).toContain('og:image');
  });

  it('SEO-01: no hay placeholder de verificación de Search Console', () => {
    // Sin token real no se envía nada (ronda fix 1): el fichero placeholder
    // con el nombre repetido no debe existir.
    expect(existsSync(join(ROOT, 'public', 'google3fce0f2d783a10a6.html'))).toBe(false);
  });
});

describe('HDR-01: cabeceras de seguridad en _headers', () => {
  it('CSP, HSTS, frame-ancestors none y Referrer-Policy', () => {
    const headers = read('public/_headers');
    expect(headers).toMatch(/Content-Security-Policy:/);
    expect(headers).toMatch(/Strict-Transport-Security:/);
    expect(headers).toMatch(/frame-ancestors\s+'none'/);
    expect(headers).toMatch(/Referrer-Policy:/);
  });
});

describe('CFG-02: el build funciona en sub-path', () => {
  it('vite.config.ts fija base relativa y build.target explícito', () => {
    const config = read('vite.config.ts');
    expect(config).toMatch(/base:\s*['"]\.\/['"]/);
    expect(config).toMatch(/target:\s*['"]es20\d{2}['"]/);
  });
});
