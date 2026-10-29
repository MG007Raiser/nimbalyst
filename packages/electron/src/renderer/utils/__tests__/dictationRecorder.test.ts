// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { floatToPcm16, resampleFloat32 } from '../dictationRecorder';

describe('resampleFloat32', () => {
  it('returns the input untouched at the same rate', () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resampleFloat32(input, 16_000, 16_000)).toBe(input);
  });

  it('halves the sample count from 48 kHz to 16 kHz by thirds, interpolating between neighbours', () => {
    const input = new Float32Array([0, 0.3, 0.6, 0.9, 1.2, 1.5]);
    const output = Array.from(resampleFloat32(input, 48_000, 16_000));
    expect(output).toHaveLength(2);
    expect(output[0]).toBeCloseTo(0, 5);
    expect(output[1]).toBeCloseTo(0.9, 5);
    const up = Array.from(resampleFloat32(new Float32Array([0, 1]), 8_000, 16_000));
    expect(up.map((v) => Number(v.toFixed(3)))).toEqual([0, 0.5, 1, 1]);
  });
});

describe('floatToPcm16', () => {
  it('scales and clamps to the 16-bit range', () => {
    expect(Array.from(floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5])))).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });
});
