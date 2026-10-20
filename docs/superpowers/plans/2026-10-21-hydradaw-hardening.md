# HydraDAW — Hardening & Features: plan de implementación

> **Para agentes ejecutores:** REQUERIDA la sub-skill `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para ejecutar este plan tarea por tarea.
> Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** Dejar HydraDAW con una puerta de calidad que mida de verdad, cero bugs P0/P1, el
contrato de interacción documentado implementado, las funciones esenciales que faltaban, y
seguridad/operaciones en pie.

**Arquitectura:** Se añade una capa de test de DOM (jsdom + Testing Library) y una capa de
navegador real (puppeteer-core sobre el Chrome del sistema), sobre el Zustand + Web Audio
existentes. El motor de audio gana un token de generación para serializar `play()`; el store pasa
a updaters puros con historial completo; los componentes de timeline pasan de eventos de ratón a
Pointer Events. No se toca la arquitectura general ni se introduce ninguna dependencia de runtime.

**Stack:** React 18.3 · TypeScript 5.7 (strict) · Zustand 4.5 · Web Audio API · Vite 5.4 ·
Vitest 2.1 · Tailwind 3.4 · **+ devDeps**: `jsdom`, `@testing-library/react`, `@testing-library/dom`,
`@testing-library/jest-dom`, `puppeteer-core`.

**Spec:** `docs/superpowers/specs/2026-10-21-hydradaw-hardening-design.md`
**Auditoría:** `docs/auditoria/01-informe-auditoria.md`

## Restricciones globales

- Node `20`. TypeScript con `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` +
  `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch` + `exactOptionalPropertyTypes`.
- **Cero dependencias de runtime nuevas.** Todo lo nuevo es devDependency.
- Bundle: JS total < 350 kB gzip (actual ~94.5 kB ⇒ margen 3.7×). Verificar tras cada build.
- `npm test` debe estar **verde y meaningfully** en cada commit. Ningún test tautológico nuevo.
- Copy de UI y mensajes al usuario en **español**. Identificadores de código en inglés.
- Sin red en el producto. Sin secretos. Cero llamadas a `alert`/`confirm`/`prompt`.
- Cada tarea termina con un commit. Mensajes en formato `fix(scope): ...` / `feat(scope): ...` /
  `test(scope): ...` / `docs(scope): ...` / `chore(scope): ...`.

## Foco de revisión

Condiciones que la spec implica y que hoy nadie comprueba. Cada una queda fijada por un test en la
tarea que posee ese código.

1. **Exportar con el master a −20 dB** ⇒ el WAV exportado sale a −20 dB, no a escala completa.
2. **Arrastrar un clip con el dedo** ⇒ el clip se mueve, la página no hace scroll.
3. **Modal de exportación abierto + Suprimir** ⇒ no se borra ningún clip.
4. **Proyecto nuevo + Ctrl+Z** ⇒ no resucita nada del proyecto anterior.
5. **Arrastrar un knob + Ctrl+Z** ⇒ el valor vuelve al anterior.
6. **Cerrar la pestaña 1 s después de editar** ⇒ el cambio está guardado.
7. **Reproducir + mover un clip** ⇒ se oye una sola copia, sin picos de ganancia.
8. **Metrónomo 10 s** ⇒ el clic no se duplica en los solapes.
9. **Importar `.json` hostil** (100 000 clips, `duration: 1e18`, `__proto__`) ⇒ no se cuelga, avisa.
10. **Plugin custom con `globalThis.fetch`** ⇒ se rechaza con mensaje y no se ejecuta.

---

# WAVE 0 — Arnés de calidad real

Sin esto, ninguna corrección posterior queda fijada por un test. Es la ola que más valor entrega.

### Tarea 1: Dependencias de test de DOM + stub de entorno

**Ficheros:**
- Modificar: `package.json` (devDependencies + scripts)
- Crear: `src/tests/dom/setup.ts`
- Modificar: `vite.config.ts` (`test.setupFiles`)

**Interfaces:**
- Produce: `src/tests/dom/setup.ts` (módulo con efecto colateral, sin exports públicos).
- Produce: scripts `npm run test:dom`, `npm run test:browser`, `npm run test:all`.

- [ ] **Paso 1: instalar las devDependencies**

```bash
npm install -D jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom puppeteer-core
```

Versiones exactas a anclar: `jsdom@^26`, `@testing-library/react@^16`, `@testing-library/dom@^10`,
`@testing-library/jest-dom@^6`, `puppeteer-core@^24`. Si `@testing-library/react@16` exige React 19,
bajar a `@testing-library/react@^15` (compatible con React 18) — **comprobar antes de fijar**.

- [ ] **Paso 2: escribir `src/tests/dom/setup.ts`**

Instalar stubs **sólo si hay DOM** (guarda `typeof document !== 'undefined'`), de modo que la capa
node no se ve afectada:

- `HTMLCanvasElement.prototype.getContext` ⇒ stub 2D no-op con todos los métodos usados por
  `WaveformCanvas` (`fillRect`, `clearRect`, `fillText`, `beginPath`, `moveTo`, `lineTo`, `closePath`,
  `fill`, `stroke`, `createLinearGradient` → `{ addColorStop() {} }`, `scale`, `save`, `restore`).
  Debe **registrar las llamadas** en un array global `__canvasOps` para poder afirmar que se dibuja.
- `globalThis.PointerEvent` ⇒ clase que extiende `MouseEvent` con `pointerId`, `pointerType`,
  `isPrimary`, `width`, `height`, `pressure`.
- `globalThis.AudioContext` ⇒ stub mínimo (reutilizar el patrón de
  `src/tests/e2e/helpers/testHelpers.ts:29-144`, **extraído** a
  `src/tests/dom/audioContextStub.ts` para no duplicar).
- `globalThis.matchMedia` ⇒ stub con `matches: false` y `addEventListener`/`removeEventListener` no-op.
- `globalThis.ResizeObserver` ⇒ stub con `observe`/`unobserve`/`disconnect` no-op.
- Importar `@testing-library/jest-dom/vitest` para los matchers.

- [ ] **Paso 3: registrar el setup en `vite.config.ts`**

```ts
test: {
  setupFiles: ['./src/tests/dom/setup.ts'],
  environment: 'node',
},
```

Los ficheros de `src/tests/dom/` declaran su propio entorno con el docblock
`// @vitest-environment jsdom` en la primera línea.

- [ ] **Paso 4: escribir un test de humo del arnés**

Crear `src/tests/dom/harness.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WaveformCanvas } from '../../components/Timeline/WaveformCanvas';

describe('arnés DOM', () => {
  it('monta un clip y expone su nombre accesible', () => {
    render(<WaveformCanvas clip={{...}} width={200} height={48} isSelected={false} />);
    expect(screen.getByLabelText('Clip prueba')).toBeTruthy();
  });
});
```

El clip de prueba necesita todos los campos de `AudioClip` (`id`, `trackId`, `name`, `startTime`,
`duration`, `offset`, `audioBuffer: null`, `peaks: new Float32Array(0)`, `color`).

- [ ] **Paso 5: ejecutar y verificar**

```bash
npm run test:dom
```
Esperado: 1 test pasa. Y `npm test` sigue en 454/454 (el setup no debe romper la capa node).

- [ ] **Paso 6: commit**

```bash
git add package.json package-lock.json vite.config.ts src/tests/dom/
git commit -m "test(dom): arnés de render con jsdom + Testing Library"
```

---

### Tarea 2: Honestizar la suite existente (`e2e` → `contract`)

**Ficheros:**
- Mover: `src/tests/e2e/` → `src/tests/contract/` (6 ficheros + `helpers/`)
- Modificar: imports relativos en los ficheros movidos
- Modificar: `TEST_INFRA.md`, `TEST_READY.md`

