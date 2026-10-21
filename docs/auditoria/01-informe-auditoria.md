# HydraDAW — Informe de auditoría (síntesis de 5 subagentes + verificación propia)

> Fecha: 2026-10-21 · Base: `aca438b` · Rama: `feature/audit-hardening-2026-10`
> Método: 5 auditorías paralelas de dominios independientes (solo lectura) + verificación
> directa en navegador real (Chrome headless) + relectura manual de los hallazgos críticos.

## 0. Resumen ejecutivo

**El proyecto no tiene un problema de calidad de código. Tiene un problema de falsa confianza.**

La base de código es sólida: TypeScript estricto sin errores, 454 tests en verde, motor de audio
real, persistencia con migración, export WAV/AAC con loudness BS.1770. El problema es que **la red
de seguridad no cubre lo que dice cubrir**, y en una capa concreta —la de interacción— la
funcionalidad documentada sencillamente **no existe**.

| Veredicto | Detalle |
|---|---|
| Salud del código | **Alta**. Compila limpio, tipado estricto, sin fugas de memoria graves, DSP correcto en lo esencial. |
| Salud de los tests | **Baja en valor real**. 188 de los 454 tests ("E2E tiers 1-4") son **tautologías sobre objetos falsos**: no montan ni un componente, no abren un navegador, no comprueban el DOM. |
| Salud funcional | **Media**. ~14 features documentadas como hechas (F1-F17) no están implementadas. Faltan funciones esenciales (importar audio por botón, copiar/pegar, multi-select). |
| Seguridad | **Baja**. El sandbox de plugins de usuario es evadible trivialmente (`globalThis.fetch`); el service worker sirve builds viejos para siempre. |
| Operaciones | **Baja**. Sin CI, sin iconos PWA, cabeceras de seguridad incompletas, documentación con cifras obsoletas. |

### El hallazgo central

`src/tests/e2e/tier1_m1_m2_features.test.ts:306-319` — test *"F4-1: acquires pointer capture"*:

```ts
const target = { setPointerCapture: vi.fn((id: number) => { capturedId = id; }) };
const event = createSyntheticPointerEvent('pointerdown', target, { pointerId: 42 });
if (target.setPointerCapture) { target.setPointerCapture(event.pointerId); }
expect(target.setPointerCapture).toHaveBeenCalledWith(42);
```

El test crea su propio mock, lo llama y comprueba que su propio mock fue llamado. **Pasa aunque
`WaveformCanvas` no tenga ni una línea de código de pointer events.** Y de hecho no la tiene
(`WaveformCanvas.tsx:128` usa `onMouseDown` + listeners `window`).

Igual con F5 (`touch-action: none`): `expect({touchAction:'none'}.touchAction).toBe('none')`.
Y con F8 (hitboxes 44px): `expect(44).toBeGreaterThanOrEqual(44)`.

**Consecuencia**: `TEST_READY.md` declara el producto *"READY — 100% Passing"* como puerta de
lanzamiento, y `HANDOFF.md:8` cita *"E2E en Chrome real: 0 errores de consola"* de scripts
temporales en `/tmp` que no están en el repo y no se pueden re-ejecutar. La puerta de calidad
real es inexistente.

## 1. Tabla consolidada de hallazgos

Severidad: **P0** = pérdida de datos/corrupción · **P1** = defecto visible para el usuario ·
**P2** = corrección/robustez · **P3** = higiene, riesgo latente, deriva de spec.

### 1.1 Motor de audio y DSP (AUD)

