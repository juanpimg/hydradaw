import { PluginDefinition } from '../types/daw';

// Fix(waveA): PRNG determinista (mulberry32) para IR reproducible (RT == export).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fix(waveA): semilla fija derivada de `decay` para que la misma decay genere la misma IR.
export function reverbSeedFromDecay(decay: number): number {
  const q = Number.isFinite(decay) ? Math.round(decay * 1000) : 2000;
  return (Math.imul(q, 2654435761) ^ 0x9e3779b9) >>> 0;
}

// Fix(waveA): debounce trailing para regeneración de IR multi-MB por tick de knob (150-250ms).
export const REVERB_DECAY_DEBOUNCE_MS = 200;

// Fix(waveA): debounce trailing para recálculo de curva del saturador por tick de knob.
export const SATURATOR_DRIVE_DEBOUNCE_MS = 150;

// Fix(waveA): ganancia dura máxima del loop de feedback del delay (riesgo auditivo si >= 1).
export const DELAY_FEEDBACK_MAX_GAIN = 0.95;

// Fix(waveA): clamp local a la definición del parámetro (min/max). El canonical
// `clampToDef` vive en PluginHost; este helper evita un import circular
// (PluginHost -> BUILTIN_PLUGINS) y aplica la misma tabla min/max.
function clampBuiltinParam(pluginId: string, paramId: string, value: number): number {
  const def = BUILTIN_PLUGINS[pluginId];
  const param = def?.parameters.find((p) => p.id === paramId);
  if (!param) return value;
  if (!Number.isFinite(value)) return param.defaultValue;
  return Math.min(param.max, Math.max(param.min, value));
}

/**
 * Generates a synthetic impulse response for convolution reverb
 */
export function createReverbImpulse(context: BaseAudioContext, duration: number, decay: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * Math.max(0.1, duration));
  const impulse = context.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  // Fix(waveA): ruido determinista con semilla derivada de `decay` (misma decay -> mismo buffer).
  const rng = mulberry32(reverbSeedFromDecay(decay));
  for (let i = 0; i < length; i++) {
    const n = length - i;
    const factor = Math.pow(n / length, decay);
    // Stereo white noise decay
    left[i] = (rng() * 2 - 1) * factor;
    right[i] = (rng() * 2 - 1) * factor;
  }
  return impulse;
}

/**
 * Distortion curve for tube saturation
 */
export function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  // Fix(waveA): clamp drive a 0..100 (la tabla usa amount = drive/2, es decir 0..50).
  const clamped = Number.isFinite(amount) ? Math.min(50, Math.max(0, amount)) : 12.5;
  const k = Math.max(0, clamped);
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    if (k === 0) {
      curve[i] = x;
    } else {
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
  }
  return curve;
}

