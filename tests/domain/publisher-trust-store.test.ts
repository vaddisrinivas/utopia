import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { buildPackageInstallPreviewWithSignatureVerification } from '@/src/domain/package-install';
import {
  UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM,
  UTOPIA_PUBLISHER_TRUST_SNAPSHOT_SCHEMA_VERSION,
  createPublisherTrustStore,
  type UtopiaPinnedRootSignedPublisherTrustSnapshot,
  type UtopiaPinnedRootSignedPublisherTrustSnapshotPayload,
  type UtopiaPublisherTrustKey,
  type UtopiaPublisherTrustRoot,
} from '@/src/domain/publisher-trust-store';
import type { UtopiaPublisherTrustSnapshotFloor } from '@/src/domain/publisher-trust-persistence';

const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-install/valid-package.json');
const packageFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const TRUST_NOW_MS = Date.parse('2026-07-29T00:00:00.000Z');
const trustNow = () => TRUST_NOW_MS;

describe('publisher trust store policy', () => {
  it('rejects attacker-controlled roots that are not pinned', async () => {
    const pinnedRoot = await generateSigningMaterial();
    const attackerRoot = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();

    const snapshot = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 1,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'attacker-root',
            keyId: 'demo-key',
            publicKey: publisherKey.publicKey,
            notBefore: '2026-07-01T00:00:00.000Z',
          }),
        ],
      }),
      rootKeyId: 'attacker-root',
      rootMaterial: attackerRoot,
      signedAt: '2026-07-10T00:00:00.000Z',
    });

    await expect(createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'pinned-root',
        publicKey: pinnedRoot.publicKey,
      })],
      snapshot,
    })).rejects.toThrow(/unknown_root/);
  });

  it('rejects tampered snapshots after signing', async () => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();

    const signed = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 2,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'demo-key',
            publicKey: publisherKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-10T00:00:00.000Z',
    });

    const tamperedSnapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot = {
      ...signed,
      publisherKeys: [
        {
          ...signed.publisherKeys[0],
          publicKey: `${signed.publisherKeys[0].publicKey}-tampered`,
        },
      ],
    };

    await expect(createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot: tamperedSnapshot,
    })).rejects.toThrow(/bad_snapshot_signature/);
  });

  it('rejects duplicate pinned roots', async () => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();

    const snapshot = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 3,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'demo-key',
            publicKey: publisherKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-10T00:00:00.000Z',
    });

    await expect(createPublisherTrustStore({
      pinnedRoots: [
        makePinnedRoot({ rootKeyId: 'root-a', publicKey: root.publicKey }),
        makePinnedRoot({ rootKeyId: 'root-a', publicKey: root.publicKey }),
      ],
      snapshot,
    })).rejects.toThrow(/duplicate_root/);
  });

  it('rejects duplicate publisher key IDs', async () => {
    const root = await generateSigningMaterial();
    const firstKey = await generateSigningMaterial();
    const secondKey = await generateSigningMaterial();

    const snapshot = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 4,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'duplicate-key',
            publicKey: firstKey.publicKey,
          }),
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'duplicate-key',
            publicKey: secondKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-10T00:00:00.000Z',
    });

    await expect(createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot,
    })).rejects.toThrow(/duplicate_key_id/);
  });

  it('rejects malformed timestamps in snapshot metadata', async () => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();

    const signedSnapshot = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 5,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'demo-key',
            publicKey: publisherKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-10T00:00:00.000Z',
    });
    const malformedSnapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot = {
      ...signedSnapshot,
      rootSignature: {
        ...signedSnapshot.rootSignature,
        signedAt: 'not-an-iso-timestamp',
      },
    };

    await expect(createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot: malformedSnapshot,
    })).rejects.toThrow(/malformed_timestamp/);
  });

  it('rejects invalid key windows in snapshot payload', async () => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();

    const snapshot = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 6,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'window-key',
            publicKey: publisherKey.publicKey,
            notBefore: '2026-08-01T00:00:00.000Z',
            revokedAt: '2026-07-01T00:00:00.000Z',
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-10T00:00:00.000Z',
    });

    await expect(createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot,
    })).rejects.toThrow(/invalid_key_window/);
  });

  it('persists the accepted floor and rejects stale cold starts', async () => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();
    const persistence = makeMutableSnapshotFloorPersistence();

    const snapshot = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 50,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'floor-key',
            publicKey: publisherKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-20T00:00:00.000Z',
    });

    await createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      persistence: persistence.persistence,
      snapshot,
      now: trustNow,
    });

    expect(persistence.saves).toHaveLength(1);
    expect(persistence.saves[0]).toMatchObject({
      minimumAcceptedSnapshotVersion: 50,
      snapshotId: 'publisher-trust-50',
      rootKeyId: 'root-a',
    });

    const staleSnapshot = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 49,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'floor-key',
            publicKey: publisherKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-21T00:00:00.000Z',
    });

    await expect(createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      persistence: persistence.persistence,
      snapshot: staleSnapshot,
      now: trustNow,
    })).rejects.toThrow(/snapshot_rollback/);
  });

  it.each([
    ['rejects expired snapshots at cold start', { expiresAt: '2026-07-25T00:00:00.000Z' }, /expired/],
    ['rejects future-dated snapshots at cold start', { signedAt: '2026-07-30T00:00:00.000Z' }, /future_dated/],
    ['rejects invalid snapshot signing windows at cold start', { createdAt: '2026-07-22T00:00:00.000Z', signedAt: '2026-07-21T00:00:00.000Z' }, /snapshot_window_invalid/],
  ])('%s', async (_label, overrides, expectedError) => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();

    const snapshot = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 51,
        createdAt: 'createdAt' in overrides ? overrides.createdAt : '2026-07-01T00:00:00.000Z',
        expiresAt: 'expiresAt' in overrides ? overrides.expiresAt : '2026-08-31T00:00:00.000Z',
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'window-key',
            publicKey: publisherKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: 'signedAt' in overrides ? overrides.signedAt : '2026-07-20T00:00:00.000Z',
    });

    await expect(createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot,
      now: trustNow,
    })).rejects.toThrow(expectedError);
  });

  it('rejects persistence failures without advancing the live snapshot', async () => {
    const root = await generateSigningMaterial();
    const firstKey = await generateSigningMaterial();
    const secondKey = await generateSigningMaterial();
    const persistence = makeMutableSnapshotFloorPersistence();

    const store = await createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      persistence: persistence.persistence,
      snapshot: await makeSignedSnapshot({
        payload: makeSnapshotPayload({
          snapshotVersion: 60,
          publisherKeys: [
            makePublisherKey({
              publisherId: 'demo.publisher',
              rootKeyId: 'root-a',
              keyId: 'refresh-key',
              publicKey: firstKey.publicKey,
            }),
          ],
        }),
        rootKeyId: 'root-a',
        rootMaterial: root,
        signedAt: '2026-07-20T00:00:00.000Z',
      }),
      now: trustNow,
    });

    persistence.failSaveWith('disk full');
    const refresh = await store.refreshSnapshot(await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 61,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'refresh-key',
            publicKey: secondKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-21T00:00:00.000Z',
    }));

    expect(refresh).toMatchObject({
      status: 'rejected',
      reason: 'persistence_failure',
      snapshotVersion: 61,
    });
    expect(store.snapshot.snapshotVersion).toBe(60);
    expect(persistence.floor?.minimumAcceptedSnapshotVersion).toBe(60);
  });

  it('does not persist tampered snapshots before verification', async () => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();
    const persistence = makeMutableSnapshotFloorPersistence();

    const signed = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 70,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'tamper-key',
            publicKey: publisherKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-20T00:00:00.000Z',
    });

    const tamperedSnapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot = {
      ...signed,
      publisherKeys: [
        {
          ...signed.publisherKeys[0],
          publicKey: `${signed.publisherKeys[0].publicKey}-tampered`,
        },
      ],
    };

    await expect(createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      persistence: persistence.persistence,
      snapshot: tamperedSnapshot,
      now: trustNow,
    })).rejects.toThrow(/bad_snapshot_signature/);

    expect(persistence.saves).toHaveLength(0);
    expect(persistence.floor).toBeNull();
  });

  it('rejects stale and equal snapshot refreshes', async () => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();

    const store = await createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot: await makeSignedSnapshot({
        payload: makeSnapshotPayload({
          snapshotVersion: 10,
          publisherKeys: [
            makePublisherKey({
              publisherId: 'demo.publisher',
              rootKeyId: 'root-a',
              keyId: 'demo-key',
              publicKey: publisherKey.publicKey,
            }),
          ],
        }),
        rootKeyId: 'root-a',
        rootMaterial: root,
        signedAt: '2026-07-10T00:00:00.000Z',
      }),
    });

    const equal = await store.refreshSnapshot(await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 10,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'demo-key',
            publicKey: publisherKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-11T00:00:00.000Z',
    }));
    expect(equal).toMatchObject({
      status: 'rejected',
      reason: 'snapshot_rollback',
      snapshotVersion: 10,
    });

    const stale = await store.refreshSnapshot(await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 9,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'demo-key',
            publicKey: publisherKey.publicKey,
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-12T00:00:00.000Z',
    }));
    expect(stale).toMatchObject({
      status: 'rejected',
      reason: 'snapshot_rollback',
      snapshotVersion: 9,
    });
  });

  it('rejects revoked publisher keys', async () => {
    const root = await generateSigningMaterial();
    const revokedKey = await generateSigningMaterial();

    const store = await createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot: await makeSignedSnapshot({
        payload: makeSnapshotPayload({
          snapshotVersion: 20,
          publisherKeys: [
            makePublisherKey({
              publisherId: 'demo.publisher',
              rootKeyId: 'root-a',
              keyId: 'revoked-key',
              publicKey: revokedKey.publicKey,
              status: 'revoked',
              revokedAt: '2026-07-16T00:00:00.000Z',
            }),
          ],
        }),
        rootKeyId: 'root-a',
        rootMaterial: root,
        signedAt: '2026-07-10T00:00:00.000Z',
      }),
    });

    const decision = store.resolvePackageSignatureDecision({
      publisher: { id: 'demo.publisher' },
      signature: await makeRegistrySignature({
        keyId: 'revoked-key',
        packageValue: packageFixture,
        keyPair: revokedKey.pair,
        signedAt: '2026-07-15T00:00:00.000Z',
      }),
    });

    expect(decision).toMatchObject({
      status: 'rejected',
      reason: 'revoked',
      keyId: 'revoked-key',
    });
  });

  it('rejects signatures outside the trusted key window', async () => {
    const root = await generateSigningMaterial();
    const activeKey = await generateSigningMaterial();

    const store = await createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot: await makeSignedSnapshot({
        payload: makeSnapshotPayload({
          snapshotVersion: 21,
          publisherKeys: [
            makePublisherKey({
              publisherId: 'demo.publisher',
              rootKeyId: 'root-a',
              keyId: 'window-key',
              publicKey: activeKey.publicKey,
              notBefore: '2026-07-20T00:00:00.000Z',
              revokedAt: '2026-08-01T00:00:00.000Z',
            }),
          ],
        }),
        rootKeyId: 'root-a',
        rootMaterial: root,
        signedAt: '2026-07-10T00:00:00.000Z',
      }),
    });

    const decision = store.resolvePackageSignatureDecision({
      publisher: { id: 'demo.publisher' },
      signature: await makeRegistrySignature({
        keyId: 'window-key',
        packageValue: packageFixture,
        keyPair: activeKey.pair,
        signedAt: '2026-07-15T00:00:00.000Z',
      }),
    });

    expect(decision).toMatchObject({
      status: 'rejected',
      reason: 'expired',
      keyId: 'window-key',
    });
  });

  it('rejects snapshots with algorithm mismatches', async () => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();

    const snapshot = await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 22,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'bad-algorithm-key',
            publicKey: publisherKey.publicKey,
            algorithm: 'ed25519',
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-10T00:00:00.000Z',
    });

    await expect(createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot,
    })).rejects.toThrow(/algorithm_mismatch/);
  });

  it('accepts a valid pinned-root signed rotation', async () => {
    const root = await generateSigningMaterial();
    const firstKey = await generateSigningMaterial();
    const secondKey = await generateSigningMaterial();

    const store = await createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot: await makeSignedSnapshot({
        payload: makeSnapshotPayload({
          snapshotVersion: 30,
          publisherKeys: [
            makePublisherKey({
              publisherId: 'demo.publisher',
              rootKeyId: 'root-a',
              keyId: 'rotation-key-a',
              publicKey: firstKey.publicKey,
              notBefore: '2026-07-01T00:00:00.000Z',
              revokedAt: '2026-08-01T00:00:00.000Z',
            }),
            makePublisherKey({
              publisherId: 'demo.publisher',
              rootKeyId: 'root-a',
              keyId: 'rotation-key-b',
              publicKey: secondKey.publicKey,
              notBefore: '2026-07-20T00:00:00.000Z',
              revokedAt: '2026-09-01T00:00:00.000Z',
            }),
          ],
        }),
        rootKeyId: 'root-a',
        rootMaterial: root,
        signedAt: '2026-07-20T00:00:00.000Z',
      }),
    });

    const refresh = await store.refreshSnapshot(await makeSignedSnapshot({
      payload: makeSnapshotPayload({
        snapshotVersion: 31,
        publisherKeys: [
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'rotation-key-a',
            publicKey: firstKey.publicKey,
            notBefore: '2026-07-01T00:00:00.000Z',
            revokedAt: '2026-08-01T00:00:00.000Z',
          }),
          makePublisherKey({
            publisherId: 'demo.publisher',
            rootKeyId: 'root-a',
            keyId: 'rotation-key-b',
            publicKey: secondKey.publicKey,
            notBefore: '2026-07-20T00:00:00.000Z',
            revokedAt: '2026-09-01T00:00:00.000Z',
          }),
        ],
      }),
      rootKeyId: 'root-a',
      rootMaterial: root,
      signedAt: '2026-07-21T00:00:00.000Z',
    }));

    expect(refresh).toMatchObject({
      status: 'accepted',
      rootKeyId: 'root-a',
      snapshotVersion: 31,
    });

    expect(store.resolvePackageSignatureDecision({
      publisher: { id: 'demo.publisher' },
      signature: await makeRegistrySignature({
        keyId: 'rotation-key-b',
        packageValue: packageFixture,
        keyPair: secondKey.pair,
        signedAt: '2026-07-25T00:00:00.000Z',
      }),
    })).toMatchObject({
      status: 'trusted',
      reason: 'trusted',
      keyId: 'rotation-key-b',
    });
  });

  it('verifies package artifact signatures with the authenticated snapshot key', async () => {
    const root = await generateSigningMaterial();
    const publisherKey = await generateSigningMaterial();

    const store = await createPublisherTrustStore({
      pinnedRoots: [makePinnedRoot({
        rootKeyId: 'root-a',
        publicKey: root.publicKey,
      })],
      snapshot: await makeSignedSnapshot({
        payload: makeSnapshotPayload({
          snapshotVersion: 40,
          publisherKeys: [
            makePublisherKey({
              publisherId: 'demo.publisher',
              rootKeyId: 'root-a',
              keyId: 'artifact-key',
              publicKey: publisherKey.publicKey,
              notBefore: '2026-07-01T00:00:00.000Z',
              revokedAt: '2026-08-01T00:00:00.000Z',
            }),
          ],
        }),
        rootKeyId: 'root-a',
        rootMaterial: root,
        signedAt: '2026-07-20T00:00:00.000Z',
      }),
    });

    const preview = await buildPackageInstallPreviewWithSignatureVerification(packageFixture, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
      expectedChecksum: sha256Canonical(packageFixture),
      registryPackage: {
        id: 'demo.shelf',
        name: 'Demo Shelf',
        version: '1.0.0',
        url: 'https://example.com/apps/demo.package.json',
        checksum: sha256Canonical(packageFixture),
        publisher: {
          id: 'demo.publisher',
          name: 'Demo',
        },
        signature: await makeRegistrySignature({
          keyId: 'artifact-key',
          packageValue: packageFixture,
          keyPair: publisherKey.pair,
          signedAt: '2026-07-25T00:00:00.000Z',
        }),
      },
      publisherTrustStore: store,
    });

    expect(preview.trust.signatureStatus).toBe('signature_verified');
    expect(preview.trust.signatureKeyId).toBe('artifact-key');
    expect(preview.validationErrors).toEqual([]);
  });
});