**Interfaces:**
- Produce: `src/tests/contract/helpers/testHelpers.ts` con **las mismas** exportaciones actuales
  (`setupTestEnvironment`, `resetDawStore`, `createMockTrack`, `createMockClip`,
  `createSyntheticPointerEvent`, `calculateExpectedTrimEdge`, `calculateExpectedUnifiedWidth`,
  `calculateExpectedClampedSeek`, `calculateExpectedKnobValue`). Los imports de la Tarea 1 no
  dependen de estos.
- Produce: `resetDawStore()` **debe llamar a `resetHistory()`** (importarlo de
  `src/store/useDawStore.ts`) ⇒ elimina la fuga de historial entre tests. Es parte del contrato.

- [ ] **Paso 1: mover el directorio**

```bash
git mv src/tests/e2e src/tests/contract
```

Los imports dentro de los ficheros movidos usan rutas relativas al propio fichero, por lo que
siguen siendo válidos (mismo nivel de profundidad). `helpers/testHelpers.ts` mantiene
`'../../../types/daw'` etc. — **verificar** que la profundidad no cambió (no lo cambió: `e2e` y
`contract` están ambos a un nivel bajo `src/tests/`).

- [ ] **Paso 2: hacer que `resetDawStore` limpie el historial**

En `src/tests/contract/helpers/testHelpers.ts`, añadir el import
`import { useDawStore, resetHistory } from '../../../store/useDawStore';` y llamar a
`resetHistory()` al final de `resetDawStore()`.

- [ ] **Paso 3: corregir los tests tautológicos**

En `src/tests/contract/tier1_m1_m2_features.test.ts`, los tests que sólo comprueban literales
(≈15) **se eliminan** (sus escenarios reales se re-implementan en `src/tests/dom/` y en
`tests/browser/` en las oleadas siguientes). Concretamente, los que asserted sobre
`{touchAction:'none'}.touchAction`, `expect(44).toBeGreaterThanOrEqual(44)` y asignaciones de
variables locales.

- [ ] **Paso 4: renombrar en la documentación**

En `TEST_INFRA.md` y `TEST_READY.md`: sustituir "E2E" por "contrato (opaco, sin DOM)" donde
aplique, añadir una tabla de las 4 capas (unit / contract / dom / browser) con qué cubre cada una
**y qué no**, y cambiar el titular de "READY — 100% Passing" por uno honesto que declare que la
capa de navegador todavía no existe (se añade en la Tarea 3).

- [ ] **Paso 5: ejecutar y verificar**

```bash
npm test
```
Esperado: el recuento baja de 454 a ~439 (los tautológicos eliminados) y **todo lo demás sigue
verde**. Registrar el número exacto en el mensaje de commit.

- [ ] **Paso 6: commit**

```bash
git commit -m "test(contract): renombra e2e->contract y elimina aserciones tautológicas"
```

---

### Tarea 3: Capa de navegador real (puppeteer-core)

**Ficheros:**
- Crear: `tests/browser/harness.mjs`
- Crear: `tests/browser/smoke.mjs`
- Crear: `tests/browser/README.md`
- Modificar: `package.json` (script `test:browser`)

**Interfaces:**
- Produce: `tests/browser/harness.mjs` exporta `withPage(fn, opts)` → `fn(page, shot)`;
  `shot(name)` guarda en `test-artifacts/browser/<nombre>.png`; `collectErrors(page)` devuelve
  `{ pageErrors: string[], consoleErrors: string[] }`.
- Produce: `npm run test:browser` — sale con código 1 si hay cualquier `pageerror` o error de
  consola, o si un smoke check falla.

- [ ] **Paso 1: escribir `tests/browser/harness.mjs`**

Resolver el ejecutable de Chrome por orden: `process.env.PUPPETEER_EXECUTABLE_PATH`,
`/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`,
`/usr/bin/google-chrome`. Si **no** hay ninguno ⇒ `throw` con el mensaje
"No se encontró Chrome. Instala google-chrome-stable o define PUPPETEER_EXECUTABLE_PATH."
(nunca saltar en silencio).

Lanzar con `--no-sandbox --disable-dev-shm-usage --autoplay-policy=no-user-gesture-required
--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`. Viewport por defecto
`1440x900`; helper `withViewport(page, w, h)`.

- [ ] **Paso 2: escribir `tests/browser/smoke.mjs` con estos checks**

| # | Check | Aserción |
|---|---|---|
| B1 | Arranque | aparece el diálogo de inicio; 0 `pageerror` |
| B2 | Carga de la demo | clicking "Empezar con la demo" ⇒ 4 pistas y 4 clips visibles |
| B3 | Play/stop | click en Play ⇒ `isPlaying` (se comprueba que el botón cambia de estado); click en Stop ⇒ vuelve |
| B4 | Split | seleccionar un clip y pulsar `S` ⇒ el número de clips pasa de 4 a 5 |
| B5 | Modal de export | abrir el modal ⇒ el diálogo aparece y el fondo no es interactivo (verificar `aria-hidden`/`inert` en el fondo en la W3) |
| B6 | Layout 320 px | viewport 320×640 ⇒ `document.documentElement.scrollWidth <= 320` (sin scroll horizontal) |
| B7 | `touch-action` | el elemento de clip tiene `getComputedStyle(el).touchAction === 'none'` (falla hoy ⇒ se arregla en W2) |
| B8 | Errores de consola | 0 `pageerror` y 0 `console.error` en todo el recorrido |

Los checks B1-B6, B8 deben pasar **ya**; B7 debe fallar hasta la Tarea 18 ⇒ marcarlo como
`expectedFailure` hasta entonces, con un `TODO(ses_...)` que apunte a la Tarea 18, y quitarlo allí.

- [ ] **Paso 3: script de npm y artefactos**

`"test:browser": "node tests/browser/smoke.mjs"`. Los artefactos van a `test-artifacts/` (ya está en
`.gitignore` — verificar).

- [ ] **Paso 4: ejecutar contra el dev server**

```bash
npm run dev -- --port 5199 &
npm run test:browser
```
Esperado: 7/8 checks pasan, B7 falla como `expectedFailure`, y el script sale con código 0.

- [ ] **Paso 5: commit**

```bash
git add tests/browser package.json
git commit -m "test(browser): capa de humo con Chrome real vía puppeteer-core"
```

---

### Tarea 4: CI

**Ficheros:**
- Crear: `.github/workflows/ci.yml`

**Interfaces:**
- Produce: workflow con 2 jobs: `unit` y `browser`.

- [ ] **Paso 1: escribir el workflow**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm }
      - run: npm ci
      - run: npm test
      - run: npx tsc --noEmit
      - run: npm run build
  browser:
    runs-on: ubuntu-latest
    needs: unit
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm }
      - run: npm ci
      - run: npm run dev -- --port 5175 &
      - run: npm run test:browser
```

`ubuntu-latest` trae `google-chrome-stable` preinstalado. Si el runner no lo tuviera, añadir
`npx @puppeteer/browsers install chrome@stable` antes del job de navegador.

- [ ] **Paso 2: verificar el workflow**

```bash
npx --yes yaml-lint .github/workflows/ci.yml || python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/ci.yml'));print('YAML OK')"
```

- [ ] **Paso 3: commit**

```bash
git commit -m "ci: puerta automatizada de tests y build"
```

---

# WAVE 1 — Bugs P0/P1 de motor, estado y exportación

Cada bug lleva **primero** el test que falla.

### Tarea 5: Token de generación de `play()` (AUD-01, AUD-02)

**Ficheros:**
- Modificar: `src/audio/AudioEngine.ts` (campo `playGen`, `play()`, `stop()`, `seek()`)
- Crear: `src/audio/engine_play_generation.test.ts`

**Interfaces:**
- Produce: campo privado `private playGen = 0;` en `AudioEngine`.
- Produce: comportamiento: `play()` concurrente ⇒ **sólo la última** sobrevive; `stop()` durante un
  `play()` en vuelo ⇒ **ninguna** reproducción.

- [ ] **Paso 1: escribir el test que falla**

Dos casos con un contexto simulado cuyo `resume()` se resuelve de forma diferida (controlada):

```ts
it('dos play() solapados programan una sola generación de fuentes', async () => {
  //(contexto con resume() diferido)
  const p1 = engine.play(tracks, clips, 0);
  const p2 = engine.play(tracks, clips, 0);
  await Promise.all([p1, p2]);
  // el número de AudioBufferSourceNodes creados es el de UNA generación, no el de dos
});

