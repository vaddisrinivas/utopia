import { describe, expect, it } from 'vitest';

import { canonicalJson } from '@/packages/shared/contracts/canonical-json';
import {
  UTOPIA_EXTENSION_MANIFEST_SCHEMA_VERSION,
  UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION,
  UTOPIA_EXTENSION_TRUST_ROOT_SCHEMA_VERSION,
  UTOPIA_EXTENSION_TRUST_TARGETS_SCHEMA_VERSION,
  resolveExtensionTrustPolicyWithTufMetadata,
  type UtopiaExtensionManifest,
  type UtopiaExtensionTrustPolicy,
  type UtopiaExtensionTrustRootMetadata,
  type UtopiaExtensionTrustTargetsMetadata,
} from '@/packages/shared/contracts/extension-trust';

describe('TUF-style extension trust metadata contract', () => {
  it('accepts an unexpired delegated manifest with matching floor and scopes', async () => {
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: await buildManifest(),
      policy: await buildPolicy(),
      root: await buildRootMetadata(),
      targets: await buildTargetsMetadata(),
      floor: {
        minimumAcceptedRootVersion: 8,
        minimumAcceptedTargetsVersionByPublisher: {
          'io.utopia': 3,
        },
      },
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(evaluation).toEqual({
      trusted: true,
      publicKey: (await buildPolicy()).trustedKeys.find((key) => key.keyId === 'lane-b-key')?.publicKey,
      rootVersion: 12,
      targetsVersion: 4,
    });
  });

  it('allows root metadata equal to minimumAcceptedRootVersion', async () => {
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: await buildManifest(),
      policy: await buildPolicy(),
      root: await buildRootMetadata(),
      targets: await buildTargetsMetadata(),
      floor: {
        minimumAcceptedRootVersion: 12,
      },
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(evaluation).toEqual({
      trusted: true,
      publicKey: (await buildPolicy()).trustedKeys.find((key) => key.keyId === 'lane-b-key')?.publicKey,
      rootVersion: 12,
      targetsVersion: 4,
    });
  });

  it('allows targets metadata equal to publisher minimumAcceptedTargetsVersion', async () => {
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: await buildManifest(),
      policy: await buildPolicy(),
      root: await buildRootMetadata(),
      targets: await signTargetsMetadata({
        ...(await buildTargetsMetadata()),
        version: 3,
      }),
      floor: {
        minimumAcceptedTargetsVersionByPublisher: {
          'io.utopia': 3,
        },
      },
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(evaluation).toEqual({
      trusted: true,
      publicKey: (await buildPolicy()).trustedKeys.find((key) => key.keyId === 'lane-b-key')?.publicKey,
      rootVersion: 12,
      targetsVersion: 3,
    });
  });

  it('rejects missing targets metadata signature', async () => {
    const { signature, ...targetsWithoutSignature } = await buildTargetsMetadata();
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: await buildManifest(),
      policy: await buildPolicy(),
      root: await buildRootMetadata(),
      targets: targetsWithoutSignature,
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(evaluation).toEqual({
      trusted: false,
      error: 'extension trust targets metadata signature is required',
      rootVersion: 12,
      targetsVersion: 4,
    });
  });

  it('rejects expired root metadata', async () => {
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: await buildManifest(),
      policy: await buildPolicy(),
      root: await signRootMetadata({
        ...(await buildRootMetadata()),
        expires: '2026-07-20T00:00:00.000Z',
      }),
      targets: await buildTargetsMetadata(),
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(evaluation).toEqual({
      trusted: false,
      error: 'extension trust root metadata expired',
      rootVersion: 12,
      targetsVersion: 4,
    });
  });

  it('rejects root rollback', async () => {
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: await buildManifest(),
      policy: await buildPolicy(),
      root: await signRootMetadata({
        ...(await buildRootMetadata()),
        version: 1,
      }),
      targets: await buildTargetsMetadata(),
      floor: {
        minimumAcceptedRootVersion: 8,
      },
      now: '2026-07-29T00:00:00.000Z',
    });

      expect(evaluation).toEqual({
      trusted: false,
      error: 'extension trust root version rollback',
      rootVersion: 1,
      targetsVersion: 4,
    });
  });

  it('rejects targets rollback against floor for a publisher', async () => {
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: await buildManifest(),
      policy: await buildPolicy(),
      root: await buildRootMetadata(),
      targets: await signTargetsMetadata({
        ...(await buildTargetsMetadata()),
        version: 2,
      }),
      floor: {
        minimumAcceptedTargetsVersionByPublisher: {
          'io.utopia': 3,
        },
      },
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(evaluation).toEqual({
      trusted: false,
      error: 'extension trust targets version rollback',
      rootVersion: 12,
      targetsVersion: 2,
    });
  });

  it('rejects publishers and extensions not inside delegation constraints', async () => {
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: {
        ...(await buildManifest()),
        id: 'io.bad.extension',
      },
      policy: await buildPolicy(),
      root: await signRootMetadata({
        ...(await buildRootMetadata()),
        delegatedPublishers: [{
          publisherId: 'io.utopia',
          extensionIdPatterns: ['io.utopia.*'],
          delegatedSigningKeyIds: ['lane-b-key'],
        }],
      }),
      targets: {
        ...(await buildTargetsMetadata()),
        publisherId: 'io.utopia',
      },
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(evaluation).toEqual({
      trusted: false,
      error: 'extension id is outside delegated trust constraints',
      rootVersion: 12,
      targetsVersion: 4,
    });
  });

  it('rejects forged root metadata signatures', async () => {
    const root = await buildRootMetadata();
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: await buildManifest(),
      policy: await buildPolicy(),
      root: {
        ...root,
        signature: {
          ...root.signature!,
          value: 'bad-signature',
        },
      },
      targets: await buildTargetsMetadata(),
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(evaluation).toMatchObject({
      trusted: false,
      error: expect.stringContaining('signature verification failed'),
      rootVersion: 12,
      targetsVersion: 4,
    });
  });

  it('rejects targets signatures from non-delegated keys', async () => {
    const targets = await buildTargetsMetadata();
    const evaluation = await resolveExtensionTrustPolicyWithTufMetadata({
      manifest: await buildManifest(),
      policy: await buildPolicy(),
      root: await buildRootMetadata(),
      targets: {
        ...targets,
        signature: {
          ...targets.signature!,
          keyId: 'rogue-key',
        },
      },
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(evaluation).toEqual({
      trusted: false,
      error: 'extension trust targets signing key is not delegated',
      rootVersion: 12,
      targetsVersion: 4,
    });
  });
});

