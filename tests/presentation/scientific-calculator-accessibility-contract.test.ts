import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/presentation/json-render-widgets.tsx'), 'utf8');
const calculator = source.slice(source.indexOf('function ScientificCalculatorWidget'), source.indexOf('function AudioLoopPlayerWidget'));

describe('Scientific Calculator accessibility contract', () => {
  it('labels the editable expression, live result, modes, clear, and keypad controls', () => {
    expect(calculator).toContain('accessibilityLabel="Expression"');
    expect(calculator).toContain('accessibilityLiveRegion="polite"');
    expect(calculator).toContain("accessibilityLabel={mode === 'deg' ? 'Degrees' : 'Radians'}");
    expect(calculator).toContain('accessibilityLabel="Clear"');
    expect(calculator).toContain('accessibilityLabel={scientificCalculatorKeyLabel(key)}');
    expect(calculator).toContain('accessibilityRole="button"');
    expect(calculator).toContain('accessibilityRole="alert"');
  });
});
