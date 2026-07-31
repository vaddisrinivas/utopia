import { describe, expect, it } from 'vitest';

import {
  CREATOR_PROOF_RECEIPT_SCHEMA_VERSION,
  runCreatorProofHarness,
} from '@/scripts/factory/run-creator-proof-harness';

describe('constrained creator proof harness', () => {
  it('runs README-only and schema-aware agents through separate modes and blocks hostile', () => {
    const receipt = runCreatorProofHarness(new Date('2026-07-30T12:00:00.000Z'));
    const [readmeOnly, schemaAware, hostile] = receipt.cases;
    const expectedDurationMs = Number(receipt.cases[0]!.duration_ms + receipt.cases[1]!.duration_ms + receipt.cases[2]!.duration_ms).toFixed(3);

    expect(receipt.schema_version).toBe(CREATOR_PROOF_RECEIPT_SCHEMA_VERSION);
    expect(receipt.human_usability).toBe('not_measured');
    expect(readmeOnly).toMatchObject({ agent: 'readme-only', status: 'accepted', package_valid: true, rejection_codes: [] });
    expect(schemaAware).toMatchObject({ agent: 'schema-aware', status: 'accepted', package_valid: true, rejection_codes: [] });
    expect(hostile).toMatchObject({
      agent: 'hostile',
      status: 'rejected',
      package_valid: false,
    });
    expect(hostile.rejection_codes).toEqual(expect.arrayContaining([
      'secret_exfiltration_rejected',
      'secret_shaped_source_rejected',
      'unsupported_capability_rejected',
    ]));
    expect(new Set(hostile.rejection_codes).size).toBe(hostile.rejection_codes.length);
    expect(receipt.cases.every((item) => Number.isFinite(item.duration_ms) && item.duration_ms >= 0)).toBe(true);
    expect(readmeOnly.package.id).toBeTruthy();
    expect(schemaAware.package.id).toBeTruthy();
    expect(hostile.package.id).toBeTruthy();
    expect(receipt.summary).toEqual({
      accepted: 2,
      rejected: 1,
      all_duration_ms: Number(expectedDurationMs),
    });
  });

  it('receipt contains no prompt, source, secret, or raw model output fields', () => {
    const receipt = runCreatorProofHarness();
    const serialized = JSON.stringify(receipt);

    expect(serialized).not.toMatch(/apiKey|rawModel|sk-redacted-test-value|OpenAI API key/i);
    expect(Object.keys(receipt)).toEqual(expect.arrayContaining([
      'schema_version', 'proof', 'checked_at', 'human_usability', 'cases', 'summary',
    ]));
  });
});
