// Task 40 (ST-04 + ST-09 + cola de menores): pines de persistencia de
// plugins custom y fades, más los menores con prueba runtime.
// TDD: este fichero se escribió primero y falla antes del fix (ver report).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    keys: vi.fn(async () => [...store.keys()]),
    delMany: vi.fn(async (keysArr: string[]) => {
      for (const k of keysArr) store.delete(k);
    }),
    __store: store,
  };
});

import type { AudioClip, AudioTrack } from '../types/daw';
import {
  serializeProject,
  deserializeProject,
  restoreClips,
  sanitizeTrack,
  reregisterCustomPlugins,
  MAX_CUSTOM_PLUGIN_CODE_BYTES,
  type PersistableProjectState,
} from '../store/persistence';
import { pluginHost } from '../audio/PluginHost';
import { registerCustomPluginForTest } from '../audio/pluginTestBridge';
import { muxAdtsFrame, parseAdtsHeader } from '../audio/aacExporter';
import { splitClipOperation } from '../audio/timelineOps';

// Código custom válido: pasa el escáner y el harness real (sin eval,
// sin this, sin APIs de red/DOM). Id único por test para no colisionar
// con otros ficheros que registran en el singleton.
function customCodeWithId(id: string): string {
  return `
  const customPlugin = {
    id: '${id}',
    name: 'Persistencia Test',
    category: 'utility',
    description: 'plugin de test para round-trip de persistencia',
    parameters: [
      { id: 'level', name: 'Nivel', min: 0, max: 2, step: 0.1, defaultValue: 1.0 }
    ],
    createDSPNode: (ctx, params) => {
      const g = ctx.createGain();
      g.gain.setTargetAtTime(params.level ?? 1.0, 0, 0.02);
      return {
        inputNode: g,
        outputNode: g,
        updateParameter: (pid, val) => {
          if (pid === 'level') g.gain.setTargetAtTime(val, 0, 0.02);
        }
      };
    }
  };
  `;
}

function trackWithCustomPlugin(pluginId: string, code: string): AudioTrack {
  return {
    id: 'track_custom',
    name: 'Custom',
    type: 'audio',
    color: '#fff',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    plugins: [
      {
        instanceId: 'inst_custom_1',
        pluginId,
        name: 'Persistencia Test',
        enabled: true,
        parameters: { level: 1.5 },
        customJsCode: code,
      },
    ],
  };
}

function baseState(): PersistableProjectState {
  return {
    projectName: 'T40',
    bpm: 120,
    timeSignature: [4, 4],
    currentTime: 0,
    duration: 16,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    metronome: false,
    masterVolume: 1.0,
    masterMute: false,
    snapMode: '1/16',
    zoom: 50,
    scrollLeft: 0,
    activeView: 'timeline',
    selectedTrackId: null,
    selectedClipIds: [],
    tracks: [],
    clips: [],
  };
}

function clipWithFades(): AudioClip {
  return {
    id: 'clip_drums_1',
    trackId: 'track_drums',
    name: 'Drums Groove (120 BPM)',
    startTime: 0,
    duration: 16,
    offset: 0,
    audioBuffer: null,
    peaks: new Float32Array(0),
    color: '#f59e0b',
    fadeIn: 0.5,
    fadeOut: 1.25,
  };
}

describe('ST-04: el código del plugin custom sobrevive al guardado', () => {
  beforeEach(() => {
    pluginHost.clearCustomPluginsForTest();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    pluginHost.clearCustomPluginsForTest();
  });

  it('serialize → deserialize conserva customJsCode', () => {
    const code = customCodeWithId('t40_roundtrip');
    const state = { ...baseState(), tracks: [trackWithCustomPlugin('t40_roundtrip', code)] };
    const out = serializeProject(state);
    const back = deserializeProject(JSON.parse(JSON.stringify(out)));
    expect(back).not.toBeNull();
    expect(back!.tracks[0]!.plugins[0]!.customJsCode).toBe(code);
  });

  it('el saneado conserva el código dentro del límite y descarta el sobredimensionado', () => {
    const code = customCodeWithId('t40_sanitize');
    const clean = sanitizeTrack({
      id: 't',
      type: 'audio',
      plugins: [
        { instanceId: 'i1', pluginId: 't40_sanitize', name: 'P', enabled: true, parameters: {}, customJsCode: code },
        { instanceId: 'i2', pluginId: 't40_big', name: 'P', enabled: true, parameters: {}, customJsCode: 'x'.repeat(MAX_CUSTOM_PLUGIN_CODE_BYTES + 1) },
      ],
    });
    expect(clean).not.toBeNull();
    expect(clean!.plugins[0]!.customJsCode).toBe(code);
    expect(clean!.plugins[1]).not.toHaveProperty('customJsCode');
  });

  it('re-registro: tras limpiar el host, el plugin vuelve con sus knobs', async () => {
    const pluginId = 't40_reregister';
    const code = customCodeWithId(pluginId);
    // Vía de test (contenedor vm sobre los bytes de public/sandbox.js):
    // equivale a registerCustomPluginSecure en el navegador.
    registerCustomPluginForTest(code);
    expect(pluginHost.getPluginDefinition(pluginId)?.parameters.map((p) => p.id)).toEqual(['level']);

    const state = { ...baseState(), tracks: [trackWithCustomPlugin(pluginId, code)] };
    const back = deserializeProject(JSON.parse(JSON.stringify(serializeProject(state))));
    expect(back).not.toBeNull();

    // Simula una recarga: el singleton pierde las definiciones custom.
    pluginHost.clearCustomPluginsForTest();
    expect(pluginHost.getPluginDefinition(pluginId)).toBeUndefined();

    const res = await reregisterCustomPlugins(back!.tracks, (c) => {
      registerCustomPluginForTest(c);
      return Promise.resolve(pluginHost.getPluginDefinition(pluginId));
    });
    expect(res.reregistered).toBe(1);
    expect(res.failed).toBe(0);
    // Knobs presentes: la definición restaurada declara el parámetro.
    expect(pluginHost.getPluginDefinition(pluginId)?.parameters.map((p) => p.id)).toEqual(['level']);
  });

  it('el código restaurado nunca se ejecuta en el hilo principal (sin new Function/eval)', () => {
    const persistenceSrc = readFileSync(join(process.cwd(), 'src/store/persistence.ts'), 'utf8');
    expect(persistenceSrc).not.toContain('new Function');
    // La única vía de registro es la segura del host (sandbox iframe en el
    // navegador; contenedor vm en tests), nunca evaluación directa.
    expect(persistenceSrc).toContain('reregisterCustomPluginFromCode');
  });
});