export const BUILTIN_PLUGINS: Record<string, PluginDefinition> = {
  eq3: {
    id: 'eq3',
    name: 'Vintage 3-Band Parametric EQ',
    category: 'eq',
    description: 'Ecualizador musical de 3 bandas con modelado analógico de curvas (Low Shelf, Mid Bell y High Shelf).',
    parameters: [
      { id: 'lowGain', name: 'Low Gain', min: -15, max: 15, step: 0.5, defaultValue: 0, unit: 'dB' },
      { id: 'lowFreq', name: 'Low Freq', min: 40, max: 350, step: 10, defaultValue: 100, unit: 'Hz' },
      { id: 'midGain', name: 'Mid Gain', min: -15, max: 15, step: 0.5, defaultValue: 0, unit: 'dB' },
      { id: 'midFreq', name: 'Mid Freq', min: 300, max: 5000, step: 50, defaultValue: 1000, unit: 'Hz' },
      { id: 'midQ', name: 'Mid Q', min: 0.5, max: 4.0, step: 0.1, defaultValue: 1.0 },
      { id: 'highGain', name: 'High Gain', min: -15, max: 15, step: 0.5, defaultValue: 0, unit: 'dB' },
      { id: 'highFreq', name: 'High Freq', min: 3000, max: 16000, step: 100, defaultValue: 8000, unit: 'Hz' },
    ],
    createDSPNode: (context, params) => {
      const lowFilter = context.createBiquadFilter();
      lowFilter.type = 'lowshelf';
      // Fix(waveA): clamp en creación (frecuencias <= 0 quedan fuera de rango).
      lowFilter.frequency.value = clampBuiltinParam('eq3', 'lowFreq', params.lowFreq ?? 100);
      lowFilter.gain.value = clampBuiltinParam('eq3', 'lowGain', params.lowGain ?? 0);

      const midFilter = context.createBiquadFilter();
      midFilter.type = 'peaking';
      midFilter.frequency.value = clampBuiltinParam('eq3', 'midFreq', params.midFreq ?? 1000);
      midFilter.gain.value = clampBuiltinParam('eq3', 'midGain', params.midGain ?? 0);
      midFilter.Q.value = clampBuiltinParam('eq3', 'midQ', params.midQ ?? 1.0);

      const highFilter = context.createBiquadFilter();
      highFilter.type = 'highshelf';
      highFilter.frequency.value = clampBuiltinParam('eq3', 'highFreq', params.highFreq ?? 8000);
      highFilter.gain.value = clampBuiltinParam('eq3', 'highGain', params.highGain ?? 0);

      lowFilter.connect(midFilter);
      midFilter.connect(highFilter);

      return {
        inputNode: lowFilter,
        outputNode: highFilter,
        updateParameter: (paramId, value) => {
          // Fix(waveA): clamp en TODOS los updateParameter contra la definición.
          if (paramId === 'lowGain') lowFilter.gain.setTargetAtTime(clampBuiltinParam('eq3', 'lowGain', value), context.currentTime, 0.02);
          if (paramId === 'lowFreq') lowFilter.frequency.setTargetAtTime(clampBuiltinParam('eq3', 'lowFreq', value), context.currentTime, 0.02);
          if (paramId === 'midGain') midFilter.gain.setTargetAtTime(clampBuiltinParam('eq3', 'midGain', value), context.currentTime, 0.02);
          if (paramId === 'midFreq') midFilter.frequency.setTargetAtTime(clampBuiltinParam('eq3', 'midFreq', value), context.currentTime, 0.02);
          if (paramId === 'midQ') midFilter.Q.setTargetAtTime(clampBuiltinParam('eq3', 'midQ', value), context.currentTime, 0.02);
          if (paramId === 'highGain') highFilter.gain.setTargetAtTime(clampBuiltinParam('eq3', 'highGain', value), context.currentTime, 0.02);
          if (paramId === 'highFreq') highFilter.frequency.setTargetAtTime(clampBuiltinParam('eq3', 'highFreq', value), context.currentTime, 0.02);
        },
      };
    },
  },

  compressor: {
    id: 'compressor',
    name: 'Pro VCA Compressor',
    category: 'dynamics',
    description: 'Compresor transparente de nivel de estudio con control de umbral, ratio, tiempos y ganancia de salida.',
    parameters: [
      { id: 'threshold', name: 'Threshold', min: -50, max: 0, step: 1, defaultValue: -18, unit: 'dB' },
      { id: 'ratio', name: 'Ratio', min: 1, max: 20, step: 0.5, defaultValue: 4, unit: ':1' },
      { id: 'attack', name: 'Attack', min: 1, max: 150, step: 1, defaultValue: 20, unit: 'ms' },
      { id: 'release', name: 'Release', min: 20, max: 800, step: 10, defaultValue: 150, unit: 'ms' },
      { id: 'makeupGain', name: 'Makeup', min: -6, max: 18, step: 0.5, defaultValue: 3, unit: 'dB' },
    ],
    createDSPNode: (context, params) => {
      const comp = context.createDynamicsCompressor();
      // Fix(waveA): clamp en creación (ratio < 1, umbrales fuera de rango, etc.).
      comp.threshold.value = clampBuiltinParam('compressor', 'threshold', params.threshold ?? -18);
      comp.ratio.value = clampBuiltinParam('compressor', 'ratio', params.ratio ?? 4);
      comp.attack.value = clampBuiltinParam('compressor', 'attack', params.attack ?? 20) / 1000;
      comp.release.value = clampBuiltinParam('compressor', 'release', params.release ?? 150) / 1000;

      const makeup = context.createGain();
      const makeupDb = clampBuiltinParam('compressor', 'makeupGain', params.makeupGain ?? 3);
      makeup.gain.value = Math.pow(10, makeupDb / 20);

      comp.connect(makeup);

      return {
        inputNode: comp,
        outputNode: makeup,
        updateParameter: (paramId, value) => {
          // Fix(waveA): clamp en TODOS los updateParameter contra la definición.
          if (paramId === 'threshold') comp.threshold.setTargetAtTime(clampBuiltinParam('compressor', 'threshold', value), context.currentTime, 0.02);
          if (paramId === 'ratio') comp.ratio.setTargetAtTime(clampBuiltinParam('compressor', 'ratio', value), context.currentTime, 0.02);
          if (paramId === 'attack') comp.attack.setTargetAtTime(clampBuiltinParam('compressor', 'attack', value) / 1000, context.currentTime, 0.02);
          if (paramId === 'release') comp.release.setTargetAtTime(clampBuiltinParam('compressor', 'release', value) / 1000, context.currentTime, 0.02);
          if (paramId === 'makeupGain') {
            const gainLinear = Math.pow(10, clampBuiltinParam('compressor', 'makeupGain', value) / 20);
            makeup.gain.setTargetAtTime(gainLinear, context.currentTime, 0.02);
          }
        },
      };
    },
  },

  delay: {
    id: 'delay',
    name: 'Analog Tape Delay',
    category: 'spatial',
    description: 'Eco y retardo estéreo con filtro paso-bajo cálido y retroalimentación analógica.',
    parameters: [
      { id: 'time', name: 'Time', min: 20, max: 800, step: 10, defaultValue: 250, unit: 'ms' },
      { id: 'feedback', name: 'Feedback', min: 0, max: 85, step: 1, defaultValue: 35, unit: '%' },
      { id: 'damp', name: 'Damping', min: 1000, max: 14000, step: 200, defaultValue: 6000, unit: 'Hz' },
      { id: 'mix', name: 'Mix', min: 0, max: 100, step: 1, defaultValue: 25, unit: '%' },
    ],
    createDSPNode: (context, params) => {
      const input = context.createGain();
      const output = context.createGain();
      const dryGain = context.createGain();
      const wetGain = context.createGain();

      const delayNode = context.createDelay(2.0);
      delayNode.delayTime.value = clampBuiltinParam('delay', 'time', params.time ?? 250) / 1000;

      const feedbackNode = context.createGain();
      // Fix(waveA): clamp duro de feedback <= 0.95 en creación (valor >= 100 daría ganancia de loop >= 1).
      const feedbackPct = clampBuiltinParam('delay', 'feedback', params.feedback ?? 35);
      feedbackNode.gain.value = Math.min(feedbackPct / 100, DELAY_FEEDBACK_MAX_GAIN);

      const filterNode = context.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.value = clampBuiltinParam('delay', 'damp', params.damp ?? 6000);

      const mixVal = clampBuiltinParam('delay', 'mix', params.mix ?? 25) / 100;
      dryGain.gain.value = 1.0;
      wetGain.gain.value = mixVal;

      // Dry path
      input.connect(dryGain);
      dryGain.connect(output);

      // Wet feedback loop: input -> delay -> filter -> feedback -> delay
      input.connect(delayNode);
      delayNode.connect(filterNode);
      filterNode.connect(feedbackNode);
      feedbackNode.connect(delayNode);

      // Wet output
      filterNode.connect(wetGain);
      wetGain.connect(output);

      return {
        inputNode: input,
        outputNode: output,
        updateParameter: (paramId, value) => {
          // Fix(waveA): clamp en TODOS los updateParameter; feedback con tope duro 0.95.
          if (paramId === 'time') delayNode.delayTime.setTargetAtTime(clampBuiltinParam('delay', 'time', value) / 1000, context.currentTime, 0.02);
          if (paramId === 'feedback') feedbackNode.gain.setTargetAtTime(Math.min(clampBuiltinParam('delay', 'feedback', value) / 100, DELAY_FEEDBACK_MAX_GAIN), context.currentTime, 0.02);
          if (paramId === 'damp') filterNode.frequency.setTargetAtTime(clampBuiltinParam('delay', 'damp', value), context.currentTime, 0.02);
          if (paramId === 'mix') wetGain.gain.setTargetAtTime(clampBuiltinParam('delay', 'mix', value) / 100, context.currentTime, 0.02);
        },
      };
    },
  },

  reverb: {
    id: 'reverb',
    name: 'Studio Hall Reverb',
    category: 'spatial',
    description: 'Espacializador convolutivo de alta densidad con control de amortiguación y tiempo de cola.',
    parameters: [
      { id: 'decay', name: 'Decay', min: 0.5, max: 5.0, step: 0.1, defaultValue: 2.0, unit: 's' },
      { id: 'mix', name: 'Mix', min: 0, max: 100, step: 1, defaultValue: 30, unit: '%' },
      { id: 'damping', name: 'Damping', min: 2000, max: 16000, step: 200, defaultValue: 8000, unit: 'Hz' },
    ],
    createDSPNode: (context, params) => {
      const input = context.createGain();
      const output = context.createGain();
      const dryGain = context.createGain();
      const wetGain = context.createGain();

      const convolver = context.createConvolver();
      // Fix(waveA): clamp en creación.
      const decayTime = clampBuiltinParam('reverb', 'decay', params.decay ?? 2.0);
      convolver.buffer = createReverbImpulse(context, decayTime, 2.5);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = clampBuiltinParam('reverb', 'damping', params.damping ?? 8000);

      const mix = clampBuiltinParam('reverb', 'mix', params.mix ?? 30) / 100;
      dryGain.gain.value = 1.0;
      wetGain.gain.value = mix;

      input.connect(dryGain);
      dryGain.connect(output);

      input.connect(filter);
      filter.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(output);

      // Fix(waveA): debounce trailing de la regeneración de IR (multi-MB por tick de knob).
      let decayTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingDecay: number | null = null;

      return {
        inputNode: input,
        outputNode: output,
        updateParameter: (paramId, value) => {
          // Fix(waveA): clamp en TODOS los updateParameter contra la definición.
          if (paramId === 'mix') wetGain.gain.setTargetAtTime(clampBuiltinParam('reverb', 'mix', value) / 100, context.currentTime, 0.02);
          if (paramId === 'damping') filter.frequency.setTargetAtTime(clampBuiltinParam('reverb', 'damping', value), context.currentTime, 0.02);
          if (paramId === 'decay') {
            pendingDecay = clampBuiltinParam('reverb', 'decay', value);
            if (decayTimer !== null) clearTimeout(decayTimer);
            decayTimer = setTimeout(() => {
              decayTimer = null;
              if (pendingDecay === null) return;
              const v = pendingDecay;
              pendingDecay = null;
              try {
                // Fix(waveA): IR determinista (semilla de `decay`); RT == export.
                convolver.buffer = createReverbImpulse(context, v, 2.5);
              } catch (e) {
                // Context might be busy
              }
            }, REVERB_DECAY_DEBOUNCE_MS);
          }
        },
        cleanup: () => {
          if (decayTimer !== null) {
            clearTimeout(decayTimer);
            decayTimer = null;
          }
        },
      };
    },
  },

  limiter: {
    id: 'limiter',
    name: 'Mastering Brickwall Limiter',
    category: 'dynamics',
    description: 'Limitador de pico real que previene el clipeo digital en 0 dBFS con techo estricto (-0.1 dB).',
    parameters: [
      { id: 'ceiling', name: 'Ceiling', min: -3.0, max: 0.0, step: 0.1, defaultValue: -0.1, unit: 'dB' },
      { id: 'threshold', name: 'Threshold', min: -18, max: 0, step: 0.5, defaultValue: -2, unit: 'dB' },
      { id: 'release', name: 'Release', min: 10, max: 300, step: 10, defaultValue: 50, unit: 'ms' },
    ],
    createDSPNode: (context, params) => {
      const comp = context.createDynamicsCompressor();
      // Fix(waveA): clamp en creación.
      comp.threshold.value = clampBuiltinParam('limiter', 'threshold', params.threshold ?? -2);
      comp.ratio.value = 20; // Hard limiting ratio
      comp.knee.value = 0;   // Hard knee
      comp.attack.value = 0.001; // 1 ms fastest attack
      comp.release.value = clampBuiltinParam('limiter', 'release', params.release ?? 50) / 1000;

      const ceilingGain = context.createGain();
      const ceilingDb = clampBuiltinParam('limiter', 'ceiling', params.ceiling ?? -0.1);
      ceilingGain.gain.value = Math.pow(10, ceilingDb / 20);

      comp.connect(ceilingGain);

      return {
        inputNode: comp,
        outputNode: ceilingGain,
        updateParameter: (paramId, value) => {
          // Fix(waveA): clamp en TODOS los updateParameter contra la definición.
          if (paramId === 'threshold') comp.threshold.setTargetAtTime(clampBuiltinParam('limiter', 'threshold', value), context.currentTime, 0.01);
          if (paramId === 'release') comp.release.setTargetAtTime(clampBuiltinParam('limiter', 'release', value) / 1000, context.currentTime, 0.01);
          if (paramId === 'ceiling') {
            const linear = Math.pow(10, clampBuiltinParam('limiter', 'ceiling', value) / 20);
            ceilingGain.gain.setTargetAtTime(linear, context.currentTime, 0.01);
          }
        },
      };
    },
  },

  saturator: {
    id: 'saturator',
    name: 'Tube Saturation & Warmth',
    category: 'distortion',
    description: 'Distorsión armónica cálida para enriquecer pistas vocales o instrumentos con presencia analógica.',
    parameters: [
      { id: 'drive', name: 'Drive', min: 0, max: 100, step: 1, defaultValue: 25, unit: '%' },
      { id: 'tone', name: 'Tone', min: 2000, max: 14000, step: 200, defaultValue: 6500, unit: 'Hz' },
      { id: 'mix', name: 'Mix', min: 0, max: 100, step: 1, defaultValue: 50, unit: '%' },
    ],
    createDSPNode: (context, params) => {
      const input = context.createGain();
      const output = context.createGain();
      const dryGain = context.createGain();
      const wetGain = context.createGain();

      const shaper = context.createWaveShaper();
      // Fix(waveA): clamp drive 0..100 en creación.
      shaper.curve = makeDistortionCurve(clampBuiltinParam('saturator', 'drive', params.drive ?? 25) / 2);
      shaper.oversample = '4x';

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = clampBuiltinParam('saturator', 'tone', params.tone ?? 6500);

      // Fix(waveA): clamp en creación; se conserva el mix actual para la rampa del swap.
      let currentMix = clampBuiltinParam('saturator', 'mix', params.mix ?? 50) / 100;
      dryGain.gain.value = 1.0 - currentMix * 0.5;
      wetGain.gain.value = currentMix;

      input.connect(dryGain);
      dryGain.connect(output);

      input.connect(shaper);
      shaper.connect(filter);
      filter.connect(wetGain);
      wetGain.connect(output);

      // Fix(waveA): debounce del recálculo de curva (44100 floats por tick) + rampa de wet en el swap.
      let driveTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingDrive: number | null = null;

      return {
        inputNode: input,
        outputNode: output,
        updateParameter: (paramId, value) => {
          // Fix(waveA): clamp en TODOS los updateParameter contra la definición.
          if (paramId === 'drive') {
            pendingDrive = clampBuiltinParam('saturator', 'drive', value);
            if (driveTimer !== null) clearTimeout(driveTimer);
            driveTimer = setTimeout(() => {
              driveTimer = null;
              if (pendingDrive === null) return;
              const d = pendingDrive;
              pendingDrive = null;
              try {
                const now = context.currentTime;
                // Fix(waveA): rampa de wet durante el swap para evitar clicks.
                try {
                  (wetGain.gain as unknown as { cancelScheduledValues?: (t: number) => void }).cancelScheduledValues?.(now);
                } catch (_) { /* mock sin cancelScheduledValues */ }
                wetGain.gain.setTargetAtTime(0.0, now, 0.01);
                shaper.curve = makeDistortionCurve(d / 2);
                wetGain.gain.setTargetAtTime(currentMix, now + 0.04, 0.02);
              } catch (_) { /* contexto ocupado */ }
            }, SATURATOR_DRIVE_DEBOUNCE_MS);
          }
          if (paramId === 'tone') filter.frequency.setTargetAtTime(clampBuiltinParam('saturator', 'tone', value), context.currentTime, 0.02);
          if (paramId === 'mix') {
            const m = clampBuiltinParam('saturator', 'mix', value) / 100;
            currentMix = m;
            wetGain.gain.setTargetAtTime(m, context.currentTime, 0.02);
            dryGain.gain.setTargetAtTime(1.0 - m * 0.5, context.currentTime, 0.02);
          }
        },
        cleanup: () => {
          if (driveTimer !== null) {
            clearTimeout(driveTimer);
            driveTimer = null;
          }
        },
      };
    },
  },
};
