import { describe, expect, it } from 'vitest';

import {
  GOLDEN_LOOP_SUITES,
  classifyGoldenLoopResult,
} from '../../scripts/quality/run-golden-loop-proof.mjs';

describe('Golden Loop proof runner', () => {
  it('contains the complete vertical rather than independent marketing checks', () => {
    const ids = GOLDEN_LOOP_SUITES.map((suite) => suite.id);
    expect(ids).toEqual(expect.arrayContaining([
      'golden_vertical',
      'core_boundary',
      'creator_factory',
      'creator_study',
      'install_trust',
      'registry_privacy',
      'local_sync_contract',
      'local_runtime_code',
      'local_guarantees',
      'network_sync_transport',
      'clean_checkout',
      'proof_contracts',
      'cross_runtime_conformance',
      'multi_surface_execution',
      'multi_surface_receipts',
      'web_export',
      'android_export',
    ]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps external evidence blockers separate from implementation failures', () => {
    expect(classifyGoldenLoopResult({ kind: 'required' }, 0, 'PASS')).toBe('PASS');
    expect(classifyGoldenLoopResult({ kind: 'required' }, 1, 'typecheck failed')).toBe('FAIL');
    expect(classifyGoldenLoopResult({ kind: 'evidence' }, 1, 'BLOCKER=missing_receipt')).toBe('BLOCKED');
    expect(classifyGoldenLoopResult({ kind: 'evidence' }, 0, 'live_multi_device_status=BLOCKED')).toBe('BLOCKED');
    expect(classifyGoldenLoopResult({ kind: 'evidence' }, 0, 'ready blockers=3')).toBe('BLOCKED');
    expect(classifyGoldenLoopResult({ kind: 'required' }, 0, 'PASS', 'SIGTERM')).toBe('FAIL');
    expect(classifyGoldenLoopResult({ kind: 'evidence' }, 0, 'PASS', null, true)).toBe('BLOCKED');
  });
});
