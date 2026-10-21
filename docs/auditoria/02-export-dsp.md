# HydraDAW — Auditoría de dominio: Exportación y utilidades DSP

> Fecha: 2026-10-21 · Base: `aca438b` · Método: auditoría de solo lectura + verificación en código.
> Complementa a `docs/auditoria/01-informe-auditoria.md` (§1.5).

## Hallazgos

| ID | Sev | Ubicación | Hallazgo |
|---|---|---|---|
| EXP-01 | **P1** | `AudioEngine.ts:700-716`, `ExportModal.tsx:54,146` | `renderOffline()` construye un `MasterBus` nuevo con volumen 1.0 y sin mute, y `OfflineRenderOptions` no tiene campos de master. `ExportModal` nunca lee `masterVolume`/`masterMute` ⇒ **el master a −20 dB no afecta a la exportación**: el archivo sale a escala completa, distinto de lo que se oía. |
| EXP-02 | P2 | `loudness.ts:48-74` | El K-weighting usa un *high-shelf* RBJ con S=1.2, que **no reproduce** el pre-filtro de la Tabla 1 de BS.1770-4 (+0.27 dB a 1 kHz frente a los +0.67 dB de la referencia) ⇒ **sesgo sistemático de ~0.2-0.4 LU** en toda lectura de loudness, heredado por la normalización a −14 LUFS. El test existente usa una ventana calibrada a la implementación desviada, así que no puede detectarlo. |
| EXP-03 | P2 | `ExportModal.tsx:5,197`, `WavExporter.ts:175` | El modal llama al `encodeWav` **síncrono**. `encodeWavAsync` (por bloques, cede el event loop, reporta progreso) existe y **no tiene ningún llamador en producción** ⇒ exportar un proyecto largo **congela la pestaña** varios segundos. |
| EXP-04 | P2 | `WavExporter.ts:24-33,180` | Todo el render se materializa en memoria: `AudioBuffer` + `ArrayBuffer` WAV completo + copia en `Blob` (10 min estéreo 48 kHz ≈ 230 MB en float32) ⇒ sin tope de duración, sin streaming, sin guarda de OOM. `wavExporterPerf.test.ts` sólo comprueba igualdad de bytes y un smoke de 500 k frames: **no comprueba memoria**. |
| EXP-05 | P3 | `WavExporter.ts:31-32` | Sin **padding de palabra RIFF**: si `dataSize` es impar (24 bits mono con nº impar de frames), el archivo tiene longitud impar y viola la regla de alineación de chunks ⇒ algunos importadores estrictos lo rechazan. |
| EXP-11 | P3 | `ExportModal.tsx:63`, `WavExporter.ts:122-139` | El selector de profundidad ofrece sólo 16 y 24, aunque el encoder soporta 32 bits float (probado, round-trip bit-exacto) ⇒ tras normalizar a −14 LUFS con `wouldClip`, la única opción **recorta a 0 dBFS**. |
| EXP-12 | P3 | `loudness.ts:232-240` | Para entradas de menos de 400 ms se mide el cuadrado medio del bloque parcial en vez de rellenar con ceros ⇒ un tono de 100 ms lee ~6 dB más caliente de lo que marca el estándar. |
| AAC-06 | P3 | `aacExporter.ts:46-48` | `channel_config` para 8 canales escribe `0` ("definido en PCE") en vez de `7` (ISO 14496-3 Tabla 1.42) ⇒ un frame ADTS de 8 canales sería indecodificable. Latente: el render offline siempre es estéreo. |
| DSP-07 | P3 | `waveformUtils.ts:33-45` | `new Float32Array(targetPoints * 2)` se ejecuta **antes** del guard `targetPoints <= 0` ⇒ `generateWaveformPeaks(buf, -4)` lanza `RangeError`. |
| DSP-08 | P3 | `audioMath.ts:9-30,61-75` | `dbToLinear(NaN)` ⇒ NaN; `secondsToSamples(NaN, sr)` ⇒ NaN (con tipo `number`); `calculatePeakAndRMS` envenena el RMS con un único NaN mientras el pico lo ignora ⇒ inconsistencia dentro de la misma función. |
| DSP-09 | P3 | `audioMath.ts:33-52` | Las leyes de pan no protegen contra NaN (`Math.min/max` propagan NaN) ⇒ `calculateConstantPowerPan(NaN)` devuelve `{ left: NaN, right: NaN }` ⇒ **silencia la pista sin error**. |
| DSP-10 | P3 | `timelineOps.ts:42,94-100,128` | Ni split ni trim validan finitud ⇒ `splitClipOperation(clip, NaN)` devuelve clips con `startTime`/`duration`/`offset` en NaN ⇒ **geometría envenenada en el estado del proyecto**. |

## Verificado como correcto

- **Cabecera WAV**: `chunkSize = 36 + dataSize` (= filesize−8), little-endian con `DataView`, `byteRate`/
  `blockAlign`/`bitsPerSample`/format codes (1 PCM, 3 float) correctos.
