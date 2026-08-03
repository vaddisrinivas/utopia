import { checklistChecked, toggleChecklistChecked } from '@/src/presentation/widgets/checklist-state';
import { describe, expect, it } from 'vitest';

describe('checklist state', () => {
  it.each([
    [true, true],
    [false, false],
    [1, true],
    [0, false],
    ['done', true],
    ['false', false],
    [null, false],
  ])('normalizes %j', (input, expected) => {
    expect(checklistChecked(input)).toBe(expected);
  });

  it('toggles normalized values deterministically', () => {
    expect(toggleChecklistChecked('done')).toBe(false);
    expect(toggleChecklistChecked(undefined)).toBe(true);
  });
});
