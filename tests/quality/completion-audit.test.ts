import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { getDebugAppAcceptance, getSignedReleaseAcceptance, listBlockingIssues } from '@/scripts/quality/utopia-acceptance-registry.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixturesRoot = join(projectRoot, 'tests/fixtures/utopia-completion-audit');

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(fixturesRoot, name), 'utf8'));
}

describe('utopia completion audit registry', () => {
  it('treats signed release as separate from debug app acceptance', () => {
    const registry = loadFixture('debug-app-pass.json');

    expect(listBlockingIssues(registry)).toEqual([]);
    expect(getDebugAppAcceptance(registry)).toMatchObject({ status: 'passed' });
    expect(getSignedReleaseAcceptance(registry)).toMatchObject({ status: 'blocked' });
  });

  it('refuses debug app completion when any P0 or P1 issue is open', () => {
    const registry = loadFixture('debug-app-blocked.json');

    expect(listBlockingIssues(registry)).toHaveLength(1);
    expect(getDebugAppAcceptance(registry)).toMatchObject({ status: 'missing' });
  });
});
