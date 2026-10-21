// M4: presupuesto de importación de audio — decodeAudioFile no lee blobs
// gigantes a memoria (patrón de App.tsx MAX_IMPORT_FILE_BYTES).
import { describe, it, expect, vi } from 'vitest';
import { decodeAudioFile, MAX_AUDIO_FILE_BYTES } from '../audio/waveformUtils';

function fakeCtx() {
  return {
    decodeAudioData: vi.fn(async () => ({ duration: 1 }) as unknown as AudioBuffer),
  } as unknown as BaseAudioContext;
}

describe('M4: presupuesto de importación de audio', () => {
  it('un blob por encima del presupuesto se rechaza SIN leerlo a memoria', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(8));
    const huge = { size: MAX_AUDIO_FILE_BYTES + 1, arrayBuffer } as unknown as Blob;
    await expect(decodeAudioFile(huge, fakeCtx())).rejects.toThrow(/demasiado grande/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('un blob dentro del presupuesto se decodifica con normalidad', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(8));
    const ok = { size: 1024, arrayBuffer } as unknown as Blob;
    await decodeAudioFile(ok, fakeCtx());
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });
});
