# HydraDAW — Hardening & Features: documento de diseño

> **Estado:** aprobado por el usuario sin preguntas (modo autónomo: "no preguntes, toma las decisiones").
> **Fecha:** 2026-10-21 · **Rama:** `feature/audit-hardening-2026-10` · **Base:** `aca438b`
> **Auditoría de origen:** `docs/auditoria/01-informe-auditoria.md`

---

## 1. Intención y por qué

HydraDAW es un DAW multitrack 100 % local en el navegador. La auditoría
(`docs/auditoria/01-informe-auditoria.md`) concluye que el **código está sano pero la red de
seguridad es ficticia**: 188 de los 454 tests ("E2E tiers 1-4") son tautologías sobre objetos
falsos que no montan ni un componente, y una quincena de features documentadas como terminadas
(F4-F17) sencillamente no están implementadas.

El objetivo de este trabajo no es "añadir features后市". Es **devolver la confianza al proceso**:
que exista un test que falle cuando el producto se rompe, y que las features que el producto
promete existan de verdad.

### Metas

1. **Una puerta de calidad que mida de verdad**: tests que montan componentes y verifican el DOM,
   y una capa de navegador real.
2. **Cero bugs P0/P1** en motor de audio, estado, persistencia, exportación e interacción.
3. **El contrato documentado implementado**: F4-F17 de `PROJECT.md` deja de ser fiction.
4. **Funciones esenciales que faltan**: importar audio sin arrastrar, copiar/pegar/duplicar,
   multi-selección.
5. **Seguridad y operaciones en pie**: sandbox de plugins real, service worker versionado, CI.

### No-metas (explícitamente fuera de alcance)

- **MIDI** (G4): exige un modelo de entrada/salida y un layout de piano que no existen. No es un
  bug, es un proyecto. Se documenta como roadmap.
- **Automatización de parámetros** (G3): requiere un modelo de datos nuevo (curvas, lanes,
  persistencia) y un editor gráfico. Se documenta como roadmap.
- **MP3** (G8): WebCodecs no codifica MP3 y meter una dependencia `lamejs` (WASM, ~300 kB) para
  una mejora marginal sobre AAC no compensa. Se documenta como roadmap.
- **Elasticidad de tempo / remuestreo** (G7): requiere un motor de time-stretch. Fuera de alcance.
- **Migración de majors** (React 19, Vite 7, Vitest 3): salto de riesgo alto sin beneficio para
  este producto. La postura es fijar Node 20 y el lockfile actual.
- **WAM 2.0 / WebCLAP / AudioWorklet**: fuera de alcance; se mantiene el registro de plugins
  custom JS, endurecido.

### Anti-objetivos (lo que sería un fracaso)

- "Tests verdes" sin que los testsfallen cuando el producto se rompe. **Prohibido.**
- Añadir features nuevas mientras las documentadas siguen sin existir.
- Romper la promesa central: **100 % local, sin backend, sin credenciales**.

---

## 2. Restricciones

| Restricción | Valor exacto |
|---|---|
| Node | `20` (`.nvmrc` existente) |
| TypeScript | `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch` (todo ya activo; se añade `exactOptionalPropertyTypes`) |
| Gestor de estado | Zustand 4.5, **sin** Redux/MobX/Jotai nuevos |
| Build | Vite 5.4, `tsc && vite build` debe seguir siendo la puerta de compilación |
| Bundle | JS total < 350 kB gzip (medido actual: ~94.5 kB gzip ⇒ margen 3.7×) |
| Dependencias runtime | **Cero nuevas.** Todo lo nuevo es devDependency |
| Sin red | Ninguna llamada de red en el producto; el service worker es sólo caché local |
| Sin secretos | Ningún token, clave ni credencial en el repo |
| Accesibilidad | Objetivo táctil ≥ 44×44 px; contraste ≥ 4.5:1; `focus-visible` en todo control |
| Copy del producto | Español (UI y mensajes al usuario). Los identificadores de código, en inglés |

---