it('stop() durante un play() en vuelo deja el motor en silencio', async () => {
  const p = engine.play(tracks, clips, 0);
  engine.stop();
  await p;
  expect(engine.isPlaying).toBe(false);
  // ninguna fuente queda programada
});
```

- [ ] **Paso 2: ejecutar y verificar que falla**

```bash
npx vitest run src/audio/engine_play_generation.test.ts
```
Esperado: FAIL (hoy hay doble programación / estado zombi).

- [ ] **Paso 3: implementar**

En `AudioEngine`: añadir `private playGen = 0;`. En `play()`, la **primera** línea tras la
firma es `const gen = ++this.playGen;`. Después de **cada** `await`, comprobar
`if (gen !== this.playGen) return;`. En `stop()` y en `seek()`, hacer `this.playGen++;` al inicio.

- [ ] **Paso 4: ejecutar y verificar que pasa**

```bash
npx vitest run src/audio/engine_play_generation.test.ts && npm test
```

- [ ] **Paso 5: commit**

```bash
git commit -m "fix(audio): token de generación evita doble audio y zombis post-stop"
```

---

### Tarea 6: Sello correcto de la toma en punch-in (AUD-03)

**Ficheros:**
- Modificar: `src/audio/AudioEngine.ts` (método de grabación)
- Modificar: `src/audio/engine_fixes.test.ts`

**Interfaces:**
- Produce: `recordingStartTime` se sella **después** de `getUserMedia()` y de
  `mediaRecorder.start()`.

- [ ] **Paso 1: test que falla**

Mock de `getUserMedia` que **adelanta `ctx.currentTime` en 5 s** antes de resolver. Tras grabar,
el `startTime` del clip debe corresponder al tiempo **post-prompt**, no al pre-prompt.

- [ ] **Paso 2: verificar que falla**

```bash
npx vitest run src/audio/engine_fixes.test.ts -t "punch"
```

- [ ] **Paso 3: implementar**

Mover el sello de `recordingStartTime` a después de `await navigator.mediaDevices.getUserMedia(...)`
y de `mediaRecorder.start(...)`, tomando `this.getCurrentTime()` en ese punto.

- [ ] **Paso 4: verificar** → `npx vitest run src/audio/engine_fixes.test.ts && npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(audio): la toma se ancla tras conceder el micro"`

---

### Tarea 7: Metrónomo sin solapes (AUD-04)

**Ficheros:**
- Modificar: `src/audio/AudioEngine.ts` (`armMetroExtender` y el estado del metrónomo)
- Crear: `src/audio/engine_metronome.test.ts`

**Interfaces:**
- Produce: campo privado `metroScheduledUntil = 0` (tiempo de línea de tiempo).

- [ ] **Paso 1: test que falla**

Con `vi.useFakeTimers()`, disparar el extensor dos veces y contar los osciladores creados: los
tiempos de click programados **no** deben contener duplicados.

- [ ] **Paso 2: verificar que falla** → `npx vitest run src/audio/engine_metronome.test.ts`

- [ ] **Paso 3: implementar**

Cada disparo programa la ventana `[max(now, metroScheduledUntil), now + 2)` y actualiza
`metroScheduledUntil = windowEnd`. Resetear `metroScheduledUntil = 0` en `setMetronome(false)` y
al parar.

- [ ] **Paso 4: verificar** → test + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(audio): el metrónomo ya no duplica clicks solapados"`

---

### Tarea 8: Loop en el reloj de audio (AUD-05)

**Ficheros:**
- Modificar: `src/audio/AudioEngine.ts` (`handleLoopWrap`, `armLoopTimer`)
- Modificar: `src/audio/engine_loop.test.ts`

**Interfaces:**
- Produce: el wrap del loop se decide con `ctx.currentTime`, no con `Date.now()`.

- [ ] **Paso 1: test que falla**

Simular un temporizador que se dispara **tarde** (el `ctx.currentTime` ya ha pasado `loopEnd`):
el motor debe rellenar el hueco (la siguiente iteración empieza en `ctx.currentTime`, no en
`loopEnd`), de modo que no hay un silencio entre iteraciones.

- [ ] **Paso 2: verificar que falla** → `npx vitest run src/audio/engine_loop.test.ts`

- [ ] **Paso 3: implementar**

Sustituir la planificación por `setTimeout` de reloj de pared por un **intervalo de 25 ms** que
compara `ctx.currentTime` con el `loopEnd` proyectado y programa la siguiente iteración con
antelación. Si el wrap se detecta tarde, la siguiente iteración se ancla en
`ctx.currentTime + 0.02` (relleno del hueco) en lugar de `loopEnd`.

- [ ] **Paso 4: verificar** → test + `npm test` (los tests de loop existentes deben seguir verdes:
  adjustar sus expectativas al nuevo mecanismo **sólo** si el cambio es intencionado, y
  documentarlo en el commit).

- [ ] **Paso 5: commit** → `git commit -m "fix(audio): el loop se planifica en el reloj de audio"`

---

### Tarea 9: Fugas de nodos: fades y clicks (AUD-06, AUD-07)

**Ficheros:**
- Modificar: `src/audio/TrackNode.ts` (`addActiveSource` — parámetro `cleanup`)
- Modificar: `src/audio/AudioEngine.ts` (pasa el cleanup del `clipGain`; desconecta el `gain` del click)
- Crear: `src/audio/node_leak.test.ts`

**Interfaces:**
- Produce: `TrackNode.addActiveSource(source: AudioBufferSourceNode, cleanup?: () => void): void`.

- [ ] **Paso 1: test que falla**

Con un contexto simulado que **cuente** `createGain` y `disconnect`: reproducir un clip con
`fadeIn > 0`, disparar todos los `onended`, y comprobar que **todos** los gains creados están
desconectados. Idem para el metrónomo (N clicks ⇒ N gains desconectados).

- [ ] **Paso 2: verificar que falla** → `npx vitest run src/audio/node_leak.test.ts`

- [ ] **Paso 3: implementar**

- `TrackNode.addActiveSource(source, cleanup?)`: en el `onended`, invocar `cleanup?.()` antes de
  desconectar.
- `AudioEngine`: al crear el `clipGain` de un fade, pasar `() => { try { clipGain.disconnect(); }
  catch { /* ya desconectado */ } }`.
- `AudioEngine.spawnClick`: en `osc.onended`, desconectar también el `gain`.

- [ ] **Paso 4: verificar** → test + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(audio): desconecta gains de fades y clicks al terminar"`

---

### Tarea 10: Un plugin roto no rompe el transporte (AUD-10)

**Ficheros:**
- Modificar: `src/audio/PluginHost.ts` (`createInstanceNode` — validar forma del nodo)
- Modificar: `src/audio/TrackNode.ts` (`rebuildEffectsChain` — try/catch por paso)
- Modificar: `src/audio/plugin_safety.test.ts`

**Interfaces:**
- Produce: `PluginHost.createInstanceNode` devuelve un *pass-through* (`GainNode` de ganancia 1)
  cuando el nodo del plugin no cumple la forma `{ inputNode, outputNode }`.

- [ ] **Paso 1: test que falla**

Registrar un plugin custom cuyo `createDSPNode` devuelve `{}` y otro que **lanza**. Añadirlo a una
pista y llamar a `play()`: **no** debe rechazar, y el resto de pistas debe sonar.

- [ ] **Paso 2: verificar que falla** → `npx vitest run src/audio/plugin_safety.test.ts`

- [ ] **Paso 3: implementar**