| ID | Sev | Ubicación | Hallazgo |
|---|---|---|---|
| AUD-01 | P1 | `AudioEngine.ts:434-489` | `play()` hace 2 `await` antes de `isPlaying=true`. Dos `play()` solapados pasan ambos la guarda `if (this.isPlaying) this.stop(true)` ⇒ **doble fuente de audio (+6 dB / fase)**. Alcanzable: el store dispara `audioEngine.play()` sin `await` en cada tick de scrub, en cada arrastre de clip y **dentro de updaters de Zustand** (doble invocación en StrictMode). |
| AUD-02 | P1 | `AudioEngine.ts:434-489` | Inversamente: play → stop rápido deja el `play()` en vuelo ⇒ **zombi que sigue sonando tras pulsar stop**. |
| AUD-03 | P1 | `AudioEngine.ts:556-567` | El punch-in sella `recordingStartTime` **antes** de `await getUserMedia()` ⇒ la toma se coloca tantos segundos antes como tarde el permiso del micro. |
| AUD-04 | P1 | `AudioEngine.ts:954-970` | `armMetroExtender` programa la ventana `[now, now+2)` cada 1 s ⇒ **cada click se programa dos veces** (2 osciladores) ⇒ metrónomo ~+6 dB y phasey. |
| AUD-05 | P1 | `AudioEngine.ts:975-1001` | El wrap del loop lo dispara un `setTimeout` de reloj de pared, no el reloj de audio ⇒ **hueco audible o click** en cada frontera de loop bajo carga/throttling. |
| AUD-06 | P2 | `AudioEngine.ts:860-886` | El `clipGain` de los fades nunca se desconecta ⇒ **crecimiento silencioso del grafo** (~15 nodos/min por clip con fade, por iteración de loop). |
| AUD-07 | P2 | `AudioEngine.ts:896-925` | El `gain` de cada click de metrónomo nunca se desconecta ⇒ ~120 `GainNode` fugados por 10 min de metrónomo. |
| AUD-08 | P2 | `PluginHost.ts:96-136` | El "sandbox" delega en `new Function` + 8 nombres sombreados. Escapan sin esfuerzo: `globalThis.fetch`, `navigator.sendBeacon`, `location.href`, `self['fe'+'tch']`, `x.constructor.constructor("...")()`. |
| AUD-09 | P2 | `useDawStore.ts:401-411` | `addClip` **no resincroniza el engine**, a diferencia de `updateClip`/`removeClip`/`removeTrack` ⇒ un clip importado o grabado durante la reproducción **no suena** hasta parar. |
| AUD-10 | P2 | `TrackNode.ts:63-109` | Una cadena de efectos inválida **rompe todo el transporte**: `rebuildEffectsChain` no tiene `try/catch` ⇒ un plugin que devuelve `{}` deja la app muda. |
| AUD-11 | P2 | `AudioEngine.ts:124-175` | Al recrear el contexto se reconstruye el `MasterBus` pero **no los `trackNodes`** ⇒ nodos del contexto viejo sobreviven y `connect` cruzado lanza `InvalidAccessError` ⇒ silencio tras cambio de dispositivo. |
| AUD-12 | P3 | `waveformUtils.ts:33`, `timelineOps.ts:89`, `audioMath.ts:21` | NaN/negativos se propagan a `startTime`/`duration` ⇒ un clip envenenado de forma permanente. |

### 1.2 Estado y persistencia (ST)

| ID | Sev | Ubicación | Hallazgo |
|---|---|---|---|
| ST-01 | **P0** | `useDawStore.ts:40,569,768` + `persistence.ts:1019` | `resetHistory()` existe pero **nadie lo llama**. Cargar demo/blanco/guardado **no limpia el historial** ⇒ Ctrl+Z en un proyecto nuevo **resucita pistas del proyecto anterior**. |
| ST-02 | P1 | `useDawStore.ts:393,413,485,515,529,546` | 6 acciones mutantes **no llaman `recordHistory`**: `updateTrack`, `updateClip`, `addPluginToTrack`, `removePluginFromTrack`, `togglePlugin`, `updatePluginParam`. ⇒ **arrastrar un clip, mover un fader o girar un knob no se puede deshacer**. |
| ST-03 | P1 | `useDawStore.ts:21-24,182-217` | `HistorySnapshot` solo guarda `{tracks, clips}` ⇒ deshacer **no restaura** bpm, compás, loop, volumen master, mute, nombre, ni la selección; y el engine conserva el tempo nuevo mientras el estado vuelve atrás ⇒ **divergencia audio/estado**. |
| ST-04 | P1 | `useDawStore.ts:494`, `persistence.ts:351`, `PluginRackModal.tsx:81` | El código custom del plugin **nunca se persiste** (`customJsCode`/`customWamUrl` se pierden) ⇒ tras recargar, el plugin aparece sin knobs y **sin DSP**. |
| ST-05 | P1 | `persistence.ts:1275-1304`, `App.tsx:172-181` | El autosave es debounce **sin flush**: no hay `beforeunload`/`pagehide` y el `stop()` **descarta** el timer pendiente ⇒ **se pierde el último cambio** si se cierra la pestaña en <2 s. |
| ST-06 | P1 | `persistence.ts` (5 puntos de contacto) | `snapMode` **no se persiste** ⇒ la preferencia de imantado vuelve a `1/16` en cada recarga. |
| ST-07 | P2 | `useGlobalShortcuts.ts:5-110` | Los atajos globales **no miran si hay un modal abierto** ⇒ con el modal de exportación abierto, `Delete` borra clips por detrás, `Espacio` reproduce, `S` corta. |
| ST-08 | P2 | `persistence.ts:359,480` | La importación de proyecto no sanea los **parámetros de plugin** (puede colarse `"lowGain": "evil"` en un `Record<string,number>`), ni deduplica ids, ni valida la selección ⇒ Importar JSON hostil inyecta basura tipada. |
| ST-09 | P2 | `types/daw.ts:53` + `persistence.ts` | `fadeIn`/`fadeOut` **no sobreviven al round-trip** de guardado. |
| ST-10 | P2 | `useDawStore.ts:362,379,396,420,436,510,524,541` | Efectos del engine (`syncTracks`, `play`, `rebuildTrackEffects`) ejecutados **dentro de los updaters de `set()`** ⇒ impureza; con doble invocación (StrictMode) el audio se programa dos veces. |
| ST-11 | P3 | `useDawStore.ts:373,430,469` | Mutación in-place de `c.audioBuffer = null` sobre objetos vivos del store; y `trimClip` **registra historial aunque no cambie nada** (`delta=0`) ⇒ los 30 slots de deshacer se llenan de no-ops. |
| ST-12 | P3 | `persistence.ts:1161`, `useGlobalShortcuts.ts` | El snapshot de autosave incluye selección/zoom/scroll ⇒ cada scroll dispara un guardado completo con PCM; y los atajos no filtran `e.repeat` ⇒ mantener `R` pulsado alterna grabación. |