## 3. Decisiones de diseño (las que tomo)

### 3.1 Arnés de test real

**Decisión:** dos capas nuevas, y una honestización de la existente.

| Capa | Ubicación | Entorno | Qué verifica |
|---|---|---|---|
| `unit` | `src/**/*.test.ts` (existente) | node | Lógica pura, motor con contexto simulado. **Sin cambios.** |
| `contract` | `src/tests/contract/` (renombrado desde `src/tests/e2e/`) | node | Igual que hoy, **pero renombrado y documentado como lo que es**: tests de contrato opacos sin DOM. Se elimina la afirmación de "E2E". |
| `dom` | `src/tests/dom/` | jsdom | **NUEVO.** Monta componentes React reales con Testing Library y verifica DOM, atributos, estilos computados y eventos. |
| `browser` | `tests/browser/` | Chrome real | **NUEVO.** Puppeteer-core contra el dev server. Verifica lo que sólo el navegador real puede: canvas, estilos computados, layout responsive, `touch-action`, punteros, errores de consola. |

**Por qué renombrar en vez de dejar "e2e":** el nombre es la primera mentira. Un directorio
llamado `e2e` que no abre un navegador hace que cualquier lector futuro (humano o agente) asuma
una cobertura que no existe. Renombrar cuesta 6 `git mv` y un ajuste de imports; no renombrar
cuesta la confianza del proyecto.

**Por qué `puppeteer-core` y no Playwright:** Playwright descarga ~400 MB de navegadores.
`puppeteer-core` no descarga nada y usa el Chrome del sistema, que GitHub Actions ya trae
preinstalado (`ubuntu-latest` ⇒ `google-chrome-stable`). Mantiene el repo ligero.

**Por qué jsdom además del navegador real:** jsdom da ciclo de test rápido y determinista para
lógica de render (atributos, roles, teclado). El navegador real da la verdad final (canvas,
`touch-action`, layout). Ambos son necesarios: uno solo deja huecos.

**Ficheros nuevos:**

| Fichero | Responsabilidad |
|---|---|
| `src/tests/dom/setup.ts` | Stubs de DOM: `PointerEvent`, `HTMLCanvasElement.getContext` (2D no-op), `AudioContext`, `matchMedia`. Instalado como `setupFiles` global, **guardado por `typeof document !== 'undefined'`** para no tocar la capa node. |
| `src/tests/dom/*.test.tsx` | Tests de componente reales. |
| `tests/browser/harness.mjs` | Lanzador de Chrome: helper `withPage(fn)`, captura de errores de consola y `pageerror`, reuso de instancia. |
| `tests/browser/smoke.mjs` | Suite de humo: arranque, demo, play/stop, split, modal de export, layout a 320 px, `touch-action` computado. |
| `tests/browser/package.json` | Declara el script `test:browser`. |

**Scripts `package.json`:**

```json
"test": "vitest run",
"test:dom": "vitest run src/tests/dom",
"test:browser": "node tests/browser/smoke.mjs",
"test:all": "npm test && npm run test:browser"
```

**Scripts de Chrome:** `puppeteer-core` acepta `executablePath`. Se resuelve por orden:
`PUPPETEER_EXECUTABLE_PATH` → `/usr/bin/google-chrome-stable` → `/usr/bin/chromium` →
`/usr/bin/chromium-browser`. Si no hay ninguno, el script **falla con un mensaje claro** (no se
salta en silencio: un E2E que se autoexcluye es otro test ficticio).

### 3.2 Corrección del motor de audio

**AUD-01/AUD-02 — token de generación.** `AudioEngine` gana un contador privado:

```ts
private playGen = 0;
```

`play()` hace `const gen = ++this.playGen;` al entrar y **comprueba `gen !== this.playGen` después
de cada `await`** (antes de `isPlaying = true` y antes de `scheduleClipsRange`). `stop()` y
`seek()` hacen `this.playGen++` para invalidar cualquier vuelo en curso. Esto mata a la vez el
doble audio (AUD-01) y el zombi post-stop (AUD-02).

