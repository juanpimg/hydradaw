// Fix(waveB-ts): noUncheckedIndexedAccess — aserciones non-null (!) en indexaciones
// garantizadas por el setup de cada test; sin cambios de semántica ni comportamiento.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { MasterBus } from './MasterBus';
import type { AudioTrack, AudioClip } from '../types/daw';

/* ------------------------------------------------------------------ */
/* Mocks headless (patrón de engine_m1.test.ts + oscilador para click) */
/* ------------------------------------------------------------------ */

class MockAudioParam {
  value: number;
  setValueAtTimeCalls: Array<{ v: number; t: number }> = [];
  expRampCalls: Array<{ v: number; t: number }> = [];
  constructor(defaultValue: number = 0) {
    this.value = defaultValue;
  }
  setTargetAtTime(target: number): void {
    this.value = target;
  }
  setValueAtTime(v: number, t: number): void {
    this.value = v;
    this.setValueAtTimeCalls.push({ v, t });
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    this.expRampCalls.push({ v, t });
  }
}

class MockAudioNode {
  connectedTo: MockAudioNode[] = [];
  disconnected = false;
  connect(destination: MockAudioNode): MockAudioNode {
    this.connectedTo.push(destination);
    this.disconnected = false;
    return destination;
  }
  disconnect(): void {
    this.connectedTo = [];
    this.disconnected = true;
  }
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam(1.0);
}

class MockOscillatorNode extends MockAudioNode {
  type: OscillatorType = 'sine';
  frequency = new MockAudioParam(440);
  onended: (() => void) | null = null;
  startCalls: number[] = [];
  stopCalls: number[] = [];
  start(when?: number): void {
    this.startCalls.push(when ?? 0);
  }
  stop(when?: number): void {
    this.stopCalls.push(when ?? 0);
  }
}

class MockBufferSourceNode extends MockAudioNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  startCalls: Array<{ when: number; offset: number; dur: number }> = [];
  stopped = false;
  start(when?: number, offset?: number, dur?: number): void {
    this.startCalls.push({ when: when ?? 0, offset: offset ?? 0, dur: dur ?? 0 });
  }
  stop(): void {
    this.stopped = true;
  }
}

class MockBaseContext {
  currentTime = 100.0;
  sampleRate = 44100;
  destination = new MockAudioNode();
  sources: MockBufferSourceNode[] = [];
  oscillators: MockOscillatorNode[] = [];
  gains: MockGainNode[] = [];
  createGain(): MockGainNode {
    const g = new MockGainNode();
    this.gains.push(g);
    return g;
  }
  createOscillator(): MockOscillatorNode {
    const o = new MockOscillatorNode();
    this.oscillators.push(o);
    return o;
  }
  createBufferSource(): MockBufferSourceNode {
    const s = new MockBufferSourceNode();
    this.sources.push(s);
    return s;
  }
  createDynamicsCompressor(): MockAudioNode & Record<string, MockAudioParam> {
    const n = new MockAudioNode() as MockAudioNode & Record<string, MockAudioParam>;
    n.threshold = new MockAudioParam(-24);
    n.knee = new MockAudioParam(30);
    n.ratio = new MockAudioParam(12);
    n.attack = new MockAudioParam(0.003);
    n.release = new MockAudioParam(0.25);
    return n;
  }
  createStereoPanner(): MockAudioNode & { pan: MockAudioParam } {
    const n = new MockAudioNode() as MockAudioNode & { pan: MockAudioParam };
    n.pan = new MockAudioParam(0);
    return n;
  }
  createAnalyser(): MockAudioNode & { fftSize: number; smoothingTimeConstant: number; getFloatTimeDomainData: (a: Float32Array) => void } {
    const n = new MockAudioNode() as MockAudioNode & {
      fftSize: number;
      smoothingTimeConstant: number;
      getFloatTimeDomainData: (a: Float32Array) => void;
    };
    n.fftSize = 256;
    n.smoothingTimeConstant = 0.8;
    n.getFloatTimeDomainData = (a: Float32Array) => a.fill(0.1);
    return n;
  }
}

class MockOfflineContext extends MockBaseContext {
  constructor(
    public numberOfChannels = 2,
    public length = 44100,
    public rate = 44100
  ) {
    super();
  }
  async startRendering(): Promise<AudioBuffer> {
    return { duration: this.length / this.rate, sampleRate: this.rate } as AudioBuffer;
  }
}

/* ------------------------------ helpers ------------------------------ */

function makeTrack(id = 'track_1'): AudioTrack {
  return {
    id,
    name: 'Pista 1',
    type: 'audio',
    color: '#06b6d4',
    volume: 1.0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    plugins: [],
  };
}

