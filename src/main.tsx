import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register PWA Service Worker for offline mode in supported browser environments
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && Boolean((import.meta as unknown as { env?: { PROD?: boolean; BASE_URL?: string } }).env?.PROD)) {
  window.addEventListener('load', () => {
    // CFG-02: la URL deriva de BASE_URL para que el scope sea correcto en
    // sub-path ('./' ⇒ './sw.js' relativo al documento; '/sub/' ⇒ absoluto).
    const base =
      (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    const swUrl = base.startsWith('.') ? `${base}sw.js` : `${base.replace(/\/+$/, '')}/sw.js`;
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn('[PWA] Service Worker registration failed:', err);
    });
  });
}
