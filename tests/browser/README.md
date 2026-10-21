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
npm run test:browser                  # http://localhost:5175 por defecto
node tests/browser/smoke.mjs http://localhost:5199   # o por argumento
BASE_URL=http://localhost:5199 npm run test:browser  # o por env var
```

## Checks (smoke.mjs)

| # | Check | Aserción |
|---|---|---|
| B1 | Arranque | aparece el diálogo de inicio; 0 `pageerror` |
| B2 | Carga de la demo | "Empezar con la demo" ⇒ 4 pistas y 4 clips visibles |
| B3 | Play/stop | Play ⇒ el botón pasa a Pausar; Stop ⇒ vuelve |
| B4 | Split | seleccionar un clip y pulsar `S` ⇒ clips de 4 a 5 |
| B5 | Modal de export | el diálogo aparece con `aria-modal="true"` (fondo inerte según W3C ARIA) y foco dentro |
| B6 | Layout 320 px | viewport 320×640 ⇒ `document.documentElement.scrollWidth <= 320` |
| B7 | `touch-action` | `getComputedStyle(clip).touchAction === 'none'` — **expectedFailure** (ver abajo) |
| B8 | Errores de consola | 0 `pageerror` y 0 `console.error` en todo el recorrido |

El script sale con código 1 si falla cualquier check o si hay cualquier
`pageerror` / `console.error`.

## B7: fallo esperado (quitar en WP7)

El clip no tiene `touch-action: none` ni pointer events, así que el arrastre
falla en táctil. El check está marcado `expectedFailure` a propósito:

```js
// TODO(Task 18 / Task 20, WP7): quitar la marca expectedFailure al implementar
// pointer events + touch-action:none en los clips (WaveformCanvas).
```

- Si B7 **falla** ⇒ se informa como "fallo esperado" y el script sale con 0.
- Si B7 **pasa** ⇒ se informa como "PASA INESPERADO" y el script sale con 1
  (obliga a quitar la marca al implementar el arreglo).

## Ficheros

- `harness.mjs` — `withPage(fn, opts)` → `fn(page, shot, errors)`; `shot(name)`
  guarda en `test-artifacts/browser/<nombre>.png`; `collectErrors(page)` devuelve
  `{ pageErrors, consoleErrors }`; `withViewport(page, w, h)`.
- `smoke.mjs` — los 8 checks + resumen + código de salida.
- Artefactos: `test-artifacts/browser/*.png` (`test-artifacts/` está en `.gitignore`).
