# HydraDAW

[![Client-Side](https://img.shields.io/badge/Architecture-100%25%20Client--Side-emerald)](#)
[![Privacy](https://img.shields.io/badge/Privacy-Zero%20Data%20Collected-blue)](#)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

DAW multitrack 100% local en el navegador (Web Audio API, sin servidor):
grabación con punch-in, edición (split/trim/snap, copiar/pegar/duplicar,
multi-selección), mezcla con plugins locales tras un sandbox real, loop y
metrónomo, medición BS.1770-4 y exportación **WAV 16/24/32-bit + AAC-LC**.
Sin servidor: todo ocurre en tu dispositivo.

## Capacidades reales

- **Importar audio** desde el header (`accept="audio/*"`) o por drag-and-drop
  al timeline; importación presupuestada (512 pistas / 20 000 clips) y saneada.
- **Plugins**: EQ, compresor, saturador, reverb, delay, limiter + plugins JS
  custom aislados en un `<iframe sandbox>` opaco con puente de capacidades
  (8 factorías; sin `ConvolverNode`-IR ni curvas de `WaveShaperNode`).
  **Sin** WAM 2.0 / WebCLAP / WASM / AudioWorklet.
- **Sin** MIDI, **sin** automatización de parámetros, **sin** MP3, **sin**
  time-stretch / remuestreo.
- Responsive hasta 320 px, controles táctiles ≥ 44 px, nombres accesibles y
  atajos de teclado (ver `PROJECT.md` para el inventario verificado).

## Estado de calidad (medido)

```bash
npm test            # 663/663 en 57 ficheros (unit + contrato + dom)
npm run test:browser  # 9/9 dev + 11/11 prod (Chromium real, cabeceras reales)
npx tsc --noEmit    # limpio (6 flags estrictos)
npm run build       # OK — JS ~100,5 KiB gzip, presupuesto < 350 kB
```

Detalle por capa y límites honestos: [`TEST_READY.md`](./TEST_READY.md) ·
infraestructura: [`TEST_INFRA.md`](./TEST_INFRA.md) · estado: [`HANDOFF.md`](./HANDOFF.md).

## Seguridad

Sin backend ni credenciales: ningún secreto en el repo. `.env*` y artefactos
locales (`dist/`, `test-artifacts/`) están ignorados en `.gitignore`. El hilo
principal nunca evalúa código de usuario (CSP sin `'unsafe-eval'`); el código
de plugins corre solo en el sandbox opaco sin acceso a red (`connect-src
'none'`). Nota: no hay token de Search Console (el placeholder se eliminó: sin
token no se envía nada).

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5175
npm test         # Vitest
npm run build    # tsc + vite build -> dist/
```

## Despliegue en Cloudflare Pages

Conecta este repositorio en Cloudflare Pages con:

| Ajuste | Valor |
| --- | --- |
| Framework preset | Vite (o None) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 (`.nvmrc`) |

`public/_headers` aplica CSP (sin `'unsafe-eval'` en el documento; CSP propia y
más estricta para `/sandbox.html` y `/sandbox.js`), COOP/COEP, HSTS,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y caché inmutable para
`/assets/*`. Tras el primer despliegue, comprobar una vez el merge de
`_headers` por ruta.

## Cabeceras y host esperado

Host: cualquier origen HTTPS estático (Cloudflare Pages por defecto).

- `Content-Security-Policy: default-src 'self'; script-src 'self'; …`
  (ver `public/_headers`; el sandbox tiene la suya propia)
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless` (dev: `require-corp`, ver `vite.config.ts`)
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: microphone=(self)`
- `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`

---

## ⚖️ Aviso legal

Graba y mezcla únicamente material del que poseas los derechos o que la ley te
permita usar, respetando la normativa de propiedad intelectual de tu
jurisdicción. Software "tal cual" (licencia MIT), sin garantías: el autor no
responde de daños directos o indirectos ni del uso que hagas de él.
