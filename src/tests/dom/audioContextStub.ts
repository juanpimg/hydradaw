import { vi } from 'vitest';

/**
 * Hogar compartido del `AudioContext` simulado usado por la capa node
 * (`src/tests/contract/helpers/testHelpers.ts`) y por la capa DOM
 * (`src/tests/dom/setup.ts`). Una sola implementación: no mantener copias
 * divergentes.
 *
 * Extraído de `src/tests/e2e/helpers/testHelpers.ts` (ahora `contract`).
 * Sin efectos colaterales en la importación: el stub solo se instala al
 * llamar a `ensureMockAudioContext()`.
 */
export class MockAudioContext {
  sampleRate: number;
  state: AudioContextState = 'suspended';
  currentTime: number = 0;
  destination = {};

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate ?? 44100;
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  createGain() {
    return {
      gain: { value: 1, setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createStereoPanner() {
    return {
      pan: { value: 0, setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createDynamicsCompressor() {
    return {
      threshold: { value: -24 },
      knee: { value: 30 },
      ratio: { value: 12 },
      attack: { value: 0.003 },
      release: { value: 0.25 },
      connect: vi.fn(),
    };
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      getFloatTimeDomainData: vi.fn((arr: Float32Array) => arr.fill(0)),
      connect: vi.fn(),
    };
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / (sampleRate || 44100),
      getChannelData: vi.fn(() => data),
      copyFromChannel: vi.fn(),
      copyToChannel: vi.fn(),
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }

  createBiquadFilter() {
    return {
      frequency: { value: 1000, setValueAtTime: vi.fn() },
      gain: { value: 0, setValueAtTime: vi.fn() },
      Q: { value: 1, setValueAtTime: vi.fn() },
      type: 'peaking',
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createWaveShaper() {
    return {
      curve: null,
      oversample: 'none',
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createConvolver() {
    return {
      buffer: null,
      normalize: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createDelay() {
    return {
      delayTime: { value: 0, setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
}

/**
 * Instala `MockAudioContext` como `globalThis.AudioContext` solo si no hay
 * uno real. Idempotente: llamar varias veces no tiene efecto adicional.
 */
export function ensureMockAudioContext(): void {
  if (typeof globalThis.AudioContext === 'undefined') {
    (globalThis as unknown as { AudioContext: typeof MockAudioContext }).AudioContext =
      MockAudioContext;
  }

  if (typeof globalThis.window !== 'undefined') {
    (globalThis.window as unknown as { AudioContext: unknown }).AudioContext =
      globalThis.AudioContext;
  }
}
