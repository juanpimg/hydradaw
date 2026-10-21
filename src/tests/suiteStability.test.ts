import { describe, it, expect } from 'vitest';
import { createReverbImpulse } from '../audio/builtinPlugins';
import { encodeWav, encodeWavAsync } from '../audio/WavExporter';

// Task 38 (ronda fix 1): guarda de COMPORTAMIENTO (no meta-test sobre el
// fuente). El flake vino de DSP síncrono pesado sin margen contra el timeout
// de 5 s (los presupuestos explícitos de 60 s en plugin_safety/wavExporterPerf
// son la mitigación ambiental documentada). Esta guarda fija el comportamiento
// que una regresión de rendimiento rompería: salidas deterministas y
// equivalentes con entradas pequeñas. Las entradas son deliberadamente
// pequeñas (milisegundos de CPU): solo un colapso patológico del rendimiento
// (100×+) haría tropezar el presupuesto generoso de 30 s, y entonces debe
// fallar —ese es el tripwire.

function makeTinyCtx(sampleRate = 44100) {
  return {
    sampleRate,
    createBuffer: (channels: number, length: number, rate: number) => {
      const data: Float32Array[] = [];
      for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        getChannelData: (c: number) => {
          const channel = data[c];
          if (!channel) throw new Error('canal inexistente');
          return channel;
        },
      };
    },
  } as unknown as BaseAudioContext;
}

function makeTinyBuffer() {
  const left = new Float32Array([0.1, -0.2, 0.3, -0.4, 0.5]);
  const right = new Float32Array([-0.5, 0.4, -0.3, 0.2, -0.1]);
  return {
    numberOfChannels: 2,
    length: left.length,
    sampleRate: 44100,
    getChannelData: (c: number) => (c === 0 ? left : right),
  } as unknown as AudioBuffer;
}

describe('Task 38: salidas DSP deterministas y equivalentes (guarda de comportamiento)', () => {
  it(
    'la IR de reverb es determinista para la misma decay',
    { timeout: 30_000 },
    () => {
      const ctx = makeTinyCtx();
      const a = createReverbImpulse(ctx, 0.1, 0.5);
      const b = createReverbImpulse(ctx, 0.1, 0.5);
      expect(a.length).toBe(b.length);
      expect(a.getChannelData(0)).toEqual(b.getChannelData(0));
      expect(a.getChannelData(1)).toEqual(b.getChannelData(1));
      // ...y distinta decay da distinto contenido (no es una constante).
      const c = createReverbImpulse(ctx, 0.1, 1.5);
      expect(c.getChannelData(0)).not.toEqual(a.getChannelData(0));
    }
  );

  it(
    'encodeWavAsync equivale a encodeWav byte a byte en 16/24/32-bit',
    { timeout: 30_000 },
    async () => {
      const buf = makeTinyBuffer();
      for (const depth of [16, 24, 32] as const) {
        const sync = encodeWav(buf, depth);
        const asyncOut = await encodeWavAsync(buf, depth);
        expect(asyncOut).toEqual(sync);
      }
    }
  );
});
