import { describe, expect, it } from 'vitest';

import { collectRegistryTrustMetadataValidationErrors } from '@/packages/shared/contracts/package-install';
import { resolveRegistrySignatureTrust } from '@/packages/shared/contracts/package-trust';

const baseTrust = {
  root: { schemaVersion: 'utopia.extension-trust-root.v1', version: 12, expires: '2026-08-01T00:00:00.000Z', rootKeyId: 'root-key', delegatedPublishers: [], signature: { algorithm: 'ecdsa-p256-sha256', keyId: 'root-key', value: 'signed-root', signedAt: '2026-07-29T00:00:00.000Z' } },
  targets: [{ schemaVersion: 'utopia.extension-trust-targets.v1', publisherId: 'io.utopia', version: 4, expires: '2026-08-01T00:00:00.000Z', delegatedSigningKeyIds: ['publisher-key'], signature: { algorithm: 'ecdsa-p256-sha256', keyId: 'publisher-key', value: 'signed-targets', signedAt: '2026-07-29T00:00:00.000Z' } }],
} as const;

const policy = { schemaVersion: 'utopia.trust-policy.v1' as const, name: 'Test Trust Root', trustedKeys: [{ publisherId: 'io.utopia', keyId: 'publisher-key-1', algorithm: 'ecdsa-p256-sha256' as const, publicKey: 'dGVzdC1wdWJsaWMta2V5', status: 'trusted' as const }] } as const;
const registryPackage = { id: 'io.utopia.demo', name: 'Demo', version: '1.0.0', url: 'https://example.test/demo.json', publisher: { id: 'io.utopia' } };

describe('registry trust lifecycle contract', () => {
  it('fails closed for expired root and targets metadata', () => {
    const errors = collectRegistryTrustMetadataValidationErrors({ root: { ...baseTrust.root, expires: '2026-07-29T00:00:00.000Z' }, targets: [{ ...baseTrust.targets[0], expires: '2026-07-29T00:00:00.000Z' }] }, { now: '2026-07-30T00:00:00.000Z' });
    expect(errors).toEqual(expect.arrayContaining(['trust.root expired', 'trust.targets[0] expired']));
  });

  it('rejects malformed trusted signatures', () => {
    const result = resolveRegistrySignatureTrust({ policy, registryPackage: { ...registryPackage, signature: { algorithm: 'ecdsa-p256-sha256', keyId: 'bad key', value: 'not-base64!@', signedAt: '2026-07-29T00:00:00.000Z' } } });
    expect(result).toEqual({ trusted: false, error: 'signature keyId format is invalid for trusted packages' });
  });
});
