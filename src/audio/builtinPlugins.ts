import { PluginDefinition } from '../types/daw';

/**
 * Generates a synthetic impulse response for convolution reverb
 */
function createReverbImpulse(context: BaseAudioContext, duration: number, decay: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * Math.max(0.1, duration));
  const impulse = context.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = length - i;
    const factor = Math.pow(n / length, decay);
    // Stereo white noise decay
    left[i] = (Math.random() * 2 - 1) * factor;
    right[i] = (Math.random() * 2 - 1) * factor;
  }
  return impulse;
}

/**
 * Distortion curve for tube saturation
 */
function makeDistortionCurve(amount: number): Float32Array {
  const k = Math.max(0, amount);
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
      lowFilter.frequency.value = params.lowFreq ?? 100;
      lowFilter.gain.value = params.lowGain ?? 0;

      const midFilter = context.createBiquadFilter();
      midFilter.type = 'peaking';
      midFilter.frequency.value = params.midFreq ?? 1000;
      midFilter.gain.value = params.midGain ?? 0;
      midFilter.Q.value = params.midQ ?? 1.0;

      const highFilter = context.createBiquadFilter();
      highFilter.type = 'highshelf';
      highFilter.frequency.value = params.highFreq ?? 8000;
      highFilter.gain.value = params.highGain ?? 0;

      lowFilter.connect(midFilter);
      midFilter.connect(highFilter);

      return {
        inputNode: lowFilter,
        outputNode: highFilter,
        updateParameter: (paramId, value) => {
          if (paramId === 'lowGain') lowFilter.gain.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'lowFreq') lowFilter.frequency.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'midGain') midFilter.gain.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'midFreq') midFilter.frequency.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'midQ') midFilter.Q.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'highGain') highFilter.gain.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'highFreq') highFilter.frequency.setTargetAtTime(value, context.currentTime, 0.02);
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
      comp.threshold.value = params.threshold ?? -18;
      comp.ratio.value = params.ratio ?? 4;
      comp.attack.value = (params.attack ?? 20) / 1000;
      comp.release.value = (params.release ?? 150) / 1000;

      const makeup = context.createGain();
      const makeupDb = params.makeupGain ?? 3;
      makeup.gain.value = Math.pow(10, makeupDb / 20);

      comp.connect(makeup);

      return {
        inputNode: comp,
        outputNode: makeup,
        updateParameter: (paramId, value) => {
          if (paramId === 'threshold') comp.threshold.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'ratio') comp.ratio.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'attack') comp.attack.setTargetAtTime(value / 1000, context.currentTime, 0.02);
          if (paramId === 'release') comp.release.setTargetAtTime(value / 1000, context.currentTime, 0.02);
          if (paramId === 'makeupGain') {
            const gainLinear = Math.pow(10, value / 20);
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
      delayNode.delayTime.value = (params.time ?? 250) / 1000;

      const feedbackNode = context.createGain();
      feedbackNode.gain.value = (params.feedback ?? 35) / 100;

      const filterNode = context.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.value = params.damp ?? 6000;

      const mixVal = (params.mix ?? 25) / 100;
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
          if (paramId === 'time') delayNode.delayTime.setTargetAtTime(value / 1000, context.currentTime, 0.02);
          if (paramId === 'feedback') feedbackNode.gain.setTargetAtTime(value / 100, context.currentTime, 0.02);
          if (paramId === 'damp') filterNode.frequency.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'mix') wetGain.gain.setTargetAtTime(value / 100, context.currentTime, 0.02);
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
      const decayTime = params.decay ?? 2.0;
      convolver.buffer = createReverbImpulse(context, decayTime, 2.5);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = params.damping ?? 8000;

      const mix = (params.mix ?? 30) / 100;
      dryGain.gain.value = 1.0;
      wetGain.gain.value = mix;

      input.connect(dryGain);
      dryGain.connect(output);

      input.connect(filter);
      filter.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(output);

      return {
        inputNode: input,
        outputNode: output,
        updateParameter: (paramId, value) => {
          if (paramId === 'mix') wetGain.gain.setTargetAtTime(value / 100, context.currentTime, 0.02);
          if (paramId === 'damping') filter.frequency.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'decay') {
            try {
              convolver.buffer = createReverbImpulse(context, value, 2.5);
            } catch (e) {
              // Context might be busy
            }
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
      comp.threshold.value = params.threshold ?? -2;
      comp.ratio.value = 20; // Hard limiting ratio
      comp.knee.value = 0;   // Hard knee
      comp.attack.value = 0.001; // 1 ms fastest attack
      comp.release.value = (params.release ?? 50) / 1000;

      const ceilingGain = context.createGain();
      const ceilingDb = params.ceiling ?? -0.1;
      ceilingGain.gain.value = Math.pow(10, ceilingDb / 20);

      comp.connect(ceilingGain);

      return {
        inputNode: comp,
        outputNode: ceilingGain,
        updateParameter: (paramId, value) => {
          if (paramId === 'threshold') comp.threshold.setTargetAtTime(value, context.currentTime, 0.01);
          if (paramId === 'release') comp.release.setTargetAtTime(value / 1000, context.currentTime, 0.01);
          if (paramId === 'ceiling') {
            const linear = Math.pow(10, value / 20);
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
      shaper.curve = makeDistortionCurve((params.drive ?? 25) / 2) as any;
      shaper.oversample = '4x';

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = params.tone ?? 6500;

      const mix = (params.mix ?? 50) / 100;
      dryGain.gain.value = 1.0 - mix * 0.5;
      wetGain.gain.value = mix;

      input.connect(dryGain);
      dryGain.connect(output);

      input.connect(shaper);
      shaper.connect(filter);
      filter.connect(wetGain);
      wetGain.connect(output);

      return {
        inputNode: input,
        outputNode: output,
        updateParameter: (paramId, value) => {
          if (paramId === 'drive') shaper.curve = makeDistortionCurve(value / 2) as any;
          if (paramId === 'tone') filter.frequency.setTargetAtTime(value, context.currentTime, 0.02);
          if (paramId === 'mix') {
            const m = value / 100;
            wetGain.gain.setTargetAtTime(m, context.currentTime, 0.02);
            dryGain.gain.setTargetAtTime(1.0 - m * 0.5, context.currentTime, 0.02);
          }
        },
      };
    },
  },
};
