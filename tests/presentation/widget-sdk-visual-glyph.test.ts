import { describe, expect, it } from 'vitest';

import { visualGlyph } from '@/src/presentation/widgets/widget-sdk';

describe('visualGlyph', () => {
  it('maps semantic icon ids and never prints unknown words', () => {
    expect(visualGlyph('plate')).toBe('🍽️');
    expect(visualGlyph('snowflake')).toBe('❄');
    expect(visualGlyph('unsupported-icon')).toBe('•');
    expect(visualGlyph('✓')).toBe('✓');
  });
});
