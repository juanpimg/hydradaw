import { AudioTrack, AudioClip } from '../types/daw';
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

  // Fix(wave3): estado persistente de loop / metrónomo. El store aún NO los propaga
  // (placebos) — play() los respeta automáticamente para que el cableado futuro sea
  // trivial. Técnica de loop: stop + replanificación programada con setTimeout
  // alineado a loopEnd (NO BufferSource.loop=true, que repetiría el contenido del
  // buffer en lugar del arreglo del timeline con clips arbitrarios).
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

  // Recording
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private recordingTrackId: string | null = null;
  private recordingStartTime: number = 0;
  // Fix: deduplica stopRecording concurrentes (stop() + toggleRecord) devolviendo la misma promesa.
  private stopRecordingPromise: Promise<(AudioClip & { buffer: AudioBuffer }) | null> | null = null;

  // Telemetry & Animation
  private meterCallbacks: Set<MeterCallback> = new Set();
  private timeCallbacks: Set<TimeCallback> = new Set();
  private rafId: number | null = null;

  private constructor() {}

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
    await this.ensureContext();
  }

  /**
   * Initializes or resumes the AudioContext on user interaction
   */
  async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      const AudioCtx =
        typeof window !== 'undefined'
          ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          : (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext;

      if (!AudioCtx) {
        throw new Error('[AudioEngine] Web Audio API AudioContext is not supported in this environment.');
      }

      this.context = new AudioCtx({ latencyHint: 'interactive', sampleRate: 44100 });
      this.masterBus = new MasterBus(this.context);
      this.startTelemetryLoop();
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
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
    const target = Math.max(0, time);
    this.playheadOffset = target;
    if (this.isPlaying) {
      this.play(this.cachedTracks, this.cachedClips, target);
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
    this.cachedTracks = [];
    this.cachedClips = [];
  }

  /**
   * Syncs tracks with the audio engine
   */
  async syncTracks(tracks: AudioTrack[]) {
    this.cachedTracks = tracks;
    const ctx = await this.ensureContext();
    if (!this.masterBus) return;

    const anySoloed = tracks.some(t => t.solo);
    const existingIds = new Set(this.trackNodes.keys());
    const currentIds = new Set(tracks.map(t => t.id));

    // Remove deleted tracks & properly dispose TrackNodes
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        this.trackNodes.get(id)?.dispose();
        this.trackNodes.delete(id);
      }
    }

    // Add or update tracks
    for (const track of tracks) {
      let trackNode = this.trackNodes.get(track.id);
      if (!trackNode) {
        trackNode = new TrackNode(ctx, track);
        trackNode.connect(this.masterBus.inputNode);
        this.trackNodes.set(track.id, trackNode);
      } else {
        trackNode.updateTrackState(track, anySoloed);
      }
    }
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
    const ctx = await this.ensureContext();
    if (this.isPlaying) this.stop();

    if (tracks) this.cachedTracks = tracks;
    if (clips) this.cachedClips = clips;

    const activeTracks = tracks ?? this.cachedTracks;
    const activeClips = clips ?? this.cachedClips;

    await this.syncTracks(activeTracks);

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

    // Lookahead (20 ms) to guarantee all stems align at the exact same audio buffer quantum
    const scheduleLookahead = 0.02;
    this.startTime = ctx.currentTime + scheduleLookahead;

    const windowEnd = this.activeLoop ? this.activeLoop.end : Infinity;
    this.scheduleClipsRange(ctx, activeClips, this.playheadOffset, windowEnd, this.startTime);

    // Fix(wave3): metrónomo audible (oscilador corto, acento en downbeat) al tempo real.
    if (this.activeMetronome) {
      const horizon = this.activeLoop ? this.activeLoop.end : this.playheadOffset + this.getBeatStep() * 64;
      this.scheduleMetronomeRange(ctx, this.playheadOffset, horizon, this.startTime);
      // Extiende clicks en reproducción lineal larga (el loop se replanifica en el wrap).
      if (!this.activeLoop) this.armMetroExtender(ctx);
    }

    // Fix(wave3): arma replanificación del loop alineada a loopEnd.
    if (this.activeLoop) {
      const delaySec = this.activeLoop.end - this.playheadOffset;
      if (delaySec > 0) this.armLoopTimer(delaySec);
      else this.armLoopTimer(this.activeLoop.end - this.activeLoop.start);
    }
  }

  /**
   * Stops playback and recording
   */
  stop(): number {
    const currentPos = this.getCurrentTime();
    this.isPlaying = false;
    // Fix(wave3): cancela timers de loop/metrónomo y suelta osciladores del click.
    this.clearLoopTimers();
    this.stopMetronomeNodes();

    // Stop all active sources across all track nodes
    for (const node of this.trackNodes.values()) {
      node.stopAllSources();
    }

    if (this.isRecording) {
      // Fix: evita promesa flotante sin manejar; el clip resultante se descarta aquí
      // (quien necesite el clip debe llamar a stopRecording() y compartir la misma promesa deduplicada).
      void this.stopRecording().catch(() => null);
    }

    this.activeLoop = null;

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
    await this.ensureContext();
    this.recordingTrackId = armedTrackId;
    this.recordingStartTime = this.getCurrentTime();
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
    this.isRecording = true;

    // Start synchronized playback
    await this.play(tracks ?? this.cachedTracks, clips ?? this.cachedClips, this.recordingStartTime);
  }

  /**
   * Stops recording and decodes recorded clip
   */
  async stopRecording(): Promise<(AudioClip & { buffer: AudioBuffer }) | null> {
    // Fix: deduplica llamadas concurrentes (stop() en pausa + toggleRecord del store)
    // devolviendo la misma promesa en vuelo en lugar de decodificar dos veces.
    if (this.stopRecordingPromise) return this.stopRecordingPromise;
    if (!this.isRecording || !this.mediaRecorder || !this.context) return null;

    this.isRecording = false;

    const recorder = this.mediaRecorder;
    const ctx = this.context;

    this.stopRecordingPromise = new Promise((resolve) => {
      const done = (clip: (AudioClip & { buffer: AudioBuffer }) | null) => {
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

          const clip: AudioClip & { buffer: AudioBuffer } = {
            id: 'clip_' + Date.now(),
            trackId: this.recordingTrackId || '',
            name: 'Grabación ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            startTime: this.recordingStartTime,
            duration: audioBuffer.duration,
            offset: 0,
            audioBuffer,
            buffer: audioBuffer,
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
        source.connect(trackNode.inputNode);

        const offset = Math.max(0, -clipStart) + clip.offset;
        const startWhen = Math.max(0, clipStart);
        const playDuration = Math.min(
          clip.duration - Math.max(0, -clipStart),
          totalDuration - startWhen,
          clip.audioBuffer.duration - offset
        );

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
        source.connect(trackNode.inputNode);
        source.start(audioBaseTime + entry.whenOffset, entry.offsetIntoClip, entry.playDuration);
        trackNode.addActiveSource(source);
      } catch (_) {
        // Nodo mock sin start connect — se ignora para no romper headless tests.
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
    } catch (_) {
      // Headless mock incompleto — el grid puro sigue testeable vía getMetronomeClickTimes.
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
  private armMetroExtender(ctx: BaseAudioContext): void {
    if (this.metroTimer) clearInterval(this.metroTimer);
    this.metroTimer = setInterval(() => {
      if (!this.isPlaying || !this.activeMetronome || this.activeLoop) return;
      try {
        const now = this.getCurrentTime();
        const dest = (this.masterBus?.inputNode ?? (ctx as unknown as AudioContext).destination) as unknown as AudioNode;
        if (!dest) return;
        const audioNow = ctx.currentTime;
        // Programa [now, now+2) alineado a audioNow.
        this.scheduleMetronomeOnContext(ctx, dest, now, now + 2, audioNow, this.tempoBpm, this.activeTimeSig);
      } catch (_) {}
    }, 1000);
  }

  // Fix(wave3): replanificación del loop (stop + replan). Se ejecuta vía setTimeout
  // alineado a loopEnd; reusa caché tracks/clips y respeta el tempo vigente.
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
    this.armLoopTimer(len);
  }

  private armLoopTimer(delaySec: number): void {
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = setTimeout(() => this.handleLoopWrap(), Math.max(0, delaySec * 1000));
  }

  private clearLoopTimers(): void {
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
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
      } catch (_) {}
    }
    this.metronomeNodes = [];
  }

  private startTelemetryLoop() {
    // Fix (doble loop rAF): este loop central del engine emite meters + time callbacks para suscriptores
    // React; el playhead de Timeline usa su propio loop con mutación directa del DOM para evitar
    // re-renders a 60fps. Se mantienen separados a propósito (ver comentario en Timeline.tsx).
    const loop = () => {
      if (this.isPlaying) {
        const time = this.getCurrentTime();
        this.timeCallbacks.forEach((cb) => cb(time));
      }

      if (this.masterBus) {
        const masterLevels = this.masterBus.getMeterLevels();
        const trackLevels: Record<string, { rms: number; peak: number }> = {};
        for (const [id, node] of this.trackNodes.entries()) {
          trackLevels[id] = node.getMeterLevels();
        }

        this.meterCallbacks.forEach((cb) => cb({ master: masterLevels, tracks: trackLevels }));
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  dispose() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
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
