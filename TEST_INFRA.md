# HydraDAW — Especificación de infraestructura de tests (TEST_INFRA.md)

> Estado a 2026-10-21. Cifras medidas con los comandos de §3.
> Regla: ninguna cifra sin su comando.

## 1. Filosofía

1. **Por requisitos**: cada test traza a un requisito (`ORIGINAL_REQUEST.md`
   R1–R4), a un contrato de `PROJECT.md` (F1–F24) o a un hallazgo de
   `docs/auditoria/`.
2. **Caja opaca**: se verifican contratos observables (acciones del store,
   transiciones del engine, atributos DOM, estilos computados, layout real en
   navegador). Los tests no se acoplan a estructuras privadas.
3. **Oráculos deterministas**: salidas derivadas de la spec (hitboxes ≥ 44 px,
   clamp `[0, duración]`, duración mínima 0,2 s, coeficientes BS.1770-4).
4. **Sin teatro**: un test que no puede fallar es un bug del test. En la Tarea 2
   se eliminaron 16 tautologías literales (F5/F8 nominales se re-implementaron
   como tests DOM/Browser reales).
5. **Adversarial**: payloads hostiles contra el sandbox, JSON hostil contra el
   import, bordes numéricos (NaN, ±∞, subpíxeles), viewports hasta 320 px.

## 2. Las 4 capas (lo más importante de este documento)

| Capa | Dónde | Qué cubre | Qué **NO** cubre | Medida |
|---|---|---|---|---|
| **unit** | `src/tests/*.test.ts`, `src/audio/*.test.ts` (+ `src/tests/dom/setup.ts` como setup global) | Lógica pura y store: timeline, audioMath, waveform, plugins/puente, persistencia/migración, atajos, historial, portapapeles, WAV/AAC, loudness, SW, PWA | Sin DOM (entorno `node`), sin audio real, sin navegador | **408/408** (36 ficheros) — `npx vitest run --exclude 'src/tests/contract/**' --exclude 'src/tests/dom/**' --reporter=basic` |
| **contract** | `src/tests/contract/` (opaco, sin DOM; antes `src/tests/e2e/`, renombrado en T2) | Contratos observables F1–F17 nominal + bordes + combinaciones + escenarios; oráculos matemáticos | No monta componentes, no verifica CSS/DOM real ni Pointer Events, no abre navegador | **172/172** (6 ficheros: 29+40+45+40+12+6) — `npx vitest run src/tests/contract --reporter=basic` |
| **dom** | `src/tests/dom/` (jsdom 25.x + Testing Library) | Componentes montados: roles/aria, estilos computados (`touch-action`), eventos simulados, scroll, playhead, foco, teclado, sandbox-backend | Sin layout real (jsdom no maqueta: los rectángulos se miden en `browser`), sin Web Audio real | **83/83** (15 ficheros) — `npx vitest run src/tests/dom --reporter=basic` (alias `npm run test:dom`) |
| **browser** | `tests/browser/` (puppeteer-core + Chromium real) | Layout real, pointer/touch, regresión visual, cabeceras de producción, sandbox end-to-end | Nada: es la capa de mayor fidelidad; es más lenta y necesita Chromium + build | **9/9** dev + **11/11** prod — `npm run test:browser` |

Total: **663/663 en 57 ficheros** — `npm test -- --reporter=basic | tail -4`.

### La fase de producción del navegador (por qué existe)

La suite dev corre contra el dev server **sin cabeceras**: así se escapó un
fallo real — el harness del sandbox en `srcdoc` hereda la CSP del padre y moría
en producción. Por eso `npm run test:browser` tiene segunda fase
(`tests/browser/prodCheck.mjs`): construye `dist/`, lo sirve con el
`public/_headers` **real** y comprueba CSP del documento (sin `'unsafe-eval'`),
CSP propia del sandbox (`default-src 'none'; script-src 'self' 'unsafe-eval';
connect-src 'none'`), COOP/COEP/HSTS/XFO/RP, caché inmutable de `/assets/*`,
arranque del build, plugin benigno aceptado, 4 payloads maliciosos rechazados
(`globalThis.fetch`, `navigator.sendBeacon`, alias de `eval`,
`window.__prodProbe`) y **cero ejecución / cero red / cero errores**.

