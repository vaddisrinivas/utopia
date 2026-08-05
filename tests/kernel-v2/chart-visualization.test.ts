import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Polyline: 'Polyline',
  Rect: 'Rect',
}));

import { buildChartGeometry } from '@/src/kernel/chart-visualization.fallback';

describe('chart visualization fallback', () => {
  it('drops invalid values and returns an empty safe geometry', () => {
    expect(buildChartGeometry([{ x: 'bad', y: Number.NaN }, { x: 'also-bad', y: Infinity }])).toEqual({ points: '', bars: [] });
  });

  it('keeps zero and negative values drawable around a real baseline', () => {
    const geometry = buildChartGeometry([{ x: 'a', y: -2 }, { x: 'b', y: 0 }, { x: 'c', y: 4 }]);
    expect(geometry.points).toBe('53.333333333333336,162 160,114 266.6666666666667,18');
    expect(geometry.bars).toEqual([
      { key: 'a-0', x: 6, y: 114, width: 94.66666666666667, height: 48 },
      { key: 'b-1', x: 112.66666666666667, y: 114, width: 94.66666666666667, height: 1 },
      { key: 'c-2', x: 219.33333333333334, y: 18, width: 94.66666666666667, height: 96 },
    ]);
  });

  it('uses stable fallback labels and distinct keys', () => {
    const geometry = buildChartGeometry([{ x: '', y: 1 }, { x: '', y: 2 }]);
    expect(geometry.points).toContain('1');
    expect(geometry.bars.map((bar) => bar.key)).toEqual(['1-0', '2-1']);
  });
});
