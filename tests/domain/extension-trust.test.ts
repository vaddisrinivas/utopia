import { describe, expect, it } from 'vitest';

import { evaluateSignedExtensionManifest } from '@/src/domain/extension-trust';
import {
  buildCanonicalExtensionSignedPayloadText,
  UTOPIA_EXTENSION_MANIFEST_SCHEMA_VERSION,
  UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION,
  type UtopiaExtensionCapabilityDeclaration,
  type UtopiaExtensionManifest,
  type UtopiaExtensionTrustPolicy,
} from '@/packages/shared/contracts/extension-trust';

describe('signed extension trust boundary', () => {
  it('accepts a validly signed bounded extension', async () => {
    const manifest = await buildSignedExtensionFixture({
      keyId: 'lane-b-key',
      capabilities: [{
        id: 'provider:notion',
        level: 'write',
        required: false,
      }],
    });
    const policy = makeTrustPolicy({
      keyId: 'lane-b-key',
      algorithm: manifest.signature.algorithm,
      publicKey: manifest.signature.publicKey,
    });

    const review = await evaluateSignedExtensionManifest({
      manifest,
      artifactChecksum: manifest.artifact.sha256,
      trustPolicy: policy,
      capabilityPolicy: [{ capability: 'provider:notion', maxLevel: 'admin' }],
    });

    expect(review).toMatchObject({
      status: 'accepted',
      manifestId: 'io.utopia.timer',
      signatureStatus: 'verified',
      reasons: [],
    });
  });

  it('rejects unknown signatures with deterministic refusal', async () => {
    const manifest = await buildSignedExtensionFixture({
      keyId: 'lane-b-key',
      capabilities: [{
        id: 'provider:notion',
        level: 'read',
        required: false,
      }],
    });
    const policy = makeTrustPolicy({
      keyId: 'other-key',
      algorithm: manifest.signature.algorithm,
      publicKey: manifest.signature.publicKey,
    });

    const review = await evaluateSignedExtensionManifest({
      manifest,
      artifactChecksum: manifest.artifact.sha256,
      trustPolicy: policy,
      capabilityPolicy: [{ capability: 'provider:notion', maxLevel: 'read' }],
    });

    expect(review.status).toBe('refused');
    expect(review.signatureStatus).toBe('untrusted');
    expect(review.reasons).toEqual(['extension signing key is not trusted']);
  });

  it('rejects tampered extension payloads after manifest mutation', async () => {
    const manifest = await buildSignedExtensionFixture({
      keyId: 'lane-b-key',
      capabilities: [{
        id: 'provider:notion',
        level: 'read',
        required: false,
      }],
    });
    const policy = makeTrustPolicy({
      keyId: 'lane-b-key',
      algorithm: manifest.signature.algorithm,
      publicKey: manifest.signature.publicKey,
    });
    const tamperedManifest = {
      ...manifest,
      version: '999.0.0',
    };

    const review = await evaluateSignedExtensionManifest({
      manifest: tamperedManifest,
      artifactChecksum: tamperedManifest.artifact.sha256,
      trustPolicy: policy,
      capabilityPolicy: [{ capability: 'provider:notion', maxLevel: 'read' }],
    });

    expect(review.status).toBe('refused');
    expect(review.signatureStatus).toBe('invalid');
    expect(review.reasons[0]).toContain('signature verification failed');
  });

  it('rejects revoked trust keys deterministically', async () => {
    const manifest = await buildSignedExtensionFixture({
      keyId: 'lane-b-key',
      capabilities: [{
        id: 'provider:notion',
        level: 'read',
        required: false,
      }],
    });
    const policy: UtopiaExtensionTrustPolicy = {
      schemaVersion: UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION,
      name: 'Lane B Trust Root',
      trustedKeys: [{
        publisherId: 'io.utopia',
        keyId: 'lane-b-key',
        algorithm: 'ecdsa-p256-sha256',
        publicKey: manifest.signature.publicKey ?? '',
        status: 'revoked',
        revokedAt: '2026-07-28T00:00:00.000Z',
      }],
    };

    const review = await evaluateSignedExtensionManifest({
      manifest,
      artifactChecksum: manifest.artifact.sha256,
      trustPolicy: policy,
      capabilityPolicy: [{ capability: 'provider:notion', maxLevel: 'read' }],
    });

    expect(review.status).toBe('refused');
    expect(review.signatureStatus).toBe('untrusted');
    expect(review.reasons).toEqual(['extension signing key is revoked']);
  });

  it('rejects overprivileged capabilities', async () => {
    const manifest = await buildSignedExtensionFixture({
      keyId: 'lane-b-key',
      capabilities: [{
        id: 'provider:notion',
        level: 'admin',
        required: true,
      }],
    });
    const policy = makeTrustPolicy({
      keyId: 'lane-b-key',
      algorithm: manifest.signature.algorithm,
      publicKey: manifest.signature.publicKey,
    });

    const review = await evaluateSignedExtensionManifest({
      manifest,
      artifactChecksum: manifest.artifact.sha256,
      trustPolicy: policy,
      capabilityPolicy: [{ capability: 'provider:notion', maxLevel: 'read' }],
    });

    expect(review.status).toBe('refused');
    expect(review.signatureStatus).toBe('verified');
    expect(review.reasons).toEqual(['extension capability overprivileged:provider:notion']);
  });

  it('rejects unlisted capabilities', async () => {
    const manifest = await buildSignedExtensionFixture({
      keyId: 'lane-b-key',
      capabilities: [{
        id: 'provider:beta',
        level: 'read',
        required: false,
      }],
    });
    const policy = makeTrustPolicy({
      keyId: 'lane-b-key',
      algorithm: manifest.signature.algorithm,
      publicKey: manifest.signature.publicKey,
    });

    const review = await evaluateSignedExtensionManifest({
      manifest,
      artifactChecksum: manifest.artifact.sha256,
      trustPolicy: policy,
      capabilityPolicy: [{ capability: 'provider:notion', maxLevel: 'read' }],
    });

    expect(review.status).toBe('refused');
    expect(review.signatureStatus).toBe('verified');
    expect(review.reasons).toEqual(['extension capability unknown:provider:beta']);
  });

  it('rejects an artifact whose bytes do not match the signed digest', async () => {
    const manifest = await buildSignedExtensionFixture({
      keyId: 'lane-b-key',
      capabilities: [{ id: 'provider:notion', level: 'read', required: false }],
    });
    const policy = makeTrustPolicy({
      keyId: 'lane-b-key',
      algorithm: manifest.signature.algorithm,
      publicKey: manifest.signature.publicKey,
    });

    const review = await evaluateSignedExtensionManifest({
      manifest,
      artifactChecksum: `sha256:${'b'.repeat(64)}`,
      trustPolicy: policy,
      capabilityPolicy: [{ capability: 'provider:notion', maxLevel: 'read' }],
    });

    expect(review.status).toBe('refused');
    expect(review.signatureStatus).toBe('verified');
    expect(review.reasons).toEqual(['extension artifact checksum mismatch']);
  });
});

