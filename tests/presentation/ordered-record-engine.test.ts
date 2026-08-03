import { moveRecordPosition, nextRecordPosition } from '@/src/presentation/widgets/ordered-record-engine';
import { describe, expect, it } from 'vitest';

describe('ordered record engine', () => {
  it('places new records after the highest finite position', () => {
    expect(nextRecordPosition([0, 4, 2, null, 'bad'])).toBe(5);
    expect(nextRecordPosition([])).toBe(0);
  });

  it('moves one record and returns a normalized complete ordering', () => {
    expect(moveRecordPosition(['a', 'b', 'c'], 'b', 'up')).toEqual([
      { id: 'b', position: 0 },
      { id: 'a', position: 1 },
      { id: 'c', position: 2 },
    ]);
    expect(moveRecordPosition(['a', 'b', 'c'], 'c', 'down')).toEqual([
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 },
    ]);
  });
});
