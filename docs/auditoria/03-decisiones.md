# HydraDAW — Registro de decisiones (ledger del programa de auditoría)

> Fecha: 2026-10-21 · Rama: `feature/audit-hardening-2026-10` · Base: `aca438b`
> Este documento recoge **todas las decisiones que el orquestador tomó en nombre del usuario**,
> con su motivo y su coste si se equivocan. Es la traza que permite revisar y revertir
> cualquiera de ellas.

El plan: `docs/superpowers/plans/2026-10-21-hydradaw-hardening.md` · La spec:
`docs/superpowers/specs/2026-10-21-hydradaw-hardening-design.md` · La auditoría:
`docs/auditoria/01-informe-auditoria.md`

---

# SDD ledger — plan: docs/superpowers/plans/2026-10-21-hydradaw-hardening.md

Branch: `feature/audit-hardening-2026-10` · Base commit: `aca438b` · Plan written: 2026-10-21
Spec: `docs/superpowers/specs/2026-10-21-hydradaw-hardening-design.md`
Audit: `docs/auditoria/01-informe-auditoria.md`, `docs/auditoria/02-export-dsp.md`

## Preflight: scan de conflictos del plan

| # | Tareas que comparten fichero/interfaz | Qué produce una → qué consume la otra | Hallazgo del scan | Ruling |
|---|---|---|---|---|
| 1 | T1 → T2 | T1 crea `src/tests/dom/setup.ts` + `vite.config.ts test.setupFiles`; T2 renombra `src/tests/e2e` → `src/tests/contract` | Sin conflicto. T2 no depende del DOM. | Ejecutar T1 y T2 en el mismo despacho (WP1): comparten `package.json` y el árbol de tests. |
| 2 | T3 + T4 → `package.json` | T3 añade `test:browser`; T4 no toca `package.json` (sólo el workflow) | Sin conflicto | WP2 (T3+T4) en un solo despacho, por el `package.json` compartido. |
| 3 | T12 → T13 | T12 hace puros los updaters; T13 añade `recordHistory` a esas mismas acciones | **Orden obligatorio**: T13 escribiría `recordHistory` en el interior de updaters impuros que T12 elimina | T12 antes que T13. Ambos en WP5, en ese orden. |
| 4 | T13 ↔ T32 | T13 mete `selectedClipId: string \| null` en `HistorySnapshot`; T32 **elimina** ese campo y lo sustituye por `selectedClipIds: string[]` | **Conflicto real** de forma | T32 actualiza `HistorySnapshot` a `selectedClipIds: string[]` y elimina `selectedClipId` del snapshot. Se anota en el despacho de T32. |
| 5 | T14 ↔ T16 ↔ T32 → `src/store/persistence.ts` | Las tres modifican el mismo fichero (snapMode, saneado de import, validación de selección) | Sin conflicto lógico; riesgo de conflicto de escritura si se paralelizan | Secuencial strictas dentro de WP5/WP6/WP9. |
| 6 | T20 → T32 → `WaveformCanvas.tsx` | T20 migra a Pointer Events; T32 cambia la semántica del click a modos single/toggle/range | **Riesgo**: T32 puede romper la captura de puntero | T32 debe preservar el flujo de `pointerdown`/`setPointerCapture` y sólo cambiar cómo se calcula la selección. Se anota en el despacho. |
| 7 | T22 → T24 → `Timeline.tsx` | T22 crea `lanesScrollRef`/`headersScrollRef`; T24 necesita el ref de lanes para el seguimiento del playhead | Dependencia de interfaz | T24 **reutiliza** `lanesScrollRef` de T22; no crea un ref paralelo. |
| 8 | T22 → T27 | T22 deriva el ancho de lanes del ancho medido; T27 cambia el ancho de headers a `w-36 sm:w-60` | Consistente: T27 ya no necesita tocar la fórmula de ancho | T27 no reintroduce constantes de ancho. |
| 9 | T10 → T34 → `PluginHost.ts` | T10 valida la forma del nodo; T34 aísla la evaluación del código | Sin conflicto; T34 es aditivo | T10 antes que T34 (WP4 antes que WP10). |
| 10 | T1/T3/T35/T36 → `vite.config.ts` y `package.json` | T1 añade `test`, T3 `test:browser`, T35 `define`, T36 `base`/`target` | Conflictos de escritura si se paralelizan | Todo secuencial. |
| 11 | T13 → T31 (`undo` del pegado) | T31 exige que el pegado sea deshacible | Depende de T13 | T31 en WP9, después de WP5. |
| 12 | T37 (`exactOptionalPropertyTypes`) → todo | Genera fallout en todo el código | Rompe todo lo anterior si se hace antes | **T37 es la última tarea**, tras el resto. |
| 13 | T3 B7 (`expectedFailure` de `touch-action`) | Falla hasta T20; el plan lo marca como temporal | Riesgo: un revisor puede leerlo como test roto | **Ruling**: `expectedFailure` time-boxado a T20, anotado en el ledger con su tarea de retirada. |
| 14 | T2 elimina ~15 tests tautológicos | El recuento baja de 454 | El plan dice "~439" sin cifra exacta | Se anota la cifra **medida** en el commit y en el ledger. |

### Decisiones de agrupamiento (work packages)

El plan lista 37 tareas. Se ejecutan en **10 work packages** (un implementer + un revisor por
paquete) para no gastar 74 asientos de subagente en cambios mecánicos. Los paquetes agrupan
tareas contiguas del plan que tocan los mismos ficheros ⇒ sin conflictos de escritura:

| WP | Tareas del plan | Tema |
|---|---|---|
| WP1 | T1, T2 | Arnés DOM + honestización de la suite |
| WP2 | T3, T4 | Capa de navegador real + CI |
| WP3 | T5, T6, T7, T8, **T20** | Motor: generación, punch-in, metrónomo, loop, **posición del transporte** |
| WP4 | T9, T10, T11 | Fugas de nodos, pass-through de plugins, recreación de contexto |
| WP5 | T12, T13, T14, T15 | Store puro, historial completo, autosave, atajos |
| WP6 | T16, T17, T18, T19 | Import blindado, exportación, LUFS, guarding numérico |
| WP7 | T21, T22, T23, T24, T25 | Contrato de interacción (Pointer Events, knob, scroll, seek, playhead) |
| WP8 | T26, T27, T28, T29, T30 | A11y, selectores, responsive, teclado, foco, diseño |
| WP9 | T31, T32, T33 | Importar audio, portapapeles, multi-selección |
| WP10 | T35, T36, T37, T38 | Sandbox, service worker, PWA/cabeceras, tsconfig |

**WP11 (fuera de la lista anterior): T34 — barrido de documentación.** Se ejecuta al final,
cuando las cifras reales ya son definitivas.

> **Nota de renumeración (2026-10-21, tras WP2):** la capa de navegador encontró un bug real de
> producto (el transporte pierde la posición al parar), así que se **insertó la Task 20** y las
> tareas 20-37 se renumeraron a 21-38. El plan y los briefs se regeneran con esta numeración.


## Progreso

### WP1 (Tasks 1 + 2) — ronda 1: NEEDS_CONTEXT, resuelta