function makeTrustPolicy(input: { keyId: string; algorithm: string; publicKey?: string }): UtopiaExtensionTrustPolicy {
  if (!input.publicKey) throw new Error('fixture public key missing');
  return {
    schemaVersion: UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION,
    name: 'Lane B Trust Root',
    trustedKeys: [{
      publisherId: 'io.utopia',
      keyId: input.keyId,
      algorithm: input.algorithm as 'ecdsa-p256-sha256',
      publicKey: input.publicKey,
      status: 'trusted',
    }],
  };
}

async function buildSignedExtensionFixture(input: {
  keyId: string;
  capabilities: UtopiaExtensionCapabilityDeclaration[];
}): Promise<UtopiaExtensionManifest> {
  const capabilityLevels = ['read', 'write', 'admin'];
  if (!input.capabilities.every((capability) => capabilityLevels.includes(capability.level))) {
    throw new Error('invalid capability level in fixture');
  }

  const unsignedManifest: Omit<UtopiaExtensionManifest, 'signature'> = {
    schemaVersion: UTOPIA_EXTENSION_MANIFEST_SCHEMA_VERSION,
    id: 'io.utopia.timer',
    abi: '1.0.0',
    version: '1.0.0',
    publisher: {
      id: 'io.utopia',
      name: 'Utopia',
      homepage: 'https://wonder.app',
      verified: true,
    },
    artifact: {
      kind: 'wasm',
      sha256: `sha256:${'a'.repeat(64)}`,
      sizeBytes: 4096,
      entrypoint: 'main.wasm',
    },
    capabilities: input.capabilities,
  };

  const keyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify'],
  );

  const publicKeyBytes = await globalThis.crypto.subtle.exportKey('spki', keyPair.publicKey);
  const canonicalPayload = buildCanonicalExtensionSignedPayloadText({
    ...unsignedManifest,
    signature: {
      algorithm: 'ecdsa-p256-sha256',
      keyId: input.keyId,
      value: '',
    },
  });
  const signatureValue = await buildExtensionSignature(keyPair.privateKey, canonicalPayload);

  return {
    ...unsignedManifest,
    signature: {
      algorithm: 'ecdsa-p256-sha256',
      keyId: input.keyId,
      publicKey: Buffer.from(publicKeyBytes).toString('base64'),
      signedAt: '2026-07-28T00:00:00.000Z',
      value: signatureValue,
    },
  };
}

async function buildExtensionSignature(privateKey: CryptoKey, canonicalPayload: string): Promise<string> {
  const signature = await globalThis.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    privateKey,
    new TextEncoder().encode(canonicalPayload),
  );
  return Buffer.from(signature).toString('base64');
}
