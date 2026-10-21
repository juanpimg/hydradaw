import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeExportDuration, sanitizeExportFilename, resolveExportDuration, MAX_EXPORT_DURATION_SEC } from '../components/Export/ExportModal';
import { audioEngine } from '../audio/AudioEngine';
import type { AudioClip, AudioTrack } from '../types/daw';

describe('computeExportDuration', () => {
  it('vacío → 4 + 1.5 (mínimo de proyecto)', () => {
    expect(computeExportDuration([])).toBe(5.5);
  });

  it('un clip corto respeta el mínimo', () => {
    expect(computeExportDuration([{ startTime: 0, duration: 1 }])).toBe(5.5);
  });

  it('clip largo marca el final + cola de 1.5s', () => {
    expect(computeExportDuration([{ startTime: 2, duration: 8 }])).toBe(11.5);
  });

  it('solapes: usa el máximo end, no la suma', () => {
    const clips = [
      { startTime: 0, duration: 10 },
      { startTime: 3, duration: 4 },
      { startTime: 8, duration: 1 },
    ];
    expect(computeExportDuration(clips)).toBe(11.5);
  });
});

describe('sanitizeExportFilename', () => {
  it('espacios → guiones bajos (comportamiento anterior preservado)', () => {
    expect(sanitizeExportFilename('mi cancion')).toBe('mi_cancion');
  });

  it('elimina caracteres inseguros para descarga (slashes, puntos, acentos)', () => {
    expect(sanitizeExportFilename('a/b\\c:d*e?f"g<h>i|j.k')).toBe('a_b_c_d_e_f_g_h_i_j_k');
    expect(sanitizeExportFilename('Canción Nº1 (final)')).toBe('Canci_n_N_1_final_');
  });

  it('conserva guiones, subrayados y alfanuméricos; fallback por defecto', () => {
    expect(sanitizeExportFilename('mix-2024_final v2')).toBe('mix-2024_final_v2');
    expect(sanitizeExportFilename('')).toBe('cancion_master');
    expect(sanitizeExportFilename('   ')).toBe('cancion_master');
  });
});

describe('resolveExportDuration (tope anti-OOM, EXP-05)', () => {
  it('proyecto corto ⇒ sin recorte', () => {
    expect(resolveExportDuration([{ startTime: 2, duration: 8 }])).toEqual({
      duration: 11.5,
      capped: false,
    });
  });

  it('proyecto de 1 h ⇒ se limita a 10 minutos con aviso', () => {
    expect(MAX_EXPORT_DURATION_SEC).toBe(600);
    // Sin tope, un clip de 1 h pediría 3601.5 s de OfflineAudioContext (OOM).
    expect(computeExportDuration([{ startTime: 0, duration: 3600 }])).toBe(3601.5);
    expect(resolveExportDuration([{ startTime: 0, duration: 3600 }])).toEqual({
      duration: 600,
      capped: true,
    });
  });
});

// ---------------------------------------------------------------------------
// EXP-01: el export respeta el master (fader + mute). OfflineAudioContext
// funcional mínimo: mezcla lineal siguiendo las ganancias del grafo
// (volumen/mute de pista y de master), suficiente para verificar que
// renderOffline aplica masterVolume/masterMute al MasterBus que crea.
// ---------------------------------------------------------------------------

interface FakeNode {
  _kind: 'gain' | 'pass';
  _outputs: FakeNode[];
  gain: { value: number; setTargetAtTime: (v: number) => void; setValueAtTime: (v: number) => void };
  connect: (dest: FakeNode) => FakeNode;
  disconnect: () => void;
  start?: (when?: number, offset?: number, dur?: number) => void;
  stop?: () => void;
  buffer?: AudioBuffer | null;
}

function makeFakeNode(kind: 'gain' | 'pass'): FakeNode {
  const node = {
    _kind: kind,
    _outputs: [] as FakeNode[],
    gain: {
      value: 1,
      setTargetAtTime(v: number) {
        (node as FakeNode).gain.value = v;
      },
      setValueAtTime(v: number) {
        (node as FakeNode).gain.value = v;
      },
    },
    connect(dest: FakeNode) {
      (node as FakeNode)._outputs.push(dest);
      return dest;
    },
    disconnect() {
      (node as FakeNode)._outputs.length = 0;
    },
  } as FakeNode;
  // Nodos no-gain exponen la API que MasterBus/TrackNode tocan (pass-through).
  (node as unknown as Record<string, unknown>)['pan'] = { value: 0, setTargetAtTime() {} };
  for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) {
    (node as unknown as Record<string, unknown>)[k] = { value: 0 };
  }
  (node as unknown as Record<string, unknown>)['fftSize'] = 256;
  (node as unknown as Record<string, unknown>)['smoothingTimeConstant'] = 0.8;
  (node as unknown as Record<string, unknown>)['getFloatTimeDomainData'] = (a: Float32Array) => a.fill(0);
  return node;
}

