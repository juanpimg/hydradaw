import { AudioTrack, AudioClip } from '../types/daw';
import { TrackNode } from './TrackNode';
import { MasterBus } from './MasterBus';
import { generateWaveformPeaks } from './waveformUtils';

export type MeterCallback = (levels: { master: { rms: number; peak: number }; tracks: Record<string, { rms: number; peak: number }> }) => void;
export type TimeCallback = (time: number) => void;

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

  // Recording
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private recordingTrackId: string | null = null;
  private recordingStartTime: number = 0;

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
   * Starts sample-accurate multitrack playback from a specific timeline position
   */
  async play(tracks?: AudioTrack[], clips?: AudioClip[], fromPosition: number = 0) {
    const ctx = await this.ensureContext();
    if (this.isPlaying) this.stop();

    if (tracks) this.cachedTracks = tracks;
    if (clips) this.cachedClips = clips;

    const activeTracks = tracks ?? this.cachedTracks;
    const activeClips = clips ?? this.cachedClips;

    await this.syncTracks(activeTracks);

    this.isPlaying = true;
    this.playheadOffset = Math.max(0, fromPosition);

    // Lookahead (20 ms) to guarantee all stems align at the exact same audio buffer quantum
    const scheduleLookahead = 0.02;
    this.startTime = ctx.currentTime + scheduleLookahead;

    const scheduleWindowStart = this.playheadOffset;

    // Schedule all clips on their respective tracks
    for (const clip of activeClips) {
      if (!clip.audioBuffer) continue;
      const trackNode = this.trackNodes.get(clip.trackId);
      if (!trackNode) continue;

      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;

      // Check if clip falls within playback range
      if (clipEnd > scheduleWindowStart) {
        const offsetIntoClip = Math.max(0, scheduleWindowStart - clipStart) + clip.offset;
        const delayUntilStart = Math.max(0, clipStart - scheduleWindowStart);
        const playDuration = Math.min(
          clip.duration - Math.max(0, scheduleWindowStart - clipStart),
          clip.audioBuffer.duration - offsetIntoClip
        );

        if (playDuration > 0 && offsetIntoClip < clip.audioBuffer.duration) {
          const source = ctx.createBufferSource();
          source.buffer = clip.audioBuffer;
          source.connect(trackNode.inputNode);

          const when = this.startTime + delayUntilStart;
          source.start(when, offsetIntoClip, playDuration);
          trackNode.addActiveSource(source);
        }
      }
    }
  }

  /**
   * Stops playback and recording
   */
  stop(): number {
    const currentPos = this.getCurrentTime();
    this.isPlaying = false;

    // Stop all active sources across all track nodes
    for (const node of this.trackNodes.values()) {
      node.stopAllSources();
    }

    if (this.isRecording) {
      this.stopRecording();
    }

    return currentPos;
  }

  /**
   * Returns live playhead time in seconds strictly derived from AudioContext.currentTime
   */
  getCurrentTime(): number {
    if (!this.isPlaying || !this.context) {
      return this.playheadOffset;
    }
    const elapsed = this.context.currentTime - this.startTime;
    return this.playheadOffset + Math.max(0, elapsed);
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

    this.mediaRecorder.start(100);
    this.isRecording = true;

    // Start synchronized playback
    await this.play(tracks ?? this.cachedTracks, clips ?? this.cachedClips, this.recordingStartTime);
  }

  /**
   * Stops recording and decodes recorded clip
   */
  async stopRecording(): Promise<(AudioClip & { buffer: AudioBuffer }) | null> {
    if (!this.isRecording || !this.mediaRecorder || !this.context) return null;

    this.isRecording = false;

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = async () => {
        try {
          const blob = new Blob(this.recordingChunks, { type: this.mediaRecorder!.mimeType || 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await this.context!.decodeAudioData(arrayBuffer);
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

          resolve(clip);
        } catch (err) {
          console.error('[AudioEngine] Error decoding recorded audio:', err);
          resolve(null);
        }
      };

      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    });
  }

  /**
   * Faster-than-realtime offline render for mixdown / export using OfflineAudioContext
   */
  async renderOffline(
    tracks: AudioTrack[],
    duration: number,
    clips?: AudioClip[],
    sampleRate: number = 44100
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
   * Backwards-compatible alias for renderOffline
   */
  async renderOfflineMixdown(
    tracks: AudioTrack[],
    clips: AudioClip[],
    totalDuration: number,
    sampleRate: number = 44100
  ): Promise<AudioBuffer> {
    return this.renderOffline(tracks, totalDuration, clips, sampleRate);
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

  private startTelemetryLoop() {
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