describe('ST-09: los fades sobreviven al round-trip', () => {
  it('serialize → deserialize → restoreClips conserva fadeIn/fadeOut', () => {
    const state = {
      ...baseState(),
      tracks: [
        {
          id: 'track_drums', name: 'Batería', type: 'audio' as const, color: '#fff',
          volume: 1, pan: 0, mute: false, solo: false, armed: false, plugins: [],
        },
      ],
      clips: [clipWithFades()],
    };
    const out = serializeProject(state);
    expect(out.clips[0]!.fadeIn).toBe(0.5);
    expect(out.clips[0]!.fadeOut).toBe(1.25);
    const back = deserializeProject(JSON.parse(JSON.stringify(out)));
    expect(back!.clips[0]!.fadeIn).toBe(0.5);
    expect(back!.clips[0]!.fadeOut).toBe(1.25);
    const restored = restoreClips(back!.clips, null);
    expect(restored[0]!.fadeIn).toBe(0.5);
    expect(restored[0]!.fadeOut).toBe(1.25);
  });

  it('solo persisten valores finitos mayores que 0', () => {
    const mk = (fadeIn: unknown, fadeOut: unknown) => {
      const state = { ...baseState(), clips: [{ ...clipWithFades(), fadeIn, fadeOut } as unknown as AudioClip] };
      return serializeProject(state).clips[0]!;
    };
    expect(mk(0, 0)).not.toHaveProperty('fadeIn');
    expect(mk(0, 0)).not.toHaveProperty('fadeOut');
    expect(mk(-1, NaN)).not.toHaveProperty('fadeIn');
    expect(mk(-1, NaN)).not.toHaveProperty('fadeOut');
    expect(mk(Infinity, 'alto')).not.toHaveProperty('fadeIn');
    expect(mk(Infinity, 'alto')).not.toHaveProperty('fadeOut');
  });
});

describe('T40 menores con prueba runtime', () => {
  it('AAC: un stream de 7 canales se rechaza explícitamente (sin código de 7 canales en MPEG-4 Audio)', () => {
    expect(() => muxAdtsFrame(new Uint8Array([1, 2, 3]), { sampleRate: 44100, numberOfChannels: 7 })).toThrow(/7 canales/);
  });

  it('AAC: 8 canales sigue mapeando a channel_config 7 y se relee como 8', () => {
    const frame = muxAdtsFrame(new Uint8Array([9, 9, 9]), { sampleRate: 44100, numberOfChannels: 8 });
    expect(parseAdtsHeader(frame).channels).toBe(8);
  });

  it('timelineOps: dos splits en el mismo ms con el mismo random no colisionan (contador monotónico)', () => {
    const clip: AudioClip = {
      id: 'clip_padre', trackId: 't1', name: 'X', startTime: 0, duration: 10, offset: 0,
      audioBuffer: null, peaks: new Float32Array(0),
    };
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    try {
      const a = splitClipOperation(clip, 5);
      const b = splitClipOperation(clip, 5);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a!.clip2.id).not.toBe(b!.clip2.id);
    } finally {
      nowSpy.mockRestore();
      randSpy.mockRestore();
    }
  });

  it('manifest: start_url es relativo (vale en sub-path)', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public/manifest.webmanifest'), 'utf8')) as { start_url?: string };
    expect(manifest.start_url ?? '').not.toMatch(/^\//);
  });

  it('WavExporter: el comentario ya no afirma que ExportModal use la síncrona', () => {
    const src = readFileSync(join(process.cwd(), 'src/audio/WavExporter.ts'), 'utf8');
    expect(src).not.toMatch(/ExportModal\/persistence siguen con la síncrona/);
  });
});
