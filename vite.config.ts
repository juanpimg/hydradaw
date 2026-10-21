import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// SW-01: versión de caché derivada del build. El SHA corto del commit hace
// que cada release invalide la caché del service worker anterior; fuera de
// un repo git (o sin git) se usa un marcador temporal de desarrollo.
function resolveSwVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (/^[0-9a-f]+$/.test(sha) && sha.length > 0) return sha;
  } catch {
    // Sin git: sigue un identificador de desarrollo.
  }
  return `dev-${Date.now().toString(36)}`;
}

const swVersion = resolveSwVersion();

// Los ficheros de `public/` se copian tal cual (Vite no les aplica
// `define`), así que el token `__SW_VERSION__` de `public/sw.js` se
// sustituye aquí al cerrar el bundle.
function swVersionPlugin(version: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'hydradaw-sw-version',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const swPath = path.resolve(outDir, 'sw.js');
      let src: string | null = null;
      try {
        src = await readFile(swPath, 'utf8');
      } catch {
        return;
      }
      if (src === null || !src.includes('__SW_VERSION__')) return;
      await writeFile(swPath, src.split('__SW_VERSION__').join(version));
    },
  };
}

export default defineConfig({
  // CFG-02: rutas relativas para que el build funcione también en sub-path.
  base: './',
  plugins: [react(), swVersionPlugin(swVersion)],
  define: {
    __SW_VERSION__: JSON.stringify(swVersion),
  },
  server: {
    port: 5175,
    host: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    setupFiles: ['./src/tests/dom/setup.ts'],
    environment: 'node',
  },
  build: {
    // CFG-02: target explícito (alineado con tsconfig target ES2020).
    target: 'es2020',
    rollupOptions: {
      output: {
        // Fix(waveB-shell): vendor React aparte para caché larga del framework.
        // Presupuesto: JS total <350KB gzip (medido 2026-10-08: total ~83.6KB
        // gzip / ~268KB raw en 5 chunks; inicial vendor+app ~79.2KB gzip;
        // antes: 1 chunk ~263KB raw / ~78.7KB gzip; modales diferidos ~6.1KB gzip).
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
});
