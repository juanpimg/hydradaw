export type TrackType = 'audio' | 'vocal' | 'instrument' | 'master';

export interface PluginParameter {
  id: string;
  name: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string | undefined;
}

export interface PluginDefinition {
  id: string;
  name: string;
  category: 'eq' | 'dynamics' | 'spatial' | 'distortion' | 'utility' | 'custom';
  description: string;
  parameters: PluginParameter[];
  createDSPNode: (context: BaseAudioContext, params: Record<string, number>) => {
    inputNode: AudioNode;
    outputNode: AudioNode;
    updateParameter: (paramId: string, value: number) => void;
    cleanup?: (() => void) | undefined;
  };
}

export interface PluginInstance {
  instanceId: string;
  pluginId: string;
  name: string;
  enabled: boolean;
  parameters: Record<string, number>;
  customWamUrl?: string | undefined;
  customJsCode?: string | undefined;
}

export type WavBitDepth = 16 | 24 | 32;

export type SnapMode = 'bar' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | 'triplet' | 'off';

export interface AudioClip {
  id: string;
  trackId: string;
  name: string;
  startTime: number;     // Starting point on timeline (seconds)
  duration: number;      // Duration on timeline (seconds)
  offset: number;        // Offset into the audio buffer (seconds)
  audioBuffer: AudioBuffer | null;
  // Fix(waveB): alias duplicado `buffer` eliminado — unificado en `audioBuffer`
  // (un clip con solo `buffer` no sonaba ni se exportaba).
  peaks: Float32Array;   // Pre-calculated min/max waveform peaks for 60fps canvas
  // TS-01 (exactOptionalPropertyTypes): un clip sin color asigna `undefined`
  // explícito; se declara para que la ausencia sea un valor válido.
  color?: string | undefined;
  fadeIn?: number | undefined;       // Fade-in duration in seconds (optional)
  fadeOut?: number | undefined;      // Fade-out duration in seconds (optional)
}

export interface AudioTrack {
  id: string;
  name: string;
  type: TrackType;
  color: string;
  volume: number;        // 0.0 to 1.5 (default 1.0 = 0dB)
  pan: number;           // -1.0 (Left) to +1.0 (Right)
  mute: boolean;
  solo: boolean;
  armed: boolean;        // Ready for recording
  plugins: PluginInstance[];
}

export interface ProjectMetadata {
  id: string;
  name: string;
  bpm: number;
  timeSignature: [number, number];
  sampleRate: number;
  duration: number;
  createdAt: number;
  updatedAt: number;
}
