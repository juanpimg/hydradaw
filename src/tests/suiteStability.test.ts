import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Task 38 (flake): ancla de regresión. Los tests de DSP síncrono pesado
// medían hasta ~4.6 s en máquina descargada —al 92% del timeout de 5 s por
// defecto de Vitest— y cualquier contención de CPU los tumbaba (el "2
// failed" transitorio; ver run-11: timeout del RPC del worker bajo
// saturación). Cada test pesado debe declarar un presupuesto explícito con
// margen documentado; este test lo exige por texto para que nadie lo quite
// sin darse cuenta.
const ROOT = process.cwd();

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** ¿El `it`/`describe` que empieza en `anchor` declara `timeout` cerca? */
function declaresTimeout(fileSrc: string, anchor: string): boolean {
  const at = fileSrc.indexOf(anchor);
  if (at < 0) return false;
  return fileSrc.slice(at, at + 400).includes('timeout');
}

describe('Task 38: los tests pesados declaran presupuesto de tiempo explícito', () => {
  const safety = src('src/audio/plugin_safety.test.ts');
  it.each([
    'IR de reverb determinista',
    'demo determinista + pico final',
  ])('plugin_safety: "%s" declara timeout', (name) => {
    expect(declaresTimeout(safety, name)).toBe(true);
  });

  const perf = src('src/audio/wavExporterPerf.test.ts');
  it.each([
    'encodeWavAsync equivale a sync y cede el loop',
    'volumen a escala',
    'revoca tarde y una sola vez',
  ])('wavExporterPerf: "%s" declara timeout', (name) => {
    expect(declaresTimeout(perf, name)).toBe(true);
  });
});
