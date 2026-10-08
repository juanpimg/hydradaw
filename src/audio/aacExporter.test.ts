import { describe, it, expect } from 'vitest';
import {
  muxAdtsFrame,
  parseAdtsHeader,
  aacSampleRateIndex,
  isAacSupported,
  encodeAacAdts,
} from './aacExporter';

// Fix(waveC): cabecera ADTS válida (syncword, perfil LC, índice de tasa, frame length).
describe('aacExporter ADTS framing', () => {
  it('sampleRate index correcto 44100/48000', () => {
    expect(aacSampleRateIndex(44100)).toBe(4);
    expect(aacSampleRateIndex(48000)).toBe(3);
    expect(aacSampleRateIndex(12345)).toBe(-1);
  });

  it('cabecera válida estéreo 44100', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = muxAdtsFrame(payload, { sampleRate: 44100, numberOfChannels: 2 });
    expect(frame.length).toBe(7 + payload.length);
    expect(frame[0]).toBe(0xff);
    expect(frame[1]).toBe(0xf1);
    const h = parseAdtsHeader(frame);
    expect(h.syncword).toBe(0xfff);
    expect(h.profile).toBe(1); // AAC-LC
    expect(h.sampleRateIndex).toBe(4);
    expect(h.sampleRate).toBe(44100);
    expect(h.channels).toBe(2);
    expect(h.frameLength).toBe(7 + payload.length);
    expect(Array.from(frame.subarray(7))).toEqual(Array.from(payload));
  });

  it('cabecera válida mono 48000', () => {
    const payload = new Uint8Array(100).fill(0xab);
    const frame = muxAdtsFrame(payload, { sampleRate: 48000, numberOfChannels: 1 });
    const h = parseAdtsHeader(frame);
    expect(h.syncword).toBe(0xfff);
    expect(h.sampleRateIndex).toBe(3);
    expect(h.sampleRate).toBe(48000);
    expect(h.channels).toBe(1);
    expect(h.frameLength).toBe(107);
  });

  it('round-trip de N frames con longitudes variables', () => {
    const payloads = [10, 200, 37, 1024].map((n, i) => {
      const p = new Uint8Array(n);
      for (let k = 0; k < n; k++) p[k] = (i * 31 + k) & 0xff;
      return p;
    });
    const frames = payloads.map((p) =>
      muxAdtsFrame(p, { sampleRate: 44100, numberOfChannels: 2 }),
    );
    let total = 0;
    for (const f of frames) total += f.length;
    const stream = new Uint8Array(total);
    let off = 0;
    for (const f of frames) {
      stream.set(f, off);
      off += f.length;
    }
    // Recorre el stream parseando cada cabecera y recuperando payloads.
    let pos = 0;
    let idx = 0;
    while (pos < stream.length) {
      const slice = stream.subarray(pos);
      const h = parseAdtsHeader(slice);
      expect(h.syncword).toBe(0xfff);
      const body = slice.subarray(7, h.frameLength);
      expect(Array.from(body)).toEqual(Array.from(payloads[idx] ?? new Uint8Array()));
      pos += h.frameLength;
      idx++;
    }
    expect(idx).toBe(payloads.length);
  });

  it('rechaza tasa/canal/frame inválidos', () => {
    expect(() => muxAdtsFrame(new Uint8Array(8), { sampleRate: 12345, numberOfChannels: 2 })).toThrow();
    expect(() => muxAdtsFrame(new Uint8Array(8), { sampleRate: 44100, numberOfChannels: 0 })).toThrow();
    expect(() =>
      muxAdtsFrame(new Uint8Array(9000), { sampleRate: 44100, numberOfChannels: 2 }),
    ).toThrow();
  });
});

// Fix(waveC): wiring WebCodecs en capa fina (en Node sin AudioEncoder → error descriptivo).
describe('aacExporter soporte WebCodecs', () => {
  it('isAacSupported() es false sin AudioEncoder (p. ej. Safari/Node)', async () => {
    // En el runner Node no hay WebCodecs: debe resolver false, no lanzar.
    expect(await isAacSupported()).toBe(false);
  });

  it('encodeAacAdts lanza error descriptivo sin AudioEncoder', async () => {
    const data = new Float32Array(441);
    const buf = {
      sampleRate: 44100,
      numberOfChannels: 1,
      length: data.length,
      getChannelData: () => data as unknown as { length: number; [index: number]: number },
    };
    await expect(encodeAacAdts(buf, { bitrate: 128_000 })).rejects.toThrow(/AudioEncoder|no soportado/i);
  });
});
