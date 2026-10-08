import { describe, it, expect } from 'vitest';
import { computeExportDuration, sanitizeExportFilename } from '../components/Export/ExportModal';

describe('computeExportDuration', () => {
  it('vacío → 4 + 1.5 (mínimo de proyecto)', () => {
    expect(computeExportDuration([])).toBe(5.5);
  });

  it('un clip corto respeta el mínimo', () => {
    expect(computeExportDuration([{ startTime: 0, duration: 1 }])).toBe(5.5);
  });

  it('clip largo marca el final + cola de 1.5s', () => {
    expect(computeExportDuration([{ startTime: 2, duration: 8 }])).toBe(11.5);
  });

  it('solapes: usa el máximo end, no la suma', () => {
    const clips = [
      { startTime: 0, duration: 10 },
      { startTime: 3, duration: 4 },
      { startTime: 8, duration: 1 },
    ];
    expect(computeExportDuration(clips)).toBe(11.5);
  });
});

describe('sanitizeExportFilename', () => {
  it('espacios → guiones bajos (comportamiento anterior preservado)', () => {
    expect(sanitizeExportFilename('mi cancion')).toBe('mi_cancion');
  });

  it('elimina caracteres inseguros para descarga (slashes, puntos, acentos)', () => {
    expect(sanitizeExportFilename('a/b\\c:d*e?f"g<h>i|j.k')).toBe('a_b_c_d_e_f_g_h_i_j_k');
    expect(sanitizeExportFilename('Canción Nº1 (final)')).toBe('Canci_n_N_1_final_');
  });

  it('conserva guiones, subrayados y alfanuméricos; fallback por defecto', () => {
    expect(sanitizeExportFilename('mix-2024_final v2')).toBe('mix-2024_final_v2');
    expect(sanitizeExportFilename('')).toBe('cancion_master');
    expect(sanitizeExportFilename('   ')).toBe('cancion_master');
  });
});