function makeMutableSnapshotFloorPersistence(initialFloor: UtopiaPublisherTrustSnapshotFloor | null = null) {
  let floor = initialFloor;
  const saves: UtopiaPublisherTrustSnapshotFloor[] = [];
  let failSaveMessage: string | null = null;

  return {
    persistence: {
      async load() {
        return floor;
      },
      async save(nextFloor: UtopiaPublisherTrustSnapshotFloor) {
        if (failSaveMessage) {
          throw new Error(failSaveMessage);
        }
        floor = nextFloor;
        saves.push(nextFloor);
      },
    },
    get floor() {
      return floor;
    },
    get saves() {
      return saves;
    },
    failSaveWith(message: string | null) {
      failSaveMessage = message;
    },
  };
}

function makeSnapshotPayload(input: {
  snapshotVersion: number;
  publisherKeys: readonly UtopiaPublisherTrustKey[];
  snapshotId?: string;
  createdAt?: string;
  expiresAt?: string;
  minimumAlgorithm?: typeof UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM;
}): UtopiaPinnedRootSignedPublisherTrustSnapshotPayload {
  return {
    schemaVersion: UTOPIA_PUBLISHER_TRUST_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: input.snapshotId ?? `publisher-trust-${input.snapshotVersion}`,
    snapshotVersion: input.snapshotVersion,
    createdAt: input.createdAt ?? '2026-07-01T00:00:00.000Z',
    expiresAt: input.expiresAt ?? '2026-08-31T00:00:00.000Z',
    minimumAlgorithm: input.minimumAlgorithm ?? UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM,
    publisherKeys: input.publisherKeys,
  };
}

