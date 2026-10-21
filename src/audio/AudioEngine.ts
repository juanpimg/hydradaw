import type { AudioTrack, AudioClip } from '../types/daw';
import { TrackNode } from './TrackNode';
import { MasterBus } from './MasterBus';
import { generateWaveformPeaks } from './waveformUtils';

export type MeterCallback = (levels: { master: { rms: number; peak: number }; tracks: Record<string, { rms: number; peak: number }> }) => void;
export type TimeCallback = (time: number) => void;

// Fix(wave3): opciones opcionales de reproducción. 4º arg de play() → 100% compatible
// hacia atrás (el store sigue llamando play(tracks, clips, time) sin opts).
export interface PlayOptions {
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  metronome?: boolean;
  timeSignature?: [number, number];
}

// Fix(wave3): opciones opcionales de render offline (5º arg opcional).
export interface OfflineRenderOptions {
  metronome?: boolean;
  timeSignature?: [number, number];
}

export interface MetronomeClick {
  time: number;
  accent: boolean;
  beatIndex: number;
}

export interface ClipSchedule {
  clipId: string;
  whenOffset: number;
  offsetIntoClip: number;
  playDuration: number;
}

export class AudioEngine {
  private static instance: AudioEngine;

  private context: AudioContext | null = null;
  private masterBus: MasterBus | null = null;
  private trackNodes: Map<string, TrackNode> = new Map();

  private isPlaying: boolean = false;
  private isRecording: boolean = false;
  private startTime: number = 0;       // AudioContext.currentTime when playback started
  private playheadOffset: number = 0;   // Timeline position in seconds when started
  private cachedTracks: AudioTrack[] = [];
  private cachedClips: AudioClip[] = [];
  private tempoBpm: number = 120;
  // Fix(AUD-01/AUD-02): token de generación de play(). Solo la última llamada
  // solapada sobrevive; stop()/seek() invalidan los play() en vuelo.
  private playGen = 0;

  // Fix(wave3): estado persistente de loop / metrónomo. El store aún NO los propaga
  // (placebos) — play() los respeta automáticamente para que el cableado futuro sea
  // trivial. Técnica de loop: stop + replanificación vigilada por un intervalo
  // de 25 ms en el reloj de audio (AUD-05; NO BufferSource.loop=true, que
  // repetiría el contenido del buffer en lugar del arreglo del timeline con
  // clips arbitrarios).
  // NOTE(wave3): el store aún no llama a setLoop/setMetronome — cablearlo es un cambio de 3 líneas en useDawStore
  private loopEnabled: boolean = false;
  private loopStart: number = 0;
  private loopEnd: number = 16;
  private metronomeEnabled: boolean = false;
  private timeSig: [number, number] = [4, 4];
  // Estado activo de la reproducción en curso (resuelto en play() desde stored + opts).
  private activeLoop: { start: number; end: number } | null = null;
  private activeMetronome: boolean = false;
  private activeTimeSig: [number, number] = [4, 4];
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private metroTimer: ReturnType<typeof setInterval> | null = null;
  private metronomeNodes: OscillatorNode[] = [];
  // Fix(AUD-04): watermark del metrónomo (segundos de timeline): hasta dónde ya
  // se programaron clicks. Cada disparo del extensor continúa desde aquí.
  private metroScheduledUntil = 0;

  // Recording
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private recordingTrackId: string | null = null;
  private recordingStartTime: number = 0;
  // Fix: deduplica stopRecording concurrentes (stop() + toggleRecord) devolviendo la misma promesa.
  // Fix(waveB): tipo unificado en `audioBuffer` (alias `buffer` eliminado).
  private stopRecordingPromise: Promise<(AudioClip & { audioBuffer: AudioBuffer }) | null> | null = null;
  // Fix(waveA): última toma preservada por stop() en vez de descartarla.
  // Fix(waveB): tipo unificado en `audioBuffer` (alias `buffer` eliminado).
  private lastTake: (AudioClip & { audioBuffer: AudioBuffer }) | null = null;
  // Fix(waveA): firma de efectos por track para reconstruir solo cuando cambian plugins.
  private trackEffectsSig: Map<string, string> = new Map();
  // Fix(waveA): telemetría con buffers pre-alojados (sin alloc por frame).
  private telemetryScratch: Float32Array = new Float32Array(2048);
  private telemetryPayload: { master: { rms: number; peak: number }; tracks: Record<string, { rms: number; peak: number }> } = {
    master: { rms: 0, peak: 0 },
    tracks: {},
  };
  private lastMeterSig: string | null = null;

  // Telemetry & Animation
  private meterCallbacks: Set<MeterCallback> = new Set();
  private timeCallbacks: Set<TimeCallback> = new Set();
  private rafId: number | null = null;

  constructor() {}

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  /**
   * Explicit initialization contract for the audio engine
   */
  async init(): Promise<void> {
    try {
      await this.ensureContext();
    } catch (err) {
      console.warn('[AudioEngine] init: AudioContext initialization deferred or unavailable:', err);
    }
  }

