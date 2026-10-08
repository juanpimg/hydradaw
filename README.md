# HydraDAW

DAW multitrack 100% local en el navegador (Web Audio API): grabación, mezcla, mastering con limitador brickwall, plugins locales (JS/WAM) y exportación WAV 16/24-bit. Sin servidor: todo ocurre en tu dispositivo.

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

## Estado y siguientes pasos
Consulta [`HANDOFF.md`](./HANDOFF.md) para el estado actual, arquitectura, limitaciones conocidas y tareas pendientes.
