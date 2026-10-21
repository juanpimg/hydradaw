// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  encodeWav,
  encodeWavAsync,
  downloadAudioBlob,
  WAV_ASYNC_CHUNK_SAMPLES,
} from './WavExporter';
import { decodeWavBytes } from '../store/persistence';

/** Mock mínimo de AudioBuffer para el runner Node. */
function mockBuffer(channels: Float32Array[], sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    duration: (channels[0]?.length ?? 0) / sampleRate,
    getChannelData: (c: number) => channels[c] as Float32Array<ArrayBuffer>,
  } as unknown as AudioBuffer;
}

/** memcmp rápido: evita el diff estructural de vitest en buffers de MB. */
function expectBytesEqual(a: Uint8Array, b: Uint8Array) {
  expect(a.length).toBe(b.length);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i]! ^ b[i]!);
  expect(diff).toBe(0);
}

function makeFakeCtx(): BaseAudioContext {
  return {
    createBuffer(chs: number, len: number, sr: number) {
      const data = Array.from({ length: chs }, () => new Float32Array(len));
      return {
        numberOfChannels: chs,
        length: len,
        sampleRate: sr,
        duration: len / sr,
        getChannelData: (c: number) => data[c],
      };
    },
  } as unknown as BaseAudioContext;
}

describe('WavExporter waveB: vectores conocidos por bit depth', () => {
  it('16-bit: -1.0, -0.0001, silencio, +0.9999, +1.0 con Math.round simétrico', () => {
    // Fix(waveB): -0.0001 * 32768 = -3.2768 → round -3; el floor anterior daba
    // -4 (error de 1 LSB en negativos). Ningún test existente codificaba el bug
    // (usaban toBeCloseTo ±5 LSB o full-scale exactos), así que no se tocó ninguno.
    const wav = encodeWav(mockBuffer([new Float32Array([-1.0, -0.0001, 0.0, 0.9999, 1.0])]), 16);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(-3);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(32764); // round(0.9999 * 32767)
    expect(view.getInt16(52, true)).toBe(32767);
    // Documenta la divergencia con el floor anterior en el caso clave:
    expect(Math.floor(-0.0001 * 0x8000)).toBe(-4);
  });

  it('16-bit: clamp de overs y NaN → 0 sin wraparound', () => {
    const wav = encodeWav(mockBuffer([new Float32Array([2.5, -3.8, NaN])]), 16);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(0);
  });

  it('24-bit: vectores LE de 3 bytes incl. -1.0, -0.0001 y +1.0', () => {
    const wav = encodeWav(
      mockBuffer([new Float32Array([-1.0, -0.0001, 0.0, 0.9999, 1.0])]),
      24,
    );
    const at = (i: number) => [wav[44 + i * 3], wav[44 + i * 3 + 1], wav[44 + i * 3 + 2]];
    expect(at(0)).toEqual([0x00, 0x00, 0x80]); // -8388608
    // Fix(waveB): round(-0.0001 * 2^23) = -839 → 2^24-839 = 0xFFFCB9 LE.
    expect(at(1)).toEqual([0xb9, 0xfc, 0xff]);
    expect(at(2)).toEqual([0x00, 0x00, 0x00]);
    expect(at(4)).toEqual([0xff, 0xff, 0x7f]); // 0x7FFFFF
    // +0.9999 programático contra la fórmula redondeada (independiente del loop):
    const int24 = Math.round(0.9999 * 0x7fffff);
    const u = int24 & 0xffffff;
    expect(at(3)).toEqual([u & 0xff, (u >> 8) & 0xff, (u >> 16) & 0xff]);
  });

  it('32-bit float: silencio, fracciones y headroom >0dBFS sin truncar', () => {
    const samples = new Float32Array([-1.0, -0.0001, 0.0, 0.9999, 1.25, -2.0]);
    const wav = encodeWav(mockBuffer([samples]), 32);
    const view = new DataView(wav.buffer);
    for (let i = 0; i < samples.length; i++) {
      expect(view.getFloat32(44 + i * 4, true)).toBe(Math.fround(samples[i]!));
    }
    // >0dBFS se conserva (sin clamp en float32):
    expect(view.getFloat32(44 + 4 * 4, true)).toBe(1.25);
    expect(view.getFloat32(44 + 5 * 4, true)).toBe(-2);
  });

  it('E3: 3 frames mono a 24 bits ⇒ archivo par con padding a 0 (alineación RIFF)', async () => {
    // dataSize = 3 frames × 1 ch × 3 bytes = 9 (impar): el WAV debe medir
    // 44 + 9 + 1 = 54 bytes (par), con el byte 53 a 0 y el tamaño RIFF a
    // 37 + 9 = 46. Sin padding, los importadores estrictos rechazan el archivo.
    const buf = mockBuffer([new Float32Array([0.5, -0.5, 0.25])]);
    for (const out of [encodeWav(buf, 24), await encodeWavAsync(buf, 24)]) {
      expect(out.length).toBe(54);
      expect(out.length % 2).toBe(0);
      expect(out[out.length - 1]).toBe(0);
      const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      expect(view.getUint32(4, true)).toBe(37 + 9); // tamaño RIFF
      expect(view.getUint32(40, true)).toBe(9); // dataSize intacto
    }
  });
  it('cabecera de 44 bytes idéntica para mono/44100/2 frames/16-bit', () => {
    const wav = encodeWav(mockBuffer([new Float32Array(2)]), 16);
    expect(wav.length).toBe(48);
    expect(Array.from(wav.subarray(0, 44))).toEqual([
      0x52, 0x49, 0x46, 0x46, // 'RIFF'
      0x28, 0x00, 0x00, 0x00, // chunkSize = 40
      0x57, 0x41, 0x56, 0x45, // 'WAVE'
      0x66, 0x6d, 0x74, 0x20, // 'fmt '
      0x10, 0x00, 0x00, 0x00, // subchunk1Size = 16
      0x01, 0x00, // PCM
      0x01, 0x00, // mono
      0x44, 0xac, 0x00, 0x00, // 44100
      0x88, 0x58, 0x01, 0x00, // byteRate = 88200
      0x02, 0x00, // blockAlign
      0x10, 0x00, // 16 bits
      0x64, 0x61, 0x74, 0x61, // 'data'
      0x04, 0x00, 0x00, 0x00, // dataSize = 4
    ]);
  });
});

