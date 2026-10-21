import { describe, it, expect, vi, afterEach } from 'vitest';
import { deserializeProject } from '../store/persistence';
import { runHandlePickFile } from '../App';

afterEach(() => {
  vi.restoreAllMocks();
});

function baseRaw(): Record<string, unknown> {
  return {
    version: 1,
    projectName: 'Test',
    bpm: 120,
    timeSignature: [4, 4],
    currentTime: 0,
    duration: 32,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    metronome: false,
    masterVolume: 1,
    masterMute: false,
    snapMode: '1/16',
    zoom: 50,
    scrollLeft: 0,
    activeView: 'timeline',
    selectedTrackId: null,
    selectedClipId: null,
    tracks: [{ id: 't1', name: 'T1', type: 'audio', color: '#fff', volume: 1, pan: 0, mute: false, solo: false, armed: false, plugins: [] }],
    clips: [],
    audioClipIds: [],
  };
}

describe('import hardening (ST-08, SEC-02)', () => {
  it('I1: {"lowGain": "evil"} en un parámetro ⇒ el valor guardado es un número (o el parámetro se descarta)', () => {
    const raw = baseRaw();
    raw['tracks'] = [{
      id: 't1', name: 'T1', type: 'audio', color: '#fff', volume: 1, pan: 0,
      mute: false, solo: false, armed: false,
      plugins: [{ instanceId: 'i1', pluginId: 'eq3', name: 'EQ', enabled: true, parameters: { lowGain: 'evil' } }],
    }];
    const back = deserializeProject(JSON.parse(JSON.stringify(raw)));
    expect(back).not.toBeNull();
    const params = back!.tracks[0]!.plugins[0]!.parameters as Record<string, unknown>;
    if ('lowGain' in params) {
      expect(typeof params['lowGain']).toBe('number');
      expect(Number.isFinite(params['lowGain'] as number)).toBe(true);
    }
  });

  it('I2: 100 000 clips ⇒ se trunca a 20 000 y se avisa', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = baseRaw();
    const clips: unknown[] = [];
    for (let i = 0; i < 100_000; i++) {
      clips.push({ id: `c${i}`, trackId: 't1', name: `Clip ${i}`, startTime: 0, duration: 1, offset: 0, demoKind: null, needsReimport: true });
    }
    raw['clips'] = clips;
    const back = deserializeProject(raw);
    expect(back).not.toBeNull();
    expect(back!.clips.length).toBe(20_000);
    expect(warn).toHaveBeenCalled();
  });

  it('I3: duration: 1e18 ⇒ queda acotado a ≤ 86400', () => {
    const raw = baseRaw();
    raw['duration'] = 1e18;
    const back = deserializeProject(raw);
    expect(back).not.toBeNull();
    expect(back!.duration).toBeLessThanOrEqual(86400);
    expect(back!.duration).toBeGreaterThanOrEqual(1);
  });

  it('I4: clave __proto__ en el JSON ⇒ no aparece en el objeto resultante', () => {
    const parsed = JSON.parse('{"version":1,"projectName":"X","tracks":[],"clips":[],"audioClipIds":[],"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const back = deserializeProject(parsed);
    expect(back).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(back, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    // Parámetros con __proto__ tampoco se cuelan
    const raw2 = baseRaw();
    raw2['tracks'] = [{
      id: 't1', name: 'T1', type: 'audio', color: '#fff', volume: 1, pan: 0,
      mute: false, solo: false, armed: false,
      plugins: [{ instanceId: 'i1', pluginId: 'eq3', name: 'EQ', enabled: true, parameters: JSON.parse('{"lowGain":2,"__proto__":{"x":1}}') }],
    }];
    const back2 = deserializeProject(raw2);
    expect(back2).not.toBeNull();
    const params2 = back2!.tracks[0]!.plugins[0]!.parameters as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(params2, '__proto__')).toBe(false);
  });

  it('I5: ids duplicados ⇒ quedan únicos', () => {
    const raw = baseRaw();
    raw['tracks'] = [
      { id: 'dup', name: 'A', type: 'audio', color: '#fff', volume: 1, pan: 0, mute: false, solo: false, armed: false, plugins: [] },
      { id: 'dup', name: 'B', type: 'audio', color: '#fff', volume: 1, pan: 0, mute: false, solo: false, armed: false, plugins: [] },
    ];
    raw['clips'] = [
      { id: 'cdup', trackId: 'dup', name: 'C1', startTime: 0, duration: 1, offset: 0, demoKind: null, needsReimport: true },
      { id: 'cdup', trackId: 'dup', name: 'C2', startTime: 1, duration: 1, offset: 0, demoKind: null, needsReimport: true },
    ];
    const back = deserializeProject(raw);
    expect(back).not.toBeNull();
    const trackIds = back!.tracks.map((t) => t.id);
    expect(new Set(trackIds).size).toBe(trackIds.length);
    const clipIds = back!.clips.map((c) => c.id);
    expect(new Set(clipIds).size).toBe(clipIds.length);
  });

  it('I6: selectedTrackId inexistente ⇒ queda null', () => {
    const raw = baseRaw();
    raw['selectedTrackId'] = 'no-existe';
    raw['selectedClipId'] = 'tampoco-existe';
    const back = deserializeProject(raw);
    expect(back).not.toBeNull();
    expect(back!.selectedTrackId).toBeNull();
    expect(back!.selectedClipId).toBeNull();
  });

  it('I0: archivo > 25 MB ⇒ se rechaza con un toast y no se importa', async () => {
    const pushToast = vi.fn();
    const importProjectFromJson = vi.fn(async () => ({ ok: true as const }));
    const textFn = vi.fn(async () => JSON.stringify({ version: 1, tracks: [], clips: [] }));
    const file = { size: 26 * 1024 * 1024, text: textFn, name: 'big.hydra' } as unknown as File;
    await runHandlePickFile({
      file,
      setBusy: () => {},
      finishBoot: vi.fn(),
      importProjectFromJson,
      pushToast,
    });
    expect(pushToast).toHaveBeenCalled();
    expect(textFn).not.toHaveBeenCalled();
    expect(importProjectFromJson).not.toHaveBeenCalled();
  });
});