- **Codificación PCM**: escala simétrica con `Math.round` (`0x7FFF`/`0x8000`, `0x7FFFFF`/`0x800000`),
  clamp antes de escalar (sin wraparound), intercalado estéreo `[L0,R0,…]`, float 32 sin clampar.
- **ADTS** (1-7 canales): syncword `0xFFF`, MPEG-4 `0xF1`, perfil LC, tabla de índices de
  muestreo, longitud de frame de 13 bits, VBR fullness `0x7FF`; la config del encoder coincide
  con la cabecera que se escribe. `isAacSupported` degrada a `false` sin WebCodecs y ambos
  caminos de error lanzan mensajes descriptivos voids de toast ⇒ sin ruta de crash.
- **Núcleo del render offline**: conecta a `destination` por la cadena maestra completa
  (volumen→limiter→ceiling→mute→analyser), reconstruye ganancia/pan/mute/solo y **plugins
  habilitados** por pista, respeta `offset`/`startTime`/`duration` (incluidos clips con inicio
  negativo y recorte al final del buffer), aplica fades, renderiza linealmente (sin wrap de loop:
  decisión de diseño documentada) y con metrónomo opcional al tempo real.
- **Núcleo de loudness**: bloques de 400 ms con solape de 100 ms, gating en dos pasos (−70 LUFS
  absoluto, −10 LU relativo, `>` estricto), constante −0.691, G=1.0 en estéreo, filtrado K con
  estado por canal **sobre copias** (la entrada nunca se muta), true-peak con sobremuestreo
  polyphase ×4 que detecta picos inter-muestra, y normalización con tope de +12 dB y `wouldClip`
  calculado sobre `max(peak, truePeak)`.
- **UX de error de exportación**: `catch → pushToast` + `finally → setIsExporting(false)` ⇒ no
  queda un estado "exportando" colgado; el cierre y la tecla Escape se bloquean durante el render;
  `downloadAudioBlob` revoca la URL una sola vez (a los 30 s / al ocultar / al segundo click).
- **Límites de línea de tiempo**: el split rechaza en los bordes con exclusión de `minDuration`;
  los trims acotan `start ≥ 0`, `offset ≥ 0`, `duration ≥ min`, y el trim derecho se limita a la
  longitud de la fuente; el snap magnético respeta el umbral, da prioridad al clip y respeta el
  modo `'off'`.

## Dónde va cada corrección

Todas estas correcciones están ejecutadas en el plan maestro
`docs/superpowers/plans/2026-10-21-hydradaw-hardening.md`:

- EXP-01, EXP-03, EXP-04, EXP-05, EXP-11 ⇒ **Tarea 17** (Exportación fiel al mixer).
- EXP-02, EXP-12 ⇒ **Tarea 18** (LUFS conforme a BS.1770-4).
- AAC-06, DSP-07, DSP-08, DSP-09, DSP-10 ⇒ **Tarea 19** (Guarding numérico).

## Estado tras el hardening (2026-10-21, verificado en código y tests)

| ID | Estado |
|---|---|
| EXP-01 | **Resuelto.** El render offline respeta volumen master y mute (`ExportModal` + `AudioEngine.renderOffline`); test de no-divergencia. |
| EXP-02 | **Resuelto.** K-weighting con los coeficientes exactos de la Tabla 1 de BS.1770-4 a 48 kHz (derivación bilineal verificada término a término); la ventana del test se movió al valor del estándar. |
| EXP-03 | **Resuelto.** El modal usa `encodeWavAsync` (por bloques, cede el event loop, reporta progreso); el comentario que decía lo contrario se corrigió. |
| EXP-04 | **Resuelto (mitigado con presupuesto).** Codificación por bloques + guardas de memoria; el test solo de igualdad de bytes se complementó con presupuestos explícitos. |
| EXP-05 | **Resuelto.** Padding RIFF (`padBytes = dataSize % 2`, RIFF size `36 + dataSize + padBytes`), verificado aritméticamente contra la spec. |
| EXP-11 | **Resuelto.** El selector ofrece 16, 24 y **32-bit float** (`ExportModal.tsx`: `useState<16 \| 24 \| 32>`). |
| EXP-12 | **Resuelto.** Entradas cortas conformes al estándar (cero-pad), no lectura caliente del bloque parcial. |
| AAC-06 | **Resuelto (8→7); resto aceptado.** 8 canales escribe `channel_config` 7; un stream genuino de 7 canales sigue escribiendo 7 (sin código de 7 canales en MPEG-4 Audio): extremadamente raro, documentado en código. |
| DSP-07 | **Resuelto.** Guard antes de alocar (`targetPoints <= 0` no lanza). |
| DSP-08 | **Resuelto.** `dbToLinear(NaN)` ⇒ 1 (unity: un NaN suelto significa "sin atenuación", no "silencio"); `secondsToSamples` y `calculatePeakAndRMS` saneados. |
| DSP-09 | **Resuelto.** `calculateConstantPowerPan(NaN)` devuelve las ganancias reales de `pan = 0` (potencia constante, no `{1,1}` que serían +3 dB). |
| DSP-10 | **Resuelto.** Split y trim validan finitud: un NaN no envenena la geometría. |
