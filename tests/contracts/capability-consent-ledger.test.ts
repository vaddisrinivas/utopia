import { describe, expect, it } from 'vitest';

import {
  buildCapabilityConsentRecordFingerprint,
  buildCapabilityConsentRecordId,
  buildCapabilityConsentLedgerScope,
  canonicalCapabilityConsentRecord,
  collectCapabilityConsentRecordValidationErrors,
  getCapabilityConsentLedgerState,
  validateCapabilityConsentRecord,
} from '@/packages/shared/contracts/capability-consent-ledger';

describe('capability consent ledger contracts', () => {
  const baseEntry = {
    schemaVersion: 'utopia.capability-consent-ledger.v1',
    installationId: 'install-1',
    packageId: 'demo.capability',
    packageVersion: '1.2.3',
    packageChecksum: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    capability: 'native.camera',
    scope: ['notes', 'tasks'],
    decision: 'allow',
    decidedBy: 'user-1',
    decidedAt: '2026-07-30T00:00:00.000Z',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  } as const;

  it('normalizes scope ordering and computes deterministic ids', () => {
    expect(buildCapabilityConsentLedgerScope(['b', 'a', 'a', ''])).toEqual(['a', 'b']);
    expect(buildCapabilityConsentRecordId({
      installationId: baseEntry.installationId,
      packageId: baseEntry.packageId,
      capability: baseEntry.capability,
      scope: ['b', 'a'],
    })).toEqual(buildCapabilityConsentRecordId({
      installationId: baseEntry.installationId,
      packageId: baseEntry.packageId,
      capability: baseEntry.capability,
      scope: ['a', 'b'],
    }));
  });

  it('keeps active decisions and computes a canonical ledger fingerprint', () => {
    const input = canonicalCapabilityConsentRecord({ ...baseEntry, scope: ['tasks', 'notes', 'notes'] });
    expect(input.scope).toEqual(['notes', 'tasks']);

    const state = getCapabilityConsentLedgerState(input);
    expect(state).toEqual({ isRevoked: false, active: true, effectiveDecision: 'allow' });
    expect(buildCapabilityConsentRecordFingerprint(input)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('marks and validates revoked consent', () => {
    expect(() => validateCapabilityConsentRecord({
      ...baseEntry,
      revocation: {
        revokedBy: 'admin-1',
        revokedAt: '2026-07-29T00:00:00.000Z',
      },
    })).toThrow('capability_consent_record_invalid:revocation.revokedAt must be after decidedAt');

    const revoked = validateCapabilityConsentRecord({
      ...baseEntry,
      revocation: {
        revokedBy: 'admin-1',
        revokedAt: '2026-07-30T00:01:00.000Z',
        revocationReason: 'user reset',
      },
    });
    const state = getCapabilityConsentLedgerState(revoked);
    expect(state.isRevoked).toBe(true);
    expect(state.active).toBe(false);
    expect(state.effectiveDecision).toBe(null);
    expect(state.revokedReason).toBe('user reset');
  });

  it('rejects malformed ledger records as hostile input', () => {
    expect(collectCapabilityConsentRecordValidationErrors({
      schemaVersion: 'utopia.capability-consent-ledger.v0',
      installationId: '',
      packageId: '',
      packageVersion: '',
      packageChecksum: 'not-a-checksum',
      capability: '',
      scope: [''],
      decision: 'maybe',
      decidedBy: '',
      decidedAt: 'bad-timestamp',
      createdAt: 'bad',
      updatedAt: '2026-07-30T00:00:00.000Z',
    })).toEqual([
      'schemaVersion must be utopia.capability-consent-ledger.v1',
      'installationId is required',
      'packageId is required',
      'packageVersion is required',
      'packageChecksum must be sha256:<64 hex chars>',
      'capability is required',
      'scope must be a non-empty array',
      'decision must be allow or deny',
      'decidedBy is required',
      'decidedAt must be ISO timestamp',
      'createdAt must be ISO timestamp',
    ]);

    expect(() => validateCapabilityConsentRecord({
      ...baseEntry,
      revocation: {
        revokedBy: '',
        revokedAt: '2026-07-30T00:02:00.000Z',
      },
    } as unknown)).toThrow('capability_consent_record_invalid:revocation.revokedBy is required');
  });
});
