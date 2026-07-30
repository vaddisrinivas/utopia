import { describe, expect, it } from 'vitest';

import { runConformanceSuite } from '@/packages/conformance/src/conformance-harness';

describe('conformance lane', () => {
  it('runs all conformance checks without fail', async () => {
    const results = await runConformanceSuite();
    const failing = results.filter((result) => result.status === 'fail');
    expect(failing).toEqual([]);
  });

  it('includes expected conformance check names', async () => {
    const results = await runConformanceSuite();
    const names = results.map((result) => result.name);
    expect(names).toContain('canonical-json deterministic');
    expect(names).toContain('package-validation shared rules');
    expect(names).toContain('package-validation server parity');
    expect(names).toContain('expression-runtime parity');
    expect(names).toContain('install/update lifecycle');
    expect(names).toContain('capability denial contract');
    expect(names).toContain('install-runtime-mobile');
    expect(names).toContain('server-runtime-android-capability');
  });
});
