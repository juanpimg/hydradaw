/**
 * High-performance audio waveform utilities
 */

/**
 * Computes min/max peak pairs for rendering at 60 FPS
 * @param buffer AudioBuffer to extract peaks from
 * @param targetPoints Number of peak pairs to generate (e.g. 1000 for standard timeline clip)
 */
export function generateWaveformPeaks(buffer: AudioBuffer, targetPoints: number = 800): Float32Array {
  const peaks = new Float32Array(targetPoints * 2);
  const channels = buffer.numberOfChannels;
  const channelData: Float32Array[] = [];

  for (let c = 0; c < channels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  const length = buffer.length;
  const blockSize = Math.floor(length / targetPoints);

  if (blockSize <= 0) {
    return peaks;
  }

  for (let i = 0; i < targetPoints; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, length);

    let min = 1.0;
    let max = -1.0;

    for (let c = 0; c < channels; c++) {
      const data = channelData[c];
      for (let j = start; j < end; j += 4) { // stride 4 for ultra-fast approximation
        const val = data[j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }

    if (min > 0) min = 0;
    if (max < 0) max = 0;

    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }

  return peaks;
}

/**
 * Decodes an audio File / Blob into an AudioBuffer
 */
export async function decodeAudioFile(file: Blob, audioContext: BaseAudioContext): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

/**
 * Generates synthetic high-quality demo audio stems (Drums, Bass, Chords, Vocal Lead)
 * allows instant testing without needing external sample downloads
 */
export function generateDemoTrackBuffer(
  context: BaseAudioContext,
  type: 'drums' | 'bass' | 'chords' | 'lead',
  durationSec: number = 8,
  bpm: number = 120
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const buffer = context.createBuffer(2, totalSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const beatDuration = 60 / bpm;
  const totalBeats = Math.floor(durationSec / beatDuration);

  for (let beat = 0; beat < totalBeats; beat++) {
    const beatStart = Math.floor(beat * beatDuration * sampleRate);

    if (type === 'drums') {
      // Kick on 0, 2, 4... Snare on 1, 3...
      const isKick = beat % 2 === 0;
      const soundLength = Math.floor((isKick ? 0.3 : 0.2) * sampleRate);
      for (let i = 0; i < soundLength && beatStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * (isKick ? 15 : 25));
        let sample = 0;
        if (isKick) {
          const freq = 120 * Math.exp(-t * 20) + 45;
          sample = Math.sin(2 * Math.PI * freq * t) * env * 0.9;
        } else {
          // Snare: noise + body tone
          const noise = (Math.random() * 2 - 1) * 0.7;
          const tone = Math.sin(2 * Math.PI * 180 * t) * 0.5;
          sample = (noise + tone) * env * 0.7;
        }
        left[beatStart + i] += sample;
        right[beatStart + i] += sample;
      }

      // Hi-hat on every 8th note
      const eighthStart = beatStart + Math.floor((beatDuration / 2) * sampleRate);
      const hatLength = Math.floor(0.05 * sampleRate);
      for (let i = 0; i < hatLength && eighthStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 80);
        const hat = (Math.random() * 2 - 1) * env * 0.3;
        left[eighthStart + i] += hat;
        right[eighthStart + i] += hat;
      }
    } else if (type === 'bass') {
      // 808 / Synth Bass line
      const notes = [55, 55, 65.4, 73.4, 49]; // A1, C2, D2, G1
      const freq = notes[beat % notes.length];
      const soundLength = Math.floor(beatDuration * 0.9 * sampleRate);
      for (let i = 0; i < soundLength && beatStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 50) * Math.exp(-t * 1.5);
        // Sawtooth + sub sine
        const sub = Math.sin(2 * Math.PI * (freq / 2) * t) * 0.5;
        const main = (2 * ((freq * t) % 1) - 1) * 0.3;
        const sample = (sub + main) * env * 0.7;
        left[beatStart + i] += sample;
        right[beatStart + i] += sample;
      }
    } else if (type === 'chords') {
      // Warm Analog Pad / Synth chords
      const chords = [
        [220, 261.6, 329.6], // Am
        [174.6, 220, 261.6], // F
        [261.6, 329.6, 392], // C
        [196, 246.9, 293.7]  // G
      ];
      const chord = chords[Math.floor(beat / 2) % chords.length];
      const soundLength = Math.floor(beatDuration * 1.8 * sampleRate);
      for (let i = 0; i < soundLength && beatStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.sin((Math.PI * i) / soundLength) * 0.4;
        let sLeft = 0;
        let sRight = 0;
        chord.forEach((f) => {
          // Slight detune for stereo width
          sLeft += Math.sin(2 * Math.PI * (f * 1.002) * t) * 0.25;
          sRight += Math.sin(2 * Math.PI * (f * 0.998) * t) * 0.25;
        });
        left[beatStart + i] += sLeft * env;
        right[beatStart + i] += sRight * env;
      }
    } else if (type === 'lead') {
      // Vocal Melodic Lead Synth
      const melody = [440, 523.25, 659.25, 587.33, 440, 659.25, 783.99, 659.25];
      const freq = melody[beat % melody.length];
      const soundLength = Math.floor(beatDuration * 0.85 * sampleRate);
      for (let i = 0; i < soundLength && beatStart + i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t * 100) * Math.exp(-t * 2);
        const vibrato = Math.sin(2 * Math.PI * 5 * t) * 4;
        const sample = Math.sin(2 * Math.PI * (freq + vibrato) * t) * env * 0.5;
        left[beatStart + i] += sample * 0.8;
        right[beatStart + i] += sample * 1.0;
      }
    }
  }

  return buffer;
}
