# HydraDAW — Handoff para la próxima sesión

Última actualización: 2026-10-08

## Estado actual
- **Repo independiente:** https://github.com/juanpimg/hydradaw.git (`main`), local en `/home/jp/Escritorio/Proyectos/hydradaw`.
- **Origen:** copiado de `apps/hydra-daw` del monorepo `/home/jp/Escritorio/Proyectos/editor`. **Las dos copias pueden divergir**; decidir cuál es la fuente de verdad (recomendado: el repo `hydradaw`) y sincronizar.
- `npm install`, `npm run build` y `npm test` (71 tests) pasan en el repo independiente.
- Suite E2E con Chrome real (`scripts/test-browser-daw.mjs`) vive solo en el monorepo y pasó con 0 errores de consola (apunta a puerto 5175).
- **Cloudflare Pages: NO desplegado todavía.** Solo preparado (ver README).
- Subagentes y crons detenidos. No hay tareas en segundo plano.

## Arquitectura (src/)
- `audio/AudioEngine.ts` — reloj maestro (`AudioContext.currentTime`), reproducción, grabación (getUserMedia), mixdown offline.
- `audio/TrackNode.ts` — cadena por pista: FX → panner → gain → mute/solo → analyser.
- `audio/MasterBus.ts` — suma + limitador brickwall (-0.1 dBFS) + analyser.
- `audio/PluginHost.ts`, `builtinPlugins.ts` — 6 efectos integrados + importador de plugins JS locales.
- `audio/WavExporter.ts` — WAV 16/24-bit; `waveformUtils.ts` — picos y stems demo.
- `store/useDawStore.ts` — estado Zustand. `components/` — Header, Transport, Timeline, Mixer, Plugins, Export.

## Limitaciones conocidas / pendientes
1. **Persistencia:** la skill `opfs-storage` prometía OPFS/IndexedDB; el proyecto aún no se guarda entre sesiones (`idb-keyval` está como dependencia pero sin uso verificado). Implementar guardado/carga multi-proyecto.
2. **Plugins:** solo JS custom en el rack; no hay carga real de WAM 2.0 / WebCLAP / WASM ni AudioWorklet (el DSP usa nodos nativos de Web Audio).
3. **Exportación:** solo WAV. Faltan MP3/AAC (WebCodecs `AudioEncoder`) y medición LUFS / true peak.
4. **Tests:** `src/tests/*.test.ts` definen sus propias funciones auxiliares (audioMath, timelineOps) en lugar de importar código real de `src/`; conviene extraer esa lógica a módulos y testear la implementación real. En el E2E, el split con <kbd>S</kbd> no cambió el nº de clips (4 → 4); revisar.
5. **Móvil/táctil:** sin diseño responsivo < 768px ni hitboxes de 44px (regla del workspace).
6. **Cabeceras:** `_headers` usa COEP `credentialless`; el dev server de Vite usa `require-corp`. Unificar si se usa SharedArrayBuffer.
7. Bundle: ~233 kB JS (69 kB gzip); sin code-splitting.

## Cómo desplegar en Cloudflare Pages
Build `npm run build`, output `dist`, Node 20. Detalles en `README.md`.

## Comandos útiles
```bash
npm run dev     # :5175
npm test
npm run build
```
