import { describe, expect, it } from 'vitest';

import { createCloudVaultKeyRing, createCloudVaultService } from '@/src/domain/cloud-vault';
import { LocalFakeBlobStore } from '@/src/domain/cloud-vault-storage';

describe('cloud vault lifecycle', () => {
  it('rejects rollback publication and returns delete receipts', async () => {
    const service = createService();

    const published = await service.publish({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      plaintext: 'v1',
      now: '2026-07-28T00:00:00.000Z',
    });
    expect(published.status).toBe('published');
    expect(published.revision).toBe(1);

    const rollback = await service.publish({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      plaintext: 'older',
      proposedRevision: 1,
      now: '2026-07-28T00:00:01.000Z',
    });
    expect(rollback.status).toBe('rejected');
    expect(rollback.reason).toBe('cloud_vault_rollback_rejected');

    const deleted = await service.deleteArtifact({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      now: '2026-07-28T00:00:02.000Z',
    });
    expect(deleted.status).toBe('deleted');
    expect(deleted.revision).toBe(2);

    const exported = await service.exportArtifact({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      now: '2026-07-28T00:00:03.000Z',
    });
    expect(exported.status).toBe('rejected');
    expect(exported.reason).toBe('cloud_vault_deleted');
  });

  it('rotates keys, blocks revoked exports, then rewraps cleanly', async () => {
    const service = createService();

    const published = await service.publish({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      plaintext: 'secret payload',
      now: '2026-07-28T00:00:00.000Z',
    });
    expect(published.keyId).toBe('kek-1');

    const rotated = await service.rotateWrappingKey({
      newKeyId: 'kek-2',
      material: bytes(33),
      now: '2026-07-28T00:00:01.000Z',
    });
    expect(rotated.activeKeyId).toBe('kek-2');

    const revoke = await service.revokeWrappingKey({
      keyId: 'kek-1',
      now: '2026-07-28T00:00:02.000Z',
    });
    expect(revoke.status).toBe('revoked');

    const blocked = await service.exportArtifact({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      now: '2026-07-28T00:00:03.000Z',
    });
    expect(blocked.status).toBe('rejected');
    expect(blocked.reason).toBe('cloud_vault_wrapping_key_revoked');

    const rewrap = await service.rewrapArtifact({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      now: '2026-07-28T00:00:04.000Z',
    });
    expect(rewrap.status).toBe('rewrapped');
    expect(rewrap.keyId).toBe('kek-2');
    expect(rewrap.rewrapGeneration).toBe(1);

    const exported = await service.exportArtifact({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      ttlSeconds: 120,
      now: '2026-07-28T00:00:05.000Z',
    });
    expect(exported.status).toBe('exported');
    expect(exported.ciphertextRequest?.expiresAt).toBe('2026-07-28T00:02:05.000Z');
  });
});

function createService() {
  return createCloudVaultService({
    store: new LocalFakeBlobStore(),
    keyRing: createCloudVaultKeyRing({
      activeKeyId: 'kek-1',
      createdAt: '2026-07-28T00:00:00.000Z',
      keyMaterial: bytes(1),
    }),
    randomBytes: bytes,
    now: () => '2026-07-28T00:00:00.000Z',
  });
}

function bytes(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => (index + 41) % 256);
}