- **Ruling: `jsdom@^25.0.1` en vez de `jsdom@30.1.3`.** El implementadorILDRó correctamente:
  jsdom 30 declara `engines: node ^22.22.2 || ^24.15.0 || >=26.0.0` y el proyecto fija **Node 20**
  (`.nvmrc`, y Cloudflare Pages compila con Node 20). jsdom 30 es insustituible en Node 20: exige
  `zlib.createZstdDecompress` y `worker_threads.markAsUncloneable` (inexistentes en toda la serie
  20.x) y extiende el global `Iterator` (V8 11.7+, ausente en 20.18) — falsear ese último sería
  exactamente el "teatro de stubs" que este WP existe para destruir. `jsdom@25.0.1`
  (`engines: node >=18`) fue verificado por el implementador cargando y renderizando en Node 20.18
  sin shims.
  **Coste si me equivoco**: un jsdom 25 algo más antiguo que 30 ⇒ posibles carencias de API de
  DOM que 30 sí tiene. Verificado que la API usada (`PointerEvent`, canvas 2D, `matchMedia`,
  `ResizeObserver`) está covered por 25.
- **Ruling: no se sube el toolchain a Node 22.** Node 20 es una restricción del proyecto, no una
  preferencia. Subirlo obligaría a cambiar `.nvmrc`, el workflow de CI y el runtime de Cloudflare
  Pages — un cambio de despliegue para adaptarnos a una librería de test. Coste si me equivoco:
  jsdom 25 podría quedarse corto para APIs de DOM futuras. Riesgo bajo y aceptable.
- **Ruling: se conservan los 16 tests eliminados, no 15.** El brief decía "≈15" y enumeraba tres
  formas; la enumeración da 16 (F5 ×5, F8 ×5, F4-2, F4-5, F7-4, F9-5, F1-4, F1-5). Se borran los
  16 ⇒ recuento base **438**, no 439. La cifra "≈439" del plan era aproximada.
- **Deuda menor anotada (no bloquea):** `PROJECT.md:118` y `docs/auditoria/*` siguen citando
  `tests/e2e` ⇒ resolver en **Task 33** (barrido de documentación).
- **Concern anotado para la revisión final:** el implementador vio **una** ejecución de `npm test`
  en paralelo con `npm run build` reportar "2 failed | 436 passed", no reproducida en 4
  ejecuciones posteriores. Sospecha de flake por contención de CPU en tests de audio con presupuestos
  de milisegundos. **A investigar:** identificar los 2 tests concretos y si el presupuesto de tiempo
  es el responsable. No es un hallazgo nuevo del WP1 (es preexistente) pero debe quedar fichado.
  **Actualización del implementador (ronda 2):** 30 ejecuciones posteriores verdes (incluida
  saturación de 20 núcleos y sondas sobre los ficheros sospechosos); **no hay aserciones de
  presupuesto de wall-clock en la suite**; los nombres de los 2 tests no se pudieron capturar.
  Queda como item de triaje de la revisión final.

### WP1: complete (commits ee9a8da..ec744b0, review clean) — REABIERTO por hallazgo del controlador

**Revisión (independiente): Spec ✅ · Task quality: Approved.** Sin Critical ni Important.
6 findings **Minor** diferidos al triaje final:
- `src/tests/dom/setup.ts` — `getContext` devuelve el stub 2D también para `'webgl'`/`'bitmaprenderer'`
  ⇒ un componente que pida el contexto equivocado pasaría el test.
- `src/tests/dom/setup.ts` — `__canvasOps` graba **sólo nombres de operación**, sin argumentos, y no se
  limpia entre tests ⇒ los asserts de geometría de dibujo futuros no pueden verificar valores, y hay
  riesgo de dependencia de orden.
- `src/tests/dom/setup.ts` — `ctx2dStub` es un **singleton** con `fillStyle`/`strokeStyle`/`lineWidth`
  mutables ⇒ varios canvas montados comparten estado de estilo.
- `src/tests/dom/audioContextStub.ts` — `ensureMockAudioContext()` sobrescribe `window.AudioContext`
  sin comprobar si ya existía una implementación real.
- `src/tests/dom/harness.test.tsx` — `toBeTruthy()` tras `getByLabelText` (que ya lanza si falta) ⇒
  idioma débil; procede `toBeInTheDocument()` de jest-dom.
- `src/tests/dom/setup.ts` — `..._args: number[]` descarta la aridad; moot si se adoptan los anteriores.

**Nota de calidad para WP7:** los tres primeros menores afectan directamente a la calidad de los
tests DOM de las oleadas 2-3 (afirman sobre el canvas dibujado). Se llevan como contexto al
despacho de WP7, que es donde se escriben esos tests.

### WP1: fix round 1/5 — regresión de rendimiento de la suite (hallazgo del controlador, Important)

**Confirmado por el controlador al resolver el ⚠️ "no verificable desde el diff" del revisor.**
Medición controlada (misma máquina, misma rama, sólo cambiando una cosa por vez):

| Configuración | Duración de `npx vitest run` |
|---|---|
| Baseline antes de WP1 (sin `setupFiles`) | ~2.4 s |
| WP1 tal cual (`setupFiles` + `import '@testing-library/jest-dom/vitest'` estático) | **54.63 s** |
| WP1 con `setupFiles: []` | 4.41 s |
| WP1 con el setup pero **sin** la línea `import '@testing-library/jest-dom/vitest'` | **4.17 s** |

**Causa aislada**: el import **estático** de `@testing-library/jest-dom/vitest` en
`src/tests/dom/setup.ts:1`. Como `setupFiles` es **global**, ese módulo se carga en los 29
ficheros de test, incluidos los 28 que corren en entorno `node` sin DOM. La suite se ralentiza
**13×** (2.4 s → 54.6 s) por un matcher que esos 28 ficheros no usan.

**Por qué es Important y no Minor**: la puerta de calidad es lo que este programa existe para
construir; una suite 13× más lenta hace que el gate se deje de ejecutar (es el fallo que ya
detectamos una vez en este repo: la puerta de calidad "verde" que nadie ejecuta). Además el
presupuesto de tiempo de la suite es el mecanismo que protege al resto del programa.

**Ruling: el import de jest-dom sale del setup global y pasa a cada fichero DOM.** El setup
global se queda con lo barato (los stubs con guarda `typeof document !== 'undefined'`), y cada
fichero de `src/tests/dom/` importa `@testing-library/jest-dom/vitest` en su propia cabecera.
Motivo: los matchers de jest-dom sólo tienen sentido con DOM, así que cargarlos sólo donde hay
DOM no pierde nada y elimina el 96 % del sobrecoste.
**Coste si me equivoco**: algún fichero DOM futuro olvide el import y sus matchers no estén
disponibles ⇒ falla ruidosamente con "matcher not found", no silenciosamente. Riesgo aceptable.

- **WP1: fix round 1/5 (1 addressed, 0 open — regresión de rendimiento de la suite; commits ec744b0..d8ddd4a)**
  Re-revisión acotada: **ALL FINDINGS ADDRESSED**, sin breakage nueva en el diff del fix.
  Medición del controlador con **caché de transform borrada** dos veces: `Duration 4.25s` y
  `4.46s`, `setup 1.36s`/`1.38s`, 439/439 — el coste en frío de 54.63s / setup 169.70s ha
  desaparecido. El implementadorائرó que los 54.63s no reproducían en su máquina (4.49s warm):
  consistente con queThose 54.63s eran coste de transform en frío. En cualquier caso, el coste
  en frío está eliminado.
- **Task 1: complete (commits ee9a8da..ceee1b2, review clean)**
- **Task 2: complete (commits ceee1b2..ec744b0, review clean)**
- **WP1: complete (commits ee9a8da..d8ddd4a, review clean)**

