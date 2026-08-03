import { describe, expect, it } from 'vitest';

import {
  formatValueControlValue,
  nextValueControlValue,
  normalizeValueControlConfig,
} from '@/src/presentation/widgets/value-control-engine';

describe('generic value control engine', () => {
  it('increments, decrements, resets, and clamps without domain assumptions', () => {
    const config = normalizeValueControlConfig({ step: 2, min: 0, max: 10, resetValue: 4 });
    expect(nextValueControlValue(4, 'increment', config)).toBe(6);
    expect(nextValueControlValue(4, 'decrement', config)).toBe(2);
    expect(nextValueControlValue(10, 'increment', config)).toBe(10);
    expect(nextValueControlValue(0, 'decrement', config)).toBe(0);
    expect(nextValueControlValue(9, 'reset', config)).toBe(4);
  });

  it('uses an explicit precision policy for quantities and decimal values', () => {
    const config = normalizeValueControlConfig({ step: 0.1, precision: 2 });
    expect(nextValueControlValue(0.2, 'increment', config)).toBe(0.3);
    expect(nextValueControlValue(2, 'set', config, '2.345')).toBe(2.35);
    expect(formatValueControlValue(2.3, config.precision)).toBe('2.30');
  });

  it('normalizes invalid configuration safely', () => {
    const config = normalizeValueControlConfig({ step: -1, min: 5, max: 2, resetValue: -99, precision: 99 });
    expect(config).toEqual({ step: 1, min: 5, max: 5, resetValue: 5, precision: 6 });
  });
});
