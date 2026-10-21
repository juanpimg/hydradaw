import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