### 1.3 UI / React / A11y (UI)

| ID | Sev | Ubicación | Hallazgo |
|---|---|---|---|
| UI-01 | P1 | `Timeline.tsx:205,227` | **Los headers de pista y los lanes son dos contenedores de scroll independientes sin sincronizar** ⇒ con >4 pistas los nombres se desalinean de sus lanes al hacer scroll. El contrato e2e lo "verifica" sobre objetos falsos. |
| UI-02 | P1 | `Ruler.tsx:100-105` | La regla **no es `sticky`** ⇒ al hacer scroll vertical desaparece la numeración de compases y la superficie de seek. |
| UI-03 | P1 | `WaveformCanvas.tsx:128,213-233` | Arrastrar/recortar usa `onMouseDown` + `window` listeners: **sin `touch-action: none`, sin `setPointerCapture`, sin eventos pointer** ⇒ en táctil el navegador se queda con el gesto y **el clip no se mueve**. |
| UI-04 | P1 | `Knob.tsx:46-72,94-99,124` | El knob no hace `setPointerCapture` ni tiene `touch-action: none` ⇒ **inal usable al tacto**; además `onWheel` con `preventDefault()` es un no-op (React registra `wheel` como pasivo) ⇒ la página hace scroll al girar el knob. |
| UI-05 | P1 | `TransportBar.tsx:278-392`, `Timeline.tsx:130`, `TrackHeader.tsx:82`, `ChannelStrip.tsx:49` | Botones sólo-icono **sin nombre accesible** (Stop, Play, Record, Loop, mute master, zoom, borrar pista, añadir efecto): sólo `title`, que no es un nombre fiable. |
| UI-06 | P2 | `MixerConsole.tsx:9`, `TrackHeader.tsx:19`, `PluginRackModal.tsx:16`, `ExportModal.tsx:54` | `useDawStore()` **sin selector** ⇒ suscripción al store entero ⇒ cualquier cambio re-renderiza los 4 subárboles (cada movimiento de knob re-renderiza el rack completo). |
| UI-07 | P2 | `Timeline.tsx:33` | `scrollContainerRef` está adjunto pero **nunca se lee** ⇒ el playhead **no sigue al scroll**: se sale de la vista y nadie lo persigue. |
| UI-08 | P2 | `Ruler.tsx:64-70` | El seek **sólo acota por abajo** ⇒ se puede buscar más allá de la duración del proyecto; y la regla no es focusable ⇒ **no hay seek por teclado**. |
| UI-09 | P2 | `Timeline.tsx:124,129,191`, `TrackHeader.tsx:32`, `Header.tsx:55-82` | Los headers son `w-60` fijos (240 px) ⇒ a 320 px las lanes quedan en ~80 px; los botones de zoom son de ~24 px y los M/S/R de 36 px ⇒ **por debajo del objetivo táctil de 44 px**; los handles de trim son `opacity-25` (invisibles al tacto). |
| UI-10 | P2 | `TrackHeader.tsx:30`, `WaveformCanvas.tsx:213`, `ChannelStrip.tsx:177`, `Knob.tsx:162` | 4 callejones sin teclado: seleccionar pista, reset de dB a 0, editor de valor exacto del knob, y `role="option"` sin `listbox` padre. |
| UI-11 | P2 | `PluginRackModal.tsx:55`, `ExportModal.tsx:80` | Los modales **no atrapan el foco** ni inertizan el fondo ⇒ el Tab se sale del diálogo a la línea de tiempo de detrás. |
| UI-12 | P3 | `Timeline.tsx:51`, `Ruler.tsx:26`, `TransportBar.tsx:183` | **Dos bucles rAF de playhead** + dos suscripciones `onTimeUpdate` ⇒ hasta 4 escrituras de posición por frame; el timecode re-renderiza a la tasa del engine. |
| UI-13 | P3 | `WaveformCanvas.tsx:224`, `index.css:29` | Clips con `rounded-lg` (8 px) contra la spec (2-4 px); la utilidad `tabular-nums` existe y **no se usa en ningún sitio**. |
| UI-14 | P3 | `TransportBar.tsx:302`, `TrackHeader.tsx:141`, `index.css` | `animate-ping`/`animate-pulse` infinitos **sin `prefers-reduced-motion`**. |

### 1.4 Build, seguridad, docs y tests (CFG)

