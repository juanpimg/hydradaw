# HydraDAW — Declaración de readiness de tests (TEST_READY.md)

**Estado**: VERDE MEDIDO — unit 408/408 · contrato 172/172 · dom 83/83 ·
navegador 9/9 dev + 11/11 prod · `tsc` limpio · build OK
**Fecha**: 2026-10-21 · Rama: `feature/audit-hardening-2026-10`

> La antigua etiqueta "READY — 100% Passing" era teatro: 16 tests afirmaban
> literales del propio test y no podían fallar, y la "suite E2E" nunca abrió un
> navegador. Se eliminaron en la Tarea 2 y la capa se renombró a `contract`.
> Esta declaración no dice "listo para lanzar": dice **qué mide cada capa, con
> qué comando se reproduce, y qué no cubre ninguna**.

## 1. Cómo reproducir cada cifra

```bash
npm test -- --reporter=basic | tail -4        # 663/663, 57 ficheros
npx vitest run src/tests/contract --reporter=basic   # 172/172 (29+40+45+40+12+6)
npx vitest run src/tests/dom --reporter=basic        # 83/83, 15 ficheros
npm run test:browser                          # 9/9 dev + 11/11 prod
npx tsc --noEmit                               # limpio (6 flags estrictos)
npm run build                                  # OK; JS 102 871 bytes gzip
cat dist/assets/*.js | gzip -c | wc -c         # 102871 (< 350 000 presupuesto)
```

## 2. Resumen por capa

| Capa | Resultado medido | Qué cubre | Qué **NO** cubre |
|---|---|---|---|
| **unit** | 408/408 (36 ficheros) | timeline/audioMath/waveform, store, historial, persistencia/migración, atajos, portapapeles, WAV/AAC, loudness BS.1770-4, puente del sandbox, SW, PWA | Sin DOM, sin audio real, sin navegador |
| **contract** | 172/172 (tiers 29+40+45+40+12+6) | Contratos F1–F17 nominal + bordes + combinaciones + escenarios, sin DOM | No monta componentes; no verifica CSS, Pointer Events ni layout; no abre navegador |
| **dom** | 83/83 (15 ficheros, jsdom 25.x) | Componentes montados: nombres accesibles, `touch-action` computado, trim/knob/ruler/playhead, scroll, foco, teclado, responsive, backend del sandbox | Sin layout real (los px se miden en `browser`), sin Web Audio real |
| **browser dev** | 9/9 (`smoke.mjs`) | Chromium real: arranque, demo, play/stop, split con S (también en pausa — el bug que motivó la T20), export, 320 px, `touch-action: none`, cero errores de consola | Sin cabeceras de producción |
| **browser prod** | 11/11 (`prodCheck.mjs`) | `dist/` + `_headers` real: CSP sin `unsafe-eval`, CSP del sandbox, caché inmutable, arranque, benigno aceptado, 4 maliciosos rechazados, cero ejecución/red/errores | No sustituye probar el merge de `_headers` en Cloudflare tras el despliegue |

## 3. Cobertura F1–F17 (contrato + dónde vive el nominal real)

F1–F4, F6–F7, F9–F17: nominal + bordes en contrato. **F5 y F8**: sin nominal en
contrato (tautologías eliminadas); nominal real en DOM (estilos computados,
hitboxes) + B6/B7 de navegador. Tier 3 (12) y Tier 4 (6) intactos.

## 4. Lo que esta suite no afirma (límites honestos)

- No mide gaplessness en hardware real (el loop pre-programado es gapless bajo
  reloj simulado; en hardware es "gapless módulo latencia", sin medir).
- No prueba AAC con encoder real donde no hay WebCodecs (degradación elegante).
- No cubre MIDI, automatización, MP3 ni time-stretch: no existen (ver roadmap en
  `PROJECT.md`).
- No cubre el merge de `_headers` en Cloudflare Pages: comprobar una vez tras
  desplegar.
- La suite es determinista salvo contención extrema
  de CPU; el flake histórico (DSP síncrono ~4,6 s contra timeout de 5 s) se
  corrigió con presupuestos explícitos de 60 s + guarda de comportamiento
  (`suiteStability.test.ts`).

## 5. Evidencia de ejecución (2026-10-21)

```
Test Files  57 passed (57) / Tests  663 passed (663)          # npm test
Test Files  6 passed (6)   / Tests  172 passed (172)          # contract
Test Files  15 passed (15) / Tests  83 passed (83)            # dom
[browser] 9/9 checks verdes                                   # dev
[prod] 11/11 checks verdes                                     # prod
npx tsc --noEmit → limpio · npm run build → ✓ built in ~4s
vendor 45,26 kB + app 48,50 kB gzip, CSS 6,52 kB, 2 modales lazy
```