async function makeSignedSnapshot(input: {
  payload: UtopiaPinnedRootSignedPublisherTrustSnapshotPayload;
  rootMaterial: SigningMaterial;
  rootKeyId: string;
  signedAt: string;
  rootSignatureAlgorithm?: string;
}): Promise<UtopiaPinnedRootSignedPublisherTrustSnapshot> {
  const canonicalPayload = canonicalJson(input.payload);
  const signatureBytes = await globalThis.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    input.rootMaterial.pair.privateKey,
    new TextEncoder().encode(canonicalPayload),
  );

  return {
    ...input.payload,
    rootSignature: {
      rootKeyId: input.rootKeyId,
      algorithm: (input.rootSignatureAlgorithm ?? UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM) as typeof UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM,
      signedAt: input.signedAt,
      value: Buffer.from(signatureBytes).toString('base64'),
    },
  };
}

function makePinnedRoot(input: {
  rootKeyId: string;
  publicKey: string;
  status?: 'trusted' | 'revoked';
  notBefore?: string;
  revokedAt?: string;
}): UtopiaPublisherTrustRoot {
  return {
    rootKeyId: input.rootKeyId,
    algorithm: UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM,
    publicKey: input.publicKey,
    status: input.status ?? 'trusted',
    ...(input.notBefore ? { notBefore: input.notBefore } : {}),
    ...(input.revokedAt ? { revokedAt: input.revokedAt } : {}),
  };
}