  /**
   * Initializes or resumes the AudioContext on user interaction with resilient fallback
   */
  async ensureContext(): Promise<AudioContext> {
    if (!this.context || this.context.state === 'closed') {
      const AudioCtx =
        typeof window !== 'undefined'
          ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          : (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext;

      if (!AudioCtx) {
        throw new Error('[AudioEngine] Web Audio API AudioContext is not supported in this environment.');
      }

      let ctx: AudioContext;
      try {
        // Preferred: interactive latency hint at standard 44.1kHz
        ctx = new AudioCtx({ latencyHint: 'interactive', sampleRate: 44100 });
      } catch (err) {
        console.warn(
          '[AudioEngine] Failed to initialize AudioContext with sampleRate: 44100, falling back to native device sample rate:',
          err
        );
        try {
          // Fallback 1: let the browser use the hardware device's native clock (e.g. 48kHz on mobile/Linux)
          ctx = new AudioCtx({ latencyHint: 'interactive' });
        } catch (err2) {
          console.warn(
            '[AudioEngine] Failed to initialize AudioContext with latencyHint: "interactive", falling back to default constructor:',
            err2
          );
          // Fallback 2: default constructor without parameters
          ctx = new AudioCtx();
        }
      }

      this.context = ctx;
      this.masterBus = new MasterBus(this.context);
      this.startTelemetryLoop();
    }

    // Capture autoplay restrictions gracefully (NotAllowedError / interrupted state on iOS)
    if (this.context.state === 'suspended' || (this.context.state as string) === 'interrupted') {
      try {
        await this.context.resume();
      } catch (err) {
        console.warn(
          '[AudioEngine] AudioContext.resume() was rejected (autoplay policy restriction). Proceeding in suspended state:',
          err
        );
      }
    }

    return this.context;
  }

  getContext(): AudioContext | null {
    return this.context;
  }

  getMasterBus(): MasterBus | null {
    return this.masterBus;
  }

  getTrackNodes(): Map<string, TrackNode> {
    return this.trackNodes;
  }

  setTempo(bpm: number): void {
    this.tempoBpm = Math.max(20, Math.min(300, bpm));
  }

  getTempo(): number {
    return this.tempoBpm;
  }

  // Fix(wave3): expone setLoop/setMetronome para que el store los cablee.
  // Diseños posibles: (a) solo opts en play(), (b) estado en engine + opts override.
  // Se elige (b): play() sin opts (como lo llama hoy el store) suena con loop/metrónomo
  // automáticamente; opts permite override puntual por llamada. Sin tocar el store.
  setLoop(enabled: boolean, start?: number, end?: number): void {
    this.loopEnabled = enabled;
    if (start !== undefined) this.loopStart = Math.max(0, start);
    if (end !== undefined) this.loopEnd = Math.max(0, end);
  }

  getLoop(): { enabled: boolean; start: number; end: number } {
    return { enabled: this.loopEnabled, start: this.loopStart, end: this.loopEnd };
  }

  isLoopEnabled(): boolean {
    return this.loopEnabled;
  }

  setMetronome(on: boolean): void {
    this.metronomeEnabled = on;
    // Fix(AUD-04): al apagar, el watermark se resetea para la próxima reproducción.
    if (!on) this.metroScheduledUntil = 0;
  }

  isMetronomeEnabled(): boolean {
    return this.metronomeEnabled;
  }

  setTimeSignature(beatsPerBar: number, beatUnit: number = 4): void {
    const num = Math.max(1, Math.floor(beatsPerBar));
    const den = [2, 4, 8, 16].includes(beatUnit) ? beatUnit : 4;
    this.timeSig = [num, den];
  }

  getTimeSignature(): [number, number] {
    return [...this.timeSig] as [number, number];
  }

  // Fix(wave3): paso de click en segundos. bpm = negras/min; el denominador ajusta:
  // paso = (60/bpm) * (4/den). En 4/4 coincide con la rejilla del TransportBar.
  getBeatStep(bpm?: number, sig?: [number, number]): number {
    const tempo = bpm ?? this.tempoBpm;
    const den = sig?.[1] ?? this.timeSig[1];
    return (60 / Math.max(20, Math.min(300, tempo))) * (4 / den);
  }

  // Fix(wave3): rejilla de clicks pura (sin AudioContext) → testeable en Node.
  // Acento en downbeat (beatIndex % beatsPerBar === 0). La rejilla sigue al tempo
  // real (setTempo); los stems demo/render siguen fijos a 120 BPM porque son
  // buffers sintetizados (generateDemoTrackBuffer(ctx, kind, 16, 120)) — re-sintetizar
  // al cambiar bpm exigiría regenerar buffers, fuera de alcance wave3.
  getMetronomeClickTimes(
    from: number,
    until: number,
    bpm?: number,
    sig?: [number, number]
  ): MetronomeClick[] {
    const tempo = bpm ?? this.tempoBpm;
    const signature = sig ?? this.timeSig;
    const beatsPerBar = Math.max(1, Math.floor(signature[0]));
    const step = this.getBeatStep(tempo, signature);
    if (!(until > from) || !(step > 0)) return [];
    const clicks: MetronomeClick[] = [];
    // Alinea al grid global (múltiplos de step desde 0) para que el acento sea estable.
    // Fix: +0 normaliza -0 (Math.ceil(-1e-9)) a +0 para igualdad estricta.
    const firstIndex = Math.ceil(from / step - 1e-9) + 0;
    const lastExclusive = until - 1e-9;
    for (let i = firstIndex; i * step <= lastExclusive; i++) {
      const t = i * step + 0;
      if (t < 0) continue;
      clicks.push({ time: t, accent: i % beatsPerBar === 0, beatIndex: i });
    }
    return clicks;
  }

  // Fix(wave3): envuelve un tiempo de timeline en [start, end). Puro/testeable.
  wrapTimeInLoop(time: number, start?: number, end?: number): number {
    const s = start ?? this.loopStart;
    const e = end ?? this.loopEnd;
    const len = e - s;
    if (!(len > 0) || !isFinite(time)) return time;
    if (time < e && time >= s) return time;
    if (time < s) return time; // antes del loop: lineal hasta entrar
    return s + ((time - s) % len);
  }

  // Fix(wave3): planifica clips en [fromPosition, windowEnd). Puro/testeable.
  // Sin loop: windowEnd = Infinity (lineal). Con loop: windowEnd = loopEnd (capa).
  planClipSchedules(clips: AudioClip[], fromPosition: number, windowEnd: number): ClipSchedule[] {
    const out: ClipSchedule[] = [];
    const from = Math.max(0, fromPosition);
    for (const clip of clips) {
      if (!clip.audioBuffer) continue;
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= from || clipStart >= windowEnd) continue;
      const offsetIntoClip = Math.max(0, from - clipStart) + clip.offset;
      const whenOffset = Math.max(0, clipStart - from);
      const playDuration = Math.min(
        clip.duration - Math.max(0, from - clipStart),
        windowEnd === Infinity ? Infinity : windowEnd - Math.max(from, clipStart),
        clip.audioBuffer.duration - offsetIntoClip
      );
      if (playDuration > 0 && offsetIntoClip < clip.audioBuffer.duration) {
        out.push({ clipId: clip.id, whenOffset, offsetIntoClip, playDuration });
      }
    }
    return out;
  }

