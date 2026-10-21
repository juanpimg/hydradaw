// HydraDAW service worker — SW-01.
//
// Política por rutas:
// - Navegaciones (`/` e `/index.html`, el app shell): network-first con
//   respaldo a caché ⇒ el visitante siempre recibe el shell actual; sin red,
//   se sirve el cacheado.
// - Assets con hash (`/assets/*`, inmutables por diseño): cache-first.
// - Resto de GET mismos-origen: network-first con respaldo a caché.
//
// La versión la inyecta Vite en el build (ver `vite.config.ts`,
// `hydradaw-sw-version`): cada release invalida la caché anterior y el
// `activate` borra las cachés viejas.

// `__SW_VERSION__` es un token literal sustituido en `dist/sw.js` durante el
// build. En desarrollo queda tal cual (caché `hydradaw-__SW_VERSION__`).
const SW_VERSION = '__SW_VERSION__';
const CACHE_NAME = `hydradaw-${SW_VERSION}`;

// Precache del shell: lo mínimo para arrancar offline en primera visita.
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// network-first: la red manda; la caché es el respaldo offline.
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

// cache-first: el disco manda (assets inmutables con hash).
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const networkResponse = await fetch(request);
  if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
    cache.put(request, networkResponse.clone()).catch(() => {});
  }
  return networkResponse;
}

self.addEventListener('fetch', (event) => {
  // Solo GET mismos-origen http(s).
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;

  // Navegaciones (app shell) ⇒ network-first.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  // Assets con hash ⇒ cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  // Resto ⇒ network-first con respaldo a caché.
  event.respondWith(networkFirst(event.request));
});