**AUD-03 — sello de la toma.** `recordingStartTime` se sella **después** de resolver
`getUserMedia()` y **después** de `mediaRecorder.start()`, con `this.getCurrentTime()` de ese
momento.

**AUD-04 — metrónomo sin solapes.** Se sustituye la ventana `[now, now+2)` por una marca de agua
`metroScheduledUntil` (tiempo de línea de tiempo). Cada disparo programa
`[max(now, metroScheduledUntil), now + 2)` y adelanta la marca. Ningún click se programa dos veces.

**AUD-05 — loop en el reloj de audio.** El wrap deja de depender de `setTimeout` de reloj de pared.
Se sustituye por un **intervalo de 25 ms que compara `ctx.currentTime` con `loopEnd`** y programa
la siguiente iteración con antelación suficiente para que no haya hueco. Cuando el temporizador
se dispara tarde, la siguiente iteración se programa en `ctx.currentTime + 0.02` (rellena el hueco)
en vez de dejar el hueco.

**AUD-06/AUD-07 — fugas de nodos.** `TrackNode.addActiveSource` acepta un `cleanup?: () => void`
opcional que se invoca en `onended`; el `clipGain` de los fades se desconecta ahí. El `gain` de
cada click de metrónomo se desconecta en `osc.onended`.

**AUD-10 — un plugin roto no rompe el transporte.** `PluginHost.createInstanceNode` valida la
forma del nodo devuelto (`inputNode.connect` y `outputNode` presentes) y devuelve un
*pass-through* (un `GainNode` de ganancia 1) si la validación falla. `TrackNode.rebuildEffectsChain`
envuelve cada paso en `try/catch` y sustituye por *pass-through* ante excepción.

**AUD-11 — recreación de contexto.** `ensureContext()` que reemplaza el contexto **descarta los
`trackNodes`** (disconnect + `Map` vacío + `trackEffectsSig` reseteado) para que `syncTracks` los
reconstruya sobre el contexto nuevo.

**AUD-09 — `addClip` durante la reproducción.** Tras el `set`, si `isPlaying`, se re-planifica con
`audioEngine.play(tracks, clips, audioEngine.getCurrentTime())` — **fuera** del updater.

### 3.3 Corrección del estado

**ST-10 — updaters puros.** Regla que se aplica a **todo** `useDawStore.ts`: ningún updater de
`set()` tiene efectos. Patrón canónico:

```ts
updateTrack: (id, updates) => {
  const updated = get().tracks.map((t) => (t.id === id ? { ...t, ...updates } : t));
  set({ tracks: updated });
  audioEngine.syncTracks(updated);
}
```

**ST-01 — el historial no cruza proyectos.** `loadDemoProject`, `createBlankProject` y
`applySerializedProject` llaman `resetHistory()`.

**ST-02 — todos los cambios son deshacibles.** Las 6 acciones que no registraban historial
(`updateTrack`, `updateClip`, `addPluginToTrack`, `removePluginFromTrack`, `togglePlugin`,
`updatePluginParam`) pasan a registrarlo. **Excepción deliberada:** `updatePluginParam` durante un
arrastre de knob genera decenas de cambios por segundo; se **coalescen** con un umbral de 400 ms
(y se fuerza un snapshot al soltar el puntero) para no agotar la pila de 30 con un solo gesto.

**ST-03 — el historial restaura el estado completo.** `HistorySnapshot` pasa a:

```ts
interface HistorySnapshot {
  tracks: AudioTrack[];
  clips: AudioClip[];
  bpm: number;
  timeSignature: [number, number];
  loopStart: number;
  loopEnd: number;
  isLooping: boolean;
  metronome: boolean;
  masterVolume: number;
  masterMute: boolean;
  projectName: string;
  snapMode: SnapMode;
  selectedTrackId: string | null;
  selectedClipId: string | null;
}
```

