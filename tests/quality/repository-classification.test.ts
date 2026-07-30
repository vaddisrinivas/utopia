import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('repository classification check', () => {
  it('runs the non-destructive classifier gate without mutation', () => {
    const output = execSync('node scripts/quality/check-repository-classification.mjs', {
      cwd: root,
      encoding: 'utf8',
    });

    expect(output).toContain('Repository classification check: PASS');
    expect(output).toContain('Classified root directories');
  });

  it('parses required evidence files in repository docs', () => {
    const classification = readFileSync(resolve(root, 'docs/repository-classification.md'), 'utf8');
    const scorecard = readFileSync(resolve(root, 'docs/platform-scorecard.md'), 'utf8');

    expect(classification).toContain('| Directory | Category | Why |');
    expect(scorecard).toContain('| Aspect | Status | Current evidence / next gate |');
  });
});