describe('WavExporter waveB: encodeWavAsync equivale a sync y cede el loop', () => {
  // Buffer que supera 1 chunk (fuerza el camino por bloques + yields).
  function bigStereo(): AudioBuffer {
    const length = Math.floor(WAV_ASYNC_CHUNK_SAMPLES / 2) + 10_000;
    const ch0 = new Float32Array(length);
    const ch1 = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      ch0[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.7;
      ch1[i] = i % 2 === 0 ? -1.0 : 0.9999;
    }
    ch0[0] = 2.5; // overs también en el camino async
    ch1[1] = -3.8;
    return mockBuffer([ch0, ch1]);
  }

  it.each([16, 24, 32] as const)('async === sync byte a byte en %i-bit', async (depth) => {
    const buf = bigStereo();
    expectBytesEqual(await encodeWavAsync(buf, depth), encodeWav(buf, depth));
  });

  it('cede el event loop entre chunks (un timer colado corre antes de terminar)', async () => {
    const buf = bigStereo();
    let ticked = false;
    const tick = new Promise<void>((resolve) =>
      setTimeout(() => {
        ticked = true;
        resolve();
      }, 0),
    );
    const out = await encodeWavAsync(buf, 16);
    await tick;
    expect(ticked).toBe(true);
    expectBytesEqual(out, encodeWav(buf, 16));
  });

  it('reporta progreso (encodedFrames, totalFrames) y maneja buffer vacío', async () => {
    const seen: Array<[number, number]> = [];
    const buf = mockBuffer([
      new Float32Array([0.1, -0.2, 0.3]),
      new Float32Array([0.4, 0.5, -0.6]),
    ]);
    const out = await encodeWavAsync(buf, 16, (done, total) => seen.push([done, total]));
    expect(out).toEqual(encodeWav(buf, 16));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[seen.length - 1]).toEqual([3, 3]);

    const emptySeen: Array<[number, number]> = [];
    const empty = await encodeWavAsync(
      mockBuffer([new Float32Array(0), new Float32Array(0)]),
      24,
      (d, t) => emptySeen.push([d, t]),
    );
    expect(empty.length).toBe(44);
    expect(emptySeen).toEqual([[0, 0]]);
  });
});

