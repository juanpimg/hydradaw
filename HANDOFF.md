# HydraDAW — Handoff para la próxima sesión

Última actualización: 2026-10-08 (noche, tras bucle agéntico oleadas 1-4 + fix click-select)

## Estado actual
- **Repo independiente:** https://github.com/juanpimg/hydradaw.git (`main`), local en `/home/jp/Escritorio/Proyectos/hydradaw`. ESTE repo es la fuente de verdad; `apps/hydra-daw` del monorepo editor es copia divergente sin sincronizar.
- `npm test`: **122/122 pasan** (8 ficheros). `npm run build` OK (JS ~251 kB / ~75 kB gzip).
- E2E en Chrome real (puppeteer-core, scripts en `/tmp/opencode/daw-e2e/` y `/tmp/opencode/daw-clickfix/verify.mjs`): **0 errores de consola, 0 pageerrors**. Verificado: demo 4 pistas/4 clips, play/pause/stop, split con ratón real + tecla S (4→5 clips), add/remove plugin, modal export, loop/metrónomo sin errores, persistencia tras recarga, mixer con limiter -0.1 dBFS. Carga ~1.2 s (networkidle0, SwiftShader).
- **Cloudflare Pages: NO desplegado todavía.** Solo preparado (ver README).
- Subagentes detenidos. Dev server de verificación corriendo en :5175 (pararlo si molesta).

## Lo hecho en el bucle (oleadas 1-4)
- Oleada 1: `src/store/persistence.ts` (autosave idb-keyval `hydradaw:project:v1`, regenera stems demo) + `App.tsx` (load guard StrictMode); `src/audio/audioMath.ts` + `src/audio/timelineOps.ts` (split/trim/snap reales, tests migrados de lógica duplicada a imports); engine: grabación deduplicada, `updateTrackPluginParam`, trim con clamp/offset, Ruler con denominador, listeners resize, Knob limpio.
- Oleada 2: store integrado (knobs en vivo, BPM→`setTempo`, split/trim delegados con minDuration 0.2 e ids únicos, `trimClip` nuevo) + audio de usuario persistido en WAV 32-bit float bit-exacto (`hydradaw:audio:<clipId>`, limpieza de huérfanos, degradación ante quota, clips >64 MiB omitidos).
- Oleada 3: loop real (stop+replanificación, `setLoop`, wrap en getCurrentTime; offline lineal a propósito) + metrónomo real (oscilador 2000/1000 Hz al tempo, `setMetronome`/`setTimeSignature`); store cableado (`toggleLoop/toggleMetronome` → engine).
- Oleada 4 (fix bloqueador E2E): `WaveformCanvas.tsx` — `onClick stopPropagation` para que el `onClick` del lane no borre la selección hecha en `mousedown`; sin esto ningún clip era seleccionable con ratón real.

## Limitaciones conocidas / pendientes
1. **Plugins:** solo JS custom en el rack; no hay carga real de WAM 2.0 / WebCLAP / WASM ni AudioWorklet (el DSP usa nodos nativos de Web Audio). `new Function(code)` sin sandbox.
2. **Exportación:** solo WAV. Faltan MP3/AAC (WebCodecs `AudioEncoder`) y medición LUFS / true peak.
3. **Móvil/táctil:** sin diseño responsivo < 768px ni hitboxes de 44px (regla del workspace).
4. **Cabeceras:** `_headers` usa COEP `credentialless`; el dev server de Vite usa `require-corp`. Unificar si se usa SharedArrayBuffer.
5. Bundle ~251 kB JS (~75 kB gzip); sin code-splitting.
6. Stems demo usan `Math.random`: tras recargar el ruido difiere ligeramente (estructura/tempo idénticos). Renombrar un clip demo lo marca para reimportar.
7. Sin Web Audio (SSR/Node) la restauración de audio queda pendiente hasta tener contexto.

## Cómo desplegar en Cloudflare Pages
Build `npm run build`, output `dist`, Node 20. Detalles en `README.md`.

## Comandos útiles
```bash
npm run dev     # :5175
npm test
npm run build
```