interface FakeScheduled {
  buffer: AudioBuffer | null;
  when: number;
  offset: number;
  dur: number;
  node: FakeNode;
}

class FakeOfflineContext {
  sampleRate: number;
  currentTime = 0;
  destination: FakeNode;
  _sources: FakeScheduled[] = [];
  private _length: number;

  constructor(_channels: number, length: number, sampleRate: number) {
    this._length = length;
    this.sampleRate = sampleRate;
    this.destination = makeFakeNode('pass');
  }

  createGain(): FakeNode {
    return makeFakeNode('gain');
  }
  createStereoPanner(): FakeNode {
    return makeFakeNode('pass');
  }
  createDynamicsCompressor(): FakeNode {
    return makeFakeNode('pass');
  }
  createAnalyser(): FakeNode {
    return makeFakeNode('pass');
  }
  createBufferSource(): FakeNode {
    const node = makeFakeNode('pass');
    const entry: FakeScheduled = { buffer: null, when: 0, offset: 0, dur: 0, node };
    node.start = (when = 0, offset = 0, dur = 0) => {
      entry.when = when;
      entry.offset = offset;
      entry.dur = dur;
      // `renderOffline` asigna `source.buffer = clip.audioBuffer` antes de
      // `start()`: se captura aquí porque `entry.buffer` no lo ve directamente.
      entry.buffer = node.buffer ?? null;
    };
    node.stop = () => {};
    this._sources.push(entry);
    return node;
  }

  private pathGain(node: FakeNode): number {
    let g = 1;
    let current: FakeNode | undefined = node._outputs[0];
    while (current) {
      if (current._kind === 'gain') g *= current.gain.value;
      current = current._outputs[0];
    }
    return g;
  }

  async startRendering(): Promise<AudioBuffer> {
    const sr = this.sampleRate;
    const out0 = new Float32Array(this._length);
    const out1 = new Float32Array(this._length);
    for (const s of this._sources) {
      if (!s.buffer) continue;
      const g = this.pathGain(s.node);
      const start = Math.max(0, Math.round(s.when * sr));
      const off = Math.max(0, Math.round(s.offset * sr));
      const frames = Math.max(0, Math.round(s.dur * sr));
      const ch0 = s.buffer.getChannelData(0);
      const ch1 = s.buffer.numberOfChannels > 1 ? s.buffer.getChannelData(1) : ch0;
      for (let i = 0; i < frames && start + i < this._length; i++) {
        out0[start + i]! += (ch0[off + i] ?? 0) * g;
        out1[start + i]! += (ch1[off + i] ?? 0) * g;
      }
    }
    const channels = [out0, out1];
    return {
      numberOfChannels: 2,
      length: this._length,
      sampleRate: sr,
      duration: this._length / sr,
      getChannelData: (c: number) => channels[c]!,
    } as unknown as AudioBuffer;
  }
}

function constantStereoBuffer(value: number, seconds = 1, sampleRate = 44100): AudioBuffer {
  const length = Math.round(seconds * sampleRate);
  const ch0 = new Float32Array(length).fill(value);
  const ch1 = new Float32Array(length).fill(value);
  return {
    numberOfChannels: 2,
    length,
    sampleRate,
    duration: seconds,
    getChannelData: (c: number) => (c === 0 ? ch0 : ch1),
  } as unknown as AudioBuffer;
}

function exportTrack(): AudioTrack {
  return {
    id: 't1', name: 'T1', type: 'audio', color: '#fff', volume: 1, pan: 0,
    mute: false, solo: false, armed: false, plugins: [],
  };
}

function exportClip(buffer: AudioBuffer): AudioClip {
  return {
    id: 'c1', trackId: 't1', name: 'C1', startTime: 0, duration: 1, offset: 0,
    audioBuffer: buffer, peaks: new Float32Array(0),
  };
}

function renderedPeak(buf: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i] ?? 0));
  }
  return peak;
}

describe('renderOffline respeta el master (EXP-01)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('E1: renderOffline con masterVolume: 0.5 ⇒ el buffer renderizado tiene pico ≈ la mitad', async () => {
    vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
    const audio = constantStereoBuffer(0.5);
    const full = await audioEngine.renderOffline([exportTrack()], 1, [exportClip(audio)], 44100);
    const half = await audioEngine.renderOffline([exportTrack()], 1, [exportClip(audio)], 44100, { masterVolume: 0.5 });
    expect(renderedPeak(full)).toBeGreaterThan(0.4);
    expect(renderedPeak(half) / renderedPeak(full)).toBeCloseTo(0.5, 2);
  });

  it('E2: renderOffline con masterMute: true ⇒ el buffer renderizado es silencio', async () => {
    vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
    const audio = constantStereoBuffer(0.5);
    const muted = await audioEngine.renderOffline([exportTrack()], 1, [exportClip(audio)], 44100, { masterMute: true });
    expect(renderedPeak(muted)).toBe(0);
  });
});
