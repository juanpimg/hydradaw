# HydraDAW — Handoff para la próxima sesión

Última actualización: 2026-10-08 (noche, tras waveA + waveB + waveC + E2E)

## Estado actual
- **Repo independiente:** https://github.com/juanpimg/hydradaw.git (`main`), local en `/home/jp/Escritorio/Proyectos/hydradaw`. ESTE repo es la fuente de verdad; `apps/hydra-daw` del monorepo editor es copia divergente sin sincronizar.
- `npm test`: **228/228 pasan** (17 ficheros). `npx tsc --noEmit` limpio con `strict + noUncheckedIndexedAccess + verbatimModuleSyntax`. Build OK: vendor 141kB + app 116kB + modales lazy (~79kB gzip inicial, <350kB).
- E2E en Chrome real (scripts en `/tmp/opencode/daw-*/verify*.mjs`): **0 errores de consola**. Verificado: demo 4/4, play/pause/stop, split con ratón real + S (4→5), plugins add/remove, export modal, loop/metrónomo, persistencia tras recarga, mixer con limiter, WAV 16-bit con sonido (peak ~1.0, RMS ~0.36), lectura LUFS visible ("Integrada: -7.1 LUFS"), AAC con degradación elegante donde no hay encoder (aviso + toast, sin crash).
- **Cloudflare Pages: NO desplegado todavía.** Conectar repo en el dashboard (build `npm run build`, output `dist`, Node 20).
- Subagentes detenidos. Dev server de verificación corriendo en :5175 (pararlo si molesta).

## Estado actual
- **Repo independiente:** https://github.com/juanpimg/hydradaw.git (`main`), local en `/home/jp/Escritorio/Proyectos/hydradaw`. ESTE repo es la fuente de verdad; `apps/hydra-daw` del monorepo editor es copia divergente sin sincronizar.
- `npm test`: **122/122 pasan** (8 ficheros). `npm run build` OK (JS ~251 kB / ~75 kB gzip).
- E2E en Chrome real (puppeteer-core, scripts en `/tmp/opencode/daw-e2e/` y `/tmp/opencode/daw-clickfix/verify.mjs`): **0 errores de consola, 0 pageerrors**. Verificado: demo 4 pistas/4 clips, play/pause/stop, split con ratón real + tecla S (4→5 clips), add/remove plugin, modal export, loop/metrónomo sin errores, persistencia tras recarga, mixer con limiter -0.1 dBFS. Carga ~1.2 s (networkidle0, SwiftShader).
- **Cloudflare Pages: NO desplegado todavía.** Solo preparado (ver README).
- Subagentes detenidos. Dev server de verificación corriendo en :5175 (pararlo si molesta).

## Lo hecho en el bucle (oleadas 1-4 + waveA + waveB + waveC)
- Oleadas 1-4 (base): persistencia idb-keyval + audio WAV32 por clip, audioMath/timelineOps reales, knobs en vivo, loop/metronomo reales, fix click-select (`WaveformCanvas` stopPropagation), fix export silenciosa (MasterBus→destination en offline).
- WaveA (8 frentes, 125→193 tests): punch-in sin autodestrucción, loop con lookahead+jitter, lastTake, syncTracks por firma, seek stop-primero, telemetría sin alloc; feedback clamp + clampToDef + IR con semilla/debounce + demo determinista 0.89 + split/trim/snap con límites y compás; store con resync/clamps/duration/setTimeSignature/setLoopRange; timeline con guard de atajos/DnD en cascada/Cortar deshabilitado/trim proporcional/foco+snap; transporte con BPM local-state + meters 15fps + VU dB; modales dialog/ESC/foco + knob teclado; buses con duck-typing + clamps + connect idempotente; persistencia con migración/sanitize/claves v1/tope 300MiB/autosave sin reloj.
- WaveB (193→212): alias `buffer` eliminado; loop inicio/fin + compás editables; WAV por bloques + round + `encodeWavAsync` + revoke segura; tsconfig endurecido (172 errores corregidos); lazy modals + vendor split + toast (adiós alert/confirm) + Permissions-Policy.
- WaveC (212→228): AAC-LC vía WebCodecs + ADTS manual, sonoridad BS.1770 con gating, pico verdadero estimado, normalizado -14 LUFS pre-codificación.
- Oleada 1: `src/store/persistence.ts` (autosave idb-keyval `hydradaw:project:v1`, regenera stems demo) + `App.tsx` (load guard StrictMode); `src/audio/audioMath.ts` + `src/audio/timelineOps.ts` (split/trim/snap reales, tests migrados de lógica duplicada a imports); engine: grabación deduplicada, `updateTrackPluginParam`, trim con clamp/offset, Ruler con denominador, listeners resize, Knob limpio.
- Oleada 2: store integrado (knobs en vivo, BPM→`setTempo`, split/trim delegados con minDuration 0.2 e ids únicos, `trimClip` nuevo) + audio de usuario persistido en WAV 32-bit float bit-exacto (`hydradaw:audio:<clipId>`, limpieza de huérfanos, degradación ante quota, clips >64 MiB omitidos).
- Oleada 3: loop real (stop+replanificación, `setLoop`, wrap en getCurrentTime; offline lineal a propósito) + metrónomo real (oscilador 2000/1000 Hz al tempo, `setMetronome`/`setTimeSignature`); store cableado (`toggleLoop/toggleMetronome` → engine).
- Oleada 4 (fix bloqueador E2E): `WaveformCanvas.tsx` — `onClick stopPropagation` para que el `onClick` del lane no borre la selección hecha en `mousedown`; sin esto ningún clip era seleccionable con ratón real.

## Limitaciones conocidas / pendientes ( roadmap )
1. **Plugins:** DSP con nodos nativos; sin WAM 2.0 / WebCLAP / WASM / AudioWorklet. `new Function(code)` sin sandbox (validar o aislar).
2. **Móvil/táctil:** sin responsive <768px ni hitboxes 44px (header/mixer/transporte con scroll-x como paliativo).
3. **Remuestreo:** clips restaurados a tasa original sin remuestreo si cambia el dispositivo; stems demo fijos a 120 BPM (rejillaWalk no estira audio).
4. **AAC real:** verificado solo degradación elegante en headless sin encoder; probar en Chrome headed con codecs propietarios.
5. **Mezcla caliente:** el demo suma ~+1.1 dBFS pre-limiter (el WAV int16 lo recorta); considerar ganancia de etapa o normalizado por defecto.
6. **Cabeceras:** COOP/COEP por higiene (Web Audio no los exige); `_headers` solo Pages/Netlify.
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