En `createInstanceNode`, validar `dsp && typeof dsp.inputNode?.connect === 'function' &&
dsp.outputNode`; si falla, construir el pass-through. En `rebuildEffectsChain`, envolver cada
conexión en `try/catch` y, ante excepción, insertar el pass-through y **no** propagar.

- [ ] **Paso 4: verificar** → test + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(audio): un plugin inválido degrada a pass-through"`

---

### Tarea 11: Recreación del contexto de audio (AUD-11)

**Ficheros:**
- Modificar: `src/audio/AudioEngine.ts` (`ensureContext`)
- Modificar: `src/tests/audioBootResilience.test.ts`

**Interfaces:**
- Produce: al reemplazar el contexto, los `trackNodes` se descartan y `trackEffectsSig` se resetea.

- [ ] **Paso 1: test que falla**

Cerrar el contexto, forzar la recreación en `ensureContext()`, y comprobar que `trackNodes` se
reconstruyen sobre el contexto nuevo y que `play()` programa sin `InvalidAccessError`.

- [ ] **Paso 2: verificar que falla** → `npx vitest run src/tests/audioBootResilience.test.ts`

- [ ] **Paso 3: implementar**

En la rama de `ensureContext()` que reemplaza `this.context`: desconectar y vaciar el mapa de
`trackNodes` y resetear `trackEffectsSig` a `''` para forzar la reconstrucción en `syncTracks`.

- [ ] **Paso 4: verificar** → test + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(audio): los nodos de pista se rehacen al cambiar de contexto"`

---

### Tarea 12: Updaters puros en el store (ST-10)

**Ficheros:**
- Modificar: `src/store/useDawStore.ts` (todas las acciones con efectos dentro de `set`)
- Crear: `src/tests/store_purity.test.ts`

**Interfaces:**
- Produce: **ningún** updater de `set()` ejecuta efectos. Patrón canónico ya presente en
  `updatePluginParam` (línea ~546): calcular con `get()`, luego `set(...)`, luego el efecto.

- [ ] **Paso 1: test que falla**

Espiar `audioEngine.syncTracks` / `play` / `rebuildTrackEffects` y contar llamadas al invocar
`addTrack`, `removeTrack`, `updateTrack`, `addClip`, `updateClip`, `removeClip`, `splitClip`,
`trimClip`, `addPluginToTrack`, `removePluginFromTrack`, `togglePlugin`. Cada uno debe llamar
**exactamente una vez** al efecto correspondiente (hoy `addTrack` lo llama dentro del updater, y el
updater puede invocarse más de una vez).

- [ ] **Paso 2: verificar que falla** → `npx vitest run src/tests/store_purity.test.ts`

- [ ] **Paso 3: implementar**

Reescribir cada acción en la forma: `const next = get().tracks.map(...)` → `set({ tracks: next })`
→ `audioEngine.syncTracks(next)` (fuera del `set`).

- [ ] **Paso 4: verificar** → test + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "refactor(store): los updaters de estado quedan puros"`

---

### Tarea 13: Historial completo y sin fugas (ST-01, ST-02, ST-03, ST-11)

**Ficheros:**
- Modificar: `src/store/useDawStore.ts` (`HistorySnapshot`, `cloneHistoryState`, `recordHistory`,
  `undo`, `redo`, las 6 acciones que no registraban, `trimClip`, `loadDemoProject`,
  `createBlankProject`)
- Modificar: `src/store/persistence.ts` (`applySerializedProject` — llamar a `resetHistory()`)
- Crear: `src/tests/history.test.ts`

**Interfaces:**
- Produce: `HistorySnapshot` ampliado (ver spec §3.3) con `bpm`, `timeSignature`, `loopStart`,
  `loopEnd`, `isLooping`, `metronome`, `masterVolume`, `masterMute`, `projectName`, `snapMode`,
  `selectedTrackId`, `selectedClipId`.
- Produce: `recordHistory` acepta el snapshot completo; `undo`/`redo` lo restauran **y** lo
  reinyectan en el engine.

- [ ] **Paso 1: tests que fallan** (en `src/tests/history.test.ts`)

| Test | Aserción |
|---|---|
| H1 | `updateTrack` (volumen) y luego `undo()` ⇒ el volumen vuelve al anterior |
| H2 | `updatePluginParam` y luego `undo()` ⇒ el parámetro vuelve al anterior |
| H3 | `addPluginToTrack` y luego `undo()` ⇒ el plugin desaparece |
| H4 | `undo()` tras cambiar el BPM ⇒ el BPM **y** el tempo del engine vuelven |
| H5 | `undo()` tras `createBlankProject()` ⇒ **no** aparecen pistas del proyecto anterior |
| H6 | `undo()` tras `loadDemoProject()` ⇒ no aparecen clips del proyecto anterior |
| H7 | `trimClip(id, 'left', 0)` ⇒ `canUndo` sigue en `false` (no-op sin historial) |
| H8 | `undo()` de un `removeClip` ⇒ el clip vuelve **y** vuelve a estar seleccionado |
| H9 | tras `updateClip` (arrastre), `undo()` ⇒ el clip vuelve a su `startTime` |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/history.test.ts`

- [ ] **Paso 3: implementar**

Ampliar `HistorySnapshot` y `cloneHistoryState`; registrar en las 6 acciones; **coalescer**
`updatePluginParam` (no registrar más de 1 snapshot cada 400 ms; forzar snapshot al pasar 400 ms
desde el último); en `undo`/`redo` restaurar los campos nuevos y reinyectar en el engine
(`setTempo`, `setLoop`, `setTimeSignature`, `setMetronome`, master bus). Llamar `resetHistory()` en
`loadDemoProject`, `createBlankProject` y `applySerializedProject`. En `trimClip`, comparar el
resultado con el original y no registrar si no cambió.

- [ ] **Paso 4: verificar** → `npx vitest run src/tests/history.test.ts && npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(store): historial completo, sin fugas entre proyectos"`

---

### Tarea 14: Autosave a prueba de cierre + `snapMode` persistente (ST-05, ST-06, ST-12)

**Ficheros:**
- Modificar: `src/store/persistence.ts` (`startAutosave`, `selectAutosaveSnapshot`,
  `PersistableProjectState`, `SerializedProject`, `serializeProject`, `buildProjectFromRaw`,
  `applySerializedProject`)
- Modificar: `src/tests/persistence.test.ts`, `src/tests/persistence_migration.test.ts`

**Interfaces:**
- Produce: `startAutosave()` devuelve una función de parada que **vuelca** el timer pendiente.
- Produce: `snapMode` en el snapshot de persistencia, validado contra la lista de `SnapMode`.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| P1 | llamar al `stop()` del autosave con un cambio pendiente ⇒ el proyecto **se guarda** |
| P2 | `snapMode = 'bar'` ⇒ guardar ⇒ recargar ⇒ `snapMode === 'bar'` |
| P3 | el snapshot de autosave **no** incluye `zoom`/`scrollLeft`/`activeView`/selección |
| P4 | `beforeunload` dispara un guardado (se puede simular con `pagehide`/evento manual) |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/persistence.test.ts`

- [ ] **Paso 3: implementar**

`startAutosave`: añadir listeners `beforeunload` y `pagehide` → `void saveProjectNow()`;
quitarlos en la función de parada; la parada **vuelca** el timer pendiente. Añadir `snapMode` a
los 5 puntos de contacto de la persistencia, validándolo contra
`['off','bar','1/1','1/4','1/8','1/16','1/32']`. Quitar `zoom`/`scrollLeft`/`activeView`/
selección del snapshot de autosave.

- [ ] **Paso 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(persistence): autosave a prueba de cierre y snap persistente"`

---

### Tarea 15: Atajos globales sin djinn (ST-07, ST-12)

**Ficheros:**
- Modificar: `src/hooks/useGlobalShortcuts.ts`
- Modificar: `src/tests/globalShortcuts.test.ts`