describe('WavExporter waveB: round-trip con el parser de persistencia', () => {
  it('32-bit float es bit-exacto (incl. >0dBFS)', () => {
    const ctx = makeFakeCtx();
    const ch0 = new Float32Array([0.0, 0.75, 1.25, -2.0, -0.0001]);
    const ch1 = new Float32Array([-1.0, 0.9999, 0.5, -0.5, 0.0]);
    const original = mockBuffer([ch0, ch1]);
    const decoded = decodeWavBytes(encodeWav(original, 32), ctx);
    expect(decoded.numberOfChannels).toBe(2);
    expect(decoded.length).toBe(ch0.length);
    for (let c = 0; c < 2; c++) {
      const a = original.getChannelData(c);
      const b = decoded.getChannelData(c);
      for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]);
    }
  });

  it('16-bit PCM dentro de 2/32768 (rampa con negativos)', () => {
    const ctx = makeFakeCtx();
    const n = 2048;
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = (i / (n - 1)) * 2 - 1; // [-1, 1]
    const original = mockBuffer([ch]);
    const decoded = decodeWavBytes(encodeWav(original, 16), ctx);
    const a = original.getChannelData(0);
    const b = decoded.getChannelData(0);
    let maxDiff = 0;
    for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i]! - b[i]!));
    expect(maxDiff).toBeLessThanOrEqual(2 / 32768);
  });
});

describe('WavExporter waveB: volumen a escala (smoke previo cuello de botella)', () => {
  it('codifica 500k frames estéreo 16-bit con longitud y muestras exactas', () => {
    const n = 500_000;
    const ch0 = new Float32Array(n);
    const ch1 = new Float32Array(n);
    ch0[0] = 1.0;
    ch1[n - 1] = -1.0;
    const wav = encodeWav(mockBuffer([ch0, ch1]), 16);
    expect(wav.length).toBe(44 + n * 2 * 2);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(44 + (n * 2 - 1) * 2, true)).toBe(-32768);
  });
});

describe('WavExporter waveB: downloadAudioBlob revoca tarde y una sola vez', () => {
  let urls: string[];
  let createSpy: { mockRestore: () => void };
  let revokeSpy: { mockRestore: () => void };
  let doc: {
    visibilityState: string;
    createElement: ReturnType<typeof vi.fn>;
    body: { appendChild: ReturnType<typeof vi.fn>; removeChild: ReturnType<typeof vi.fn> };
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
  let listeners: Record<string, Array<() => void>>;
  let counter = 0;

  beforeEach(() => {
    urls = [];
    counter = 0;
    createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((() => {
        const url = `blob:mock-${++counter}`;
        urls.push(url);
        return url;
      }) as typeof URL.createObjectURL);
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((() => {}) as typeof URL.revokeObjectURL);
    listeners = {};
    const anchor = {
      style: {} as Record<string, string>,
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    doc = {
      visibilityState: 'visible',
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      addEventListener: vi.fn((type: string, fn: () => void) => {
        (listeners[type] ??= []).push(fn);
      }),
      removeEventListener: vi.fn((type: string, fn: () => void) => {
        listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
      }),
    };
    vi.stubGlobal('document', doc);
  });

  afterEach(() => {
    vi.useRealTimers();
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('revoca a los 30s (no a los 100ms) y una sola vez aunque el timer siga', () => {
    vi.useFakeTimers();
    try {
      downloadAudioBlob(new Blob(['x']), 'a.wav');
      expect(createSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(revokeSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(29_900);
      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledWith(urls[0]);
      vi.advanceTimersByTime(120_000);
      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it('el segundo click revoca la URL anterior pendiente', () => {
    vi.useFakeTimers();
    try {
      downloadAudioBlob(new Blob(['x']), 'a.wav');
      downloadAudioBlob(new Blob(['y']), 'b.wav');
      // La anterior se revoca al instante, exactamente una vez:
      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledWith(urls[0]);
      vi.advanceTimersByTime(30_000);
      expect(revokeSpy).toHaveBeenCalledTimes(2);
      expect(revokeSpy).toHaveBeenCalledWith(urls[1]);
      vi.advanceTimersByTime(60_000);
      expect(revokeSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('visibilitychange a hidden revoca una sola vez', () => {
    vi.useFakeTimers();
    try {
      downloadAudioBlob(new Blob(['x']), 'a.wav');
      expect(listeners['visibilitychange']?.length).toBe(1);
      const fire = () => listeners['visibilitychange']!.forEach((fn) => fn());
      fire(); // visible → no revoca
      expect(revokeSpy).not.toHaveBeenCalled();
      doc.visibilityState = 'hidden';
      fire();
      expect(revokeSpy).toHaveBeenCalledTimes(1);
      fire(); // listener retirado → sin doble revocación
      vi.advanceTimersByTime(60_000);
      expect(revokeSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
