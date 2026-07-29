import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_HOME_COPY } from '@/src/providers/data-home-selection';

function sourceAt(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('data home screen source contract', () => {
  it('uses canonical data-home copy tokens on install screen', () => {
    const source = sourceAt('app/install.tsx');
    expect(source).toContain("from '@/src/providers/data-home-selection'");
    expect(source).toContain('DATA_HOME_COPY');
    expect(source).toContain('DATA_HOME_COPY.localDefaultHint');
    expect(source).toContain('DATA_HOME_COPY.remoteMigrationHint');
    expect(source).not.toContain('Switching to a remote home requires manual export, import, and migration.');
    expect(source).not.toContain('Switching data homes requires manual export, import, and migration before continuing.');
  });

  it('uses canonical preview migration copy on installed app screen', () => {
    const source = sourceAt('app/apps/[installationId].tsx');
    expect(source).toContain("from '@/src/providers/data-home-selection'");
    expect(source).toContain('DATA_HOME_COPY');
    expect(source).toContain('DATA_HOME_COPY.previewRemoteMigrationHint');
    expect(source).not.toContain('Switching data homes requires manual export, import, and migration.');
    expect(source).not.toContain('Switching data homes requires manual export, import, and migration before continuing.');
  });

  it('keeps non-proof migration language source-neutral for UI text', () => {
    const proofLanguage = /live|proof|verified|connected proof/i;
    expect(DATA_HOME_COPY.localDefaultHint).not.toMatch(proofLanguage);
    expect(DATA_HOME_COPY.remoteMigrationHint).not.toMatch(proofLanguage);
    expect(DATA_HOME_COPY.previewRemoteMigrationHint).not.toMatch(proofLanguage);
  });
});