**Interfaces:**
- Produce: `handleGlobalKeyDown` hace early-return si `exportModalOpen` o `pluginModalTrackId`
  están activos (leído con `useDawStore.getState()`), permitiendo `Escape`.
- Produce: los atajos de un solo carácter ignoran `e.repeat`.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| S1 | con `exportModalOpen: true`, `Delete` **no** borra el clip seleccionado |
| S2 | con `pluginModalTrackId` activo, `S` **no** corta el clip |
| S3 | con un modal abierto, `Escape` sí se procesa (no se propaga) |
| S4 | `e.repeat === true` no dispara `toggleRecord` |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/globalShortcuts.test.ts`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(shortcuts): los atajos no disparan con un modal abierto"`

---

### Tarea 16: Importación de proyecto blindada (ST-08, SEC-02)

**Ficheros:**
- Modificar: `src/App.tsx` (`runHandlePickFile` — presupuesto de tamaño)
- Modificar: `src/store/persistence.ts` (`buildProjectFromRaw` — saneado, topes, validación)
- Crear: `src/tests/import_hardening.test.ts`

**Interfaces:**
- Produce: `buildProjectFromRaw` sanea parámetros de plugin con `Number.isFinite`, deduplica ids,
  valida la selección y acota `duration` a `[1, 86400]`.
- Produce: `runHandlePickFile` rechaza archivos > 25 MB con un toast.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| I1 | `{"lowGain": "evil"}` en un parámetro ⇒ el valor guardado es un número (o el parámetro se descarta) |
| I2 | 100 000 clips ⇒ se trunca a 20 000 y se avisa |
| I3 | `duration: 1e18` ⇒ queda acotado a ≤ 86400 |
| I4 | clave `__proto__` en el JSON ⇒ no aparece en el objeto resultante |
| I5 | ids duplicados ⇒ quedan únicos |
| I6 | `selectedTrackId` inexistente ⇒ queda `null` |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/import_hardening.test.ts`

- [ ] **Paso 3: implementar**

- [ ] **Step 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(import): presupuesto y saneado de proyectos ajenos"`

---

### Tarea 17: Exportación fiel al mixer (EXP-01, EXP-03, EXP-05, EXP-11, EXP-04)

**Ficheros:**
- Modificar: `src/audio/AudioEngine.ts` (`OfflineRenderOptions`, `renderOffline`)
- Modificar: `src/components/Export/ExportModal.tsx` (leer master del store, `encodeWavAsync`,
  opción 32 bits, tope de duración)
- Modificar: `src/audio/WavExporter.ts` (padding de palabra RIFF)
- Modificar: `src/audio/wavExporterPerf.test.ts`, `src/tests/export_utils.test.ts`

**Interfaces:**
- Produce: `OfflineRenderOptions` gana `masterVolume?: number; masterMute?: boolean;`.
- Produce: `encodeWav` con padding: si `dataSize` es impar, `bufferSize = 45 + dataSize` y el byte
  de padding a 0; el tamaño RIFF pasa a `37 + dataSize`.
- Produce: `ExportModal` acepta profundidades `16 | 24 | 32`.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| E1 | `renderOffline` con `masterVolume: 0.5` ⇒ el buffer renderizado tiene pico ≈ la mitad |
| E2 | `renderOffline` con `masterMute: true` ⇒ el buffer renderizado es silencio |
| E3 | `encodeWav` de 3 frames mono a 24 bits ⇒ el tamaño del archivo es **par** y el padding a 0 |
| E4 | `ExportModal` con `bitDepth: 32` llama a `encodeWav(buffer, 32)` |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/audio/wavExporterPerf.test.ts`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test` + `npm run build`

- [ ] **Paso 5: commit** → `git commit -m "fix(export): el master manda y la exportación no congela"`

---

### Tarea 18: LUFS conforme a BS.1770-4 (EXP-02, EXP-12)

**Ficheros:**
- Modificar: `src/audio/loudness.ts` (`designHighShelf` → coeficientes de la Tabla 1 de BS.1770-4;
  `measureLoudness` → relleno a 400 ms)
- Modificar: `src/audio/loudness.test.ts`

**Interfaces:**
- Produce: `measureLoudness` sobre un tono senoidal de 997 Hz a escala completa devuelve
  **−3.0 LUFS ± 0.1** (valor de referencia BS.1770-4), no −3.4.

- [ ] **Paso 1: test que falla**

Tono de 997 Hz, 2 s, escala completa ⇒ el valor debe caer en `[−3.1, −2.9] LUFS`. El test actual
usa `[-4.2, -3.2]` (calibrado a la implementación desviada) ⇒ **cambiar la ventana** y ver que falla.

- [ ] **Paso 2: verificar que falla** → `npx vitest run src/audio/loudness.test.ts`

- [ ] **Paso 3: implementar**

Sustituir el *high-shelf* RBJ por los coeficientes de la Tabla 1 de BS.1770-4
(`b = [1.53512486, -2.69169619, 1.19839281]`, `a = [1, -1.69065929, 0.73248077]` a 48 kHz),
derivando otras tasas por transformada bilineal del mismo prototipo analógico. Rellenar con ceros
hasta 400 ms los bloques de entrada más cortos que un bloque.

- [ ] **Paso 4: verificar** → `npx vitest run src/audio/loudness.test.ts && npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(loudness): K-weighting conforme a BS.1770-4"`

---

### Tarea 19: Guarding numérico en las utilidades (DSP-07, DSP-08, DSP-09, DSP-10, AUD-12, AAC-06)

**Ficheros:**
- Modificar: `src/audio/waveformUtils.ts`, `src/audio/audioMath.ts`, `src/audio/timelineOps.ts`,
  `src/audio/aacExporter.ts`
- Crear: `src/tests/numeric_guards.test.ts`

**Interfaces:**
- Produce: `generateWaveformPeaks(buffer, n)` con `n <= 0` devuelve `Float32Array(0)` (no lanza).
- Produce: `splitClipOperation(clip, NaN)` devuelve `null`; `trimLeft/RightOperation(clip, NaN)`
  devuelve el clip intacto.
- Produce: `calculateConstantPowerPan(NaN)` devuelve `{ left: 1, right: 1 }` (pan 0).
- Produce: `dbToLinear(NaN)` y `secondsToSamples(NaN, sr)` devuelven valores finitos.

- [ ] **Paso 1: tests que fallan** (uno por guarda)

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/numeric_guards.test.ts`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "fix(dsp): las utilidades numéricas rechazan no-finitos"`

---

# WAVE 2 — El contrato de interacción (F4-F8, F10-F13) implementado de verdad

### Tarea 20: Pointer Events en los clips (UI-03, F4, F5, F6)

**Ficheros:**
- Modificar: `src/components/Timeline/WaveformCanvas.tsx`
- Crear: `src/tests/dom/waveformCanvas.test.tsx`
- Modificar: `tests/browser/smoke.mjs` (quitar el `expectedFailure` de B7)

**Interfaces:**
- Produce: la raíz del clip tiene `onPointerDown`, `onPointerMove`, `onPointerUp`,
  `onPointerCancel`; el estilo computado `touch-action` es `none`.
- Produce: zona de trim dinámica: `isTouch ? Math.min(20, width * 0.28) : Math.min(8, width * 0.2)`,
  con `isTouch = e.pointerType !== 'mouse'`.

- [ ] **Paso 1: tests que fallan** (jsdom)

