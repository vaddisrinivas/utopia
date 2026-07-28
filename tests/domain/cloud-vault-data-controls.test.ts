import { describe, expect, it } from 'vitest';

import {
  createCloudVaultKeyRing,
  createCloudVaultService,
  validateCloudVaultPresignedRequest,
} from '@/src/domain/cloud-vault';
import { LocalFakeBlobStore } from '@/src/domain/cloud-vault-storage';

describe('cloud vault data controls', () => {
  it('constrains presigned requests to bounded ttl and allowed headers', () => {
    expect(() => validateCloudVaultPresignedRequest({
      schemaVersion: 'wonder.cloud-vault-presigned-request.v1',
      requestId: 'req-1',
      purpose: 'upload_ciphertext',
      method: 'PUT',
      key: 'vault/demo/object.bin',
      contentType: 'application/octet-stream',
      requiredHeaders: [{ name: 'x-extra-header', value: 'nope' }],
      maxBytes: 64,
      contentSha256: `sha256:${'a'.repeat(64)}`,
      issuedAt: '2026-07-28T00:00:00.000Z',
      expiresAt: '2026-07-28T00:20:00.000Z',
    })).toThrow('cloud_vault_presign_ttl_invalid');

    expect(() => validateCloudVaultPresignedRequest({
      schemaVersion: 'wonder.cloud-vault-presigned-request.v1',
      requestId: 'req-2',
      purpose: 'upload_ciphertext',
      method: 'PUT',
      key: 'vault/demo/object.bin',
      contentType: 'application/octet-stream',
      requiredHeaders: [{ name: 'x-extra-header', value: 'nope' }],
      maxBytes: 64,
      contentSha256: `sha256:${'a'.repeat(64)}`,
      issuedAt: '2026-07-28T00:00:00.000Z',
      expiresAt: '2026-07-28T00:05:00.000Z',
    })).toThrow('cloud_vault_presign_header_invalid');
  });

  it('blocks export and delete when controls disable them', async () => {
    const service = createCloudVaultService({
      store: new LocalFakeBlobStore(),
      keyRing: createCloudVaultKeyRing({
        createdAt: '2026-07-28T00:00:00.000Z',
        keyMaterial: bytes(5),
      }),
      randomBytes: bytes,
      now: () => '2026-07-28T00:00:00.000Z',
    });

    const published = await service.publish({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      plaintext: 'secret payload',
      controls: {
        exportable: false,
        deletable: false,
        maxPresignTtlSeconds: 90,
      },
      now: '2026-07-28T00:00:00.000Z',
    });
    expect(published.status).toBe('published');

    const exported = await service.exportArtifact({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      now: '2026-07-28T00:00:01.000Z',
    });
    expect(exported.status).toBe('rejected');
    expect(exported.reason).toBe('cloud_vault_export_disabled');

    const deleted = await service.deleteArtifact({
      workspaceId: 'ws-alpha',
      artifactId: 'artifact-a',
      now: '2026-07-28T00:00:02.000Z',
    });
    expect(deleted.status).toBe('rejected');
    expect(deleted.reason).toBe('cloud_vault_delete_disabled');
  });
});

function bytes(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => (index + 73) % 256);
}
