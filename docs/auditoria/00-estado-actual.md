# HydraDAW — Estado actual verificado (línea base de auditoría)

> Fecha: 2026-10-21 · Rama: `feature/audit-hardening-2026-10` · Base: `aca438b`
> Todos los datos de esta página fueron verificados ejecutando comandos, no leyendo documentación.

## 1. Veredicto de la línea base

| Comprobación | Comando | Resultado |
|---|---|---|
| Tests | `npm test` | **454/454 pasan**, 28 ficheros, ~2.4 s |
| Tipos | `npx tsc --noEmit` | **Limpio** (`strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `noUnusedLocals` + `noUnusedParameters`) |
| Build | `npm run build` | OK (`tsc && vite build`) |
| Tamaño del código | `find src -name '*.ts*' \| xargs wc -l` | **17 477 líneas** |

**Conclusión**: el proyecto está en estado *verde* en su propia red de tests. La auditoría
no busca fallos de compilación, busca **defectos que la suite no cubre**. Ese es el criterio.

## 2. Arquitectura verificada

```
src/
├── audio/          Motor + DSP      (AudioEngine 1150 L, persistence-cols 1304 L, plugins 442 L)
├── components/     Presentación    (Timeline, Mixer, Transport, Plugins, Export, Start, Toast)
├── store/          Estado+Zustand  (useDawStore 803 L, persistence 1304 L)
├── hooks/          Atajos globales  (useGlobalShortcuts 117 L)
├── types/          Contratos       (daw.ts 79 L)
└── tests/          454 tests en 28 ficheros (incluye src/tests/e2e/ con 5 tiers)
```

Stack: React 18.3 + TypeScript 5.7 + Zustand 4.5 + Tailwind 3.4 + Vite 5.4 + Vitest 2.1
+ `idb-keyval` 6.2 + `lucide-react` 0.475. Sin backend, sin credenciales, despliegue en Cloudflare Pages.

## 3. Lo que SÍ funciona (verificado)

- **Motor de audio**: contexto con fallback de sample rate, telemetría de tiempo, loop con
  lookahead, metrónomo a tempo, limitador brickwall en el bus maestro, ceiling a −0.1 dBFS.
- **Persistencia**: autosave en IndexedDB (`idb-keyval`), claves versionadas `v1`, audio de usuario
  en WAV float32 bit-exacto con clave `hydradaw:audio:<clipId>`, migración y sanitización, tope 300 MiB.
- **Exportación**: WAV 16/24/32-bit, AAC-LC vía WebCodecs con ADTS manual, loudness BS.1770 con
  gating (integrada y true-peak estimado), normalización a −14 LUFS.
- **Edición**: split/trim/snap magnético reales, deshacer/rehacer con pila de 30, plugins con DSP
  nativo real (EQ, compresor, saturador, reverb, delay, limiter), persistencia de parámetros.
- **Robustez de arranque**: `runHandleContinue/Blank/PickFile` con `try/catch/finally`, `busy` siempre
  liberado, toasts no bloqueantes sustituyendo `alert/confirm`.
- **Rendimiento**: chunks vendor separados, modales lazy, telemetría a 15 fps, playhead manipulado
  por DOM directo (no por estado React).

## 4. Huecos funcionales confirmados (leídos en código)

Estos son **ausencias de funcionalidad**, no bugs. Un DAW sin ellos no es un DAW:

| # | Hueco | Evidencia |
|---|---|---|
| G1 | **Sin importar audio por botón** — solo hay *drag & drop* en el timeline | `Timeline.tsx:82` `handleDrop`; no existe `<input type=file accept="audio/*">` en `Header.tsx` → móvil/tablet no puede importar |
| G2 | **Sin copiar/pegar/duplicar clips** | `grep -i "copy\|paste\|duplicate\|clipboard"` → 0 resultados en código de producción |
| G3 | **Sin automatización de parámetros** (lanes) | `grep -i "automation"` → 0 resultados en código de producción |
| G4 | **Sin MIDI** | `grep -i "midi"` → 0 resultados |
| G5 | **Sin selección múltiple de clips** | el store solo tiene `selectedClipId: string \| null` |
| G6 | **Sin CI** | no existe `.github/` |
| G7 | **Sin remuestreo/elasticidad de tempo** | `HANDOFF.md` lo lista como limitación (roto 6) |
| G8 | **Sin export a MP3** | solo WAV + AAC |

## 5. Hallazgos preliminares de lectura directa (a confirmar por los auditores)

- `useDawStore.ts:27-28` — las pilas `undoStack`/`redoStack` viven **fuera** del store Zustand, a
  nivel de módulo. No se reinician entre pruebas ⇒ **fuga de estado de deshacer entre tests** y
  cualquier carga del módulo los reinicia silenciosamente.
- `useDawStore.ts:362, 379, 420, 436` — llamadas a `audioEngine.syncTracks()` / `audioEngine.play()`
  **dentro del updater de `set()`**. En React 18 StrictMode el updater puede invocarse dos veces ⇒
 effects/audio doble.
- `useDawStore.ts:485-567` — `addPluginToTrack`, `removePluginFromTrack`, `togglePlugin` y
  `updatePluginParam` **no llaman a `recordHistory`** ⇒ esas acciones no se pueden deshacer.
- `src/tests/e2e/helpers/testHelpers.ts:154-180` — `resetDawStore()` no limpia `undoStack`/`redoStack`
  ⇒ los tests de e2e comparten historial de deshacer.
- `PluginHost.ts:114` — `new Function(code)` para plugins de usuario ⇒ ejecución arbitraria en el
  origen de la página, sin sandbox.

## 6. Documentación obsoleta (verificar contra código)

| Documento | Afirmación | Realidad |
|---|---|---|
| `PROJECT.md:51-56` | Todos los milestones M1-M5 y el track E2E están **PLANNED** | El código ya implementa F1-F19; la tabla de milestones nunca se cerró |
| `HANDOFF.md:7` | 228/228 tests en 17 ficheros | **454/454 en 28 ficheros** |
| `HANDOFF.md:14` | 122/122 tests en 8 ficheros | Duplicado y obsoleto (bloque "Estado actual" repetido dos veces, líneas 5-10 y 12-17) |
| `HANDOFF.md:29-42` | Lista de limitaciones con **numeración duplicada** (1-6 dos veces) | Doc desactualizado y mal formado |
| `HANDOFF.md` | "Cloudflare Pages: NO desplegado todavía" | Requiere verificación con el usuario |
| `README.md` | "plugins locales (JS/WAM)" | El soporte WAM no está implementado; solo JS custom vía `new Function` |