function makePublisherKey(input: {
  publisherId: string;
  rootKeyId: string;
  keyId: string;
  publicKey: string;
  algorithm?: string;
  status?: 'trusted' | 'revoked';
  notBefore?: string;
  revokedAt?: string;
}): UtopiaPublisherTrustKey {
  return {
    publisherId: input.publisherId,
    rootKeyId: input.rootKeyId,
    keyId: input.keyId,
    algorithm: input.algorithm ?? UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM,
    publicKey: input.publicKey,
    status: input.status ?? 'trusted',
    ...(input.notBefore ? { notBefore: input.notBefore } : {}),
    ...(input.revokedAt ? { revokedAt: input.revokedAt } : {}),
  };
}

async function generateSigningMaterial(): Promise<SigningMaterial> {
  const pair = await globalThis.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify'],
  );
  const exported = await globalThis.crypto.subtle.exportKey('spki', pair.publicKey);
  return {
    pair,
    publicKey: Buffer.from(exported).toString('base64'),
  };
}

async function makeRegistrySignature(input: {
  keyId: string;
  packageValue: unknown;
  keyPair: CryptoKeyPair;
  signedAt: string;
  algorithm?: string;
}): Promise<{ keyId: string; algorithm: string; publicKey: string; value: string; signedAt: string }> {
  const canonicalPayload = canonicalJson(input.packageValue);
  const signature = await globalThis.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    input.keyPair.privateKey,
    new TextEncoder().encode(canonicalPayload),
  );
  const exported = await globalThis.crypto.subtle.exportKey('spki', input.keyPair.publicKey);
  return {
    algorithm: input.algorithm ?? UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM,
    keyId: input.keyId,
    publicKey: Buffer.from(exported).toString('base64'),
    value: Buffer.from(signature).toString('base64'),
    signedAt: input.signedAt,
  };
}

type SigningMaterial = Readonly<{
  pair: CryptoKeyPair;
  publicKey: string;
}>;