| ID | Sev | Ubicación | Hallazgo |
|---|---|---|---|
| SEC-01 | P1 | `PluginHost.ts:96-129` | (ver AUD-08) Fuga de sandbox confirmada: `grep globalThis\|navigator\|location` ⇒ 0 hits en el archivo; el registro de un plugin con `globalThis.fetch` **tiene éxito**. |
| SW-01 | P1 | `public/sw.js:1,38-50`, `src/main.tsx:13` | El SW **sí** se registra, pero cachea **todo** (incluido el shell) con `CACHE_NAME='hydradaw-v1'` **que nunca se bumpea** ⇒ **cada visitante recurrente ve la build anterior** en su primera carga. Sin manifiesto de assets precacheados ⇒ una recarga offline puede fallar. |
| DOC-01 | P1 | `src/tests/e2e/*`, `TEST_INFRA.md:41`, `TEST_READY.md:15` | La suite "E2E de 4 tiers" corre en Node con mocks: `grep -rn "playwright\|puppeteer\|jsdom\|render(" src/tests/e2e/ package.json` ⇒ **0 hits**. `TEST_READY.md` la declara puerta de lanzamiento. |
| TEST-01 | P2 | `tier1_m1_m2_features.test.ts:375,521,496` | ~15 de los 188 tests son **tautologías literales** que no pueden fallar. |
| SEC-02 | P2 | `App.tsx:103`, `persistence.ts:440` | Importación de proyecto **sin presupuesto**: `file.text()` sin límite de tamaño, `JSON.parse` sin cota, arrays sin tope, `duration: 1e18` ⇒ largura de regla de 5e19 px ⇒ **congelación/OOM de la pestaña**. |
| CFG-01 | P2 | `manifest.webmanifest:9`, `index.html:8` | El único icono es un SVG `data:` declarado `maskable` ⇒ **la instalabilidad PWA falla**; sin `apple-touch-icon`, sin `og:image`. |
| OPS-01 | P2 | raíz del repo | **No existe `.github/`** ⇒ ningún gate automático; Cloudflare Pages compila sin correr tests. |
| HDR-01 | P3 | `public/_headers` | Sin `Content-Security-Policy`, sin HSTS, sin `frame-ancestors`, sin `Referrer-Policy`; COEP difiere entre dev (`require-corp`) y prod (`credentialless`). |
| SEO-01 | P3 | `index.html:13`, `public/sitemap.xml` | Sin `og:image`/`twitter:card`; canonical fijo a `hydradaw.pages.dev`; el fichero de Search Console lleva un **placeholder**, no un token real. |
| CFG-02 | P3 | `vite.config.ts` | `base` sin fijar ⇒ rutas absolutas (`/assets/`) ⇒ **no funciona en sub-path**; `build.target` implícito. |
| TS-01 | P3 | `tsconfig.json` | Falta `exactOptionalPropertyTypes` ⇒ `undefined` se cuela en campos opcionales. |

### 1.5 Exportación y utilidades DSP (EXP)

Pendiente de la auditoría de dominio Export/DSP (en curso al cierre de este documento).
Ver `docs/auditoria/02-export-dsp.md` cuando se integre.

## 2. Funcionalidad ausente (no son bugs, son huecos)

| ID | Hueco | Impacto |
|---|---|---|
| G1 | **No hay forma de importar audio salvo arrastrar y soltar** (`Timeline.tsx:82`). No existe `<input type="file" accept="audio/*">` en el `Header`. | En móvil/tablet **es imposible importar una pista**. El DAW más usado del mundo sin botón de importar. |
| G2 | **Sin copiar/pegar/duplicar clips** | Flujo de edición estándar inexistente. |
| G3 | **Sin automatización de parámetros** | No se puede automatizar un fade de volumen ni un barrido de filtro. |
| G4 | **Sin MIDI** | `grep -i midi` ⇒ 0 resultados. |
| G5 | **Sin multi-selección de clips** | El store sólo tiene `selectedClipId: string \| null`. |
| G6 | **Sin CI** | Nada se ejecuta automáticamente. |
| G7 | **Sin remuestreo ni elasticidad de tempo** | Un clip a 120 BPM en un proyecto a 140 BPM no se estira. |
| G8 | **Sin export a MP3** | WAV y AAC cubren el caso de uso; MP3 esNice-to-have. |

## 3. Verificación de los hallazgos críticos (hecha por mí, no por los subagentes)