`undo`/`redo` restauran todos esos campos **y los reinyectan en el engine**
(`setTempo`, `setLoop`, `setTimeSignature`, `setMetronome`, master bus `setVolume`/`setMute`).

**ST-05 — el autosave no pierde el último cambio.** `startAutosave()` registra `beforeunload` y
`pagehide` → `saveProjectNow()`. El `stop()` devuelto **vuelca** el timer pendiente en vez de
descartarlo.

**ST-06 — `snapMode` se persiste.** Se añade a `PersistableProjectState`, `SerializedProject`,
`serializeProject`, `buildProjectFromRaw` (con validación contra la lista de `SnapMode`),
`applySerializedProject` y `selectAutosaveSnapshot`.

**ST-07 — los atajos no disparan con un modal abierto.** `handleGlobalKeyDown` lee
`useDawStore.getState()` y hace early-return si `exportModalOpen` o `pluginModalTrackId` están
activos. `Escape` sigue permitiéndose.

**ST-08/SEC-02 — importación hostil blindada.** Presupuesto de importación: `file.size > 25 MB`
⇒ rechazo con toast; `tracks.length > 512` o `clips.length > 20000` ⇒ truncado con aviso; cada
parámetro de plugin se valida con `Number.isFinite` contra la definición del builtin; los ids se
deduplican; `selectedTrackId`/`selectedClipId` se validan contra los ids restaurados (a `null` si
son colgantes); `duration` se acota a `[1, 86400]`.

**ST-11 — trim no-op sin historial.** `trimClip` compara el resultado con el original y **no
registra historial** si no cambió nada.

**ST-12 — autosave sin ruido.** El snapshot de autosave excluye `zoom`, `scrollLeft`,
`activeView` y la selección (no son cambios de proyecto). Los atajos filtran `e.repeat`.

### 3.4 Contrato de interacción (la parte que nunca existió)

**UI-03 — pointer events en los clips.** `WaveformCanvas` pasa de `onMouseDown` + listeners
`window` a `onPointerDown` + `setPointerCapture` + `pointermove`/`pointerup`/`pointercancel` sobre
el propio elemento. La raíz del clip lleva `touch-none` (`touch-action: none`). El trim se decide
por zona dinámica:

```ts
const edge = isTouch ? Math.min(20, width * 0.28) : Math.min(8, width * 0.2);
```

`isTouch` se deduce de `e.pointerType !== 'mouse'`. La captura es defensiva
(`if (el.setPointerCapture) el.setPointerCapture(e.pointerId)`).

**UI-04 — knob.** `setPointerCapture` en `pointerdown`, `releasePointerCapture` en `pointerup`/
`pointercancel`, `touch-none` en el dial, y la rueda pasa a un listener **nativo no pasivo**
(`addEventListener('wheel', h, { passive: false })` en un `useEffect` con ref) para que
`preventDefault()` funcione de verdad.

**UI-01 — scroll vertical sincronizado.** `Timeline` añade refs a los dos contenedores
(headers y lanes) y un `onScroll` en cada uno con banderas de reentrada
(`isSyncingFromHeaders` / `isSyncingFromLanes`) y umbral de subpíxel (`> 0.5`), tal y como
especifica el contrato de `PROJECT.md`.

**UI-02 — regla sticky.** La `Ruler` recibe `sticky top-0 z-20` y fondo opaco.

**UI-08 — seek acotado y por teclado.** `handleSeek` acota a `[0, duration]`. La regla recibe
`role="slider"`, `tabIndex={0}`, `aria-valuemin/max/now` y flechas ←/→ (mover 1 s), `Home`/`End`.

**UI-07 — el playhead sigue al scroll.** El bucle de playhead consulta `scrollContainerRef` y
hace `scrollBy` cuando el playhead se acerca al borde (con un flag `followPlayhead`).

**UI-12 — un solo bucle.** Se extrae un hook `usePlayheadSync()` compartido por `Timeline` y
`Ruler`: **una** suscripción `onTimeUpdate` + **un** `requestAnimationFrame`, no dos de cada.