type TrustFixture = {
  policy: UtopiaExtensionTrustPolicy;
  root: UtopiaExtensionTrustRootMetadata;
  targets: UtopiaExtensionTrustTargetsMetadata;
  rootPrivateKey: CryptoKey;
  targetsPrivateKey: CryptoKey;
};

let trustFixture: Promise<TrustFixture> | null = null;

async function buildManifest(): Promise<UtopiaExtensionManifest> {
  const policy = (await trustFixtureBuilder()).policy;
  return {
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
      sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sizeBytes: 1024,
      entrypoint: 'main.wasm',
    },
    capabilities: [{
      id: 'provider:notion',
      level: 'read',
      required: false,
    }],
    signature: {
      algorithm: 'ecdsa-p256-sha256',
      keyId: 'lane-b-key',
      value: 'signature-payload',
      publicKey: policy.trustedKeys.find((key) => key.keyId === 'lane-b-key')?.publicKey ?? '',
      signedAt: '2026-07-28T00:00:00.000Z',
    },
  };
}

async function buildPolicy(): Promise<UtopiaExtensionTrustPolicy> {
  const fixture = await trustFixtureBuilder();
  return fixture.policy;
}

async function buildRootMetadata(): Promise<UtopiaExtensionTrustRootMetadata> {
  const fixture = await trustFixtureBuilder();
  return fixture.root;
}

async function buildTargetsMetadata(): Promise<UtopiaExtensionTrustTargetsMetadata> {
  const fixture = await trustFixtureBuilder();
  return fixture.targets;
}

async function trustFixtureBuilder(): Promise<TrustFixture> {
  if (!trustFixture) {
    trustFixture = buildSignedTrustFixture();
  }
  return trustFixture;
}

