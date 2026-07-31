import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('constrained creator agent proof', () => {
  it('passes the three agent modes without claiming human usability', () => {
    const root = mkdtempSync(join(tmpdir(), 'utopia-creator-agent-proof-'));
    const output = join(root, 'proof.json');
    try {
      execFileSync(process.execPath, ['scripts/quality/golden-loop/check-constrained-creator-agents.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, UTOPIA_CONSTRAINED_CREATOR_PROOF_PATH: output },
        encoding: 'utf8',
      });
      expect(existsSync(output)).toBe(true);
      const evidence = JSON.parse(readFileSync(output, 'utf8'));
      expect(evidence.status).toBe('PASS');
      expect(evidence.human_usability).toBe('NOT_MEASURED');
      expect(evidence.payload.cases).toHaveLength(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