### 3.5 Accesibilidad y responsive

- **UI-05**: todo botón sólo-icono recibe `aria-label` explícito ("Detener", "Reproducir",
  "Grabar", "Bucle", "Silenciar master", "Acercar zoom", "Alejar zoom", "Eliminar pista",
  "Añadir efecto").
- **UI-06**: se sustituye `useDawStore()` sin selector por selectores granulares
  (`useDawStore(s => s.tracks)`) y `useShallow` de `zustand/react/shallow` donde haga falta más de
  un campo.
- **UI-09**: los headers de pista pasan a `w-36 sm:w-60` (144/240 px) y la fórmula del ancho de
  lanes pasa a calcularse desde el ancho real del contenedor de headers (no una constante `240`),
  de modo que el breakpoint no pueda desincronizarse. Los controles táctiles pasan a 44×44 px
  (zoom, M/S/R, stop/loop/play, añadir efecto, borrar pista). Los handles de trim se muestran
  siempre en punteros gruesos (`pointer-coarse:opacity-100`).
- **UI-10**: `TrackHeader` seleccionable con teclado (`tabIndex`, `role="button"`, Enter/Espacio);
  el readout dB del `ChannelStrip` pasa a `<button>` (reset a 0 dB); el valor del knob pasa a
  `<button>` (editor de valor exacto); el lane de clips recibe `role="listbox"`.
- **UI-11**: foco atrapado en los dos modales (handler de `Tab` que cicla dentro del panel) y
  `aria-hidden` + `inert` en el fondo mientras están abiertos.
- **UI-13**: clips con esquinas de 3 px (spec: 2-4 px) y `tabular-nums` en todos los valores
  numéricos (tiempos, dB, knobs, BPM).
- **UI-14**: `prefers-reduced-motion` respetado: las animaciones infinitas pasan a
  `motion-safe:` y se añade una regla global en `index.css`.

### 3.6 Funciones nuevas

**G1 — Importar audio (botón).** `Header` gana un botón "Importar audio" con `<input type="file"
accept="audio/*" multiple>`. Al elegir, por cada archivo: decodifica con
`decodeAudioFile(file, ctx)`, genera picos, elige pista destino (la seleccionada si existe, si no
crea una nueva), calcula `startTime` con `calculateMagneticSnap` a partir de la posición del
playhead, y añade el clip con `addClip`. Errores por archivo ⇒ toast individual; los archivos
válidos se importan igual. Comportamiento idéntico al *drag & drop* existente
(`Timeline.handleDrop`), **extraído a una función compartida** `importAudioFiles(files, options)`
en `src/audio/importAudio.ts` para que no haya dos implementaciones que divergir.

**G2 — Copiar/pegar/duplicar.** Nuevas acciones de store: `copyClips(clipIds)` (a un portapapeles
interno, en el mismo store), `pasteClips(atTime?)` y `duplicateSelectedClips()`. Los atajos:
`Ctrl/Cmd+C`, `Ctrl/Cmd+V`, `Ctrl/Cmd+D`, `Ctrl/Cmd+X` (cortar). El portapapeles **interno** (no
el del sistema) porque los clips llevan referencias a `AudioBuffer` que el portapapeles del
navegador no puede transportar; el portapapeles del sistema se usa sólo para texto. Un "pegar"
pega los clips con **ids nuevos** y conserva `audioBuffer` y `peaks` (referencia compartida: no
duplica PCM en memoria).

**G5 — Multi-selección.** `selectedClipIds: string[]` **reemplaza** a `selectedClipId` (se
elimina el campo antiguo, no conviven). Click normal ⇒ selección única; `Shift+click` ⇒ rango
(por orden temporal y de pista); `Ctrl/Cmd+click` ⇒ toggle. `Delete` borra toda la selección.
`Esc` limpia la selección. El store expone `selectClip(id, mode: 'single' | 'toggle' | 'range')`.

**G6 — CI.** `.github/workflows/ci.yml`: job `unit` (Node 20, `npm ci`, `npm test`, `npm run
build`) y job `browser` (Chrome preinstalado en `ubuntu-latest`, `npm run test:browser`).

