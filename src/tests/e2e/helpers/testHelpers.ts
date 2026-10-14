import { vi } from 'vitest';
import type { AudioTrack, AudioClip } from '../../../types/daw';
import { useDawStore } from '../../../store/useDawStore';

/**
 * Setup a lightweight, robust browser-like environment in Node for opaque-box testing.
 */
export function setupTestEnvironment() {
  if (typeof globalThis.window === 'undefined') {
    const mockWindow = {
      innerWidth: 1024,
      innerHeight: 768,
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => setTimeout(cb, 16)),
      cancelAnimationFrame: vi.fn((id: number) => clearTimeout(id)),
    };
    (globalThis as unknown as { window: unknown }).window = mockWindow;
  }

  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => setTimeout(cb, 16));
    (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id));
  }

  // Ensure AudioContext is mocked cleanly if not present
  if (typeof globalThis.AudioContext === 'undefined') {
    class MockAudioContext {
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
    (globalThis as unknown as { AudioContext: typeof MockAudioContext }).AudioContext = MockAudioContext;
  }

  if (typeof globalThis.window !== 'undefined') {
    (globalThis.window as unknown as { AudioContext: unknown }).AudioContext = globalThis.AudioContext;
  }
}

/**
 * Reset DAW Zustand store to clean initial baseline.
 */
export function resetDawStore() {
  useDawStore.setState({
    projectName: 'Test Project',
    bpm: 120,
    timeSignature: [4, 4],
    duration: 16,
    currentTime: 0,
    isPlaying: false,
    isRecording: false,
    tracks: [],
    clips: [],
    selectedTrackId: null,
    selectedClipId: null,
    activeView: 'timeline',
    zoom: 50,
    scrollLeft: 0,
    masterVolume: 1,
    masterMute: false,
    metronome: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    exportModalOpen: false,
    pluginModalTrackId: null,
    toasts: [],
  });
}

/**
 * Create a mock AudioTrack with sensible defaults.
 */
export function createMockTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: overrides.id ?? `track_${Math.random().toString(36).substring(2, 9)}`,
    name: overrides.name ?? 'Track 1',
    type: overrides.type ?? 'audio',
    color: overrides.color ?? '#06b6d4',
    volume: overrides.volume ?? 1.0,
    pan: overrides.pan ?? 0.0,
    mute: overrides.mute ?? false,
    solo: overrides.solo ?? false,
    armed: overrides.armed ?? false,
    plugins: overrides.plugins ?? [],
  };
}

/**
 * Create a mock AudioClip with sensible defaults.
 */
export function createMockClip(overrides: Partial<AudioClip> = {}): AudioClip {
  return {
    id: overrides.id ?? `clip_${Math.random().toString(36).substring(2, 9)}`,
    trackId: overrides.trackId ?? 'track_1',
    name: overrides.name ?? 'AudioClip.wav',
    startTime: overrides.startTime ?? 0.0,
    duration: overrides.duration ?? 4.0,
    offset: overrides.offset ?? 0.0,
    audioBuffer: overrides.audioBuffer ?? null,
    peaks: overrides.peaks ?? new Float32Array([0, 0, 0.5, -0.5]),
    color: overrides.color ?? '#06b6d4',
  };
}

/**
 * Synthetic PointerEvent generator for testing pointer capture and touch behaviors.
 */
export interface SyntheticPointerOptions {
  pointerId?: number;
  pointerType?: 'mouse' | 'touch' | 'pen';
  isPrimary?: boolean;
  clientX?: number;
  clientY?: number;
  button?: number;
}

export function createSyntheticPointerEvent(
  type: string,
  target: HTMLElement | { setPointerCapture?: (id: number) => void; releasePointerCapture?: (id: number) => void },
  options: SyntheticPointerOptions = {}
) {
  const pointerId = options.pointerId ?? 1;
  const pointerType = options.pointerType ?? 'mouse';
  const isPrimary = options.isPrimary ?? true;
  const clientX = options.clientX ?? 0;
  const clientY = options.clientY ?? 0;
  const button = options.button ?? 0;

  let defaultPrevented = false;
  let propagationStopped = false;

  return {
    type,
    target,
    currentTarget: target,
    pointerId,
    pointerType,
    isPrimary,
    clientX,
    clientY,
    button,
    preventDefault: () => {
      defaultPrevented = true;
    },
    stopPropagation: () => {
      propagationStopped = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
    get propagationStopped() {
      return propagationStopped;
    },
  };
}

/**
 * Authoritative Mathematical Specifications from PROJECT.md:
 */

// F6 Trim Edge Oracle: 20px on touch, 8px on mouse, capped to width percentages
export function calculateExpectedTrimEdge(width: number, isTouch: boolean): number {
  return isTouch ? Math.min(20, width * 0.28) : Math.min(8, width * 0.2);
}

// F12 Ruler Unified Width Oracle
export function calculateExpectedUnifiedWidth(
  viewportWidth: number,
  headerWidth: number,
  duration: number,
  zoom: number
): number {
  return Math.max(viewportWidth - headerWidth, duration * zoom);
}

// F13 Ruler Clamped Seek Time Oracle
export function calculateExpectedClampedSeek(
  clickX: number,
  zoom: number,
  duration: number
): number {
  const rawTime = clickX / zoom;
  return Math.max(0, Math.min(duration, rawTime));
}

// F7 Knob Delta to Value Oracle
export function calculateExpectedKnobValue(
  startVal: number,
  deltaY: number,
  min: number,
  max: number,
  step: number
): number {
  const range = max - min;
  const stepChange = (deltaY / 150) * range;
  let next = Math.max(min, Math.min(max, startVal + stepChange));
  if (step > 0) {
    next = Math.round(next / step) * step;
  }
  return Math.min(max, Math.max(min, Number(next.toFixed(6))));
}
