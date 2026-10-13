# HydraDAW

[![Client-Side](https://img.shields.io/badge/Architecture-100%25%20Client--Side-emerald)](#)
[![Privacy](https://img.shields.io/badge/Privacy-Zero%20Data%20Collected-blue)](#)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

DAW multitrack 100% local en el navegador (Web Audio API): grabación, mezcla, mastering con limitador brickwall, plugins locales (JS/WAM) y exportación WAV 16/24-bit. Sin servidor: todo ocurre en tu dispositivo.

## Seguridad

Sin backend ni credenciales: ningún secreto en el repo. `.env*` y artefactos locales
(`dist/`, `test-artifacts/`) están ignorados en `.gitignore`.

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

`public/_headers` aplica COOP/COEP (`credentialless`) y caché inmutable para `/assets/*`.

## Cabeceras y host esperado
Host: cualquier origen HTTPS estático (Cloudflare Pages por defecto). Equivalentes requeridos:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless` (dev: `require-corp`, ver `vite.config.ts`)
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: microphone=(self)`
- `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`

Web Audio no exige aislamiento; COOP/COEP se mantienen por higiene futura
(posible SharedArrayBuffer/WASM con hilos). Snippet Nginx equivalente:

```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "credentialless" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Permissions-Policy "microphone=(self)" always;
location /assets/ {
  add_header Cache-Control "public, max-age=31536000, immutable" always;
}
```

## Estado y siguientes pasos
Consulta [`HANDOFF.md`](./HANDOFF.md) para el estado actual, arquitectura, limitaciones conocidas y tareas pendientes.

---

## ⚖️ Aviso legal

Graba y mezcla únicamente material del que poseas los derechos o que la ley te permita usar, respetando la normativa de propiedad intelectual de tu jurisdicción. Software "tal cual" (licencia MIT), sin garantías: el autor no responde de daños directos o indirectos ni del uso que hagas de él.