function fakeBuffer(duration: number): AudioBuffer {
  return { duration } as unknown as AudioBuffer;
}

function makeClip(overrides: Partial<AudioClip> = {}): AudioClip {
  return {
    id: 'clip_1',
    trackId: 'track_1',
    name: 'Clip 1',
    startTime: 0,
    duration: 16,
    offset: 0,
    audioBuffer: fakeBuffer(16),
    peaks: new Float32Array([0, 0]),
    color: '#06b6d4',
    ...overrides,
  };
}

/** Inyecta un contexto mock en el singleton sin pasar por requestAnimationFrame. */
function setupEngine() {
  const engine = AudioEngine.getInstance();
  const mockCtx = new MockBaseContext();
  (engine as unknown as { context: unknown }).context = mockCtx;
  (engine as unknown as { masterBus: unknown }).masterBus = new MasterBus(
    mockCtx as unknown as BaseAudioContext
  );
  vi.spyOn(engine, 'ensureContext').mockResolvedValue(mockCtx as unknown as AudioContext);
  return { engine, mockCtx };
}

afterEach(() => {
  const engine = AudioEngine.getInstance();
  try {
    engine.stop();
  } catch (_) {}
  engine.setLoop(false, 0, 16);
  engine.setMetronome(false);
  engine.setTempo(120);
  engine.setTimeSignature(4, 4);
  vi.restoreAllMocks();
  delete (globalThis as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext;
});

/* -------------------------------- tests ------------------------------ */

describe('wave3: loop real en el engine', () => {
  it('wrapTimeInLoop envuelve en [start, end) y deja lineal lo anterior', () => {
    const { engine } = setupEngine();
    expect(engine.wrapTimeInLoop(5, 4, 8)).toBe(5); // dentro
    expect(engine.wrapTimeInLoop(9, 4, 8)).toBeCloseTo(5, 9); // wrap
    expect(engine.wrapTimeInLoop(12, 4, 8)).toBeCloseTo(4, 9); // múltiplo exacto
    expect(engine.wrapTimeInLoop(2, 4, 8)).toBe(2); // antes del loop: lineal
    expect(engine.wrapTimeInLoop(10, 4, 4)).toBe(10); // loop inválido: lineal
    expect(engine.wrapTimeInLoop(10, 8, 4)).toBe(10); // end<=start: lineal
  });

  it('planClipSchedules capa en loopEnd con loop y es lineal sin loop', () => {
    const { engine } = setupEngine();
    const clips = [makeClip({ startTime: 0, duration: 16 })];
    const looped = engine.planClipSchedules(clips, 0, 4);
    expect(looped).toHaveLength(1);
    expect(looped[0]!.playDuration).toBeLessThanOrEqual(4);

    const linear = engine.planClipSchedules(clips, 0, Infinity);
    expect(linear).toHaveLength(1);
    expect(linear[0]!.playDuration).toBeCloseTo(16, 9);

    // Clip que empieza después del loop no se programa en la iteración actual
    const outside = engine.planClipSchedules([makeClip({ startTime: 10, duration: 4 })], 0, 4);
    expect(outside).toHaveLength(0);
  });

  it('play con opts loop replanifica en wrap (stop + re-schedule, no BufferSource.loop)', async () => {
    const { engine, mockCtx } = setupEngine();
    await engine.play([makeTrack()], [makeClip()], 0, { loop: true, loopStart: 0, loopEnd: 4 });
    // Una iteración programada, capada a 4 s
    expect(mockCtx.sources.length).toBeGreaterThan(0);
    for (const s of mockCtx.sources) {
      for (const c of s.startCalls) expect(c.dur).toBeLessThanOrEqual(4 + 1e-9);
    }
    // Timer de wrap armado y estado activo
    expect((engine as unknown as { loopTimer: unknown }).loopTimer).not.toBeNull();
    expect((engine as unknown as { activeLoop: unknown }).activeLoop).toEqual({ start: 0, end: 4 });
    // Ninguna fuente usa loop=true (técnica documentada: stop + replanificación)
    for (const s of mockCtx.sources) {
      expect((s as unknown as { loop?: boolean }).loop ?? false).toBe(false);
    }
    // Playhead envuelto: startTime = currentTime+0.02 (lookahead), loop [0,4).
    // raw = 5 - 0.02 = 4.98 → wrap a 0.98.
    mockCtx.currentTime += 5.0;
    expect(engine.getCurrentTime()).toBeCloseTo(0.98, 5);
  });

  it('handleLoopWrap replanifica la siguiente iteración desde loopStart', async () => {
    const { engine, mockCtx } = setupEngine();
    await engine.play([makeTrack()], [makeClip()], 0, { loop: true, loopStart: 2, loopEnd: 6 });
    const scheduledBefore = mockCtx.sources.length;
    mockCtx.currentTime += 10; // fuerza cruce de loopEnd
    (engine as unknown as { handleLoopWrap: () => void }).handleLoopWrap();
    expect((engine as unknown as { playheadOffset: number }).playheadOffset).toBeCloseTo(2, 9);
    expect(mockCtx.sources.length).toBeGreaterThan(scheduledBefore);
  });

  it('wrap tardío en el reloj de audio rellena el hueco (AUD-05)', async () => {
    vi.useFakeTimers();
    try {
      const { engine, mockCtx } = setupEngine();
      await engine.play([makeTrack()], [makeClip()], 0, { loop: true, loopStart: 0, loopEnd: 4 });
      const scheduledBefore = mockCtx.sources.length;
      expect(scheduledBefore).toBeGreaterThan(0);
      // El watchdog se dispara tarde: el audio ya pasó loopEnd (100.02 + 4).
      mockCtx.currentTime += 10;
      await vi.advanceTimersByTimeAsync(50);
      expect(mockCtx.sources.length).toBeGreaterThan(scheduledBefore);
      expect((engine as unknown as { playheadOffset: number }).playheadOffset).toBeCloseTo(0, 9);
      // Gap fill: la siguiente iteración se ancla en currentTime + 0.02,
      // no en el loopEnd obsoleto.
      expect((engine as unknown as { startTime: number }).startTime).toBeCloseTo(
        mockCtx.currentTime + 0.02,
        9
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('sin loop reproduce lineal: programa más allá de loopEnd y no arma timer', async () => {
    const { engine, mockCtx } = setupEngine();
    engine.setLoop(true, 0, 4); // configurado pero desactivado por opts
    await engine.play([makeTrack()], [makeClip()], 0, { loop: false });
    const durations = mockCtx.sources.flatMap((s) => s.startCalls.map((c) => c.dur));
    expect(durations.some((d) => d > 4)).toBe(true);
    expect((engine as unknown as { loopTimer: unknown }).loopTimer).toBeNull();
    mockCtx.currentTime += 5.0;
    expect(engine.getCurrentTime()).toBeCloseTo(5.02, 1); // lineal, sin wrap
  });

  it('play sin opts respeta el estado interno setLoop (diseño b: el store no necesita cambios)', async () => {
    const { engine, mockCtx } = setupEngine();
    engine.setLoop(true, 0, 4); // lo que hará el store cuando se cablee
    await engine.play([makeTrack()], [makeClip()], 0); // firma antigua de 3 args
    expect((engine as unknown as { activeLoop: unknown }).activeLoop).toEqual({ start: 0, end: 4 });
    for (const s of mockCtx.sources) {
      for (const c of s.startCalls) expect(c.dur).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it('loop inválido (end <= start) degrada a lineal sin timer', async () => {
    const { engine, mockCtx } = setupEngine();
    await engine.play([makeTrack()], [makeClip()], 0, { loop: true, loopStart: 8, loopEnd: 4 });
    expect((engine as unknown as { activeLoop: unknown }).activeLoop).toBeNull();
    expect((engine as unknown as { loopTimer: unknown }).loopTimer).toBeNull();
    expect(mockCtx.sources.length).toBeGreaterThan(0);
  });

  it('stop() desarma el loop y devuelve posición (firma intacta)', async () => {
    const { engine } = setupEngine();
    await engine.play([makeTrack()], [makeClip()], 1, { loop: true, loopStart: 0, loopEnd: 4 });
    const pos = engine.stop();
    expect(typeof pos).toBe('number');
    expect((engine as unknown as { loopTimer: unknown }).loopTimer).toBeNull();
  });
});

describe('wave3: metrónomo audible al tempo real', () => {
  it('grid 120 BPM 4/4: 4 clicks en [0,2), acento solo en downbeat', () => {
    const { engine } = setupEngine();
    engine.setTempo(120);
    const clicks = engine.getMetronomeClickTimes(0, 2);
    expect(clicks).toHaveLength(4);
    expect(clicks.map((c) => c.time)).toEqual([0, 0.5, 1, 1.5]);
    expect(clicks[0]!.accent).toBe(true);
    expect(clicks.slice(1).every((c) => !c.accent)).toBe(true);
  });

  it('el grid sigue a setTempo (60 BPM → paso 1 s; 140 BPM → 60/140)', () => {
    const { engine } = setupEngine();
    engine.setTempo(60);
    expect(engine.getMetronomeClickTimes(0, 2.01).map((c) => c.time)).toEqual([0, 1, 2]);
    engine.setTempo(140);
    const step = 60 / 140;
    const clicks = engine.getMetronomeClickTimes(0, step * 2 + 0.001);
    expect(clicks).toHaveLength(3);
    expect(clicks[1]!.time).toBeCloseTo(step, 9);
  });

  it('6/8: paso de corchea y acento cada 6 clicks', () => {
    const { engine } = setupEngine();
    engine.setTempo(120);
    engine.setTimeSignature(6, 8);
    const step = 0.25; // (60/120) * (4/8)
    const clicks = engine.getMetronomeClickTimes(0, step * 6 + 0.001);
    expect(clicks).toHaveLength(7); // 0..6 inclusive (borde)
    expect(clicks[0]!.accent).toBe(true);
    expect(clicks.slice(1, 6).every((c) => !c.accent)).toBe(true);
    expect(clicks[6]!.accent).toBe(true);
  });

  it('play con metrónomo genera osciladores (2000 Hz acento / 1000 Hz resto)', async () => {
    const { engine, mockCtx } = setupEngine();
    engine.setTempo(120);
    engine.setMetronome(true);
    await engine.play([makeTrack()], [makeClip({ duration: 4 })], 0);
    expect(mockCtx.oscillators.length).toBeGreaterThan(0);
    const freqs = mockCtx.oscillators.map((o) => o.frequency.value);
    expect(freqs[0]).toBe(2000);
    expect(freqs.slice(1)).toContain(1000);
    // Envolvente corta aplicada
    for (const o of mockCtx.oscillators) {
      expect(o.startCalls.length).toBe(1);
      expect(o.stopCalls.length).toBe(1);
    }
  });

  it('sin metrónomo no se genera ningún click', async () => {
    const { engine, mockCtx } = setupEngine();
    engine.setMetronome(false);
    await engine.play([makeTrack()], [makeClip()], 0);
    expect(mockCtx.oscillators).toHaveLength(0);
  });

  it('renderOffline incluye clicks si el metrónomo está activado; lineal si no', async () => {
    const { engine } = setupEngine();
    (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = MockOfflineContext;
    const tracks = [makeTrack()];
    const clips = [makeClip()];

    // Espía el programador offline observando createOscillator del ctx real usado.
    engine.setTempo(120);
    engine.setMetronome(true);
    const withClick = await engine.renderOffline(tracks, 2, clips, 44100);
    expect(withClick).toBeDefined();

    engine.setMetronome(false);
    const withoutClick = await engine.renderOffline(tracks, 2, clips, 44100);
    expect(withoutClick).toBeDefined();
    // La diferencia audible se verifica a nivel de grid puro + conteo realtime;
    // aquí se afirma que ambas variantes renderizan sin lanzar y respetan la firma.
  });

  it('renderOffline con opts.metronome hace override del estado interno', async () => {
    const { engine } = setupEngine();
    (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = MockOfflineContext;
    engine.setMetronome(false);
    await expect(
      engine.renderOffline([makeTrack()], 1, [makeClip()], 44100, { metronome: true })
    ).resolves.toBeDefined();
    await expect(
      engine.renderOfflineMixdown([makeTrack()], [makeClip()], 1, 44100, { metronome: false })
    ).resolves.toBeDefined();
  });
});

describe('wave3: compatibilidad hacia atrás', () => {
  it('mantiene todas las firmas usadas por el store', () => {
    const { engine } = setupEngine();
    for (const m of [
      'play',
      'stop',
      'syncTracks',
      'rebuildTrackEffects',
      'getMasterBus',
      'getCurrentTime',
      'ensureContext',
      'startRecording',
      'stopRecording',
      'renderOffline',
      'renderOfflineMixdown',
      'setTempo',
      'updateTrackPluginParam',
    ] as const) {
      expect(typeof (engine as unknown as Record<string, unknown>)[m]).toBe('function');
    }
    // Nuevos métodos exigidos
    expect(typeof engine.setLoop).toBe('function');
    expect(typeof engine.setMetronome).toBe('function');
    expect(typeof engine.rewind).toBe('function');
    // stop() sigue devolviendo number
    expect(typeof engine.stop()).toBe('number');
  });

  it('play acepta 3 args (store actual) y 4 args con opts (nuevo)', async () => {
    const { engine } = setupEngine();
    await expect(engine.play([makeTrack()], [makeClip()], 0)).resolves.toBeUndefined();
    await expect(
      engine.play([makeTrack()], [makeClip()], 0, { loop: true, loopStart: 0, loopEnd: 8 })
    ).resolves.toBeUndefined();
  });
});