## 3. Comandos

```bash
npm test                                   # todo: 663/663, 57 ficheros
npx vitest run src/tests/contract          # contrato opaco: 172/172
npm run test:dom                            # dom: 83/83
npm run test:browser                        # navegador: 9/9 dev + 11/11 prod
npm run test:all                            # unit+contract+dom+browser
npx vitest run src/tests/contract/tier3_combinations.test.ts  # un tier concreto
npx tsc --noEmit                            # tipos (debe salir limpio)
npm run build                               # build (mide el bundle)
```

## 4. Metodología de 4 tiers (solo capa de contrato)

> Los 4 tiers viven en `src/tests/contract/`: contratos observables sin montar
> componentes ni abrir navegador. La cobertura real de UI corresponde a `dom` y
> `browser` (§2). La antigua etiqueta "E2E" se retiró: estos tests nunca abrieron
> un navegador y llamarlos E2E era la falsa confianza que el programa eliminó.

### Tier 1: cobertura nominal (69 tests: 29 + 40)

Caminos nominales por feature F1–F17. Tras T2, **F5 y F8 no tienen nominal aquí**
(sus tests eran literales `expect('none').toBe('none')` / `expect(44)...` y se
eliminaron): su nominal vive como tests DOM reales (estilos computados) y como
checks B6/B7 de navegador. El resto de features conserva ≥3–5 nominales.

### Tier 2: bordes (85 tests: 45 + 40)

Límites y degenerados: ficheros vacíos/corruptos, sample-rates extremos,
pointerdown/up en 1 ms, multi-touch, deltas subpíxel, seeks en ±9999 px, zoom
0, viewports de 280–320 px, BPM 260, toggles ×100.

### Tier 3: combinaciones (12 tests)

Interacciones pareadas (F1+F3, F4+F5+F6, F10+F11+F12, …): trim táctil con
captura sin scroll del padre, scroll sincronizado con regla sticky, seek al
ancho máximo con clamp, layout 320 px cohesionado, etc.

### Tier 4: escenarios (6 tests)

Journeys multi-paso: grabación táctil a 320 px, producción multi-pista con
split, fallo de audio + edición silenciosa, mezcla responsive con knobs,
composición + pre-export, sesión de estrés (resize 1920→320, seeks fuera de
rango, trims al mínimo).

## 5. Matriz de cobertura (medida)

| Tier | Foco | Objetivo mín. | Medido |
|---|---|---|---|
| Tier 1 | Nominal F1–F17 | 85 | **69** (16 tautológicos eliminados en T2; F5/F8 nominal en DOM/browser) |
| Tier 2 | Bordes F1–F17 | 85 | **85** |
| Tier 3 | Combinaciones | 10 | **12** |
| Tier 4 | Escenarios | 5 | **6** |
| **Total contrato** | | 185 | **172** |

## 6. Ficheros

```
src/tests/contract/
├── helpers/testHelpers.ts              # factorías, resets (+resetHistory), oráculos
├── tier1_m1_m2_features.test.ts        # 29 nominales F1–F9
├── tier1_m3_m4_features.test.ts        # 40 nominales F10–F17
├── tier2_m1_m2_boundaries.test.ts      # 45 bordes F1–F9
├── tier2_m3_m4_boundaries.test.ts      # 40 bordes F10–F17
├── tier3_combinations.test.ts          # 12 combinaciones
└── tier4_scenarios.test.ts             # 6 escenarios
src/tests/dom/                          # 15 ficheros, 83 tests (setup.ts + audioContextStub.ts)
tests/browser/                          # smoke.mjs (9) + prodCheck.mjs (11) + harness/serveDist
```

Nota toolchain: jsdom fijado a la serie 25.x (`engines >=18`) porque jsdom 30
exige Node ≥22 y el proyecto fija Node 20 (`.nvmrc`, Cloudflare Pages).