| Test | Aserción |
|---|---|
| W1 | `pointerdown` en un clip ⇒ `setPointerCapture` llamado con el `pointerId` |
| W2 | el estilo computado del clip tiene `touch-action: none` |
| W3 | `pointermove` con `pointerType: 'touch'` a 5 px del borde ⇒ recorta (cambia `duration`) |
| W4 | `pointermove` con `pointerType: 'mouse'` a 12 px del borde ⇒ **no** recorta (mueve) |
| W5 | `pointercancel` ⇒ no se aplica ningún cambio pendiente |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/dom/waveformCanvas.test.tsx`

- [ ] **Paso 3: implementar**

Sustituir `handleMouseDown`/`onMouseDown` por `handlePointerDown`/`onPointerDown` con
`setPointerCapture` defensivo, y escuchar `pointermove`/`pointerup`/`pointercancel` **sobre el
elemento** (no sobre `window`). Añadir `touch-none` a la clase del contenedor del clip. Eliminar
`onClick` de清除 selección (el `stopPropagation` se mantiene para que el lane no limpie la
selección).

- [ ] **Paso 4: verificar** → test + `npm test` + `npm run test:browser` (B7 ahora pasa)

- [ ] **Paso 5: commit** → `git commit -m "feat(timeline): Pointer Events y zonas de trim táctiles"`

---

### Tarea 21: El knob, con captura de puntero y rueda real (UI-04, F7)

**Ficheros:**
- Modificar: `src/components/Plugins/Knob.tsx`
- Crear: `src/tests/dom/knob.test.tsx`

**Interfaces:**
- Produce: `setPointerCapture` en `pointerdown`, `releasePointerCapture` en `pointerup`/`pointercancel`,
  `touch-none` en el dial, y la rueda con listener **nativo no pasivo**.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| K1 | `pointerdown` ⇒ `setPointerCapture` llamado |
| K2 | `pointerup` ⇒ `releasePointerCapture` llamado |
| K3 | `touch-action` computado = `none` |
| K4 | doble click ⇒ el valor vuelve al valor por defecto |
| K5 | el listener de rueda se registra con `{ passive: false }` |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/dom/knob.test.tsx`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "feat(plugins): knob con captura de puntero y rueda no pasiva"`

---

### Tarea 22: Scroll vertical sincronizado y regla sticky (UI-01, UI-02, F10, F11, F12)

**Ficheros:**
- Modificar: `src/components/Timeline/Timeline.tsx`
- Modificar: `src/components/Timeline/Ruler.tsx`
- Crear: `src/tests/dom/timelineScroll.test.tsx`

**Interfaces:**
- Produce: `Timeline` tiene refs `headersScrollRef` y `lanesScrollRef`, con `onScroll` en ambos y
  banderas de reentrada `isSyncingFromHeaders` / `isSyncingFromLanes` y umbral de 0.5 px.
- Produce: la `Ruler` tiene `sticky top-0 z-20` y fondo opaco.
- Produce: el ancho de lanes se calcula desde el **ancho real medido** del contenedor de headers
  (mediante `ResizeObserver`), no desde la constante `240`.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| T1 | hacer scroll en los headers ⇒ el `scrollTop` de los lanes se iguala |
| T2 | hacer scroll en los lanes ⇒ el `scrollTop` de los headers se iguala |
| T3 | el scroll sincronizado no entra en bucle (el contador de eventos se estabiliza) |
| T4 | la clase de la raíz de la `Ruler` contiene `sticky` |
| T5 | el ancho de lanes usa el ancho medido del header, no 240 |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/dom/timelineScroll.test.tsx`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test` + `npm run test:browser`

- [ ] **Paso 5: commit** → `git commit -m "feat(timeline): scroll vertical sincronizado y regla sticky"`

---

### Tarea 23: Seek acotado y por teclado (UI-08, F13)

**Ficheros:**
- Modificar: `src/components/Timeline/Ruler.tsx`
- Crear: `src/tests/dom/ruler.test.tsx`

**Interfaces:**
- Produce: `handleSeek` acota a `[0, duration]`.
- Produce: la `Ruler` es `role="slider"`, `tabIndex={0}`, con `aria-valuemin/max/now` y
  `aria-label="Posición del cursor"`.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| R1 | click a 10 000 px con zoom 50 y duración 16 ⇒ `currentTime === 16` |
| R2 | click a −500 px ⇒ `currentTime === 0` |
| R3 | la regla tiene `role="slider"` y es focusable |
| R4 | `ArrowRight` con foco ⇒ `currentTime` avanza 1 s, acotado a la duración |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/dom/ruler.test.tsx`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "feat(timeline): seek acotado y navegable por teclado"`

---

### Tarea 24: Un solo bucle de playhead + seguimiento de scroll (UI-07, UI-12)

**Ficheros:**
- Crear: `src/hooks/usePlayheadSync.ts`
- Modificar: `src/components/Timeline/Timeline.tsx`
- Modificar: `src/components/Timeline/Ruler.tsx`
- Modificar: `src/components/Transport/TransportBar.tsx` (timecode con gate)

**Interfaces:**
- Produce: `usePlayheadSync({ containerRef, zoom })` → registra **una** suscripción
  `audioEngine.onTimeUpdate` y **un** `requestAnimationFrame`; escribe la posición en el elemento
  que se le pase por ref; opcionalmente hace `scrollBy` de seguimiento cuando el playhead se
  acerca al borde.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| PH1 | con `isPlaying`, sólo hay **una** suscripción activa al `onTimeUpdate` |
| PH2 | el playhead se actualiza al cambiar el tiempo del engine |
| PH3 | el `scrollLeft` del contenedor sigue al playhead cuando se acerca al borde |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/dom/playhead.test.tsx`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "perf(timeline): un solo bucle de playhead y seguimiento"`

---

# WAVE 3 — Accesibilidad, responsive y diseño

### Tarea 25: Nombres accesibles en los controles de icono (UI-05)

**Ficheros:**
- Modificar: `src/components/Transport/TransportBar.tsx`, `src/components/Timeline/Timeline.tsx`,
  `src/components/Timeline/TrackHeader.tsx`, `src/components/Mixer/ChannelStrip.tsx`
- Crear: `src/tests/dom/accessibleNames.test.tsx`

**Interfaces:**
- Produce: todo botón sólo-icono con `aria-label` explícito.

- [ ] **Paso 1: tests que fallan** — para cada control, `getByRole('button', { name: /.../ })`.

- [ ] **Paso 2: verificar que fallan**

- [ ] **Paso 3: implementar** — etiquetas: "Detener", "Reproducir"/"Pausar", "Grabar",
  "Activar bucle", "Metrónomo", "Silenciar master", "Acercar zoom", "Alejar zoom",
  "Eliminar pista {nombre}", "Añadir efecto", "Cortar clip".

- [ ] **Paso 4: verificar** → tests + `npm test` + `npm run test:browser`

- [ ] **Paso 5: commit** → `git commit -m "a11y: nombres accesibles en los controles de icono"`

---

### Tarea 26: Selectores granulares en el store (UI-06)

**Ficheros:**
- Modificar: `src/components/Mixer/MixerConsole.tsx`, `src/components/Timeline/TrackHeader.tsx`,
  `src/components/Plugins/PluginRackModal.tsx`, `src/components/Export/ExportModal.tsx`
- Crear: `src/tests/dom/renderCount.test.tsx`

**Interfaces:**
- Produce: ningún componente hace `useDawStore()` sin selector. Con varios campos, usar
  `useShallow` de `zustand/react/shallow`.

- [ ] **Paso 1: test que falla** — contar renders de un componente hijo al cambiar un campo no
  relacionado del store; debe ser 0.

- [ ] **Paso 2: verificar que falla**

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "perf(ui): selectores granulares en Zustand"`

---

### Tarea 27: Responsive y objetivos táctiles (UI-09, F8, F14, F15, F16, F17)

**Ficheros:**
- Modificar: `src/components/Timeline/Timeline.tsx`, `src/components/Timeline/TrackHeader.tsx`,
  `src/components/Header/Header.tsx`, `src/components/Transport/TransportBar.tsx`,
  `src/components/Mixer/ChannelStrip.tsx`
- Crear: `src/tests/dom/responsive.test.tsx`

**Interfaces:**
- Produce: headers de pista `w-36 sm:w-60`; el ancho de lanes se deriva del ancho medido (Tarea 22).
- Produce: los botones de zoom, M/S/R, stop/loop/play, mute master, borrar pista y añadir efecto
  miden **≥ 44×44 px** en punteros gruesos.