  pause(): void {
    this.stop();
  }

  seek(time: number): void {
    // Fix(AUD-01): invalida los play() en vuelo antes del reinicio.
    this.playGen++;
    const target = Math.max(0, time);
    const wasPlaying = this.isPlaying;
    // Fix(waveA): stop() síncrono ANTES de cualquier await para evitar doble sonido/race.
    if (wasPlaying) this.stop(true);
    this.playheadOffset = target;
    if (wasPlaying) {
      void this.play(this.cachedTracks, this.cachedClips, target);
    }
  }

  /**
   * Stops playback, clears all track nodes, and resets engine state
   */
  clear(): void {
    // Fix(wave3): clear() también debe desarmar el loop/metrónomo pendientes.
    this.clearLoopTimers();
    this.stopMetronomeNodes();
    this.activeLoop = null;
    this.stop();
    for (const [, node] of this.trackNodes.entries()) {
      node.dispose();
    }
    this.trackNodes.clear();
    // Fix(waveA): limpia firmas de efectos al resetear el engine.
    this.trackEffectsSig.clear();
    this.cachedTracks = [];
    this.cachedClips = [];
  }

  /**
   * Syncs tracks with the audio engine safely even in silent/unsupported mode
   */
  async syncTracks(tracks: AudioTrack[]) {
    this.cachedTracks = tracks;

    let ctx: AudioContext;
    try {
      ctx = await this.ensureContext();
    } catch (err) {
      console.warn('[AudioEngine] syncTracks: Web Audio context unavailable, caching tracks in silent mode.', err);
      return;
    }

    if (!this.masterBus) return;

    const anySoloed = tracks.some(t => t.solo);
    const existingIds = new Set(this.trackNodes.keys());
    const currentIds = new Set(tracks.map(t => t.id));

    // Remove deleted tracks & properly dispose TrackNodes
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        this.trackNodes.get(id)?.dispose();
        this.trackNodes.delete(id);
        // Fix(waveA): limpia firma de efectos del track eliminado.
        this.trackEffectsSig.delete(id);
      }
    }

    // Add or update tracks
    for (const track of tracks) {
      let trackNode = this.trackNodes.get(track.id);
      if (!trackNode) {
        trackNode = new TrackNode(ctx, track);
        trackNode.connect(this.masterBus.inputNode);
        // Fix(waveA): propaga anySoloed al track nuevo (antes se ignoraba).
        trackNode.updateTrackState(track, anySoloed);
        this.trackNodes.set(track.id, trackNode);
        // Fix(waveA): registra firma inicial (el ctor ya construyó la cadena).
        this.trackEffectsSig.set(track.id, this.computeEffectsSignature(track));
      } else {
        // Fix(waveA): reconstruye efectos solo si cambia la firma de plugins.
        const prevSig = this.trackEffectsSig.get(track.id);
        const nextSig = this.computeEffectsSignature(track);
        trackNode.updateTrackState(track, anySoloed);
        if (prevSig !== nextSig) {
          this.rebuildTrackEffects(track);
          this.trackEffectsSig.set(track.id, nextSig);
        }
      }
    }
  }

  // Fix(waveA): firma de plugins (ids+enabled+params) para detectar cambios.
  private computeEffectsSignature(track: AudioTrack): string {
    return track.plugins.map((p) => `${p.instanceId}:${p.pluginId}:${p.enabled ? 1 : 0}:${JSON.stringify(p.parameters)}`).join('|');
  }

  // Fix(waveA): expone la última toma preservada por stop().
  // Fix(waveB): retorna solo `audioBuffer` (alias `buffer` eliminado).
  getLastTake(): (AudioClip & { audioBuffer: AudioBuffer }) | null {
    return this.lastTake;
  }

  /**
   * Rebuilds a specific track's insert effects chain
   */
  rebuildTrackEffects(track: AudioTrack) {
    const node = this.trackNodes.get(track.id);
    if (node) {
      node.rebuildEffectsChain(track);
    }
  }

  // Fix(waveA): alias exigido por waveA (misma cadena de inserción).
  rebuildTrackEffectsChain(track: AudioTrack) {
    this.rebuildTrackEffects(track);
  }

  /**
   * Live-updates a single plugin parameter on a track without rebuilding the chain.
   * Delegates to TrackNode.updatePluginParameter; no store changes needed.
   */
  updateTrackPluginParam(trackId: string, instanceId: string, paramId: string, value: number): void {
    // Fix: expone acceso limpio a TrackNode.updatePluginParameter para que los knobs suenen en vivo.
    this.trackNodes.get(trackId)?.updatePluginParameter(instanceId, paramId, value);
  }

  /**
   * Starts sample-accurate multitrack playback from a specific timeline position.
   * Fix(wave3): 4º arg opcional opts {loop, loopStart, loopEnd, metronome, timeSignature}.
   * Sin opts usa el estado interno (setLoop/setMetronome) para que el store actual
   * (play(tracks, clips, time) sin opts) obtenga loop/metrónomo reales sin cambios.
   */
  async play(tracks?: AudioTrack[], clips?: AudioClip[], fromPosition: number = 0, opts?: PlayOptions) {
    // Fix(AUD-01/AUD-02): solo la última llamada solapada sobrevive. `let` (no
    // const) porque el stop interno de reinicio hace bump y se absorbe con
    // gen = this.playGen tras él; sin esto el reinicio se invalidaría a sí mismo.
    let gen = ++this.playGen;
    let ctx: AudioContext;
    try {
      ctx = await this.ensureContext();
    } catch (err) {
      console.warn('[AudioEngine] play: AudioContext is not available, playback aborted safely.', err);
      return;
    }
    if (gen !== this.playGen) return;
    // Fix(waveA): el stop interno preserva la toma en curso (punch-in/seek no la matan).
    if (this.isPlaying) {
      this.stop(true);
      gen = this.playGen;
    }

    if (tracks) this.cachedTracks = tracks;
    if (clips) this.cachedClips = clips;

    const activeTracks = tracks ?? this.cachedTracks;
    const activeClips = clips ?? this.cachedClips;

    await this.syncTracks(activeTracks);
    if (gen !== this.playGen) return;

    // Fix(wave3): resuelve loop/metrónomo efectivo (opts > estado interno).
    const effLoop = opts?.loop ?? this.loopEnabled;
    const effStart = opts?.loopStart ?? this.loopStart;
    const effEnd = opts?.loopEnd ?? this.loopEnd;
    const effMetro = opts?.metronome ?? this.metronomeEnabled;
    const effSig = opts?.timeSignature ?? this.timeSig;
    const loopActive = effLoop && isFinite(effStart) && isFinite(effEnd) && effEnd > effStart;
    this.activeLoop = loopActive ? { start: effStart, end: effEnd } : null;
    this.activeMetronome = effMetro;
    this.activeTimeSig = [...effSig] as [number, number];

    this.isPlaying = true;
    this.playheadOffset = Math.max(0, fromPosition);
    this.startTelemetryLoop();

    // Lookahead (20 ms) to guarantee all stems align at the exact same audio buffer quantum
    const scheduleLookahead = 0.02;
    this.startTime = ctx.currentTime + scheduleLookahead;

    const windowEnd = this.activeLoop ? this.activeLoop.end : Infinity;
    this.scheduleClipsRange(ctx, activeClips, this.playheadOffset, windowEnd, this.startTime);

    // Fix(wave3): metrónomo audible (oscilador corto, acento en downbeat) al tempo real.
    if (this.activeMetronome) {
      const horizon = this.activeLoop ? this.activeLoop.end : this.playheadOffset + this.getBeatStep() * 64;
      this.scheduleMetronomeRange(ctx, this.playheadOffset, horizon, this.startTime);
      // Fix(AUD-04): siembra el watermark en horizon para que el extensor
      // continúe desde ahí sin duplicar lo ya programado.
      this.metroScheduledUntil = horizon;
      // Extiende clicks en reproducción lineal larga (el loop se replanifica en el wrap).
      if (!this.activeLoop) this.armMetroExtender(ctx);
    }

    // Fix(wave3 + AUD-05): arma la vigilancia del loop en el reloj de audio.
    if (this.activeLoop) {
      this.armLoopTimer();
    }
  }

  /**
   * Stops playback and recording.
   * Fix(waveA): preserva la toma en lastTake (getter getLastTake()) en vez de
   * perderla; toggleRecord sigue funcionando igual vía la promesa deduplicada.
   */
  stop(preserveRecording: boolean = false): number {
    // Fix(AUD-02): invalida los play() en vuelo (zombis post-stop).
    this.playGen++;
    const currentPos = this.getCurrentTime();
    // Fix(Task-20): persiste la posición para que getCurrentTime() la devuelva
    // tras parar (el split con S en pausa y la reanudación la necesitan).
    this.playheadOffset = currentPos;
    this.isPlaying = false;
    // Fix(wave3): cancela timers de loop/metrónomo y suelta osciladores del click.
    this.clearLoopTimers();
    this.stopMetronomeNodes();

    // Stop all active sources across all track nodes
    for (const node of this.trackNodes.values()) {
      node.stopAllSources();
    }

    if (this.isRecording && !preserveRecording) {
      // Fix(waveA): guarda el clip en lastTake en vez de descartarlo.
      void this.stopRecording()
        .then((clip) => {
          if (clip) this.lastTake = clip;
        })
        .catch(() => null);
    }

    this.activeLoop = null;
    // Fix(AUD-04): al parar, el watermark del metrónomo vuelve a 0.
    this.metroScheduledUntil = 0;

    return currentPos;
  }

  /**
   * Returns live playhead time in seconds strictly derived from AudioContext.currentTime.
   * Fix(wave3): con loop activo envuelve en [start, end) para que la UI y el
   * temporizador sigan la rejilla audible.
   */
  getCurrentTime(): number {
    if (!this.isPlaying || !this.context) {
      return this.playheadOffset;
    }
    const elapsed = this.context.currentTime - this.startTime;
    const raw = this.playheadOffset + Math.max(0, elapsed);
    if (this.activeLoop) {
      const { start, end } = this.activeLoop;
      const len = end - start;
      if (len > 0 && raw >= end) {
        return start + ((raw - start) % len);
      }
    }
    return raw;
  }

  /**
   * Starts live audio recording on the armed track
   */
  async startRecording(armedTrackId: string, tracks?: AudioTrack[], clips?: AudioClip[]): Promise<void> {
    // Fix(waveA): captura si ya sonaba ANTES de cualquier await (punch-in hot).
    const wasPlaying = this.isPlaying;
    try {
      await this.ensureContext();
    } catch (err) {
      console.warn('[AudioEngine] startRecording: Web Audio context is not available.', err);
      throw new Error('[AudioEngine] No se puede iniciar la grabación: el motor de audio no está disponible.');
    }
    this.recordingTrackId = armedTrackId;
    // Fix(AUD-03): el sello se toma DESPUÉS de conceder el micro (ver abajo).
    this.recordingChunks = [];

    if (tracks) this.cachedTracks = tracks;
    if (clips) this.cachedClips = clips;

    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('[AudioEngine] getUserMedia is not supported in this browser environment.');
    }

    // Request ultra-clean direct microphone input
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    // Start MediaRecorder with WebM / OGG / PCM container
    const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus'))
      ? 'audio/webm;codecs=opus'
      : (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/ogg;codecs=opus'))
      ? 'audio/ogg;codecs=opus'
      : '';

    this.mediaRecorder = new MediaRecorder(this.mediaStream, mimeType ? { mimeType } : undefined);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.recordingChunks.push(e.data);
      }
    };

    // Fix: asigna onstop de forma temprana (antes de start()) para no perder un stop
    // prematuro del recorder; stopRecording() lo sobrescribe con el handler que resuelve el clip.
    this.mediaRecorder.onstop = () => {
      if (!this.isRecording) {
        this.mediaStream?.getTracks().forEach((t) => t.stop());
      }
    };

    this.mediaRecorder.start(100);
    // Fix(AUD-03): sella la toma DESPUÉS de getUserMedia() y de start(), con el
    // reloj actual — si el prompt tardó, el clip ya no cae segundos antes.
    this.recordingStartTime = this.getCurrentTime();
    // Fix(waveA): punch-in no reinicia clips si ya sonaba (solo arranca recorder).
    if (wasPlaying) {
      this.isRecording = true;
      return;
    }

    // Start synchronized playback
    // Fix(waveA): isRecording DESPUÉS del play inicial para que el stop interno no mate la toma.
    await this.play(tracks ?? this.cachedTracks, clips ?? this.cachedClips, this.recordingStartTime);
    this.isRecording = true;
  }

  /**
   * Stops recording and decodes recorded clip
   * Fix(waveB): retorna solo `audioBuffer` (alias `buffer` eliminado).
   */
  async stopRecording(): Promise<(AudioClip & { audioBuffer: AudioBuffer }) | null> {
    // Fix: deduplica llamadas concurrentes (stop() en pausa + toggleRecord del store)
    // devolviendo la misma promesa en vuelo en lugar de decodificar dos veces.
    if (this.stopRecordingPromise) return this.stopRecordingPromise;
    if (!this.isRecording || !this.mediaRecorder || !this.context) return null;

    this.isRecording = false;

    const recorder = this.mediaRecorder;
    const ctx = this.context;

    this.stopRecordingPromise = new Promise((resolve) => {
      const done = (clip: (AudioClip & { audioBuffer: AudioBuffer }) | null) => {
        // Fix(waveA): preserva la toma para getLastTake() aunque venga de stop().
        if (clip) this.lastTake = clip;
        this.stopRecordingPromise = null;
        resolve(clip);
      };
      // Fix: onstop se asigna síncronamente antes de llamar a stop() para no perder el evento.
      recorder.onstop = async () => {
        try {
          const blob = new Blob(this.recordingChunks, { type: recorder.mimeType || 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          const peaks = generateWaveformPeaks(audioBuffer, 800);

          // Fix(waveB): el clip grabado expone solo `audioBuffer` (alias `buffer` eliminado).
          const clip: AudioClip & { audioBuffer: AudioBuffer } = {
            id: 'clip_' + Date.now(),
            trackId: this.recordingTrackId || '',
            name: 'Grabación ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            startTime: this.recordingStartTime,
            duration: audioBuffer.duration,
            offset: 0,
            audioBuffer,
            peaks,
            color: '#ef4444',
          };

          this.mediaStream?.getTracks().forEach((t) => t.stop());
          this.mediaStream = null;
          this.mediaRecorder = null;
          this.recordingChunks = [];
          this.recordingTrackId = null;

          done(clip);
        } catch (err) {
          console.error('[AudioEngine] Error decoding recorded audio:', err);
          done(null);
        }
      };

      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        // Fix: el recorder ya estaba inactivo; resuelve en lugar de dejar la promesa colgada.
        done(null);
      }
    });

    return this.stopRecordingPromise;
  }

  /**
   * Faster-than-realtime offline render for mixdown / export using OfflineAudioContext.
   * Fix(wave3): incluye el click del metrónomo si está activado (respeta estado
   * interno o opts.metronome, al tempo real). El loop NO se envuelve offline a
   * propósito: el export es lineal del timeline; el loop es solo escucha en realtime.
   */
  async renderOffline(
    tracks: AudioTrack[],
    duration: number,
    clips?: AudioClip[],
    sampleRate: number = 44100,
    opts?: OfflineRenderOptions
  ): Promise<AudioBuffer> {
    const OfflineCtxClass =
      typeof window !== 'undefined'
        ? window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
        : (globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext;

    if (!OfflineCtxClass) {
      throw new Error('[AudioEngine] OfflineAudioContext is not supported in this environment.');
    }

    const totalDuration = Math.max(0.1, duration);
    const length = Math.max(1, Math.ceil(sampleRate * totalDuration));
    const offlineCtx = new OfflineCtxClass(2, length, sampleRate);

    // Setup master bus on offline context
    const masterBus = new MasterBus(offlineCtx);

    const anySoloed = tracks.some(t => t.solo);

    // Recreate track nodes & chains on offline context
    const offlineTracks: Map<string, TrackNode> = new Map();
    for (const track of tracks) {
      const trackNode = new TrackNode(offlineCtx, track);
      trackNode.updateTrackState(track, anySoloed);
      trackNode.connect(masterBus.inputNode);
      offlineTracks.set(track.id, trackNode);
    }

    const clipsToRender = clips ?? this.cachedClips;

    // Schedule all clips within render range
    for (const clip of clipsToRender) {
      if (!clip.audioBuffer) continue;
      const trackNode = offlineTracks.get(clip.trackId);
      if (!trackNode) continue;

      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;

      if (clipStart < totalDuration && clipEnd > 0) {
        const source = offlineCtx.createBufferSource();
        source.buffer = clip.audioBuffer;

        const offset = Math.max(0, -clipStart) + clip.offset;
        const startWhen = Math.max(0, clipStart);
        const playDuration = Math.min(
          clip.duration - Math.max(0, -clipStart),
          totalDuration - startWhen,
          clip.audioBuffer.duration - offset
        );

        if ((clip.fadeIn || clip.fadeOut) && typeof offlineCtx.createGain === 'function') {
          const clipGain = offlineCtx.createGain();
          const fi = clip.fadeIn ? Math.min(clip.fadeIn, playDuration) : 0;
          const fo = clip.fadeOut ? Math.min(clip.fadeOut, playDuration) : 0;
          const endWhen = startWhen + playDuration;
          try {
            if (fi > 0) {
              clipGain.gain.setValueAtTime?.(0, startWhen);
              clipGain.gain.linearRampToValueAtTime?.(1, startWhen + fi);
            } else {
              clipGain.gain.setValueAtTime?.(1, startWhen);
            }
            if (fo > 0) {
              const foStart = Math.max(startWhen + fi, endWhen - fo);
              clipGain.gain.setValueAtTime?.(1, foStart);
              clipGain.gain.linearRampToValueAtTime?.(0, endWhen);
            }
          } catch (_) {
            clipGain.gain.value = 1;
          }
          source.connect(clipGain);
          clipGain.connect(trackNode.inputNode);
        } else {
          source.connect(trackNode.inputNode);
        }

        if (playDuration > 0 && offset < clip.audioBuffer.duration) {
          source.start(startWhen, offset, playDuration);
        }
      }
    }

    // Render faster-than-realtime
    // Fix(wave3): overlaid del metrónomo offline al tempo real (si corresponde).
    const effMetroOffline = opts?.metronome ?? this.metronomeEnabled;
    const effSigOffline = opts?.timeSignature ?? this.timeSig;
    if (effMetroOffline) {
      this.scheduleMetronomeOnContext(
        offlineCtx,
        masterBus.inputNode,
        0,
        totalDuration,
        0,
        this.tempoBpm,
        effSigOffline
      );
    }

    const renderedBuffer = await offlineCtx.startRendering();

    // Clean up offline nodes to guarantee zero memory leaks
    for (const node of offlineTracks.values()) {
      node.dispose();
    }
    offlineTracks.clear();
    masterBus.dispose();

    return renderedBuffer;
  }

  /**
   * Backwards-compatible alias for renderOffline (firma intacta + opts opcional).
   */
  async renderOfflineMixdown(
    tracks: AudioTrack[],
    clips: AudioClip[],
    totalDuration: number,
    sampleRate: number = 44100,
    opts?: OfflineRenderOptions
  ): Promise<AudioBuffer> {
    return this.renderOffline(tracks, totalDuration, clips, sampleRate, opts);
  }

  /**
   * Subscribe to 60 FPS VU meter updates
   */
  onMeterUpdate(cb: MeterCallback): () => void {
    this.meterCallbacks.add(cb);
    return () => this.meterCallbacks.delete(cb);
  }

  /**
   * Alias for onMeterUpdate
   */
  subscribeMeters(cb: MeterCallback): () => void {
    return this.onMeterUpdate(cb);
  }

  /**
   * Subscribe to playhead time updates
   */
  onTimeUpdate(cb: TimeCallback): () => void {
    this.timeCallbacks.add(cb);
    return () => this.timeCallbacks.delete(cb);
  }

  // Fix(wave3): programa clips de [fromPosition, windowEnd) sobre ctx en base audioTime.
  private scheduleClipsRange(
    ctx: BaseAudioContext,
    clips: AudioClip[],
    fromPosition: number,
    windowEnd: number,
    audioBaseTime: number
  ): void {
    const plan = this.planClipSchedules(clips, fromPosition, windowEnd);
    const byId = new Map(clips.map((c) => [c.id, c]));
    for (const entry of plan) {
      const clip = byId.get(entry.clipId);
      if (!clip?.audioBuffer) continue;
      const trackNode = this.trackNodes.get(clip.trackId);
      // En render offline trackNodes vive en mapa local; el llamador programa aparte.
      if (!trackNode) continue;
      try {
        const source = ctx.createBufferSource();
        source.buffer = clip.audioBuffer;
        const startAt = audioBaseTime + entry.whenOffset;
        const playDur = entry.playDuration;
        const endAt = startAt + playDur;

        if ((clip.fadeIn || clip.fadeOut) && typeof ctx.createGain === 'function') {
          const clipGain = ctx.createGain();
          const fi = clip.fadeIn ? Math.min(clip.fadeIn, playDur) : 0;
          const fo = clip.fadeOut ? Math.min(clip.fadeOut, playDur) : 0;
          try {
            if (fi > 0) {
              clipGain.gain.setValueAtTime?.(0, startAt);
              clipGain.gain.linearRampToValueAtTime?.(1, startAt + fi);
            } else {
              clipGain.gain.setValueAtTime?.(1, startAt);
            }
            if (fo > 0) {
              const foStart = Math.max(startAt + fi, endAt - fo);
              clipGain.gain.setValueAtTime?.(1, foStart);
              clipGain.gain.linearRampToValueAtTime?.(0, endAt);
            }
          } catch (_) {
            clipGain.gain.value = 1;
          }
          source.connect(clipGain);
          clipGain.connect(trackNode.inputNode);
        } else {
          source.connect(trackNode.inputNode);
        }

        source.start(startAt, entry.offsetIntoClip, playDur);
        trackNode.addActiveSource(source);
      } catch (err) {
        // Fix(waveA): warn con contexto (en headless no se dispara: los mocks sí tienen start).
        console.warn('[AudioEngine] scheduleClipsRange: no se pudo programar clip', entry.clipId, err);
      }
    }
  }

  // Fix(wave3): click audible — oscilador corto con envolvente exponencial.
  // Acento (downbeat): 2000 Hz; resto: 1000 Hz. Duración 0.05 s, ganancia 0.25.
  private spawnClick(ctx: BaseAudioContext, destination: AudioNode, when: number, accent: boolean): void {
    const anyCtx = ctx as unknown as {
      createOscillator?: () => OscillatorNode;
      createGain?: () => GainNode;
    };
    if (typeof anyCtx.createOscillator !== 'function' || typeof anyCtx.createGain !== 'function') return;
    try {
      const osc = anyCtx.createOscillator();
      const gain = anyCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = accent ? 2000 : 1000;
      const t = Math.max(when, (ctx.currentTime ?? 0));
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(t);
      osc.stop(t + 0.06);
      // Solo nodos realtime se rastrean para stop(); en offline terminan con el render.
      if (ctx === (this.context as unknown as BaseAudioContext)) {
        this.metronomeNodes.push(osc);
        osc.onended = () => {
          this.metronomeNodes = this.metronomeNodes.filter((n) => n !== osc);
        };
      }
    } catch (err) {
      // Fix(waveA): warn con contexto de click (silencio solo si el mock headless está incompleto).
      console.warn('[AudioEngine] spawnClick: no se pudo generar click', err);
    }
  }

  // Fix(wave3): programa clicks de [from, until) sobre ctx. Reutilizado en
  // realtime (base = startTime) y offline (base = 0). Sigue al tempo real.
  private scheduleMetronomeOnContext(
    ctx: BaseAudioContext,
    destination: AudioNode,
    from: number,
    until: number,
    audioBaseTime: number,
    bpm?: number,
    sig?: [number, number]
  ): MetronomeClick[] {
    const clicks = this.getMetronomeClickTimes(from, until, bpm ?? this.tempoBpm, sig ?? this.activeTimeSig);
    for (const click of clicks) {
      this.spawnClick(ctx, destination, audioBaseTime + (click.time - from), click.accent);
    }
    return clicks;
  }

  // Fix(wave3): envoltorio realtime que resuelve destino (master bus o destination).
  private scheduleMetronomeRange(ctx: BaseAudioContext, from: number, until: number, audioBaseTime: number): void {
    const dest = (this.masterBus?.inputNode ?? (ctx as unknown as AudioContext).destination) as unknown as AudioNode;
    if (!dest) return;
    this.scheduleMetronomeOnContext(ctx, dest, from, until, audioBaseTime, this.tempoBpm, this.activeTimeSig);
  }

  // Fix(wave3): extiende el metrónomo en reproducciones lineales largas (cada 1 s
  // programa el siguiente tramo de 2 s). En loop no hace falta: el wrap replanifica.
  // Fix(AUD-04): ventana sin solape [max(now, watermark), now+2). El watermark es
  // monótono (max, no asignación directa) para no retroceder tras la siembra en play().
  private armMetroExtender(ctx: BaseAudioContext): void {
    if (this.metroTimer) clearInterval(this.metroTimer);
    this.metroTimer = setInterval(() => {
      if (!this.isPlaying || !this.activeMetronome || this.activeLoop) return;
      try {
        const now = this.getCurrentTime();
        const dest = (this.masterBus?.inputNode ?? (ctx as unknown as AudioContext).destination) as unknown as AudioNode;
        if (!dest) return;
        const audioNow = ctx.currentTime;
        const windowStart = Math.max(now, this.metroScheduledUntil);
        const windowEnd = now + 2;
        if (windowEnd > windowStart) {
          // La base de audio se desplaza con windowStart para conservar el alineado.
          this.scheduleMetronomeOnContext(ctx, dest, windowStart, windowEnd, audioNow + (windowStart - now), this.tempoBpm, this.activeTimeSig);
        }
        this.metroScheduledUntil = Math.max(this.metroScheduledUntil, windowEnd);
      } catch (err) {
        // Fix(waveA): warn con contexto en el extensor del metrónomo.
        console.warn('[AudioEngine] armMetroExtender: no se pudo extender el metrónomo', err);
      }
    }, 1000);
  }

  // Fix(wave3 + AUD-05): replanificación del loop (stop + replan), decidida en
  // el reloj de audio por el watchdog (checkLoopWrap). Reusa caché tracks/clips
  // y respeta el tempo vigente. El anclaje en currentTime + 0.02 rellena el hueco
  // cuando el watchdog detecta el cruce tarde; en hora es el empalme natural.
  private handleLoopWrap(): void {
    if (!this.isPlaying || !this.activeLoop || !this.context) return;
    const ctx = this.context;
    const { start, end } = this.activeLoop;
    const len = end - start;
    if (!(len > 0)) return;
    for (const node of this.trackNodes.values()) {
      node.stopAllSources();
    }
    this.stopMetronomeNodes();
    this.playheadOffset = start;
    this.startTime = ctx.currentTime + 0.02;
    this.scheduleClipsRange(ctx, this.cachedClips, start, end, this.startTime);
    if (this.activeMetronome) {
      this.scheduleMetronomeRange(ctx, start, end, this.startTime);
    }
    // Sin re-arme: el intervalo de vigilancia sigue corriendo y recalcula el
    // loopEnd proyectado desde el nuevo startTime/playheadOffset.
  }

  // Fix(AUD-05): vigilancia del loop cada 25 ms contra el loopEnd proyectado en
  // tiempo de audio (startTime + (end - playheadOffset)). Dispara solo cuando el
  // audio cruza el fin — nunca antes — para no truncar formas de onda en vuelo.
  private checkLoopWrap(): void {
    if (!this.isPlaying || !this.activeLoop || !this.context) return;
    const { end } = this.activeLoop;
    const projectedEnd = this.startTime + (end - this.playheadOffset);
    if (this.context.currentTime >= projectedEnd) {
      this.handleLoopWrap();
    }
  }

  private armLoopTimer(): void {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = setInterval(() => this.checkLoopWrap(), 25);
  }

  private clearLoopTimers(): void {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
    if (this.metroTimer) {
      clearInterval(this.metroTimer);
      this.metroTimer = null;
    }
  }

  private stopMetronomeNodes(): void {
    for (const osc of this.metronomeNodes) {
      try {
        osc.onended = null;
        osc.stop(0);
        osc.disconnect();
      } catch (err) {
        // Fix(waveA): warn con contexto al soltar osciladores del click.
        console.warn('[AudioEngine] stopMetronomeNodes: no se pudo soltar un oscilador', err);
      }
    }
    this.metronomeNodes = [];
  }

  private startTelemetryLoop() {
    if (this.rafId !== null) return;
    let idleDecayFrames = 30; // ~500ms of meter decay after playback stops
    const loop = () => {
      if (this.isPlaying) {
        const time = this.getCurrentTime();
        this.timeCallbacks.forEach((cb) => cb(time));
      }

      if (this.masterBus) {
        const masterLevels = this.masterBus.getMeterLevels();
        this.telemetryPayload.master.rms = masterLevels.rms;
        this.telemetryPayload.master.peak = masterLevels.peak;
        // Limpia ids obsoletos reutilizando el mismo objeto.
        for (const id of Object.keys(this.telemetryPayload.tracks)) {
          if (!this.trackNodes.has(id)) delete this.telemetryPayload.tracks[id];
        }
        for (const [id, node] of this.trackNodes.entries()) {
          let rms = 0;
          let peak = 0;
          try {
            const analyser = node.analyserNode as unknown as {
              fftSize: number;
              getFloatTimeDomainData: (a: Float32Array) => void;
            };
            const size = analyser.fftSize || 256;
            if (this.telemetryScratch.length < size) this.telemetryScratch = new Float32Array(size);
            const view = this.telemetryScratch.subarray(0, size);
            analyser.getFloatTimeDomainData(view);
            let sum = 0;
            for (let i = 0; i < view.length; i++) {
              // Fix(waveB-ts): noUncheckedIndexedAccess → view[i] es number|undefined.
              const abs = Math.abs(view[i] ?? 0);
              if (abs > peak) peak = abs;
              sum += abs * abs;
            }
            rms = Math.min(1, Math.sqrt(sum / view.length) * 1.4);
            peak = Math.min(1, peak);
          } catch (err) {
            // Fix(waveA): warn con contexto si falla la lectura del analyser.
            console.warn('[AudioEngine] telemetry: no se pudo leer el analyser de', id, err);
            const fallback = node.getMeterLevels();
            rms = fallback.rms;
            peak = fallback.peak;
          }
          const slot = this.telemetryPayload.tracks[id];
          if (slot) {
            slot.rms = rms;
            slot.peak = peak;
          } else {
            this.telemetryPayload.tracks[id] = { rms, peak };
          }
        }

        const sig =
          `${this.telemetryPayload.master.rms.toFixed(4)},${this.telemetryPayload.master.peak.toFixed(4)}|` +
          Object.keys(this.telemetryPayload.tracks)
            .sort()
            .map((id) => {
              // Fix(waveB-ts): id viene de Object.keys → existe; ?? 0 solo para el tipo.
              const t = this.telemetryPayload.tracks[id] ?? { rms: 0, peak: 0 };
              return `${id}:${t.rms.toFixed(4)},${t.peak.toFixed(4)}`;
            })
            .join(';');
        if (this.isPlaying || sig !== this.lastMeterSig) {
          this.lastMeterSig = sig;
          this.meterCallbacks.forEach((cb) => cb(this.telemetryPayload));
        }
      }

      if (typeof requestAnimationFrame === 'function') {
        if (this.isPlaying || this.isRecording) {
          idleDecayFrames = 30;
          this.rafId = requestAnimationFrame(loop);
        } else if (idleDecayFrames > 0) {
          idleDecayFrames--;
          this.rafId = requestAnimationFrame(loop);
        } else {
          // Reposo total: detener loop rAF para reducir consumo CPU a 0%
          this.rafId = null;
          this.telemetryPayload.master.rms = 0;
          this.telemetryPayload.master.peak = 0;
          for (const id of Object.keys(this.telemetryPayload.tracks)) {
            const slot = this.telemetryPayload.tracks[id];
            if (slot) {
              slot.rms = 0;
              slot.peak = 0;
            }
          }
          this.meterCallbacks.forEach((cb) => cb(this.telemetryPayload));
        }
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(loop);
    }
  }

  dispose() {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
    // Fix(wave3): dispose también desarma loop/metrónomo.
    this.clearLoopTimers();
    this.stopMetronomeNodes();
    this.activeLoop = null;
    this.meterCallbacks.clear();
    this.timeCallbacks.clear();
    this.clear();
    this.masterBus?.dispose();
    this.masterBus = null;
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(() => {});
    }
    this.context = null;
  }
}

export const audioEngine = AudioEngine.getInstance();