**Deuda que WP1 deja para WP7** (menores del revisor, decide WP7 porque es donde se escriben los
tests DOM que los necesitan): `getContext` debe devolver el stub 2D **sólo** para `contextId === '2d'`;
`__canvasOps` debe **grabar los argumentos** de cada operación y tener un reset entre tests;
`ctx2dStub` debe ser una **fábrica** (objeto nuevo por `getContext()`) en vez de un singleton con
estilo mutable. Se lleva como contexto en el despacho de WP7.

### WP2 (Tasks 3 + 4) — capa de navegador real + CI

**Revisión: Spec ✅ · Task quality: Approved.** Sin Critical ni Important. 7 **Minor** diferidos:
- `tests/browser/smoke.mjs:443` — el TODO cita "Task 18 / Task 20" ⇒ referencia obsoleta; la tarea
  canónica de Pointer Events es la **Task 21**. **A resolver en WP7** (que quita el
  `expectedFailure` y borra el TODO entero).
- `tests/browser/smoke.mjs:409-422` — B5 verifica `role=dialog` + `aria-modal` + foco dentro, pero
  **no** comprueba literalmente `inert`/`aria-hidden` del fondo ⇒ es un proxy, no una comprobación
  directa. La comprobación literal **fallaría hoy**; se añade cuando WP8 implemente la trampa de foco.
- `tests/browser/smoke.mjs:423-428` — si B5 falla, no se toma captura ni se cierra el modal ⇒ un
  fallo cascada en B6/B7 y se pierde el artefacto. Arreglo: `try/finally`.
- `tests/browser/smoke.mjs:338,358,367,400` — B1/B2/B3/B4 sólo capturan en el camino de éxito ⇒ un
  check fallido no deja PNG para diagnóstico.
- `tests/browser/smoke.mjs:277-280` — `failureLine` trunca al primer `\n` ⇒ B8 registra sólo
  "N error(es):" y oculta **cuál** error de consola saltó.
- `tests/browser/smoke.mjs:389` — `sleep(2000)` de tiempo fijo para colocar el cursor ⇒ flake
  potencial en CI saturado. Sustituir por polling del display de tiempo.
- `tests/browser/smoke.mjs:269,445` — `codigo`, `tactil` sin tildes (no es copy de UI).

**Hallazgo material de WP2 (validación del programa):** la capa de navegador encontró un **bug real
de producto** — `AudioEngine.stop()` calcula la posición pero **nunca la escribe** en
`playheadOffset`, y la acción `stop` del store fuerza `currentTime: 0` ⇒ **cortar un clip con `S`
en pausa es un no-op silencioso** y la posición de reproducción se pierde al parar. Verificado por
el controlador leyendo el código. Incorporado al plan como **Task 20** (nº nuevo; las tareas
20-37 se renumeraron a 21-38). **Ruling: la Task 20 entra en WP3** (es un bug de motor, no de
interacción). **Coste si me equivoco:** si la posición al parar debiera reiniciar a 0 por diseño,
la Task 20 introduce un cambio de comportamiento no pedido — pero la spec de DAW (Logic, Ableton)
mantiene la posición, y el propio store ya la preserva en `pause()`, así que `stop()` es el
outlier. Riesgo bajo.

- **Task 3: complete (commits d8ddd4a..26b9023, review clean)**
- **Task 4: complete (commits 26b9023..d032e10, review clean)**
- **WP2: complete (commits d8ddd4a..d032e10, review clean)**

### WP3 (Tasks 5, 6, 7, 8, 20) — motor de audio y transporte

**Revisión: Spec ✅ (con consecuencia de producto señalada) · Task quality: Needs fixes.**
3 **Important**:
1. `TransportBar.tsx:281` + `useDawStore.ts:280` — el botón cuadrado sigue titulándose
   *"Detener y volver al inicio (0:00)"* pero la acción `stop` ahora **conserva la posición** ⇒
   **los botones Stop y Pausa son comportamentalmente idénticos** y el "volver al inicio" que la UI
   anuncia ya no existe en ninguna parte. El revisor verificó que `AudioEngine.pause()`
   (`AudioEngine.ts:312`) existe pero **el store nunca lo llama**.
2. `tests/browser/smoke.mjs:127` — la NOTA de B4 describe el bug de Task 20 como si siguiera
   existiendo, y **B4 nunca ejercita el bug que Task 20 existe para arreglar** (cortar con `S`
   en pausa) ⇒ la suite de navegador no cubre el defecto de cabecera.
3. `src/audio/engine_fixes.test.ts:427` — **contaminación global de tests**: el test de punch-in
   asigna `globalThis.navigator` y `globalThis.MediaRecorder` **sin restaurarlos**
   (`vi.restoreAllMocks()` no deshace una asignación directa a `globalThis`) ⇒ cualquier test
   posterior del mismo worker hereda un `getUserMedia` que adelanta 5 s. **Mecanismo probable del
   "rojo transitorio" reportado por el implementador.**

**Ruling: Stop vuelve al inicio; Pausa conserva la posición. (Defecto de mi ruling previo.)**
Mi ruling original ("stop conserva la posición") era incompleto: separaba dos cosas que deben ir
juntas — que **el motor recuerde dónde paró** (el bug real) y que **el cursor vuelva al origen**
(convención de DAW). El diseño correcto y coherente:
- `AudioEngine.stop()` **persiste** `playheadOffset = currentPos` — el motor sabe dónde paró. ✅
  (esto es el bug real: sin ello, `getCurrentTime()` devolvía 0 tras parar y el corte con `S` en
  pausa era un no-op silencioso).
- La acción `pause` del store: `const time = audioEngine.stop(); set({ currentTime: time })` —
  **conserva la posición**. Sin cambios.
- La acción `stop` del store: `audioEngine.stop();` + **rebobinar el cursor a 0** +
  `set({ currentTime: 0 })`. Requiere un método público nuevo y mínimo en el motor para aparcar el
  cursor en 0 sin reiniciar la reproducción (no se puede usar `seek(0)`: `seek` reinicia si está
  reproduciendo).
**Por qué:** el título del botón, el `title` accesible y la convención de **todos** los DAW
(Logic, Ableton, Cubase: Stop vuelve al inicio; Space/Pausa conserva la posición) exigen que Stop
y Pausa sean distintos. Con mi ruling anterior, HydraDAW se quedaba **sin forma de volver al
inicio** y con dos botones idénticos.
**Coste si me equivoco:** el usuario que quiera volver al inicio tiene que usar la regla (click)
en vez del botón Stop ⇒ un clic extra. Riesgo bajo y reversible.

