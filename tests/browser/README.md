# Capa de navegador real (tests/browser)

Humo con **Chrome real** vía `puppeteer-core` (ya es devDependency; no descarga
navegador, usa el del sistema). Cubre lo que jsdom no puede: CSS computados,
layout real, canvas, audio y foco.

## Requisitos

- Chrome instalado. Orden de resolución (`harness.mjs` → `resolveChromeExecutable`):
  `PUPPETEER_EXECUTABLE_PATH` → `/usr/bin/google-chrome-stable` → `/usr/bin/chromium`
  → `/usr/bin/chromium-browser` → `/usr/bin/google-chrome`.
- Si no hay ninguno, el script **falla en voz alta** (nunca salta en silencio).
- Dev server en marcha (puerto configurable).

## Uso

```bash
npm run dev -- --port 5199 &
npm run test:browser                  # dev (smoke.mjs, 9 checks) + prod (prodCheck.mjs, 12 checks)
node tests/browser/smoke.mjs http://localhost:5199   # solo fase dev, o por argumento
BASE_URL=http://localhost:5199 npm run test:browser  # o por env var
```

## Checks (smoke.mjs — fase dev, 9/9)

| # | Check | Aserción |
|---|---|---|
| B1 | Arranque | aparece el diálogo de inicio; 0 `pageerror` |
| B2 | Carga de la demo | "Empezar con la demo" ⇒ 4 pistas y 4 clips visibles |
| B3 | Play/stop | Play ⇒ el botón pasa a Pausar; Stop ⇒ vuelve a 0 |
| B4 | Split | seleccionar un clip y pulsar `S` ⇒ clips de 4 a 5 |
| B4b | Split en pausa | pausar, pulsar `S` ⇒ el corte cae en la posición aparcada (bug T20) |
| B5 | Modal de export | el diálogo aparece con `aria-modal="true"`, fondo inerte y foco dentro |
| B6 | Layout 320 px | viewport 320×640 ⇒ `document.documentElement.scrollWidth <= 320`; todo control táctil ≥ 44 px |
| B7 | `touch-action` | `getComputedStyle(clip).touchAction === 'none'` (real desde WP7; la marca `expectedFailure` se retiró) |
| B8 | Errores de consola | 0 `pageerror` y 0 `console.error` en todo el recorrido |

El script sale con código 1 si falla cualquier check o si hay cualquier
`pageerror` / `console.error`.

## Checks (prodCheck.mjs — fase producción, 12/12)

Construye `dist/`, lo sirve con el `public/_headers` **real** (`serveDist.mjs`)
y comprueba: CSP del documento sin `'unsafe-eval'` + COOP/COEP/HSTS/XFO/RP (P1),
CSP propia del sandbox (`default-src 'none'; script-src 'self' 'unsafe-eval';
connect-src 'none'`) (P2), caché inmutable de `/assets/*` (P3), arranque del
build (P4), plugin benigno aceptado (P5), 4 payloads maliciosos rechazados
(P6), cero ejecución/red (P7), plantilla real del editor aceptada (P9: recarga
para partir del textarea pristine y compila su valor por defecto tal cual) y
cero errores (P8). Sin esta fase, ningún fallo que solo exista bajo cabeceras
de producción (como el harness `srcdoc` bloqueado por la CSP heredada) puede
cazarse.

## Ficheros

- `harness.mjs` — `withPage(fn, opts)` → `fn(page, shot, errors)`; `shot(name)`
  guarda en `test-artifacts/browser/<nombre>.png`; `collectErrors(page)` devuelve
  `{ pageErrors, consoleErrors }`; `withViewport(page, w, h)`.
- `smoke.mjs` — los 9 checks dev + resumen + código de salida.
- `prodCheck.mjs` — los 12 checks de producción (construye `dist/` primero).
- `serveDist.mjs` — sirve `dist/` aplicando el `_headers` real (respeta la sangría).
- Artefactos: `test-artifacts/browser/*.png` (`test-artifacts/` está en `.gitignore`).
