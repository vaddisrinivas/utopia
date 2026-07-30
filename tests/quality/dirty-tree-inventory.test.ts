import { describe, expect, it } from 'vitest';

import { classifyDirtyPath } from '../../scripts/quality/inventory-dirty-tree.mjs';

describe('dirty tree inventory classification', () => {
  it('keeps services, contracts, shells, apps, and authoring separate', () => {
    expect(classifyDirtyPath('cloudflare/utopia-registry-worker.ts')).toBe('service');
    expect(classifyDirtyPath('packages/shared/contracts/telemetry.ts')).toBe('core_or_contract');
    expect(classifyDirtyPath('src/db/migrations.ts')).toBe('shell');
    expect(classifyDirtyPath('server/test/provider-contract.ts')).toBe('test');
    expect(classifyDirtyPath('apps/food/food.v1.json')).toBe('app');
    expect(classifyDirtyPath('agents/utopia-package-builder/SKILL.md')).toBe('authoring');
  });

  it('marks unknown root files for explicit review', () => {
    expect(classifyDirtyPath('package.json')).toBe('project_config');
    expect(classifyDirtyPath('LICENSE')).toBe('unclassified');
  });
});
