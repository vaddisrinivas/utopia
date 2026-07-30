import { describe, expect, it } from 'vitest';

import { classifyLaunchProofResult } from '../../scripts/quality/run-launch-proof.mjs';

describe('launch proof result classification', () => {
  it('keeps passing gates as PASS', () => {
    expect(classifyLaunchProofResult({ kind: 'required' }, 0, '')).toBe('PASS');
  });

  it('does not call a zero-exit local check complete when its output is explicitly blocked', () => {
    expect(classifyLaunchProofResult({ kind: 'evidence' }, 0, 'live_multi_device_status=BLOCKED')).toBe('BLOCKED');
    expect(classifyLaunchProofResult({ kind: 'evidence' }, 0, 'Conformance blocked by unimplemented runtimes')).toBe('BLOCKED');
  });

  it('keeps required failures distinct from evidence blockers', () => {
    expect(classifyLaunchProofResult({ kind: 'required' }, 1, 'typecheck failed')).toBe('FAIL');
    expect(classifyLaunchProofResult({ kind: 'evidence' }, 1, 'BLOCKED=device')).toBe('BLOCKED');
    expect(classifyLaunchProofResult({ kind: 'evidence' }, 1, 'unexpected script error')).toBe('FAIL');
  });

  it('recognizes explicit blocked output from an evidence-dependent command', () => {
    expect(classifyLaunchProofResult({ kind: 'required' }, 1, 'live_multi_device_status=BLOCKED')).toBe('BLOCKED');
    expect(classifyLaunchProofResult(
      { id: 'launch_contract', kind: 'required' },
      1,
      '"failures": ["release_blocker:ios_team_id_placeholder"]',
    )).toBe('BLOCKED');
  });

  it('does not hide a launch-contract defect behind a release blocker', () => {
    expect(classifyLaunchProofResult(
      { id: 'launch_contract', kind: 'required' },
      1,
      '"failures": ["release_blocker:ios_team_id_placeholder", "missing:cloudflare/README.md"]',
    )).toBe('FAIL');
  });
});