async function buildSignedTrustFixture(): Promise<TrustFixture> {
  const rootKeyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify'],
  );
  const laneBKeyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify'],
  );

  const rootPublicKey = Buffer.from(await globalThis.crypto.subtle.exportKey('spki', rootKeyPair.publicKey)).toString('base64');
  const laneBPublicKey = Buffer.from(await globalThis.crypto.subtle.exportKey('spki', laneBKeyPair.publicKey)).toString('base64');

  const rootUnsigned: Omit<UtopiaExtensionTrustRootMetadata, 'signature'> = {
    schemaVersion: UTOPIA_EXTENSION_TRUST_ROOT_SCHEMA_VERSION,
    version: 12,
    expires: '2026-08-01T00:00:00.000Z',
    rootKeyId: 'root-key',
    delegatedPublishers: [
      {
        publisherId: 'io.utopia',
        extensionIdPatterns: ['io.utopia.*'],
        delegatedSigningKeyIds: ['lane-b-key'],
        minimumTargetsVersion: 3,
      },
    ],
  };

  const targetsUnsigned: Omit<UtopiaExtensionTrustTargetsMetadata, 'signature'> = {
    schemaVersion: UTOPIA_EXTENSION_TRUST_TARGETS_SCHEMA_VERSION,
    publisherId: 'io.utopia',
    version: 4,
    expires: '2026-08-01T00:00:00.000Z',
    delegatedSigningKeyIds: ['lane-b-key'],
  };

  const rootSignature = await buildTrustMetadataSignature(rootKeyPair.privateKey, canonicalTrustMetadataPayload(rootUnsigned));
  const targetsSignature = await buildTrustMetadataSignature(laneBKeyPair.privateKey, canonicalTrustMetadataPayload(targetsUnsigned));

  return {
    policy: {
      schemaVersion: UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION,
      name: 'Lane B Trust Policy',
      trustedKeys: [
        {
          publisherId: 'utopia-root',
          keyId: 'root-key',
          algorithm: 'ecdsa-p256-sha256',
          publicKey: rootPublicKey,
          status: 'trusted',
          notBefore: '2026-07-01T00:00:00.000Z',
        },
        {
          publisherId: 'io.utopia',
          keyId: 'lane-b-key',
          algorithm: 'ecdsa-p256-sha256',
          publicKey: laneBPublicKey,
          status: 'trusted',
          notBefore: '2026-07-01T00:00:00.000Z',
        },
      ],
    },
    root: {
      ...rootUnsigned,
      signature: {
        algorithm: 'ecdsa-p256-sha256',
        keyId: 'root-key',
        value: rootSignature,
        publicKey: rootPublicKey,
        signedAt: '2026-07-28T00:00:00.000Z',
      },
    },
    targets: {
      ...targetsUnsigned,
      signature: {
        algorithm: 'ecdsa-p256-sha256',
        keyId: 'lane-b-key',
        value: targetsSignature,
        publicKey: laneBPublicKey,
        signedAt: '2026-07-28T00:00:00.000Z',
      },
    },
    rootPrivateKey: rootKeyPair.privateKey,
    targetsPrivateKey: laneBKeyPair.privateKey,
  };
}

async function signRootMetadata(value: UtopiaExtensionTrustRootMetadata): Promise<UtopiaExtensionTrustRootMetadata> {
  const fixture = await trustFixtureBuilder();
  const { signature, ...unsigned } = value;
  return {
    ...unsigned,
    signature: {
      ...(signature ?? fixture.root.signature!),
      value: await buildTrustMetadataSignature(fixture.rootPrivateKey, canonicalTrustMetadataPayload(unsigned)),
    },
  };
}

async function signTargetsMetadata(value: UtopiaExtensionTrustTargetsMetadata): Promise<UtopiaExtensionTrustTargetsMetadata> {
  const fixture = await trustFixtureBuilder();
  const { signature, ...unsigned } = value;
  return {
    ...unsigned,
    signature: {
      ...(signature ?? fixture.targets.signature!),
      value: await buildTrustMetadataSignature(fixture.targetsPrivateKey, canonicalTrustMetadataPayload(unsigned)),
    },
  };
}

function canonicalTrustMetadataPayload(value: object): string {
  return canonicalJson(value);
}

async function buildTrustMetadataSignature(privateKey: CryptoKey, canonicalPayload: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPayload);
  const signature = await globalThis.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    privateKey,
    bytes,
  );
  return Buffer.from(signature).toString('base64');
}