**Ruling: el loop debe cerrar el hueco de verdad, no sólo reducirlo.** El revisor verificó que el
watchdog de 25 ms **sólo dispara cuando ya es tarde** (`currentTime >= projectedEnd`) y arranca la
iteración siguiente en `currentTime + 0.02` ⇒ **por construcción queda un silencio de 20-45 ms en
cada vuelta**. Eso **no cumple** el Task 8 ("programa la siguiente iteración con antelación
suficiente para que no haya hueco"): reduce el jitter del reloj de pared pero no elimina el hueco.
La iteración siguiente debe programarse **en el reloj de audio, por adelantado**, en el límite
exacto del loop (igual que el motor ya programa los clips con antelación). Verificado por el
revisor: "no produce un loop sin hueco de muestras; eso requeriría lookahead".
**Coste si me equivoco:** programming por adelantado es más complejo que el watchdog; si se hace mal
puede solapar iteraciones ⇒ dos copias sonando. El test de loop debe cubrir exactamente eso.

**Menores diferidos al triaje final:** `loopTimer` tipado como `setTimeout` pero contiene un
`setInterval`; el test de punch-in no distingue "tras `getUserMedia` pero antes de `start()`" de
"tras ambos" (el código sí es correcto); los tests de posición del transporte couplingan al
lookahead de 0.02 s; duplicación de ~80 líneas de mock-context en 3 ficheros nuevos (follow-up
evidente, **no** refactorizar en este WP).

- **WP3: fix round 1/5 (4 addressed, 0 open — Stop/Pausa, B4b, contaminación global, loop por delante; commits d99b2a7..7c58866)**
  Re-revisión acotada: **ALL FINDINGS ADDRESSED**, sin breakage nueva.
  Verificado por el revisor: `rewind()` (nuevo, `AudioEngine.ts:332`) aparca el cursor en 0 **sin**
  reiniciar la reproducción (a diferencia de `seek()`); `stop()` del store = stop+rewind+`currentTime: 0`;
  `pause` = conserva; los tests cubren las tres rutas (pause ~5 s / stop 0 / corte en la posición
  pausada ~5 s). B4b lee el **display real** `MM:SS.cc`, pausa, pulsa `S` y comprueba que el
  nuevo límite cae en `paused * 50` ±8 px ⇒ cubre el defecto de cabecera. Los stubs globales pasan a
  `vi.stubGlobal` + `vi.unstubAllGlobals()` en `afterEach` (se ejecuta también si la aserción
  falla). El loop pre-programa la iteración siguiente en el límite exacto (lead 0.1 s) y **no**
  solapa: los spans antiguos terminan ≤ el límite.
  **Ruling residual aceptado:** el implementador afirma hueco 0 **bajo reloj simulado** y "gapless
  módulo latencia" **en hardware real, sin medir**. Se acepta la prudencia: no se afirma
  gaplessness en hardware sin medición. Queda como item de triaje (medir en navegador real).
- **Task 5/6/7/8/20: complete (commits c56d79d..7c58866, review clean)**
- **WP3: complete (commits c56d79d..7c58866, review clean)**

### ⚠ FLAKE PERSISTENTE — seguido a través de WP2, WP3 y WP1

Una ejecución de `npm test` reports **"2 failed"** y todas las demás pasan. Reproducido **una vez
en cada work package**, no reproducido en 20-30 reintentos posteriores. Los nombres de los 2 tests
**nunca** se han capturado. Sospechas: (a) contaminación global de stubs (arreglada en WP3, pero el
síntoma persiste), (b) tests de audio con presupuestos de tiempo real bajo contención de CPU
(`plugin_safety.test.ts` tarda ~11 s con un test de IR de reverb de 4.7 s).
**Por qué lo sigo:** un gate que falla "a veces" sin poder nombrar el culpable es exactamente la
falsa confianza que este programa viene a eliminar. **Se investiga antes del cierre de la rama.**
- **Tarea añadida al plan (Task 39)**: identificar y eliminar el flake, o demostrar que es
  environmental y documentarlo con evidencia.

### WP4 (Tasks 9, 10, 11) — fugas de nodos y aislamiento de fallos

**Revisión: Spec ❌ (misunderstood) · Task quality: Needs fixes.** 2 **Critical** + 3 **Important**:
- **C1** — el `clipGain` de un fade **nunca se desconectaba al parar**: `stopAllSources()` anula
  `onended` antes de `stop(0)` ⇒ el cleanup que vivía en `onended` **nunca se ejecutaba** en el
  camino de teardown dominante. Fuga **sin cota dentro de una sesión** (un `GainNode` por clip con
  fade por cada `play()`→`stop()`/`seek`/retake sobre la misma pista viva), y `dispose()` no la
  remediaba (corta las aristas *salientes* de `inputNode`, no la entrante `clipGain → inputNode`).
- **C2** — el `gain` del click del metrónomo tampoco se soltaba al parar: `stopMetronomeNodes()`
  anula `osc.onended` y sólo hace `osc.disconnect()` ⇒ la arista `gain → destination` sobrevivía.
- **I1** — los tests nuevos sólo disparaban `onended` a mano ⇒ **no cubrían el camino `stop()`**.
- **I2** — el `passNode` del fallback no se registraba en `activeDSPNodes` ⇒ `dispose()` no lo
  limpiaba (acumulaba uno por rebuild) y el `catch (_)` era mudo.
- **I3** — el sub-test "createDSPNode **lanza**" ya pasaba antes del cambio (el `catch` con fallback
  preexistía) ⇒ no era evidencia TDD.

**Ruling: la fuga se cierra en TODAS las vías de teardown, no sólo en el fin natural.** El patrón
del proyecto de anular `onended` antes de `stop(0)` (para evitar callbacks post-stop) choca de
frente con un cleanup que vive en `onended` ⇒ el cleanup debe vivir **junto a la fuente**, no en su
callback, e invocarse desde ambos sitios con guarda de idempotencia.
**Coste si me equivoco:** un `done` mal puesto podría dejar un nodo sin desconectar. Verificado por
el revisor: el flag `done` se fija **antes** de invocar el cleanup y ambos call sites pasan por la
misma función.

- **WP4: fix round 1/5 (5 addressed, 0 open — C1, C2, I1, I2, I3 + M1-M4; commits 03d755b..37355e2)**
  Re-revisión acotada: **ALL FINDINGS ADDRESSED**, sin breakage nueva. Verificado: las fuentes se
  guardan como `{source, cleanup?, done}` con guarda de idempotencia; los clicks como
  `{osc, gain, done}`; el `passNode` se registra en `activeDSPNodes` y lo reclama `dispose()`;
  `console.warn` con `pluginId` en ambas rutas de fallo; `outputNode` validado con `connect`;
  `gain.value = 1` explícito; el fallback final cablea `lastNode → pass → panner`.
  El informe incluye el **RED** de los tests del camino `stop()` (`2 failed | 2 passed`, con
  `expected false to be true` sobre `disconnected`) y del resto (`6 failed` con el código
  restaurado vía `git stash`).
- **Task 9/10/11: complete (commits 9de7101..37355e2, review clean)**
- **WP4: complete (commits 9de7101..37355e2, review clean)**

### WP5 (Tasks 12, 13, 14, 15) — capa de estado

**Revisión: Spec ✅ · Task quality: Approved.** Sin Critical ni Important. 5 **Minor** diferidos:
- `src/tests/history.test.ts:1334` (H4/H4b) — los tests de undo del transporte **se apoyan** en un
  snapshot previo de `addTrack`, así que pasan aunque `setBpm`/`toggleLoop`/`toggleMetronome`/
  `setMasterVolume` **no registren historial por sí mismos**. El contrato real (y el de la spec) es:
  los ajustes de transporte **no** están en la pila de undo, pero **sí se restauran** al deshacer
  una acción registrable. Los títulos de los tests sobrerrepresentan lo que fijan ⇒ añadir un test
  que documente el contrato.
- `src/tests/persistence.test.ts:1539` — no hay round-trip de `snapMode: '1/2'`, que es **justo el
  valor que motivó la corrección del brief**. Faltan pines de regresión.
- `src/store/persistence.ts:229` — `VALID_SNAP_MODES` tipado `readonly string[]` en vez de
  `readonly SnapMode[]` ⇒ un cambio futuro en la unión no daría error de tipo.
- `src/tests/globalShortcuts.test.ts:1091` — el `beforeEach` no llama a `resetHistory()` ⇒ los tests
  de S/M filtran entradas reales al `undoStack` compartido.
- `useDawStore.ts:745,772` — `updateTrack`/`updateClip` registran historial **por evento** sin
  coalescer ⇒ un arrastre de fader o de clip puede vaciar la pila de 30 pasos. **Es el trade-off
  explícito del brief** (sólo `updatePluginParam` coalesce) ⇒ se acepta y se documenta.
- `useDawStore.ts:575,615` — `redoStack` sin tope y promesas `void` sin `.catch` (preexistente,
  fuera de diff).

**Corrección de mi brief verificada por el revisor:** la lista de `SnapMode` válida del brief era
errónea (`'1/1'` no existe; faltan `'1/2'` y `'triplet'`). El implementador validó contra la unión
real de 8 valores (`src/types/daw.ts:39`) — **comportamiento correcto, brief defectuoso**. Coste si
me equivoco: ninguno; el pin de `'1/2'` es el que faltaba y queda como menor.

**Ruling aceptado: los ajustes de transporte (BPM, loop, metrónomo, volumen master) NO son
deshacibles por sí mismos**, pero se restauran al deshacer una acción registrable. Es el contrato
de la spec (§3.3 ST-02 enumeró 6 acciones; `setBpm` no estaba) y coincide con la convención de los
DAW (el transporte va en una pila aparte).
**Coste si me equivoco:** el usuario que cambia el BPM y pulsa Ctrl+Z ve que el BPM no se revierte
— comportamiento confuso pero no destructivo. Se mitiga documentando el contrato en los tests y en
la documentación (Task 34).

- **Task 12/13/14/15: complete (commits 37355e2..4300ff7, review clean)**
- **WP5: complete (commits 37355e2..4300ff7, review clean)**

### WP6 (Tasks 16, 17, 18, 19) — importación, exportación, loudness, guarding numérico

**Revisión: Spec ✅ · Task quality: Approved.** Sin Critical ni Important. 4 **Minor** diferidos:
- `src/audio/WavExporter.ts:176` — comentario obsoleto que dice que "ExportModal sigue con la
  síncrona" ⇒ ya es falso.
- `src/store/persistence.ts:1213,1241` — el truncado de pistas/clips avisa sólo por `console.warn`,
  **invisible para el usuario** que acaba de perder hasta 80 000 clips.
- `src/audio/aacExporter.ts:209,248` — un stream genuino de 7 canales escribe `channel_config` 7, que
  el parser re-lee como 8 (no hay código de 7 canales en MPEG-4 Audio). El 8→7 exigido por AAC-06
  sí funciona. Extremadamente raro; documentar o rechazar el 7 explícitamente.
- `src/audio/loudness.test.ts:414` — el test de entrada corta usa `toBeCloseTo(…, 0)` (±0.5 dB) para
  una expectativa de −6.0206 dB ⇒ basta para cazar el error de ~6 dB, pero no lo fija con precisión.

**⚠ Dos errores MÍOS en los briefs, detectados y corregidos por el implementador:**
1. **G4 (pan)**: dije que `calculateConstantPowerPan(NaN)` debía devolver `{left: 1, right: 1}`.
   **Incorrecto**: la ley es de potencia constante, así que `pan = 0` da `{√½, √½}` (energía
   total 1); `{1,1}` sería **+3 dB**. El implementador devolvió las ganancias reales de `pan = 0`.
   Verificado por el controlador leyendo `audioMath.ts`: `pan=0` → `cos(π/4), sin(π/4)`.
2. **`dbToLinear(NaN)`**: el brief no decía qué valor finito. El implementador eligió **1 (unity)**.
   **Ruling: unity es lo correcto** — un NaN suelta significa "sin atenuación", no "silencio", y
   silenciar por defecto es el peor modo de fallo.
**Coste si me equivoco en el ruling 2:** un NaN en un parámetro de plugin deja de silenciar la
pista. Ninguno.

**Verificación independiente del controlador:** `npm run test:browser` ⇒ **8/9** (B7 el fallo
esperado). El cambio del modal de exportación no rompió la suite de navegador.
**Verificación aritmética (por el revisor, contra la spec y no contra el código):** el padding
RIFF es `padBytes = dataSize % 2`, `bufferSize = 44 + dataSize + padBytes`, RIFF size
`36 + dataSize + padBytes` ⇒ 45+dataSize y 37+dataSize para dataSize impar, con `subchunk2Size`
intacto y byte de padding a cero. Correcto. El K-weighting reproduce los coeficientes exactos de la
Tabla 1 de BS.1770-4 a 48 kHz con derivación bilineal verificada término a término, y la ventana
del test se movió al valor del estándar (`[−3.1, −2.9]`), con el valor antiguo (−3.44) y el de
referencia (−3.0) reportados lado a lado.

- **Task 16/17/18/19: complete (commits 4300ff7..4d1306f, review clean)**
- **WP6: complete (commits 4300ff7..4d1306f, review clean)**

### WP7 (Tasks 21, 22, 23, 24, 25) — el contrato de interacción, implementado de verdad

**Revisión: Spec ✅ · Task quality: Needs fixes.** 3 **Important**:
1. `WaveformCanvas.tsx` — `handlePointerCancel` reseteaba el `transform` pero **no** el `width`
   escrito durante el trim ⇒ el clip quedaba visualmente a medio recortar mientras el store
   conservaba la duración original. El camino de commit tenía la misma latencia, enmascarada sólo
   por el re-render del store.
2. `usePlayheadSync.ts` — el bucle rAF compartido **corría siempre** (antes sólo `if (isPlaying)`) ⇒
   bucle de escritura a 60 fps en sesión inactiva; y el follow-scroll **no tenía puerta de
   reproducción ni de intención del usuario** ⇒ un usuario que desplazaba las lanes con el
   transporte parado era **devuelto al sitio en el siguiente frame**.
3. `timelineScroll.test.tsx` — T3 disparaba sus propios eventos `scroll` ⇒ **pasaría igual sin las
   banderas de reentrada** ⇒ no fijaba lo que decía fijar.

**Ruling: el follow-scroll no debe pelear con el usuario.** Regla adoptada (verificada por el
revisor): seguir sólo si (1) se está reproduciendo, (2) el playhead sale del área visible con 40 px
de margen, (3) no hubo scroll manual en los últimos 3 s. Los scrolls propios de la app se absorben
por marca de tiempo, así que no cuentan como manuales.
**Coste si me equivoco:** el seguimiento puede reactivarse 3 s después de que el usuario haya
desplazado a mano, y "saltar" de vuelta al playhead. Es el comportamiento estándar de los DAW y es
preferible a pelear con el scroll del usuario.

- **WP7: fix round 1/5 (3 addressed, 0 open — reset visual, follow-scroll, test de ping-pong; commits 4f8f335..45b6fc8)**
  Re-revisión acotada: **ALL FINDINGS ADDRESSED**, sin breakage nueva. Verificado: `clearDragVisual`
  resetea `transform` **y** `width` por un único camino usado por commit y cancel; `writePositions`
  (suscripción/montaje/zoom, sin scroll) separado de `maybeFollow` (con puerta de reproducción,
  margen 40 px y parking de 3 s); el rAF sólo corre reproduciendo y arranca/para con la
  transición; el test T3 reescrito **espía los setters de `scrollTop`** y simula el eco asíncrono
  del navegador, y el implementador verificó su sensibilidad (falla `expected 60 to be 100` sin
  las banderas). Los menores (filtro de `pointerId` multitáctil, limpieza al desmontar, listener de
  rueda registrado una vez, `zoom` vivo desde el store) también quedaron.
  **Tests declarados honestamente débiles (aceptados):** W9 (el modo de referencia obsoleta no es
  observable en jsdom ⇒ no cuenta como cobertura; requiere un check de navegador real) y el
  endurecimiento del `zoom` vivo (no hay RED determinista posible). El revisor está de acuerdo.
- **Task 21/22/23/24/25: complete (commits 4d1306f..45b6fc8, review clean)**
- **WP7: complete (commits 4d1306f..45b6fc8, review clean)**

**Nota de WP7:** la suite de navegador pasó de **8/9 con un fallo esperado** a **9/9 sin fallos
esperados**: el contrato F5 (`touch-action: none`) ya es real y verificado por estilo computado.

### WP8 (Tasks 26, 27, 28, 29, 30) — accesibilidad, responsive y diseño

**Revisión: Spec ❌ (Missing ×1, Misunderstood ×1) · Task quality: Needs fixes.** 2 **Important**:
1. `Timeline.tsx` — el botón "Añadir Pista" (sólo icono) **sin `aria-label`**, en un fichero que la
   tarea sí tocó ⇒ un lector de pantalla anuncia un botón sin nombre.
2. `src/tests/dom/renderCount.test.tsx` — el test R2 **pasa antes y después** por diseño y renderiza
   un `Probe` sintético creado por el propio test ⇒ incumple la regla de "los tests comprueban
   comportamiento del producto" y deja a la Task 27 **sin test de comportamiento** que discrimine.
   R1/R3 son *grep* de fuente (blanco): rompen con cualquier refactor equivalente.

**Menores relevantes:** `animate-spin` sin `motion-safe:` en el modal de export y la pantalla de
inicio ⇒ la afirmación del brief "todas las animaciones infinitas llevan `motion-safe:`" era
literalmente falsa; B6 no medía el rectángulo real de Reproducir/Pausa, Metrónomo, "Cortar clip" ni
Solo/Armar.

**Ruling: el ensanchado `w-28 → w-40` de los strips del mixer se aplica **incondicionalmente**, no
sólo en punteros gruesos.** La spec fija los 44×44 px como restricción dura y una variante
`pointer-coarse:` sería **inmedible en la suite de navegador**. El coste (strips ~43 % más anchos,
menos densidad en escritorio) se acepta. **Coste si me equivoco:** el mixer de escritorio pierde
densidad; reversible cambiando el prefijo.

- **WP8: fix round 1/5 (4 addressed, 0 open; commits 7c26771..4d72425)**
  Re-revisión acotada: **ALL FINDINGS ADDRESSED**, sin breakage nueva; **higiene de commits limpia**
  (el `tsc` rojo intermedio se enmendó, no quedó un commit roto en el rango).
  **Bónus del programa:** al ampliar B6, la suite de navegador encontró una **fuga real** — el botón
  "Cortar clip" medía 82×40 px ⇒ corregido a ≥44 px. Otro defecto real cazado por la red nueva.
- **Task 26/27/28/29/30: complete (commits 45b6fc8..4d72425, review clean)**
- **WP8: complete (commits 45b6fc8..4d72425, review clean)**

### WP9 (Tasks 31, 32, 33) — funciones nuevas: importar audio, portapapeles, multi-selección

**Revisión: Spec ❌ (Missing ×1, Misunderstood ×2) · Task quality: Needs fixes.** 2 **Important**:
1. **Regresión silenciosa del drag & drop**: el `handleDrop` antiguo llamaba a `addTrack(...)` **dentro
   del bucle por archivo**, así que soltar N archivos creaba **N pistas**; el nuevo
   `importAudioFiles` resuelve/crea la pista **una vez antes del bucle** ⇒ 1 pista con N clips.
   El ruling exigía explícitamente que el refactor **no** cambiara lo que hace el drag & drop.
2. **Corte con multi-selección parcial y destructivo**: el atajo `S` tomaba sólo
   `selectedClipIds[0]` y `splitClip` ponía `selectedClipIds: [clip2.id]` ⇒ **descartaba el resto de
   la selección en silencio**. Inconsistente con el `Delete`, que sí borra toda la selección.
   **Ruling: el corte con `S` debe afectar a TODOS los clips seleccionados que contengan el
   playhead, en un único snapshot de historial.** Es lo que espera un usuario de DAW y es lo que
   hace coherente el corte con el borrado.
   **Coste si me equivoco:** el corte múltiple es más complejo y una implementación torpe podría
   partir clips que no debía; por eso el test exige 3 clips → 6 mitades → 1 undo revierte el lote.

**Menores resueltos en la ronda:** portapapeles que cruzaba proyectos; ids con colisión teórica;
importación que registraba N+1 snapshots (el undo la pelaba clip a clip). **Ruling aceptado:** el
split de un solo clip ahora **selecciona ambas mitades** (antes sólo la derecha) — decisión
deliberada, coherente con la semántica de "productos del corte = conjunto de trabajo", y verificada
por el revisor: pulsar `S` otra vez en el mismo sitio es **no-op** (`splitClipOperation` rechaza el
corte en el borde), así que no hay bucle.

**Menor aceptado:** `TrackHeader.tsx` figuraba en el brief de la Task 33 pero **no se tocó** — el
brief era inexacto (TrackHeader maneja selección de *pista*, no de clip) ⇒ la omisión es correcta.

- **WP9: fix round 1/5 (5 addressed, 0 open; commits 78fcf19..8118a94)**
  Re-revisión acotada: **ALL FINDINGS ADDRESSED**, sin breakage nueva. Verificado: la pista se
  resuelve **por archivo** cuando no hay destino (y se crea incluso si la decodificación falla, para
  no dejar archivos huérfanos); `splitSelectedClips` corta todos los seleccionados que contienen el
  playhead en **un** snapshot, deja intactos y seleccionados los que no, y selecciona ambas mitades;
  `resetHistory()` limpia el portapapeles (cubre blanco, demo, carga e importación desde archivo);
  ids con **contador monotónico** (test con reloj y `Math.random` congelados: 20 pegadas ⇒ 20 ids
  únicos); importación con un único snapshot (2 archivos ⇒ un undo los quita).
- **Task 31/32/33: complete (commits 4d72425..8118a94, review clean)**
- **WP9: complete (commits 4d72425..8118a94, review clean)**

### WP10 (Tasks 35, 36, 37, 38, 39) — seguridad, PWA, flake, tipos

**Revisión: Spec ❌ (Task 35 parcial/malentendida) · Task quality: Needs fixes.** 1 **Critical**:
- `pluginSandbox.ts:84-96` — los patrones de `eval`/`Function` exigen un `(` final, así que
  `const e = eval;` **pasa el escáner** (verificado por el revisor: el escaneo devuelve `null`).
  Un `eval` indirecto así ejecuta en **ámbito global** y esquiva todos los parámetros sombreados
  ⇒ acceso completo a `fetch`/`window`/`document`/`indexedDB` en el padre.
- `pluginSandbox.ts:154` — `evaluateHardened` sigue evaluando la fábrica no confiable con
  `new Function` **en el padre**, y `PluginHost.ts:139-147` vuelve a materializar el mismo código
  en el padre. El iframe **sólo extrae un descriptor** (`hasFactory: true`); nunca confina
  `createDSPNode`, que se ejecuta después en el padre sobre el `AudioContext` real.
⇒ **La "aislamiento real" de la Task 35 no se cumple.** Y por eso el CSP necesita `'unsafe-eval'`.

**Ruling: aislamiento real por puente RPC de capacidades.** El bloqueo de fondo es arquitectónico:
el plugin necesita el `AudioContext` del padre (no es transferible a un iframe), así que aislar el
código **y** darle acceso a los nodos exige un **intermediario de capacidades**:
1. El código del plugin se evalúa **dentro del iframe** (origen opaco) y **nunca** en el padre.
2. El iframe recibe un **contexto proxy** cuyas únicas operaciones permitidas son un conjunto
   **allowlisted** de fábrica de nodos; cada llamada viaja por `postMessage` al padre.
3. El padre crea los nodos **reales** y devuelve **identificadores opacos**; `connect`, `setParam` y
   `dispose` viajan igual. El iframe nunca ve un `AudioNode`.
4. El padre **deja de llamar a `new Function` sobre código de usuario** ⇒ el CSP puede **eliminar
   `'unsafe-eval'`**, que era la premisa del ruling original.
5. Si el iframe no puede crearse ⇒ **rechazo explícito**, nunca ejecución sin protección.
**Coste si me equivoco:** es un rediseño del API de plugin personalized (un proxy en vez del
`AudioContext` real). Si algún plugin existente depende de API de Web Audio no cubierta por el
allowlist, deja de funcionar ⇒ hay que documentar la superficie soportada. Riesgo acotado: la
funcionalidad es **avanzada y de auto-uso**; los plugins **builtins** no pasan por este camino.

**⚠ Halazgo relacionado que confirma que el programa funciona:** el revisor verificó un bypass real
del escáner (`const e = eval;`) que la suite **no** cazaba. El nuevo arnés de tests, con payloads
adversariales, sí lo cazó.

**Ruling: el fichero de Search Console placeholder se BORRA.** El contenido del fichero es
`google-site-verification: google3fce0f2d783a10a6.html` — el **nombre del fichero repetido**, no un
token real (los tokens reales son 43+ caracteres base64 URL-safe). El ruling global era "no
inventar tokens: borrar el placeholder".

**Ruling: `base: './'` + rutas absolutas es una inconsistencia auto-infligida.** Con `base: './'`, un
`/sw.js` absoluto se registra en el **scope equivocado** bajo un despliegue en sub-path y falla en
silencio; los `src` del manifest y los enlaces del `index.html` dan 404. Las rutas deben derivarse
de `import.meta.env.BASE_URL`.
**Coste si me equivoco:** `BASE_URL` es `'./'` en dev y una ruta con barra final en prod; hay que
normalizar el join de rutas con cuidado.

**Otros Important:** el `networkFirst` del SW devuelve un 5xx sin consultar la caché; y
`src/tests/suiteStability.test.ts` **afirma sobre el texto fuente de otros tests** (meta-test), lo
que incumple la regla de "los tests comprueban comportamiento del producto" ⇒ debe sustituirse por
una guarda de comportamiento o eliminarse dejando los timeouts como mitigación documentada.

- **WP10: fix round 1/5 (7 addressed, 0 open; commits 8b96bbb..94e6b02)**
  Re-revisión acotada: **ALL FINDINGS ADDRESSED**. Verificado por el revisor con un grep directo:
  `grep "new Function" src` ⇒ **un único hit**, y está **dentro de la cadena del harness** (lado
  iframe), no en el hilo principal. El `evaluateHardened` del padre (con `new Function`) se borró; el
  padre ahora materializa los nodos sólo vía `replayBridgeOps` sobre datos validados. La CSP perdió
  `'unsafe-eval'`. El manejador del padre valida `event.source === contentWindow` + `event.origin
  === 'null'` + sesión + forma + revalidación de la importación. 658/658, 83/83 DOM, 9/9 navegador,
  bundle 106.2 kB gzip.

### ⚠⚠ HALLAZGO DEL CONTROLADOR: el sandbox de plugins está MUERTO en producción (verificado)

El revisor dejó un riesgo "unverified" y **lo he verificado yo mismo, con las cabeceras reales**.
Monté un servidor que sirve `dist/` aplicando el `public/_headers` real (con el parseo correcto del
formato, que respeta la sangría) y lo comprobé en Chrome 155:

| Prueba | Resultado |
|---|---|
| CSP servida | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; …` (sin `'unsafe-eval'`, sin `'unsafe-inline'` en scripts) |
| `new Function` en el **hilo principal** | **bloqueado** por la CSP ✅ (objetivo cumplido) |
| `<script>` inline en el iframe `srcdoc` + `sandbox="allow-scripts"` | **BLOQUEADO** ⇒ el script del harness **no se ejecuta** ⇒ el iframe nunca responde ⇒ **el registro de plugins personalizados falla siempre en producción** |
| Origen del iframe | `"null"` (opaco ✅ — el aislamiento de origen sí funciona) |

**Causa:** un documento `srcdoc` **hereda la CSP de su padre** (CSP3). El harness del iframe es un
`<script>` inline ⇒ `script-src 'self'` sin `'unsafe-inline'` lo bloquea. En **dev** no se aplica
`_headers`, así que el sandbox **funciona** ⇒ el fallo sólo aparece en producción, y **toda** la
suite de navegador corre contra el dev server ⇒ **nunca lo habría cazado**.

**Ruling: el harness del sandbox debe servirse como documento propio con CSP propia y más estricta.**
- Nuevo `public/sandbox.html` + `public/sandbox.js`: el iframe se carga por `src` (no `srcdoc`),
  con `sandbox="allow-scripts"` (sin `allow-same-origin`) ⇒ origen opaco, como ahora.
- `_headers` con regla **por ruta** para `/sandbox.html` y `/sandbox.js`:
  `Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'`
  ⇒ el sandbox **no puede hacer ninguna petición de red** (ni a terceros ni a la app) y sí puede
  evaluar el código del plugin (que es lo que necesita). El **hilo principal conserva
  `script-src 'self'`** sin `'unsafe-eval` ⇒ sigue sin poder evaluar código.
- **Comprobación de navegador con cabeceras de producción, versionada en el repo**: servir `dist/`
  con el `_headers` real y ejercitar el sandbox de extremo a extremo. Sin esto, **ninguna**
  configuración de cabeceras de producción queda verificada, y la suite actual (que corre contra el
  dev server, sin cabeceras) no puede cazarla.

**Coste si me equivoco:** el harness pasa a ser un asset estático ⇒ hay que mantener la lógica del
scanner fuera del bundle TS, y `sandbox.js` debe servirse con la CSP de su ruta (que Cloudflare
Pages soporta con reglas por ruta en `_headers`). Si la regla por ruta no se aplicara, el sandbox
vuelve a fallar en producción ⇒ por eso la comprobación con cabeceras reales es obligatoria.

- **WP10: fix round 2/5 (3 addressed, 0 open; commits 94e6b02..fc9b4bc)**
  El harness pasa a servirse como **documento propio** (`public/sandbox.html` + `public/sandbox.js`)
  con regla por ruta en `_headers`:
  `default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'` ⇒ el sandbox **no puede
  hacer ninguna petición de red** y el hilo principal **conserva** `script-src 'self'` sin
  `'unsafe-eval'`. Se añade una **fase de producción** a `npm run test:browser` que construye
  `dist/`, lo sirve con el `_headers` **real** (parseando la sangría correctamente) y ejercita el
  sandbox de extremo a extremo.
  **Verificación independiente del controlador:** `npm run test:browser` ⇒ **9/9** (fase dev) +
  **11/11** (fase producción: CSP sin `unsafe-eval` en el documento, CSP del sandbox con
  `unsafe-eval` y `connect-src 'none'`, COOP/COEP/HSTS/XFO/RP, caché inmutable de `/assets/*`,
  arranque del build, plugin benigno **aceptado**, 4 payloads maliciosos **rechazados**, y
  **cero ejecución ni llamadas de red**). Bundle **102.6 kB gzip**. Mi propia sonda independiente
  confirma que la CSP del documento principal se sirve sin `'unsafe-eval'` y que el `_headers`
  tiene las reglas por ruta.
  **Tripwire de despliegue (anotado):** la semántica de *merge* de `_headers` en Cloudflare Pages
  debe comprobarse una vez tras el primer despliegue; la regla por ruta de `/sandbox.html` es la que
  depende de ello. El check P2 es la señal de alarma, pero corre contra nuestro servidor, no
  contra Cloudflare.

**Estado del flake (Task 38):** **encontrado y corregido** — tests DSP síncronos que tardaban ~4.6 s
contra un presupuesto de 5 s (92 % del límite) ⇒ fallo bajo contención de CPU. Corregido con
presupuestos deterministas y una guarda de **comportamiento** (determinismo de la IR +
equivalencia `encodeWavAsync` ≡ `encodeWav` a 16/24/32 bits) en lugar del meta-test sobre el texto
fuente que el revisormarcó.

- **Task 35/36/37/38/39: complete (commits 8118a94..fc9b4bc, review clean)**
- **WP10: complete (commits 8118a94..fc9b4bc, review clean)**

### Task 34 — barrido de documentación

- **Commit** `1a4850d` — 9 ficheros, sólo docs. Números medidos: `npm test` 663/663 en 57
  (unit 408 + contrato 172 + dom 83); `test:browser` 9/9 dev + 11/11 prod; `tsc` limpio con 6
  flags; JS **102 871 bytes gzip** (vendor 45,3 + app 48,5 + CSS 6,5 + 2 modales lazy).
- Reescritos: `PROJECT.md`, `HANDOFF.md` (bloque único, sin duplicados), `TEST_INFRA.md`,
  `TEST_READY.md` (**sin "READY"**), `README.md`, `tests/browser/README.md` (que afirmaba 8 checks
  con un expectedFailure), `docs/auditoria/01-informe-auditoria.md` (§5.2 con el estado de los 50
  hallazgos), `docs/auditoria/00-estado-actual.md` (nota histórica) y creado
  `docs/auditoria/02-export-dsp.md`.
- **Regla aplicada: ninguna cifra sin el comando que la produce al lado.**

### Task 40 — cerrar ST-04, ST-09 y la cola de menores

- **Commit** `6a88a63`. **676/676 en 58 ficheros**; `tsc` limpio; build OK (**103 859 bytes gzip**);
  navegador **9/9 dev + 11/11 prod**.
- **ST-04 cerrado**: el código del plugin custom persiste con tope de tamaño y se re-registra al
  cargar; **verificado que el hilo principal nunca lo ejecuta** (cero `new Function`, con un test
  que lo pina) ⇒ la ruta restaurada pasa por el **mismo** escáner + iframe opaco + importación
  validada.
- **ST-09 cerrado**: `fadeIn`/`fadeOut` sobreviven al round-trip (sólo finitos y > 0).
- Menores cerrados: títulos M/S/R en español; `start_url` del manifest relativizado;
  `VALID_SNAP_MODES` tipado `readonly SnapMode[]`; pin de round-trip de `snapMode: '1/2'`;
  `resetHistory()` en el `beforeEach` de los atajos; comentario obsoleto del `WavExporter`;
  rechazo explícito del 7 canales en ADTS; ids de mitades de corte con contador monotónico.

### Revisión final de rama (`aca438b`..`6a88a63`) — veredicto: **With fixes**

77 commits, 119 ficheros, ~16 800 líneas añadidas. Revisor independiente por pasadas (motor, estado,
exportación, UI/a11y, seguridad/ops, tests, docs). **Sin Critical.** 3 **Important**:
- **I1** — la **plantilla por defecto del editor de plugins no compila bajo el sandbox nuevo**:
  `PluginRackModal.tsx:42-66` usa `context.currentTime`, que el proxy no expone (sólo expone las 8
  factorías). Verificado por el revisor **ejecutando contra los bytes reales de `public/sandbox.js`**:
  `ok: false — "updateParameter lanzó en la sonda: argumento no finito"`. Es el primer código que ve
  cualquier usuario del editor ⇒ **rompe la vía de entrada documentada a una función de cabecera**.
- **I2** — el `play()` del store fija `isPlaying: true` **sin comprobar supervivencia**: si `stop()`/
  `pause()` cae en la ventana asíncrona de `play()`, el motor queda en silencio (token) pero el store
  dice `isPlaying: true` ⇒ **gemelo a nivel de store del AUD-02** que la rama declara cerrado.
- **I3** — **las cifras de la documentación van una commit atrás**: los documentos citan 663/663 en
  57 ficheros y 102 871 bytes, cuando el commit final deja **676/676 en 58 ficheros y 103 859
  bytes**. La honestidad de las cifras es el entregable explícito de la Task 34 ⇒ contradice su
  propia regla.

**Ruling: se corrigen I1, I2, I3 y M9 antes del merge** (los tres Important tocan afirmaciones de
cabecera de la rama). El resto de menores se acepta como limitación documentada o se corrige si
cabe en el mismo pase.
**Coste si me equivoco:** los menores aceptados (sin tope de tamaño en la subida de plugin, el aviso
de truncado sólo por consola, la captura de puntero perdida) son endurecimientos, no correcciones de
comportamiento roto ⇒ el coste de dejarlos es acotado y está documentado.



















---

## Cierre del programa

- **Revisión final de rama:** veredicto **With fixes** (3 Important: I1, I2, I3) → corregidos en
  la ola final (`2216df3`, `837a451`+`4f6a836`, `212fedf`, `20b7b64`, `e729f79`, `09fd101`,
  `22ca608`, `6f8eb17`, `0081517`).
- **Re-revisión acotada de la ola final:** **ALL FINDINGS ADDRESSED**, sin breakage nueva.
- **Verificación final del controlador:**
  - `npm test` → **689/689 en 62 ficheros** (unit 431 + contrato 172 + dom 86), 9.07 s
  - `npx tsc --noEmit` → **limpio** (6 flags estrictos)
  - `npm run build` → **OK**; JS **102.5 kB gzip** (vendor 45.26 + app 49.55 + CSS 6.52 + 2 modales
    lazy), presupuesto < 350 kB ⇒ margen 3.4×
  - `npm run test:browser` → **9/9** (dev) + **12/12** (producción con cabeceras reales)
- **Rama:** `feature/audit-hardening-2026-10`, 87 commits desde `aca438b`, **sin push** (la fusión
  y el despliegue son decisiones del usuario).

### Limitaciones residuales aceptadas y documentadas

- AUD-09 (`addClip` no resincroniza el engine al añadir durante la reproducción) — menor.
- ST-11 (mutación in-place de `audioBuffer`) — latente, frágil pero no alcanzable por la UI.
- Los ajustes de transporte (BPM, loop, metrónomo, volumen master) **no** están en la pila de undo
  por sí mismos (se restauran al deshacer una acción registrable).
- El loop es gapless **bajo reloj simulado**; en hardware real no medido.
- El plugin custom recibe un **proxy** con 8 factorías allowlisted; `ConvolverNode` sin impulso y
  `WaveShaperNode` sin curva no son utilizables a través del puente.
- Tripwire de despliegue: la semántica de *merge* de `_headers` en Cloudflare Pages para la regla
  por ruta de `/sandbox.html` debe comprobarse tras el primer despliegue.
- Sin MIDI, sin automatización de parámetros, sin export MP3, sin time-stretch, sin WAM 2.0 /
  WebCLAP / WASM / AudioWorklet; sin migración a React 19 / Vite 7 / Vitest 3 (decisión explícita).
