import { describe, expect, it } from 'vitest';

import {
  CREATOR_PROOF_RECEIPT_SCHEMA_VERSION,
  runCreatorProofHarness,
} from '@/scripts/factory/run-creator-proof-harness';

describe('constrained creator proof harness', () => {
  it('runs bounded dumb/moderate agents through real install checks and blocks hostile', async () => {
    const receipt = await runCreatorProofHarness(new Date('2026-07-30T12:00:00.000Z'));
    const [readmeOnly, schemaAware, hostile] = receipt.cases;

    expect(receipt.schema_version).toBe(CREATOR_PROOF_RECEIPT_SCHEMA_VERSION);
    expect(receipt.status).toBe('AUTOMATED_AGENT_PASS');
    expect(receipt.human_usability).toBe('not_measured');
    expect(receipt.human_evidence).toBe('BLOCKED');
    expect(readmeOnly).toMatchObject({ agent: 'dumb', status: 'accepted', package_valid: true, rejection_codes: [], checks: { schema: 'passed', compiler: 'passed', install: 'passed' } });
    expect(schemaAware).toMatchObject({ agent: 'moderate', status: 'accepted', package_valid: true, rejection_codes: [], checks: { schema: 'passed', compiler: 'passed', install: 'passed' } });
    expect(hostile).toMatchObject({
      agent: 'hostile',
      status: 'rejected',
      package_valid: false,
    });
    expect(hostile.rejection_codes).toEqual(expect.arrayContaining([
      'secret_exfiltration_rejected',
      'secret_shaped_source_rejected',
      'code_execution_rejected',
      'unsupported_capability_rejected',
    ]));
    expect(new Set(hostile.rejection_codes).size).toBe(hostile.rejection_codes.length);
    expect(receipt.cases.every((item) => Number.isFinite(item.duration_ms) && item.duration_ms >= 0)).toBe(true);
    expect(readmeOnly.package.id).toBeTruthy();
    expect(schemaAware.package.id).toBeTruthy();
    expect(hostile.package.id).toBeTruthy();
    expect(receipt.summary.accepted).toBe(2);
    expect(receipt.summary.rejected).toBe(1);
    expect(receipt.summary.max_case_duration_ms).toBeGreaterThanOrEqual(0);
    expect(receipt.cases.every((item) => item.workspace.isolated && item.workspace.cleaned && !item.workspace.directFixtureCopy)).toBe(true);
  });

  it('receipt contains no prompt, source, secret, or raw model output fields', async () => {
    const receipt = await runCreatorProofHarness();
    const serialized = JSON.stringify(receipt);

    expect(serialized).not.toMatch(/apiKey|rawModel|sk-redacted-test-value|OpenAI API key/i);
    expect(Object.keys(receipt)).toEqual(expect.arrayContaining([
      'schema_version', 'proof', 'checked_at', 'status', 'human_usability', 'human_evidence', 'cases', 'summary',
    ]));
  });
});