### 3.7 Seguridad y operaciones

**SEC-01 — sandbox de plugins endurecido.** Dos capas:
1. **Denegar por defecto**: la lista de prohibiciones pasa a cubrir `globalThis`, `self`, `top`,
   `parent`, `location`, `navigator`, `history`, `Worker`, `SharedWorker`, `WebAssembly`,
   `importScripts`, `postMessage`, `indexedDB`, `caches`, `cookieStore`, `document`, `window`,
   `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `eval`, `Function`,
   `constructor`, `prototype`, `__proto__`. Además se rechaza cualquier cadena que contenga
   `constructor` o `__proto__`.
2. **Aislamiento real**: el código del plugin se evalúa en un **`<iframe sandbox="allow-scripts">`
   sin `allow-same-origin`** (origen opaco ⇒ sin `localStorage`, sin IndexedDB, sin acceso al DOM
   del padre, sin `window.parent`). La comunicación es por `postMessage` con un protocolo
   allowlisted. Si el sandbox no está disponible, **el import de plugins custom se rechaza con un
   toast** en vez de ejecutarse sin protección.

Esta es la única solución que realmente cierra el agujero: un shadowing de nombres nunca es
una frontera de seguridad, y el código ya tenía un comentario prometiendo sandbox.

**SW-01 — service worker versionado.** `public/sw.js` deja de usar `stale-while-revalidate` para
el shell. Política nueva:
- **Navegaciones** (`/` y `/index.html`): **network-first** con respaldo a caché ⇒ el usuario
  siempre recibe el `index.html` actual; si no hay red, se sirve el cacheado.
- **Assets con hash** (`/assets/*`): **cache-first** (son inmutables por diseño).
- **Versión de caché derivada del build**: Vite inyecta `__SW_VERSION__` (hash del build) vía
  `define`, y el SW lo usa en `CACHE_NAME` ⇒ cada build invalida la caché anterior. El `activate`
  borra las cachés antiguas (ya lo hacía, pero ahora la versión sí cambia).
- **Precache del shell**: `index.html` + los assets del manifiesto, generado en build.

**CFG-01 — PWA instalable.** Se generan `public/icons/icon-192.png`, `icon-512.png` e
`icon-512-maskable.png` (PNG reales, con zona segura), se referencian en el manifest, y se añade
`apple-touch-icon` + `og:image` en `index.html`.

**HDR-01 — cabeceras.** Se añaden `Content-Security-Policy` (tras sanear el sandbox de plugins,
`unsafe-eval` deja de ser necesario), `Strict-Transport-Security`, `X-Frame-Options: DENY` +
`frame-ancestors 'none'`, `Referrer-Policy: no-referrer`.

**SEO-01 — meta.** `og:image` + `twitter:card`, `apple-touch-icon`, canonical parametrizable por
`VITE_SITE_URL` con fallback al actual, y el fichero de Search Console: se **elimina** el
placeholder si no hay token real (no se puede inventar un token).

**CFG-02 — `base`.** `base: './'` para que el build funcione también en sub-path. Se documenta la
implicación para el service worker (las rutas del SW son relativas a su scope, no a `base`).

**TS-01 — `exactOptionalPropertyTypes`.** Se activa y se corrige el fallout.

### 3.8 Corrección de exportación

**EXP-01 — el master manda en la exportación.** `OfflineRenderOptions` gana `masterVolume` y
`masterMute`; `renderOffline` los aplica al `MasterBus`; `ExportModal` los lee del store y los
pasa. Un master a −20 dB debe producir un archivo a −20 dB.

**EXP-03 — exportar sin congelar la pestaña.** `ExportModal` usa `encodeWavAsync` (por bloques,
con cesión al event loop) en vez del `encodeWav` síncrono, y **muestra el progreso** en el pie del
modal (ya existe el estado `isExporting`).

**EXP-05 — padding de palabra RIFF.** Si `dataSize` es impar (24 bits mono con nº impar de
frames), se añade un byte de padding: `bufferSize = 45 + dataSize`, RIFF size = `37 + dataSize`.

**EXP-11 — opción de 32 bits float.** El selector de profundidad pasa a `16 | 24 | 32` (float),
que el encoder ya soporta y los tests ya verifican.

**EXP-02 — LUFS conforme a BS.1770-4.** Se sustituye el *high-shelf* RBJ por los coeficientes
exactos de la Tabla 1 de BS.1770-4 a 48 kHz, derivados por transformada bilineal del mismo
prototipo analógico para otras tasas (como hace libebur128). El test de referencia se actualiza
al valor conforme (±0.1 LU) con un tono de 997 Hz a escala completa.

**EXP-04 — tope de exportación.** Duración máxima exportable con aviso al usuario, y
`computeExportDuration` acotado.

**DSP-07/08/09/10 — guarding numérico.** `generateWaveformPeaks` comprueba `targetPoints` **antes**
de asignar; `audioMath` rechaza no-finitos en `dbToLinear`, `secondsToSamples`,
`calculatePeakAndRMS` (los NaN se saltan, no envenenan) y en las leyes de pan; `timelineOps`
rechaza `NaN` en split y trim.

**AAC-06 — 8 canales ADTS.** `channel_config` para 8 canales pasa a 7 (ISO 14496-3 Tabla 1.42) o
se rechaza `ch > 7`.

**EXP-12 — loudness de entradas cortas.** Se rellena con ceros hasta el bloque de 400 ms según
BS.1770.

### 3.9 Documentación

Se reescriben `PROJECT.md` (tabla de milestones real: qué está implementado, qué no, qué es
roadmap), `HANDOFF.md` (un solo bloque de estado, cifras medidas), `TEST_INFRA.md` y `TEST_READY.md`
(nombres reales de las capas, qué cubre cada una y qué **no** cubre), y `README.md` (capacidades
reales: sin WAM, con AAC, con import de audio).

**Regla:** ninguna cifra en la documentación sin el comando que la produce al lado.

---

## 4. Restricciones de revisión (qué debe mirarse con lupa)

Estas son las condiciones que la especificación implica y que ningún test cubre hoy. Cada una
acaba en el test de la tarea que posee ese código.

1. **Importar un WAV de 3 minutos y exportarlo** ⇒ el archivo exportado debe sonar como lo que se
   oía, con el mismo volumen master, sin recorte y sin congelar la pestaña.
2. **Arrastrar un clip con el dedo en un tablet** ⇒ el clip se mueve, la página no hace scroll, y
   un dedo junto al borde recorta en vez de mover.
3. **Con el modal de exportación abierto, pulsar Suprimir** ⇒ **no** se borra ningún clip.
4. **Abrir un proyecto, crear otro en blanco y pulsar Ctrl+Z** ⇒ **no** aparece nada del proyecto
   anterior.
5. **Arrastrar un knob, pulsar Ctrl+Z** ⇒ el valor del knob vuelve al anterior.
6. **Cerrar la pestaña 1 segundo después de editar** ⇒ el cambio está guardado al volver.
7. **Reproducir y mover un clip durante la reproducción** ⇒ se oye **una sola** copia, sin picos de
   ganancia, y el clip se mueve sin huecos.
8. **Poner el metrónomo y dejar sonar 10 segundos** ⇒ el clic no se duplica en los solapes.
9. **Importar un `.json` hostil** con 100 000 clips, `duration: 1e18` y `__proto__` ⇒ la app no se
   cuelga, no rompe y avisa.
10. **Cargar un plugin custom que intente `globalThis.fetch`** ⇒ se rechaza con un mensaje claro
    y **no** se ejecuta.

---

## 5. Lo que queda para el constructor

Nada. Este documento especifica decisiones de diseño, no pasos de implementación; los pasos están
en `docs/superpowers/plans/2026-10-21-hydradaw-hardening.md`.
