# Proyecto: HydraDAW

> Estado real a 2026-10-21, rama `feature/audit-hardening-2026-10`.
> Toda cifra de este documento es reproducible con el comando que la acompaña.
> Regla del proyecto: **ninguna cifra sin su comando**.

## Cifras verificadas (línea de cierre del hardening)

| Comprobación | Comando | Resultado |
|---|---|---|
| Tests | `npm test -- --reporter=basic \| tail -4` | **689/689 en 62 ficheros** (unit 431 + contrato 172 + dom 86) |
| Navegador (dev) | `npm run test:browser` (fase 1) | **9/9** en Chromium real |
| Navegador (prod) | `npm run test:browser` (fase 2) | **12/12** contra `dist/` con el `_headers` real |
| Tipos | `npx tsc --noEmit` | Limpio (`strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `noUnusedLocals` + `noUnusedParameters` + `exactOptionalPropertyTypes`) |
| Build | `npm run build` | OK (`tsc && vite build`) |
| Bundle JS | `npm run build` + `cat dist/assets/*.js \| gzip -c \| wc -c` | **104 030 bytes gzip (~101,6 KiB)**, presupuesto < 350 kB |

Desglose del build medido (`npm run build`): vendor 45,20 kB gzip +
app 49,37 kB gzip + CSS 6,54 kB gzip + modales lazy
(ExportModal 6,79 kB, PluginRackModal 3,92 kB, `useModalFocus` 0,71 kB).

## Arquitectura

HydraDAW es un DAW multitrack 100 % cliente en el navegador (Web Audio API, sin
servidor): React 18.3 + TypeScript 5.7 (estricto) + Zustand 4.5 + Tailwind 3.4 +
Vite 5.4 + Vitest 2.1. CI en `.github/workflows/ci.yml` (unit + tipos + build,
y fase de navegador).

- **Presentación (`src/components/`)**:
  - `Header/Header.tsx`: marca, nombre de proyecto, selector de vista, acciones
    (nueva pista, **importar audio** con `<input type="file" accept="audio/*">`).
  - `Timeline/`: `Timeline.tsx`, `TrackHeader.tsx`, `WaveformCanvas.tsx`, `Ruler.tsx`.
  - `Mixer/`: `MixerConsole.tsx`, `ChannelStrip.tsx`, `VUMeter.tsx`.
  - `Transport/TransportBar.tsx`: play/pausa, stop (rebobina a 0), grabar, loop,
    tempo, metrónomo, medidor master, volumen master.
  - `Plugins/`: `PluginRackModal.tsx`, `Knob.tsx`.
  - `Export/ExportModal.tsx`: exportación WAV 16/24/32-bit y AAC, async con progreso.
  - `Start/StartScreen.tsx`, `Toast/Toaster.tsx`.
- **Estado (`src/store/`)**: `useDawStore.ts` (updaters puros + efectos fuera del
  `set()`), historial con alcance por proyecto, portapapeles, `selectedClipIds`;
  `persistence.ts` (IndexedDB vía `idb-keyval`, autosave con flush en
  `beforeunload`/`pagehide`, importación presupuestada y saneada).
- **Audio (`src/audio/`)**: `AudioEngine.ts` (play con generación, punch-in,
  metrónomo sin doble click, loop pre-programado sin hueco bajo reloj simulado
  (sin medir en hardware real), fugas cerradas),
  `MasterBus.ts`, `TrackNode.ts`, `pluginSandbox.ts` (puente de capacidades hacia
  `<iframe sandbox>` opaco), `WavExporter.ts` / `aacExporter.ts`, `loudness.ts`
  (BS.1770-4), `importAudio.ts`.
- **Tests en 4 capas** (ver `TEST_INFRA.md`): `unit` (node),
  `contract` (`src/tests/contract/`, opaco sin DOM — el antiguo "e2e",
  renombrado con honestidad en la Tarea 2), `dom` (`src/tests/dom/`, jsdom +
  Testing Library), `browser` (`tests/browser/`, Chromium real en fase dev y
  fase producción).

---

## Inventario de features (estado real)

| # | Feature | Estado real |
|---|---|---|
| F1 | Arranque de audio resiliente + toast | **Implementado** |
| F2 | Fallback de contexto AudioEngine | **Implementado** |
| F3 | Arranque seguro demo/blanco | **Implementado** |
| F4 | Pointer Events en WaveformCanvas | **Implementado** (`onPointerDown`, `setPointerCapture`, `pointermove/up/cancel`) |
| F5 | `touch-action: none` en superficies interactivas | **Implementado** (WaveformCanvas + Knob, verificado por estilo computado en B7) |
| F6 | Zonas de trim táctiles dinámicas | **Implementado** (20 px táctil / 8 px ratón, asas visibles) |
| F7 | Captura de puntero en el knob + rueda no pasiva | **Implementado** |
| F8 | Hitboxes ≥ 44×44 px | **Implementado** (incluido "Cortar clip", que medía 82×40 y lo cazó B6) |
| F9 | Botón accesible de borrar clip | **Implementado** |
| F10 | Sincronización vertical headers ↔ lanes | **Implementado** (con banderas anti-reentrada) |
| F11 | Regla sticky | **Implementado** (`sticky top-0`, fondo opaco) |
| F12 | Ancho horizontal unificado regla/lanes | **Implementado** |
| F13 | Seek acotado + navegable por teclado | **Implementado** (clamp a `[0, duración]`, regla focusable) |
| F14 | Headers adaptativos / usable a 320 px | **Implementado** (`w-36 sm:w-60`) |
| F15 | Toolbar flotante responsive | **Implementado** |
| F16 | Header responsive | **Implementado** |
| F17 | Retención de controles esenciales de transporte | **Implementado** (metrónomo + VU siempre visibles) |
| F18 | Suite de tests por capas | **Implementado** (unit + contract + dom + browser; la etiqueta "E2E" se retiró por deshonesta) |
| F19 | Puerta de calidad + adversarial | **Implementado** (9/9 + 12/12; 4 payloads maliciosos rechazados, cero ejecución) |
| F20 | Importar audio desde el header | **Implementado** (`importAudioFiles`, sin depender de drag-and-drop) |
| F21 | Portapapeles de clips (copiar/pegar/duplicar) | **Implementado** (deshacíble, con ids monotónicos únicos) |
| F22 | Multi-selección de clips | **Implementado** (`selectedClipIds`; `S` corta todos los seleccionados bajo el playhead, `Delete` los borra) |
| F23 | Sandbox de plugins por puente de capacidades | **Implementado** (código solo en iframe opaco, proxy allowlisted, CSP principal sin `'unsafe-eval'`) |
| F24 | SW versionado + CI | **Implementado** (network-first en navegaciones, versión por SHA, `.github/workflows/ci.yml`) |

Correcciones P0/P1 verificadas: el undo ya no cruza proyectos y restaura
transporte + mixer; el stop conserva la posición aparcada y el botón Stop
rebobina a 0 (pausa conserva); master fader/mute afectan a la exportación;
loudness conforme a ITU-R BS.1770-4; sin doble audio en `play()` solapados ni
zombis tras stop; metrónomo sin doble click; loop sin hueco bajo reloj
simulado (sin medir en hardware real); sin fugas de nodos;
un plugin roto no enmudece la app; los atajos no disparan tras un modal; el
autosave no pierde el último cambio; importación presupuestada y saneada;
utilidades numéricas que rechazan no-finitos.

## Milestones (estado real)

| # | Nombre | Alcance | Estado |
|---|---|---|---|
| E2E→Capas | Pista de tests | Arnés DOM + honestización + navegador real + CI | **COMPLETADO** |
| M1 | Arranque resiliente (R1) | `App.tsx`, `AudioEngine.ts`, `useDawStore.ts` — F1–F3 | **COMPLETADO** |
| M2 | Táctil y gestos (R2) | `WaveformCanvas.tsx`, `Knob.tsx`, headers, strips — F4–F9 | **COMPLETADO** |
| M3 | Geometría del timeline (R3) | `Timeline.tsx`, `Ruler.tsx` — F10–F15 | **COMPLETADO** |
| M4 | Responsive (R4) | `Header.tsx`, `TransportBar.tsx` — F16–F17 | **COMPLETADO** |
| M5 | Hardening + funciones nuevas | P0/P1, sandbox, SW, F20–F24, docs honestos | **COMPLETADO** |

## Roadmap (no implementado, declarado)

Sin MIDI · sin automatización de parámetros · sin export a MP3 · sin
time-stretch / conversión de sample-rate · sin WAM 2.0 / WebCLAP / WASM /
AudioWorklet · React 18 / Vite 5 / Vitest 2 se conservan deliberadamente (no se
migra a React 19 / Vite 7 / Vitest 3).

Limitaciones residuales conocidas (no ocultas): importar audio durante la
reproducción suena tras parar/reanudar; la mezcla a 7 canales AAC se rechaza
explícitamente (MPEG-4 Audio no tiene código de 7 canales); el merge de
`_headers` por ruta debe comprobarse una vez en Cloudflare Pages tras el primer
despliegue.

## Desviaciones deliberadas registradas

- La API de plugins custom recibe un **contexto proxy** (8 factorías:
  gain, filter, shaper, delay, convolver, comp, panner, osc + connect/disconnect
  + 5 métodos de parámetro), no un `BaseAudioContext` real. **Sin** respuestas
  de impulso de `ConvolverNode` ni curvas de `WaveShaperNode` por el puente.
- Los channel strips del mixer se ensancharon incondicionalmente para los 44 px
  táctiles, a costa de densidad en escritorio.
- Los ajustes de transporte (BPM, loop, metrónomo, volumen master) **no** están
  en la pila de undo por sí mismos, pero **sí se restauran** al deshacer una
  acción registrable.

---

## Contratos de interfaz

### M1 Boot ↔ motor y store
- `src/App.tsx`: `handleContinue` / `handleBlank` / `handlePickFile` en
  `try...catch...finally` con `finally { setBusy(null); }` y `pushToast` ante
  fallo de audio (arranque en modo silencioso, nunca atrapado).
- `src/audio/AudioEngine.ts`: `ensureContext()` intenta 44 100 Hz y reintenta con
  la tasa nativa; `resume()` no lanza.

### M2 Gestos ↔ WaveformCanvas y Knob
- `WaveformCanvas.tsx`: `onPointerDown`, `setPointerCapture` defensivo,
  `onPointerMove/Up/Cancel`; `touch-action: none`; borde de trim dinámico
  (`isTouch ? min(20, w*0.28) : min(8, w*0.2)`).
- `Knob.tsx`: `touch-action: none`, `setPointerCapture`/`releasePointerCapture`,
  listener de rueda no pasivo, hitbox ampliada.

### M3 Geometría ↔ Ruler
- `Timeline.tsx` ↔ `Ruler.tsx`: ancho unificado, regla sticky, scroll vertical
  bidireccional con banderas de reentrada y umbral subpíxel, seek acotado a
  `[0, duración]`, playhead con bucle rAF compartido y follow-scroll con puerta
  (reproduciendo + fuera de vista + 3 s sin scroll manual).

### M4 Responsive ↔ Header y Transport
- `Header.tsx`: compacto < 640 px (insignias y etiquetas ocultas, iconos con
  `aria-label` retenidos).
- `TransportBar.tsx`: metrónomo y VU master siempre visibles; todo control
  sólo-icono con nombre accesible; stop = parar + volver a 0, pausa = conservar.

---

## Layout y propiedad de ficheros

| Fichero | Hito / capa | Acceso lectura | Acceso escritura |
|---|---|---|---|
| `src/App.tsx` | M1 | Todos | M1 |
| `src/audio/AudioEngine.ts` | M1 + hardening | Todos | Motor |
| `src/store/useDawStore.ts` | Estado + hardening | Todos | Estado |
| `src/tests/audioBootResilience.test.ts` | M1 | Todos | M1 |
| `src/components/Timeline/WaveformCanvas.tsx` | M2 | Todos | M2 |
| `src/components/Plugins/Knob.tsx` | M2 | Todos | M2 |
| `src/components/Timeline/TrackHeader.tsx` | M2 | Todos | M2 |
| `src/components/Mixer/ChannelStrip.tsx` | M2 | Todos | M2 |
| `src/components/Timeline/Timeline.tsx` | M3 | Todos | M3 |
| `src/components/Timeline/Ruler.tsx` | M3 | Todos | M3 |
| `src/components/Header/Header.tsx` | M4 + F20 | Todos | M4 |
| `src/components/Transport/TransportBar.tsx` | M4 | Todos | M4 |
| `src/tests/contract/**` | Capa de contrato (antes "e2e") | Todos | Capa de contrato |
| `src/tests/dom/**` | Capa DOM | Todos | Capa DOM |
| `tests/browser/**` | Capa de navegador | Todos | Capa de navegador |
| `TEST_INFRA.md` | Infra de tests | Todos | Tests |
| `TEST_READY.md` | Declaración de readiness | Todos | Tests |
| `PROJECT.md` | Orquestación | Todos | Orquestación |