- Produce: la barra de transporte **conserva** metrónomo y VU master en todos los breakpoints.
- Produce: la barra de herramientas flotante va a `bottom-2 right-2` por debajo de `sm`.

- [ ] **Paso 1: tests que fallan** — aserciones de clase y de `getBoundingClientRect` (jsdom da
  0; para el tamaño real ⇒ check B6 en el navegador: `el.getBoundingClientRect().width >= 44`).

- [ ] **Paso 2: verificar que fallan**

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test` + `npm run test:browser` (B6)

- [ ] **Paso 5: commit** → `git commit -m "feat(ui): responsive y objetivos táctiles de 44px"`

---

### Tarea 28: Teclado en la selección y el foco atrapado en los modales (UI-10, UI-11)

**Ficheros:**
- Modificar: `src/components/Timeline/TrackHeader.tsx`, `src/components/Timeline/Timeline.tsx`,
  `src/components/Mixer/ChannelStrip.tsx`, `src/components/Plugins/Knob.tsx`,
  `src/components/Plugins/PluginRackModal.tsx`, `src/components/Export/ExportModal.tsx`
- Crear: `src/tests/dom/keyboard.test.tsx`, `src/tests/dom/focusTrap.test.tsx`

**Interfaces:**
- Produce: `TrackHeader` focusable y activable con Enter/Espacio.
- Produce: los lanes de clips tienen `role="listbox"`.
- Produce: el readout dB y el valor del knob son `<button>`.
- Produce: los modales atrapan el `Tab` dentro del panel y marcan el fondo como `inert`.

- [ ] **Paso 1: tests que fallan**

- [ ] **Paso 2: verificar que fallan**

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test` + `npm run test:browser` (B5)

- [ ] **Paso 5: commit** → `git commit -m "a11y: teclado y trampa de foco en los modales"`

---

### Tarea 29: Fidelidad al sistema de diseño (UI-13, UI-14)

**Ficheros:**
- Modificar: `src/components/Timeline/WaveformCanvas.tsx`, `src/components/Transport/TransportBar.tsx`,
  `src/components/Mixer/ChannelStrip.tsx`, `src/components/Plugins/Knob.tsx`, `src/index.css`
- Crear: `src/tests/dom/designTokens.test.tsx`

**Interfaces:**
- Produce: los clips usan esquinas de 3 px (`rounded-[3px]`).
- Produce: todos los valores numéricos (tiempos, dB, knobs, BPM) llevan `tabular-nums`.
- Produce: las animaciones infinitas llevan `motion-safe:` y `index.css` incluye una regla
  `@media (prefers-reduced-motion: reduce)`.

- [ ] **Paso 1: tests que fallan** → asserts sobre las clases renderizadas.

- [ ] **Paso 2: verificar que fallan**

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "style: fidelidad a DESIGN.md (esquinas, numerales, movimiento)"`

---

# WAVE 4 — Funciones nuevas

### Tarea 30: Importar audio sin arrastrar (G1)

**Ficheros:**
- Crear: `src/audio/importAudio.ts`
- Modificar: `src/components/Header/Header.tsx`
- Modificar: `src/components/Timeline/Timeline.tsx` (usa el módulo compartido)
- Crear: `src/tests/dom/importAudio.test.tsx`

**Interfaces:**
- Produce:
  ```ts
  export interface ImportAudioResult { imported: number; failed: number; }
  export async function importAudioFiles(
    files: File[],
    options: { targetTrackId?: string; atTime?: number; createTrackIfMissing?: boolean },
  ): Promise<ImportAudioResult>;
  ```
  Usa `decodeAudioFile`, `generateWaveformPeaks` y `calculateMagneticSnap`; crea la pista si hace
  falta; **no** duplica la implementación del drag & drop.
- Produce: `Header` gana un botón "Importar audio" con `<input type="file" accept="audio/*" multiple>`.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| A1 | `importAudioFiles` con 2 ficheros ⇒ 2 clips añadidos, en la pista indicada |
| A2 | sin pista indicada ⇒ se crea una pista nueva |
| A3 | un fichero corrupto ⇒ 1 importado, 1 fallo, un toast de error, **sin** lanzar |
| A4 | el clip imported usa el snap magnético en la posición del playhead |
| A5 | el `Header` tiene un `<input type="file" accept="audio/*">` |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/dom/importAudio.test.tsx`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test` + `npm run test:browser`

- [ ] **Paso 5: commit** → `git commit -m "feat(audio): importar archivos de audio desde el header"`

---

### Tarea 31: Copiar, pegar y duplicar clips (G2)

**Ficheros:**
- Modificar: `src/store/useDawStore.ts` (`copyClips`, `pasteClips`, `duplicateSelectedClips`,
  portapapeles interno)
- Modificar: `src/hooks/useGlobalShortcuts.ts` (Ctrl+C/V/D/X)
- Crear: `src/tests/clipboard.test.ts`

**Interfaces:**
- Produce: acciones `copyClips(ids: string[]): void`, `pasteClips(atTime?: number): void`,
  `duplicateSelectedClips(): void`.
- Produce: el portapapeles es **interno** (guarda clips con sus `audioBuffer` y `peaks` por
  referencia; no duplica PCM).

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| C1 | copiar 2 clips y pegar ⇒ 2 clips nuevos con **ids nuevos** y el mismo `duration`/`startTime` |
| C2 | el clip pegado conserva su `audioBuffer` (referencia) |
| C3 | `duplicateSelectedClips` ⇒ los duplicados van justo después de los originales |
| C4 | pegar cuando el portapapeles está vacío ⇒ no hace nada y no lanza |
| C5 | copiar/pegar es **deshacible** (`undo` deshace el pegado) |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/clipboard.test.ts`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test`

- [ ] **Paso 5: commit** → `git commit -m "feat(edit): copiar, pegar y duplicar clips"`

---

### Tarea 32: Multi-selección de clips (G5)

**Ficheros:**
- Modificar: `src/store/useDawStore.ts` (`selectedClipIds: string[]` sustituye a `selectedClipId`;
  `selectClip(id, mode)`)
- Modificar: `src/components/Timeline/WaveformCanvas.tsx`, `src/components/Timeline/Timeline.tsx`,
  `src/components/Timeline/TrackHeader.tsx`, `src/hooks/useGlobalShortcuts.ts`
- Modificar: `src/store/persistence.ts` (la selección validada sigue siendo coherente)
- Crear: `src/tests/multiSelect.test.ts`

**Interfaces:**
- Produce: `selectedClipIds: string[]` (reemplaza a `selectedClipId`; el campo antiguo **se
  elimina**, no convive).
- Produce: `selectClip(id: string | null, mode: 'single' | 'toggle' | 'range'): void`.
- Produce: `Esc` limpia la selección; `Delete` borra **toda** la selección.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| M1 | click normal ⇒ 1 clip seleccionado |
| M2 | `toggle` ⇒ añade/quita de la selección |
| M3 | `range` ⇒ selecciona todos los clips entre el ancla y el destino (por tiempo y pista) |
| M4 | `Delete` borra todos los seleccionados |
| M5 | `undo` de un borrado múltiple restaura todos |
| M6 | la persistencia guarda y restaura `selectedClipIds` como array válido |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/tests/multiSelect.test.ts`

- [ ] **Paso 3: implementar** (incluye actualizar **todos** los usos de `selectedClipId`)

- [ ] **Paso 4: verificar** → tests + `npm test` + `npx tsc --noEmit`

- [ ] **Paso 5: commit** → `git commit -m "feat(edit): multi-selección de clips"`

---

### Tarea 33: Barrido de documentación (DOC-01, DOC-02, OPS-01 ya resuelto en T4)

**Ficheros:**
- Modificar: `PROJECT.md`, `HANDOFF.md`, `TEST_INFRA.md`, `TEST_READY.md`, `README.md`
- Crear: `docs/auditoria/02-export-dsp.md` (integrar la auditoría de Export/DSP)

