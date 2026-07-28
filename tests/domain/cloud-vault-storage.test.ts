import { describe, expect, it } from 'vitest';

import { createCloudVaultKeyRing, createCloudVaultService } from '@/src/domain/cloud-vault';
import { LocalFakeBlobStore } from '@/src/domain/cloud-vault-storage';

describe('cloud vault storage publication', () => {
  it('publishes through an atomic pointer and keeps keys opaque', async () => {
    const store = new LocalFakeBlobStore();
    const service = createCloudVaultService({
      store,
      keyRing: createCloudVaultKeyRing({
        createdAt: '2026-07-28T00:00:00.000Z',
        keyMaterial: bytes(1),
      }),
      randomBytes: bytes,
      now: () => '2026-07-28T00:00:00.000Z',
    });

    const receipt = await service.publish({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      plaintext: 'secret payload',
    });

    expect(receipt.status).toBe('published');
    expect(receipt.pointerKey).toContain('/pointers/');
    expect(receipt.pointerKey).not.toContain('ws-alpha');
    expect(receipt.pointerKey).not.toContain('artifact-a');
    expect(receipt.ciphertextKey).not.toContain('secret payload');
    expect(store.keys().some((key) => key.includes('/staging/'))).toBe(false);
  });

  it('survives outage-style partial writes and cleans orphan blobs', async () => {
    const store = new LocalFakeBlobStore({ fault: 'put_after_write' });
    const service = createCloudVaultService({
      store,
      keyRing: createCloudVaultKeyRing({
        createdAt: '2026-07-28T00:00:00.000Z',
        keyMaterial: bytes(2),
      }),
      randomBytes: bytes,
      now: () => '2026-07-28T00:00:00.000Z',
    });

    const failed = await service.publish({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      plaintext: 'secret payload',
    });

    expect(failed.status).toBe('failed');
    expect(failed.reason).toBe('cloud_vault_storage_unavailable');
    expect(failed.orphanedKeys.length).toBeGreaterThan(0);

    store.setFault('none');
    const cleanup = await service.cleanupOrphans({
      workspaceId: 'ws-alpha',
      now: '2026-07-28T00:00:01.000Z',
    });
    expect(cleanup.deletedKeys).toEqual(failed.orphanedKeys);
  });

  it('fails closed on quota pressure', async () => {
    const store = new LocalFakeBlobStore({ quotaBytes: 24 });
    const service = createCloudVaultService({
      store,
      keyRing: createCloudVaultKeyRing({
        createdAt: '2026-07-28T00:00:00.000Z',
        keyMaterial: bytes(3),
      }),
      randomBytes: bytes,
      now: () => '2026-07-28T00:00:00.000Z',
    });

    const receipt = await service.publish({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      plaintext: 'secret payload that will not fit',
    });

    expect(receipt.status).toBe('failed');
    expect(receipt.reason).toBe('cloud_vault_quota_exceeded');
  });
});

function bytes(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => (index + 17) % 256);
}