| Afirmación | Verificación | Resultado |
|---|---|---|
| "La suite e2e no renderiza componentes" | `grep -rln "render(\|@testing-library\|createRoot" src/` | Sólo `src/main.tsx` (el arranque real). **Confirmado.** |
| "F4 (pointer events) no está implementado" | Lectura de `WaveformCanvas.tsx:128,196-197,214` | `onMouseDown` + `window.addEventListener('mousemove'|'mouseup')`. **Confirmado.** |
| "F5 (touch-action) no está implementado" | Lectura de `WaveformCanvas.tsx:224` y `Knob.tsx:124` | Ninguna clase `touch-none`. **Confirmado.** |
| "F12 (ancho unificado) no coincide" | `Timeline.tsx:124` usa `viewportWidth - 240` fijo; el contrato documentado pide `w-36 sm:w-60` | **Confirmado.** |
| "El motor arranca y renderiza" | Chrome headless real, `http://localhost:5199/` | Pantalla de inicio renderiza correctamente. **Confirmado.** |
| "El build pasa" | `npm run build` | OK. `tsc && vite build` limpio. |
| "Los tests pasan" | `npm test` | 454/454. |
| "Cifras de la doc obsoletas" | `vite.config.ts:18` dice 83.6 kB gzip; build real mide **~94.5 kB gzip** | **Confirmado.** |

## 4. Conclusión y principio de priorización

El principio rector que decido y aplico:

> **Primero una puerta de calidad que mida de verdad; después todo lo demás.**

Arreglar bugs sin un arnés de tests que los atrape es tirar aceite sobre el fuego: los 12 bugs de
motor, los 6 huecos de deshacer y los 14 de UI no tienen ninguna red. Así que el orden es:

1. **W0** — Arnés de test real (jsdom + Testing Library; navegador real vía puppeteer-core). Convierte
   los 188 tests tautológicos en tests que montan los componentes, y añade una capa de navegador.
2. **W1** — Bugs P0/P1 de motor y estado, ahora **con test que falla antes del fix**.
3. **W2** — El contrato de interacción real (F4-F8, F10-F13) implementado de verdad.
4. **W3** — A11y, responsive, rendimiento de render.
5. **W4** — Funciones nuevas: importar audio, copiar/pegar/duplicar, multi-select, CI.
6. **W5** — Seguridad y operaciones: sandbox de plugins, service worker versionado, iconos, cabeceras, docs.

## 5. Cierre del hardening — estado final de los hallazgos (2026-10-21, rama `feature/audit-hardening-2026-10`)

Verificación final (barrido de documentación, Tarea 34 — manda sobre las cifras
provisionales que hubiera más abajo):

