import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('shell route layout', () => {
  it('keeps the loaded app host full height', () => {
    const routeFile = join(process.cwd(), 'app', 'apps', '[installationId].tsx');
    const src = readFileSync(routeFile, 'utf8');
    expect(src).toMatch(/<YStack role="main" flex=\{1\}><AppStore/);
    expect(src).not.toMatch(/<YStack role="main"[^>]*height=\{?0/);
  });
});
