import { useDawStore, generateClipId, beginHistoryBatch, endHistoryBatch } from '../store/useDawStore';
import { audioEngine } from './AudioEngine';
import { decodeAudioFile, generateWaveformPeaks } from './waveformUtils';
import { calculateMagneticSnap } from './timelineOps';

export interface ImportAudioResult {
  imported: number;
  failed: number;
}

export interface ImportAudioOptions {
  // TS-01 (exactOptionalPropertyTypes): `undefined` explícito ≡ sin destino.
  targetTrackId?: string | undefined;
  atTime?: number;
  createTrackIfMissing?: boolean;
}

function baseNameOf(fileName: string): string {
  const stripped = fileName.replace(/\.[^/.]+$/, '');
  return stripped.length > 0 ? stripped : 'Audio importado';
}

/**
 * Importa ficheros de audio al proyecto (una sola implementación compartida
 * por el botón del Header y el arrastrar-y-soltar del Timeline).
 * - Decodifica cada fichero, genera picos y coloca el clip con snap magnético
 *   en cascada desde `atTime` (por defecto el playhead del motor).
 * - Si no hay pista destino se crea una (salvo `createTrackIfMissing: false`).
 * - Un fichero corrupto cuenta como fallo con toast y no interrumpe el resto.
 * - Nunca lanza por ficheros corruptos; solo `ensureContext` fallido degrada
 *   todo el lote a fallos con un toast.
 */
export async function importAudioFiles(
  files: File[],
  options: ImportAudioOptions = {},
): Promise<ImportAudioResult> {
  const { targetTrackId, atTime, createTrackIfMissing = true } = options;
  if (files.length === 0) return { imported: 0, failed: 0 };

  let ctx: AudioContext;
  try {
    ctx = await audioEngine.ensureContext();
  } catch (err) {
    useDawStore.getState().pushToast('No se pudo inicializar el motor de audio para importar: ' + err);
    return { imported: 0, failed: files.length };
  }

  let resolvedTrackId: string | null = targetTrackId ?? null;
  // M-4: todo el lote (pistas + clips) es UNA acción lógica: un snapshot.
  beginHistoryBatch();
  let mutated = false;
  try {
    if (resolvedTrackId !== null) {
      const exists = useDawStore.getState().tracks.some((t) => t.id === resolvedTrackId);
      if (!exists) {
        if (!createTrackIfMissing) {
          useDawStore.getState().pushToast('No hay pista donde importar el audio.');
          return { imported: 0, failed: files.length };
        }
        resolvedTrackId = useDawStore.getState().addTrack(baseNameOf(files[0]?.name ?? ''));
        mutated = true;
      }
    } else if (!createTrackIfMissing) {
      const first = useDawStore.getState().tracks[0];
      if (!first) {
        useDawStore.getState().pushToast('No hay pista donde importar el audio.');
        return { imported: 0, failed: files.length };
      }
      resolvedTrackId = first.id;
    }

    const baseTime = atTime ?? audioEngine.getCurrentTime();
    let imported = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      // Sin pista destino se crea UNA pista por archivo, como hacía el
      // drag-and-drop original (`addTrack` dentro del bucle). Con pista destino
      // todos los clips comparten ese carril.
      const laneId = resolvedTrackId
        ?? (createTrackIfMissing
          ? useDawStore.getState().addTrack(baseNameOf(file.name))
          : (useDawStore.getState().tracks[0]?.id ?? null));
      if (laneId === null) {
        failed++;
        useDawStore.getState().pushToast('No hay pista donde importar el audio.');
        continue;
      }
      if (laneId !== resolvedTrackId) mutated = true;
      try {
        const audioBuffer = await decodeAudioFile(file, ctx);
        const peaks = generateWaveformPeaks(audioBuffer, 800);
        const state = useDawStore.getState();
        const dur = audioBuffer.duration;
        const rawStart = baseTime + i * (dur + 0.5);
        const { snappedTime } = calculateMagneticSnap(
          rawStart,
          state.bpm,
          state.timeSignature,
          state.clips,
          0.1,
          state.snapMode,
        );
        state.addClip({
          id: generateClipId(),
          trackId: laneId,
          name: file.name,
          startTime: snappedTime,
          duration: dur,
          offset: 0,
          audioBuffer,
          peaks,
          color: '#06b6d4',
        });
        imported++;
        mutated = true;
      } catch (err) {
        failed++;
        useDawStore.getState().pushToast('Error al importar archivo de audio: ' + err);
      }
    }

    return { imported, failed };
  } finally {
    endHistoryBatch(mutated);
  }
}