| Comprobación | Comando | Resultado |
|---|---|---|
| Tests | `npm test -- --reporter=basic \| tail -4` | **663/663 en 57 ficheros** (unit 408 + contrato 172 + dom 83) |
| Navegador dev | `npm run test:browser` (fase `smoke.mjs`) | **9/9** |
| Navegador prod | `npm run test:browser` (fase `prodCheck.mjs`) | **11/11** (`dist/` + `_headers` real) |
| Tipos | `npx tsc --noEmit` | Limpio (`strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `noUnusedLocals` + `noUnusedParameters` + `exactOptionalPropertyTypes`) |
| Build | `npm run build` + `cat dist/assets/*.js \| gzip -c \| wc -c` | OK, JS **102 871 bytes gzip** (presupuesto < 350 kB): vendor ~45,3 kB, app ~48,5 kB, CSS ~6,5 kB + 2 modales lazy |

Hallazgo extra del programa (no estaba en la tabla: lo cazó la capa de
navegador en WP2): el transporte perdía la posición al parar (`stop()` nunca
escribía `playheadOffset` y el store forzaba `currentTime: 0`), lo que hacía del
corte con `S` en pausa un no-op silencioso → **Tarea 20**. Ruling del
controlador: el motor aparca la posición (`rewind()` nuevo) y **Stop rebobina a
0 mientras Pausa conserva** (convención DAW); cubierto por el check B4b que lee
el display real.

Nota histórica: las rutas `src/tests/e2e/` citadas en este informe son la
ubicación **anterior** a la Tarea 2; hoy es `src/tests/contract/` (renombre
honesto: nunca fue E2E). Se conservan en el texto como evidencia de la base
auditada (`aca438b`).

### 5.1 Estado final por hallazgo (ruling = libro de decisiones en `.superpowers/sdd/2026-10-21-hydradaw-hardening/progress.md`)

| ID | Estado final |
|---|---|
| SEC-01, AUD-08 | **Resuelto.** `src/audio/pluginSandbox.ts`: escáner denegar-por-defecto (toda la spec §3.7 + `constructor`/`__proto__`) + pre-ejecución en `<iframe sandbox="allow-scripts">` sin `allow-same-origin` con protocolo `postMessage` allowlisted. Sin sandbox ⇒ rechazo con toast, nunca ejecución sin protección. Tests SB1–SB7 + protocolo en `plugin_safety.test.ts`. Desviación documentada: el CSP conserva `'unsafe-eval'` porque materializar el DSP (`new Function`) lo exige; quitarlo desactivaría los plugins locales. La mitigación es el sandbox, no el CSP (ver comentario en `_headers`). **Ronda fix 1 (revisión): aislamiento real por puente de capacidades** — el código del plugin se evalúa SOLO en el iframe y nunca en el padre (`new Function` solo existe dentro de la cadena del harness); el iframe recibe un proxy con 8 factorías allowlisted y el padre crea los nodos reales devolviendo handles opacos (`connect`/`setParam`/`dispose` por el mismo canal). Escáner endurecido con palabras `eval`/`Function`/`this`. CSP **sin** `'unsafe-eval'`. Sin iframe ⇒ rechazo. Tests: SB-X1–X7 + sonda de no-ejecución, `pluginBridge.test.ts` (V1–V8, harness real en `node:vm` + replay en el padre), `sandboxBackend.test.tsx` (transporte con DOM). Definiciones de primera parte/tests por `registerPluginDefinition` (objetos vivos, nunca código). |
| SW-01 | **Resuelto.** `public/sw.js`: navegaciones network-first, `/assets/*` cache-first, `CACHE_NAME` con `__SW_VERSION__` inyectado por Vite (SHA del commit) ⇒ cada release invalida la anterior. Test de política `src/tests/swPolicy.test.ts`. |
| CFG-01 | **Resuelto.** Iconos PNG reales (`icon-192/512/512-maskable`, generados por `scripts/generate-icons.mjs` con solo `zlib`, `npm run icons` los regenera), `apple-touch-icon` + `og:image`/`twitter:card`. Test `src/tests/pwaAssets.test.ts`. |
| HDR-01 | **Resuelto.** `_headers`: CSP, HSTS, `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`. Se conservan COOP/COEP/nosniff/Permissions-Policy. |
| SEO-01 | **Resuelto.** `og:image` + `twitter:card` añadidos. El canonical sigue fijo (sin `VITE_SITE_URL`: fuera del alcance del brief). El fichero de Search Console **se eliminó** (ronda fix 1): contenía el nombre repetido, no un token real; sin token no se envía nada. |
| CFG-02 | **Resuelto.** `vite.config.ts`: `base: './'` + `build.target: 'es2020'`. **Ronda fix 1:** coherencia sub-path — registro del SW derivado de `import.meta.env.BASE_URL` (`src/main.tsx`), manifest/iconos/manifest-link relativos, precache y rutas del SW relativas al scope de registro (`registration.scope`), fallback a `./index.html`. |
| TS-01 | **Resuelto.** `exactOptionalPropertyTypes: true` activo; fallout (10 errores) corregido ajustando tipos reales (`\| undefined` en opcionales que lo admiten; omisión condicional en `SerializedClip` para que `undefined` no se cuele en el DTO). Sin `!` ni `as`. |
| Flake de la suite | **Resuelto (causa encontrada y corregida).** Bajo saturación de CPU se reprodujo un colapso del worker (`Timeout calling "onTaskUpdate"`, 10 tests perdidos, 136 s) con mecanismo identificado: tests de DSP síncrono pesado (~4.6 s medidos, 92% del timeout de 5 s por defecto). Fix: presupuestos explícitos de 60 s con margen comentado + ancla de regresión `src/tests/suiteStability.test.ts`. Verificación: 30/30 verdes post-fix (recuento de entonces 638/638; hoy 663/663 tras las capas siguientes). |

### 5.2 Tabla completa de resolución (todas las §§1–2)

**Motor (AUD)** — Tareas 5–8, 11, 19, 20:

| ID | Estado final |
|---|---|
| AUD-01 (doble `play()` solapado, +6 dB) | **Resuelto (T5).** Guarda de generación: dos `play()` solapados no duplican fuentes. |
| AUD-02 (`play()` zombi tras stop rápido) | **Resuelto (T5).** El `play()` en vuelo se cancela; stop no deja sonido huérfano. |
| AUD-03 (punch-in sella antes de `getUserMedia`) | **Resuelto (T6).** `recordingStartTime` se sella tras el permiso. |
| AUD-04 (metrónomo programa cada click 2×) | **Resuelto (T7).** Cada click se programa exactamente una vez. |
| AUD-05 (loop con `setTimeout` de pared) | **Resuelto (T8).** La iteración siguiente se pre-programa en el reloj de audio en el límite exacto (lead 0,1 s), sin solape. Ruling aceptado: gapless bajo reloj simulado; en hardware real "gapless módulo latencia", **sin medir** (no se afirma). |
| AUD-06 (`clipGain` de fades nunca liberado) | **Resuelto (T9).** Cleanup junto a la fuente, idempotente, en **todas** las vías de teardown (no solo `onended`); `dispose()` lo reclama. |
| AUD-07 (`gain` del click fugado) | **Resuelto (T9).** Clicks como `{osc, gain, done}` con suelta en stop. |
| AUD-08 (sandbox evadible) | **Resuelto (T35).** Ver fila SEC-01 en §5. |
| AUD-09 (`addClip` no resincroniza) | **Aceptado como residual menor (sin tarea asignada).** `addClip` sigue sin llamar a `syncTracks`: el punch-in para el transporte antes de añadir (sin efecto) y las acciones vecinas (`addTrack`, `updateClip`, `removeClip`, `removeTrack`) sí resincronizan; importar audio **durante la reproducción** suena tras parar/reanudar. Documentado en `PROJECT.md`. |
| AUD-10 (cadena de efectos inválida enmudece todo) | **Resuelto (T10).** `try/catch` + nodo pass-through registrado y reclamado por `dispose()` + `console.warn` con `pluginId`; `outputNode` validado. |
| AUD-11 (recreación de contexto deja `trackNodes` viejos) | **Resuelto (T11).** Se reconstruyen master **y** pistas; sin `connect` cruzado. |
| AUD-12 (NaN en utilidades) | **Resuelto (T19).** Guardas de finitud; `dbToLinear(NaN)` ⇒ 1 (unity, ruling: un NaN suelto es "sin atenuación", no "silencio"); pan NaN ⇒ ganancias de `pan = 0`. |

**Estado y persistencia (ST)** — Tareas 12–16:

| ID | Estado final |
|---|---|
| ST-01 (historial cruza proyectos) | **Resuelto (T13).** `resetHistory()` en demo/blanco/carga/import; undo con alcance por proyecto. |
| ST-02 (6 acciones sin `recordHistory`) | **Resuelto (T13).** Todas registran; `updatePluginParam` coalesce; arrastres registran por evento (trade-off explícito del brief, documentado). |
| ST-03 (snapshot solo `{tracks, clips}`) | **Resuelto con desviación documentada (T13).** El snapshot incluye transporte + mixer y se restauran al deshacer. Ruling aceptado: BPM/loop/metrónomo/volumen **no** son deshacibles por sí mismos (convención DAW), pero sí se restauran con una acción registrable. |
| ST-04 (código custom del plugin no persiste) | **Resuelto (T40).** `customJsCode`/`customWamUrl` viajan por serializar → sanear (tope 256 KiB) → restaurar, y `applySerializedProject` re-registra cada custom en el `PluginHost` por la vía segura (escáner + iframe opaco) antes de `syncTracks`; `addPluginToTrack` adjunta la fuente recordada. Sin sandbox el re-registro avisa y degrada a pass-through. |
| ST-05 (autosave sin flush) | **Resuelto (T14).** Flush en `beforeunload`/`pagehide`; `stop()` no descarta el pendiente. |
| ST-06 (`snapMode` no persiste) | **Resuelto (T14).** Persistido y validado contra la unión real de 8 valores (el brief listaba `'1/1'`, que no existe; faltaban `'1/2'` y `'triplet'` — brief defectuoso, código correcto). |
| ST-07 (atajos tras un modal) | **Resuelto (T15).** Gated por `exportModalOpen`/`pluginModalTrackId`; Escape pasa a los modales. |
| ST-08 (import sin sanear) | **Resuelto (T16).** Topes 512 pistas / 20 000 clips, parámetros saneados por plugin, ids deduplicados, selección validada, `duration` acotada. |
| ST-09 (fades no sobreviven al guardado) | **Resuelto (T40).** `SerializedClip` lleva `fadeIn`/`fadeOut` (solo finitos > 0) y `restoreClips` los devuelve al `AudioClip`; pin de round-trip en `plugin_persistence.test.ts`. |
| ST-10 (efectos dentro de updaters `set()`) | **Resuelto (T12).** Updaters puros: calcular con `get()`, `set(...)`, y el efecto después. |
| ST-11 (mutación in-place + historial de no-ops) | **Resuelto parcial (T12/T13).** El trim sin cambios no registra (guard añadido); los `c.audioBuffer = null` in-place persisten como P3 aceptado. |
| ST-12 (snapshot con selección/scroll + sin filtro `repeat`) | **Resuelto parcial.** `e.repeat` filtrado en atajos; el snapshot conserva selección/zoom (P3 aceptado, sin impacto medido). |

**UI / React / A11y (UI)** — Tareas 21–30:

| ID | Estado final |
|---|---|
| UI-01 (headers/lanes desincronizados) | **Resuelto (T22).** Scroll bidireccional con banderas anti-reentrada; test de ping-pong sensible (falla sin las banderas). |
| UI-02 (regla no sticky) | **Resuelto (T23).** `sticky top-0`, fondo opaco. |
| UI-03 (sin Pointer Events) | **Resuelto (T21).** `onPointerDown` + captura + `pointermove/up/cancel`. |
| UI-04 (knob intocable + wheel pasivo) | **Resuelto (T21).** `setPointerCapture`, `touch-action: none`, listener de rueda no pasivo. |
| UI-05 (iconos sin nombre accesible) | **Resuelto (T26).** `aria-label` en todo control sólo-icono (incluido "Añadir Pista", que faltaba). |
| UI-06 (`useDawStore()` sin selector) | **Resuelto (T27).** Los 4 subárboles usan selector. |
| UI-07 (playhead no sigue al scroll) | **Resuelto (T24).** Follow-scroll con puerta: reproduciendo + fuera de vista (40 px) + 3 s sin scroll manual. |
| UI-08 (seek sin cota superior, sin teclado) | **Resuelto (T25).** Clamp a `[0, duración]`; regla focusable con seek por teclado. |
| UI-09 (fijo 240 px, hitboxes < 44 px) | **Resuelto (T27/T28).** Headers `w-36 sm:w-60`; hitboxes ≥ 44 px (B6 cazó "Cortar clip" a 82×40 y se corrigió). |
| UI-10 (callejones sin teclado) | **Resuelto (T29).** Selección de pista, reset dB, editor exacto del knob, `listbox`/`option` correctos. |
| UI-11 (modales sin foco atrapado) | **Resuelto (T30).** Trampa de foco + fondo `inert` (B5 lo verifica). |
| UI-12 (2 bucles rAF + 2 suscripciones) | **Resuelto (T24).** Un único bucle rAF compartido que solo corre reproduciendo. |
| UI-13 (`rounded-lg`, `tabular-nums` sin usar) | **Resuelto.** Radio de clips 2–4 px; `tabular-nums` en uso (ChannelStrip, MixerConsole). |
| UI-14 (animaciones sin `reduced-motion`) | **Resuelto.** `motion-safe:` en spins/pulses/pings. |

**Build, seguridad, docs, tests (CFG)** — Tareas 2, 4, 34–38:

| ID | Estado final |
|---|---|
| DOC-01 (suite "E2E" en Node) | **Resuelto (T2 + T34).** 16 tautologías eliminadas; capa renombrada a `contract`; este barrido reescribe las 5 docs con cifras medidas. |
| TEST-01 (~15 tautologías) | **Resuelto (T2).** Fueron 16; base 438. |
| SEC-02 (import sin presupuesto) | **Resuelto (T16).** Límites de tamaño, cota de arrays, `duration` acotada. |
| CFG-01 (icono SVG `data:` maskable) | **Resuelto (T36).** PNG reales 192/512/512-maskable + `apple-touch-icon` + `og:image`; test `pwaAssets`. |
| OPS-01 (sin CI) | **Resuelto (T4).** `.github/workflows/ci.yml` (unit + tsc + build + navegador). |
| HDR-01 (sin CSP/HSTS/…) | **Resuelto (T36).** CSP (documento sin `'unsafe-eval'`, sandbox con la suya), HSTS, `DENY` + `frame-ancestors 'none'`, `no-referrer`. |
| SEO-01 (sin og:, canonical fijo, placeholder) | **Resuelto parcial (T36).** `og:image` + `twitter:card`; placeholder de Search Console **eliminado** (era el nombre repetido, no un token); canonical fijo fuera de alcance (sin `VITE_SITE_URL`). |
| CFG-02 (`base` sin fijar) | **Resuelto (T36).** `base: './'` + `target: es2020` + rutas desde `import.meta.env.BASE_URL` + SW relativo al scope. |
| TS-01 (sin `exactOptionalPropertyTypes`) | **Resuelto (T37).** Activo; fallout corregido con tipos reales, sin `!` ni `as`. |

**Exportación/DSP (EXP)** — Tareas 17–19, 40: ver `02-export-dsp.md` (todo resuelto; AAC-06 completado en T40 con rechazo explícito de 7 canales).

**Huecos funcionales (G)**:

| ID | Estado final |
|---|---|
| G1 (importar solo por DnD) | **Resuelto (T31).** Botón en el header + `importAudioFiles` (un snapshot; resuelve pista por archivo). |
| G2 (sin portapapeles) | **Resuelto (T31).** Copiar/pegar/duplicar, deshacible, ids monotónicos. |
| G3 (sin automatización) | **Roadmap aceptado.** No existe; declarado en `PROJECT.md`. |
| G4 (sin MIDI) | **Roadmap aceptado.** `grep -ri midi` ⇒ 0 en producto; declarado. |
| G5 (sin multi-selección) | **Resuelto (T32).** `selectedClipIds`; split/borrado sobre la selección; modos single/toggle/range preservando `pointer capture`. |
| G6 (sin CI) | **Resuelto (T4).** Ver OPS-01. |
| G7 (sin remuestreo/elasticidad) | **Roadmap aceptado.** Declarado en `PROJECT.md`. |
| G8 (sin MP3) | **Roadmap aceptado.** WAV + AAC cubren el caso; declarado. |

Rulings transversales del controlador que estos estados aplican: jsdom 25.x
(Node 20 es restricción, no preferencia); Stop rebobina / Pausa conserva
(corrección de un ruling previo incompleto); el loop se pre-programa de verdad;
el follow-scroll no pelea con el usuario; strips anchos incondicionales;
`splitSelectedClips` en un snapshot con ambas mitades seleccionadas;
aislamiento por puente RPC (el padre nunca evalúa); placeholder de Search
Console borrado, no sustituido; `BASE_URL` para sub-path; `dbToLinear(NaN)` =
unity; transporte no-deshacible pero restaurado.
