import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.join(process.cwd(), 'src/presentation/widgets/interactive-record-widgets.tsx'),
  'utf8',
);

describe('ValueControlWidget source contract', () => {
  it('persists package-defined defaults when creating its first record', () => {
    expect(source).toContain('propertyValues(props.defaultProperties)');
    expect(source).toContain('...resolveDynamicProperties(defaultProperties, now),');
    expect(source).toContain("value === '$now' ? now : value === '$today' ? now.slice(0, 10) : value");
    expect(source).toContain('...(canonical?.properties ?? {}),');
    expect(source).toContain('[valueField]: next,');
  });
});