**Interfaces:**
- Produce: ninguna cifra en la documentación sin el comando que la reproduce al lado.

- [ ] **Paso 1: reescribir `PROJECT.md`** — tabla de milestones real (qué está implementado, qué
  no, qué es roadmap), inventario de features con su estado *real* (F4-F17 pasan a "implementado"
  tras las Waves 2-3), y una sección de roadmap (MIDI, automatización, MP3, time-stretch).

- [ ] **Paso 2: reescribir `HANDOFF.md`** — un **único** bloque de estado (eliminar el duplicado),
  cifras medidas, y la lista de limitaciones **real** y **actual**.

- [ ] **Paso 3: reescribir `TEST_INFRA.md` y `TEST_READY.md`** — las 4 capas, qué cubre cada una,
  qué **no** cubre, y cómo ejecutarlas.

- [ ] **Paso 4: reescribir `README.md`** — capacidades reales (AAC, import de audio, sin WAM), y
  eliminar el placeholder de Search Console si no hay token.

- [ ] **Paso 5: verificar** que todas las cifras del documento coinciden con la realidad:

```bash
npm test -- --reporter=basic | tail -4
npm run build 2>&1 | tail -8
```

- [ ] **Paso 6: commit** → `git commit -m "docs: reescribe el estado real del proyecto y sus tests"`

---

# WAVE 5 — Seguridad y operaciones

### Tarea 34: Sandbox real de plugins (SEC-01, AUD-08)

**Ficheros:**
- Modificar: `src/audio/PluginHost.ts`
- Crear: `src/audio/pluginSandbox.ts`
- Modificar: `src/audio/plugin_safety.test.ts`
- Modificar: `src/components/Plugins/PluginRackModal.tsx`

**Interfaces:**
- Produce: `src/audio/pluginSandbox.ts` exporta
  `evaluateCustomPlugin(code: string): { ok: true; definition: CustomPluginDefinition } | { ok: false; error: string }`.
- Produce: el código se evalúa en un `<iframe sandbox="allow-scripts">` (origen opaco) con
  `postMessage`; si el sandbox no está disponible ⇒ **rechazo explícito**.
- Produce: lista de prohibición ampliada (ver spec §3.7) y rechazo de `constructor`/`__proto__`.

- [ ] **Paso 1: tests que fallan**

| Test | Aserción |
|---|---|
| SB1 | `globalThis.fetch` ⇒ rechazado, y `globalThis.__pwned` **no** existe |
| SB2 | `navigator.sendBeacon` ⇒ rechazado |
| SB3 | `location.href` ⇒ rechazado |
| SB4 | `x.constructor.constructor("...")` ⇒ rechazado |
| SB5 | `self['fe'+'tch']` ⇒ rechazado |
| SB6 | un plugin legítimo (que devuelve una definición válida) **sí** se acepta |
| SB7 | el código no puede leer `localStorage` ni `indexedDB` del padre |

- [ ] **Paso 2: verificar que fallan** → `npx vitest run src/audio/plugin_safety.test.ts`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → tests + `npm test` + `npm run build`

- [ ] **Paso 5: commit** → `git commit -m "fix(security): sandbox real para plugins de usuario"`

---

### Tarea 35: Service worker versionado (SW-01)

**Ficheros:**
- Modificar: `public/sw.js`
- Modificar: `vite.config.ts` (inyectar `__SW_VERSION__`)
- Crear: `src/tests/swPolicy.test.ts` (test de la **política**, leyendo el fichero como texto)

**Interfaces:**
- Produce: `__SW_VERSION__` inyectado por Vite con un hash del build; `CACHE_NAME` lo usa.
- Produce: navegaciones ⇒ **network-first**; `/assets/*` ⇒ **cache-first**.

- [ ] **Paso 1: test que falla** — leer `public/sw.js` como texto y afirmar:
  contiene `__SW_VERSION__`, contiene la rama network-first para navegaciones, y la rama
  cache-first para `/assets/`.

- [ ] **Paso 2: verificar que falla** → `npx vitest run src/tests/swPolicy.test.ts`

- [ ] **Paso 3: implementar**

- [ ] **Paso 4: verificar** → test + `npm test` + `npm run build` (el build debe dejar `sw.js` con
  la versión sustituida)

- [ ] **Paso 5: commit** → `git commit -m "fix(pwa): service worker versionado y network-first"`

---

### Tarea 36: PWA instalable, cabeceras y meta (CFG-01, HDR-01, SEO-01, CFG-02)

**Ficheros:**
- Crear: `public/icons/icon-192.png`, `public/icons/icon-512.png`,
  `public/icons/icon-512-maskable.png` (PNG reales generados por script)
- Crear: `scripts/generate-icons.mjs`
- Modificar: `public/manifest.webmanifest`, `index.html`, `public/_headers`, `vite.config.ts`

**Interfaces:**
- Produce: `npm run icons` regenera los iconos; el manifest los referencia con `purpose`
  correcto; `index.html` incluye `apple-touch-icon` y `og:image`.
- Produce: `_headers` incluye CSP, HSTS, `frame-ancestors 'none'`, `Referrer-Policy`.
- Produce: `vite.config.ts` fija `base: './'` y `build.target`.

- [ ] **Paso 1: test que falla** — leer `public/manifest.webmanifest` y `index.html` y `public/_headers`
  y afirmar la presencia de los iconos, las etiquetas meta y las cabeceras.

- [ ] **Paso 2: verificar que falla** → `npx vitest run src/tests/pwaAssets.test.ts`

- [ ] **Paso 3: implementar** — generar los PNG con un script propio (PNG sin dependencias: se
  puede emitir un PNG válido con `zlib` de Node). Iconos con la marca de HydraDAW (círculo cian
  sobre fondo oscuro), con zona segura para la variante maskable.

- [ ] **Paso 4: verificar** → test + `npm test` + `npm run build` + `npm run test:browser`

- [ ] **Paso 5: commit** → `git commit -m "feat(pwa): iconos, meta social y cabeceras de seguridad"`

---

### Tarea 37: Endurecer el tsconfig y cerrar el build (TS-01, CFG-02)

**Ficheros:**
- Modificar: `tsconfig.json` (`exactOptionalPropertyTypes: true`)
- Modificar: los ficheros con fallout

**Interfaces:**
- Produce: `tsconfig.json` con `exactOptionalPropertyTypes: true`.

- [ ] **Paso 1: activar la opción y ver el fallout**

```bash
npx tsc --noEmit
```

- [ ] **Paso 2: corregir el fallout** (sin `!` ni `as` como atajo; ajustar los tipos reales)

- [ ] **Paso 3: verificar**

```bash
npx tsc --noEmit && npm test && npm run build
```

- [ ] **Paso 4: commit** → `git commit -m "chore(ts): activa exactOptionalPropertyTypes"`

---

## Verificación final

- [ ] `npm test` verde, **con el recuento exacto anotado**.
- [ ] `npx tsc --noEmit` limpio.
- [ ] `npm run build` OK y **bundle total < 350 kB gzip** (anotar la cifra medida).
- [ ] `npm run test:browser` verde (incluido B7, que ya no es `expectedFailure`).
- [ ] `npm run test:all` verde de punta a punta.
- [ ] `docs/auditoria/01-informe-auditoria.md` actualizado con el estado final de cada hallazgo
  (resuelto / aceptado / diferido).
- [ ] `git log` legible: un commit por tarea, mensajes con prefijo de scope.

## Deuda que queda explícitamente (fuera de alcance, documentada)

- **MIDI** (G4) — roadmap.
- **Automatización de parámetros** (G3) — roadmap.
- **Export a MP3** (G8) — roadmap (WAV 16/24/32 + AAC cubren el caso).
- **Elasticidad de tempo / remuestreo** (G7) — roadmap.
- **WAM 2.0 / WebCLAP / AudioWorklet** — roadmap.
- **Migración de majors** (React 19, Vite 7, Vitest 3) — decisión explícita de no migrar.
