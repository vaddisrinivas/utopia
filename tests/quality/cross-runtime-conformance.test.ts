import { execSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareConformanceSuites,
  runCrossRuntimeConformanceSuite,
  type ConformanceCheckResult,
} from '../../scripts/quality/golden-loop/cross-runtime-conformance';

describe('cross-runtime conformance', () => {
  const fixtureDir = path.join(process.cwd(), 'tests/conformance/fixtures');

  it('runs browser-compatible conformance checks over the shared corpus', async () => {
    const browserResults = await runCrossRuntimeConformanceSuite(fixtureDir);
    const names = browserResults.map((entry) => entry.name);

    expect(names).toContain('canonical-json deterministic');
    expect(names).toContain('package-validation shared rules');
    expect(names).toContain('expression-runtime parity');
    expect(names).toContain('install/update lifecycle');
    expect(names).toContain('capability denial contract');
    expect(browserResults.filter((entry) => entry.status === 'fail')).toEqual([]);
  });

  it('flags parity mismatches as explicit failures', () => {
    const nodeChecks: ConformanceCheckResult[] = [
      { name: 'canonical-json deterministic', status: 'pass', details: ['PASS'] },
      { name: 'expression-runtime parity', status: 'fail', details: ['node drift'] },
    ];
    const browserChecks: ConformanceCheckResult[] = [
      { name: 'canonical-json deterministic', status: 'pass', details: ['PASS'] },
      { name: 'expression-runtime parity', status: 'pass', details: ['PASS'] },
    ];

    expect(compareConformanceSuites(nodeChecks, browserChecks)).toEqual([
      'browser path passed but node failed: expression-runtime parity',
    ]);
  });

  it('runs the concrete conformance command without synthetic blocked wording', () => {
    const result = execSync('npm run check:conformance', {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120000,
    });

    expect(result).toContain('Conformance suite complete.');
    expect(result).not.toContain('Conformance blocked by');
  });
});
