// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WaveformCanvas } from '../../components/Timeline/WaveformCanvas';

describe('arnés DOM', () => {
  it('monta un clip y expone su nombre accesible', () => {
    render(
      <WaveformCanvas
        clip={{
          id: 'clip_harness',
          trackId: 'track_harness',
          name: 'Clip prueba',
          startTime: 0,
          duration: 4,
          offset: 0,
          audioBuffer: null,
          peaks: new Float32Array([0, 0.5, -0.5, 0.5]),
          color: '#06b6d4',
        }}
        width={200}
        height={48}
        isSelected={false}
      />
    );
    // El componente expone `aria-label={`Clip ${name}`}`: el nombre accesible real
    // incluye el prefijo (verificado contra el producto, no un literal inventado).
    expect(screen.getByLabelText('Clip Clip prueba')).toBeInTheDocument();
  });
});
