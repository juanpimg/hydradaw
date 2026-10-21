# HydraDAW — Handoff para la próxima sesión

Última actualización: 2026-10-21 (cierre del hardening, rama
`feature/audit-hardening-2026-10`). Este documento tiene un **único** bloque de
estado; los bloques duplicados y contradictorios anteriores se eliminaron en el
barrido de documentación. Toda cifra lleva su comando.

## Estado actual (medido, no declarado)

| Comprobación | Comando | Resultado |
|---|---|---|
| Tests | `npm test -- --reporter=basic \| tail -4` | **663/663 en 57 ficheros** |
| — capa unit | `npx vitest run --exclude 'src/tests/contract/**' --exclude 'src/tests/dom/**' --reporter=basic` | 408/408 (36 ficheros) |
| — capa contrato | `npx vitest run src/tests/contract --reporter=basic` | 172/172 (6 ficheros, tiers 29+40+45+40+12+6) |
| — capa dom | `npx vitest run src/tests/dom --reporter=basic` | 83/83 (15 ficheros, jsdom 25.x) |
| Navegador dev | `npm run test:browser` (fase `smoke.mjs`) | **9/9** (arranque, demo, play/stop, split con S, split en pausa, export, 320 px, touch-action, cero errores) |
| Navegador prod | `npm run test:browser` (fase `prodCheck.mjs`) | **11/11** (build de `dist/` servido con el `_headers` real: CSP sin `unsafe-eval`, CSP del sandbox, caché inmutable, arranque, benigno aceptado, 4 maliciosos rechazados, cero ejecución/red, cero errores) |
| Tipos | `npx tsc --noEmit` | Limpio (`strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `noUnusedLocals` + `noUnusedParameters` + `exactOptionalPropertyTypes`) |
| Build | `npm run build` | OK. JS **102 871 bytes gzip** (`cat dist/assets/*.js \| gzip -c \| wc -c`), presupuesto < 350 kB: vendor ~45,3 kB, app ~48,5 kB, CSS ~6,5 kB + 2 modales lazy |

- **Repo:** rama `feature/audit-hardening-2026-10` sobre `aca438b`. CI en
  `.github/workflows/ci.yml` (unit + `tsc` + build + navegador con Chrome).
- **Lo que cambió en el programa:** la suite "E2E" de objetos falsos ahora es la
  capa `contract` (opaca, sin DOM, honestamente renombrada); hay capa `dom` real
  y capa `browser` real con fase de producción; el sandbox de plugins es un
  iframe opaco con puente de capacidades y la CSP principal no tiene
  `'unsafe-eval'`; el SW es network-first con versión por SHA; hay iconos PWA,
  importar-audio por botón, portapapeles y multi-selección.
- **Cloudflare Pages: NO desplegado todavía.** Conectar repo (build
  `npm run build`, output `dist`, Node 20). Tras el primer despliegue,
  comprobar una vez el merge de `_headers` por ruta (`/sandbox.html`).

## Limitaciones reales y actuales (roadmap)

1. **Sin MIDI** (`grep -ri midi src/` ⇒ 0 resultados en producto).
2. **Sin automatización de parámetros.**
3. **Sin export a MP3** (WAV 16/24/32-bit + AAC-LC vía WebCodecs).
4. **Sin time-stretch / conversión de sample-rate** (un clip no se estira al
   cambiar el BPM; al cambiar de dispositivo no hay remuestreo).
5. **Sin WAM 2.0 / WebCLAP / WASM / AudioWorklet** (DSP con nodos nativos; los
   plugins custom usan el proxy allowlisted: sin IR de convolver ni curvas de
   shaper).
6. **Sin migración a React 19 / Vite 7 / Vitest 3** (decisión deliberada).
7. Residuales aceptados: el JS custom de un plugin no sobrevive a la recarga; los
   fades por clip no sobreviven al guardado; importar durante la reproducción
   suena tras parar/reanudar; AAC de 7 canales escribe `channel_config` 7
   (documentado en código, extremadamente raro).

## Decisiones deliberadas que hay que respetar

- Stop rebobina a 0; pausa conserva la posición (convención DAW).
- Los ajustes de transporte (BPM, loop, metrónomo, volumen master) no entran en
  la pila de undo, pero se restauran al deshacer una acción registrable.
- Strips del mixer anchos (44 px táctiles) a costa de densidad en escritorio.
- `base: './'` + rutas derivadas de `import.meta.env.BASE_URL` (sub-path seguro).

## Comandos útiles

```bash
npm run dev      # :5175 (dev usa COEP require-corp; prod credentialless)
npm test         # 663/663 — puerta de calidad
npm run test:browser  # 9/9 dev + 11/11 prod (necesita Chromium + build)
npm run build    # tsc + vite build -> dist/
```
