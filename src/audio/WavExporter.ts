/**
 * High-speed offline WAV encoder & mixdown renderer
 */

/**
 * Encodes an AudioBuffer into standard RIFF WAV format (16-bit, 24-bit PCM, or 32-bit IEEE Float)
 */
export function encodeWav(audioBuffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Uint8Array {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  // Helper to write ASCII strings
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /* RIFF chunk descriptor */
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // chunkSize (36 + dataSize)
  writeString(8, 'WAVE');

  /* FMT sub-chunk */
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);           // subchunk1Size (16 for PCM / IEEE Float)
  // Format code: 1 = WAVE_FORMAT_PCM (16/24-bit), 3 = WAVE_FORMAT_IEEE_FLOAT (32-bit float)
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, numChannels, true);  // numChannels
  view.setUint32(24, sampleRate, true);   // sampleRate
  view.setUint32(28, byteRate, true);     // byteRate
  view.setUint16(32, blockAlign, true);   // blockAlign
  view.setUint16(34, bitDepth, true);     // bitsPerSample

  /* Data sub-chunk */
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);     // subchunk2Size

  // Interleave audio samples
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  if (bitDepth === 16) {
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        // Clamp to [-1.0, 1.0]
        const sample = Math.max(-1, Math.min(1, channels[c][i]));
        // Scale to 16-bit signed integer
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, Math.floor(int16), true);
        offset += 2;
      }
    }
  } else if (bitDepth === 24) {
    // 24-bit PCM
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = Math.max(-1, Math.min(1, channels[c][i]));
        const int24 = Math.floor(sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF);
        view.setUint8(offset, int24 & 0xFF);
        view.setUint8(offset + 1, (int24 >> 8) & 0xFF);
        view.setUint8(offset + 2, (int24 >> 16) & 0xFF);
        offset += 3;
      }
    }
  } else if (bitDepth === 32) {
    // 32-bit IEEE 754 Float PCM
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        view.setFloat32(offset, channels[c][i], true);
        offset += 4;
      }
    }
  }

  return new Uint8Array(arrayBuffer);
}

/**
 * Triggers browser download for a Blob
 */
export function downloadAudioBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
