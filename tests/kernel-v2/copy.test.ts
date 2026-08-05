import { describe, expect, it } from 'vitest';

import { fixturePackages } from './v3-fixtures';

const internal = /\b(package-only|app-specific|contract surface|device proof|awaiting_device_proof|not_run|kernel runtime)\b/i;

const visible = /^(title|subtitle|label|text|body|description|emptyText|cta|prompt|reason|behavior|control|status|content)$/i;
const packages = fixturePackages();

function strings(value: unknown, key = ''): string[] {
  if (typeof value === 'string') return visible.test(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([child, item]) => strings(item, child));
  return [];
}

describe('product copy', () => {
  it('keeps internal evidence language out of every screen', () => {
    for (const pkg of packages) {
      const copy = strings(pkg.presentation.ui.screens);
      expect(copy.filter((text) => internal.test(text)), pkg.id).toEqual([]);
      expect(copy.filter((text) => text.length > 140), pkg.id).toEqual([]);
    }
  });
});
