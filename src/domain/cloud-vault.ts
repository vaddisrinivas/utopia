import { canonicalJson } from '@/src/domain/canonical-json';
import { defaultCoreCryptoPort } from '../../adapters/core-crypto';
import {
  LocalFakeBlobStore,
  type BlobObjectRecord,
  type BlobStore,
} from '@/src/domain/cloud-vault-storage';

const DATA_CIPHER_ALGORITHM = 'aes-256-gcm';
const WRAP_CIPHER_ALGORITHM = 'aes-256-gcm';
const DEK_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MAX_PRESIGN_TTL_SECONDS = 900;
const ALLOWED_PRESIGN_HEADERS = new Set(['content-type', 'x-utopia-content-sha256', 'x-utopia-artifact-revision']);

export type CloudVaultWrappingKey = Readonly<{
  keyId: string;
  createdAt: string;
  status: 'active' | 'retired' | 'revoked';
  material: string;
  revokedAt?: string;
  revokeReason?: string;
}>;

export type CloudVaultKeyRing = Readonly<{
  schemaVersion: 'wonder.cloud-vault-keyring.v1';
  activeKeyId: string;
  keys: Record<string, CloudVaultWrappingKey>;
}>;

export type CloudVaultDataControls = Readonly<{
  exportable: boolean;
  deletable: boolean;
  maxPresignTtlSeconds: number;
}>;

export type CloudVaultWrappedKey = Readonly<{
  algorithm: typeof WRAP_CIPHER_ALGORITHM;
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}>;

export type CloudVaultArtifactMetadata = Readonly<{
  schemaVersion: 'wonder.cloud-vault-metadata.v1';
  artifactId: string;
  workspaceId: string;
  revision: number;
  lifecycle: 'active' | 'deleted';
  publishedAt: string;
  plaintextSha256: string;
  plaintextBytes: number;
  ciphertextSha256: string;
  ciphertextBytes: number;
  ciphertextKey: string | null;
  contentType: string;
  dataIv: string;
  dataAuthTag: string;
  wrappedDek: CloudVaultWrappedKey;
  controls: CloudVaultDataControls;
  rewrapGeneration: number;
  deletedAt?: string;
  deleteReason?: string;
}>;

export type CloudVaultPointer = Readonly<{
  schemaVersion: 'wonder.cloud-vault-pointer.v1';
  artifactId: string;
  workspaceId: string;
  revision: number;
  metadataKey: string;
  receiptId: string;
  updatedAt: string;
}>;

export type CloudVaultReceiptBase = Readonly<{
  schemaVersion: 'wonder.cloud-vault-receipt.v1';
  receiptId: string;
  artifactId: string;
  workspaceId: string;
  keyId: string;
  happenedAt: string;
}>;

export type CloudVaultPublishReceipt = CloudVaultReceiptBase & Readonly<{
  action: 'publish';
  status: 'published' | 'rejected' | 'failed';
  revision: number;
  reason?: string;
  pointerKey: string;
  metadataKey: string | null;
  ciphertextKey: string | null;
  stagingKey: string | null;
  orphanedKeys: readonly string[];
  quotaBytesUsed: number;
}>;

export type CloudVaultRotateReceipt = Readonly<{
  schemaVersion: 'wonder.cloud-vault-rotation-receipt.v1';
  action: 'rotate';
  keyId: string;
  previousActiveKeyId: string;
  activeKeyId: string;
  happenedAt: string;
}>;

export type CloudVaultRevokeReceipt = Readonly<{
  schemaVersion: 'wonder.cloud-vault-revoke-receipt.v1';
  action: 'revoke';
  keyId: string;
  status: 'revoked' | 'rejected';
  happenedAt: string;
  reason?: string;
}>;

export type CloudVaultRewrapReceipt = CloudVaultReceiptBase & Readonly<{
  action: 'rewrap';
  status: 'rewrapped' | 'rejected' | 'failed';
  revision: number;
  rewrapGeneration: number;
  previousKeyId: string | null;
  metadataKey: string | null;
  reason?: string;
}>;

export type CloudVaultDeleteReceipt = CloudVaultReceiptBase & Readonly<{
  action: 'delete';
  status: 'deleted' | 'rejected' | 'failed';
  revision: number;
  metadataKey: string | null;
  deletedCiphertextKey: string | null;
  reason?: string;
}>;

export type CloudVaultPresignedRequest = Readonly<{
  schemaVersion: 'wonder.cloud-vault-presigned-request.v1';
  requestId: string;
  purpose: 'download_ciphertext' | 'download_metadata' | 'upload_ciphertext';
  method: 'GET' | 'PUT';
  key: string;
  contentType: 'application/octet-stream' | 'application/json';
  requiredHeaders: readonly Readonly<{ name: string; value: string }>[];
  maxBytes: number;
  contentSha256?: string;
  issuedAt: string;
  expiresAt: string;
}>;

export type CloudVaultExportReceipt = CloudVaultReceiptBase & Readonly<{
  action: 'export';
  status: 'exported' | 'rejected';
  revision: number;
  metadata: CloudVaultArtifactMetadata | null;
  ciphertextRequest: CloudVaultPresignedRequest | null;
  metadataRequest: CloudVaultPresignedRequest | null;
  reason?: string;
}>;

export type CloudVaultCleanupReceipt = Readonly<{
  schemaVersion: 'wonder.cloud-vault-cleanup-receipt.v1';
  action: 'cleanup_orphans';
  workspaceId: string;
  happenedAt: string;
  deletedKeys: readonly string[];
}>;

export type PublishCloudVaultArtifactInput = Readonly<{
  workspaceId: string;
  artifactId: string;
  plaintext: Uint8Array | string;
  contentType?: string;
  proposedRevision?: number;
  expectedCurrentRevision?: number | null;
  controls?: Partial<CloudVaultDataControls>;
  now?: string;
}>;

export function createCloudVaultKeyRing(input?: {
  activeKeyId?: string;
  createdAt?: string;
  keyMaterial?: Uint8Array;
}): CloudVaultKeyRing {
  const createdAt = normalizeIsoTimestamp(input?.createdAt ?? new Date().toISOString(), 'cloud_vault_key_created_at_invalid');
  const keyId = requireIdentifier(input?.activeKeyId ?? 'kek-1', 'cloud_vault_key_id_required');
  const materialBytes = normalizeAesKeyMaterial(input?.keyMaterial ?? secureRandomBytes(DEK_BYTES));
  return {
    schemaVersion: 'wonder.cloud-vault-keyring.v1',
    activeKeyId: keyId,
    keys: {
      [keyId]: {
        keyId,
        createdAt,
        status: 'active',
        material: toBase64(materialBytes),
      },
    },
  };
}

export function createCloudVaultService(input?: {
  store?: BlobStore;
  keyRing?: CloudVaultKeyRing;
  randomBytes?: (size: number) => Uint8Array;
  now?: () => string;
}): CloudVaultService {
  return new CloudVaultService({
    store: input?.store ?? new LocalFakeBlobStore(),
    keyRing: input?.keyRing ?? createCloudVaultKeyRing(),
    randomBytes: input?.randomBytes,
    now: input?.now,
  });
}

export function validateCloudVaultPresignedRequest(
  input: CloudVaultPresignedRequest,
  now?: string,
): CloudVaultPresignedRequest {
  if (input.schemaVersion !== 'wonder.cloud-vault-presigned-request.v1') throw new Error('cloud_vault_presign_schema_invalid');
  if (input.method !== 'GET' && input.method !== 'PUT') throw new Error('cloud_vault_presign_method_invalid');
  if (
    input.purpose !== 'download_ciphertext' &&
    input.purpose !== 'download_metadata' &&
    input.purpose !== 'upload_ciphertext'
  ) {
    throw new Error('cloud_vault_presign_purpose_invalid');
  }
  requireBlobKey(input.key, 'cloud_vault_presign_key_invalid');
  const issuedAt = normalizeIsoTimestamp(input.issuedAt, 'cloud_vault_presign_issued_at_invalid');
  const expiresAt = normalizeIsoTimestamp(input.expiresAt, 'cloud_vault_presign_expires_at_invalid');
  const ttlSeconds = Math.floor((Date.parse(expiresAt) - Date.parse(issuedAt)) / 1000);
  if (ttlSeconds <= 0 || ttlSeconds > MAX_PRESIGN_TTL_SECONDS) throw new Error('cloud_vault_presign_ttl_invalid');
  if (now && Date.parse(expiresAt) <= Date.parse(normalizeIsoTimestamp(now, 'cloud_vault_presign_now_invalid'))) {
    throw new Error('cloud_vault_presign_expired');
  }
  if (input.contentType !== 'application/octet-stream' && input.contentType !== 'application/json') {
    throw new Error('cloud_vault_presign_content_type_invalid');
  }
  if (!Number.isInteger(input.maxBytes) || input.maxBytes <= 0) throw new Error('cloud_vault_presign_max_bytes_invalid');
  if (!Array.isArray(input.requiredHeaders)) throw new Error('cloud_vault_presign_headers_invalid');
  for (const header of input.requiredHeaders) {
    if (!ALLOWED_PRESIGN_HEADERS.has(header.name.toLowerCase())) throw new Error('cloud_vault_presign_header_invalid');
    if (!header.value.trim()) throw new Error('cloud_vault_presign_header_invalid');
  }
  if (input.method === 'PUT') {
    if (input.purpose !== 'upload_ciphertext') throw new Error('cloud_vault_presign_method_purpose_invalid');
    if (!isSha256(input.contentSha256)) throw new Error('cloud_vault_presign_checksum_invalid');
  }
  if (input.method === 'GET' && input.contentSha256 !== undefined) throw new Error('cloud_vault_presign_checksum_unexpected');
  return {
    ...input,
    issuedAt,
    expiresAt,
  };
}

export class CloudVaultService {
  private readonly store: BlobStore;
  private keyRing: CloudVaultKeyRing;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly now: () => string;

  constructor(input: {
    store: BlobStore;
    keyRing: CloudVaultKeyRing;
    randomBytes?: (size: number) => Uint8Array;
    now?: () => string;
  }) {
    this.store = input.store;
    this.keyRing = cloneKeyRing(input.keyRing);
    this.randomBytes = input.randomBytes ?? secureRandomBytes;
    this.now = input.now ?? (() => new Date().toISOString());
  }

  getKeyRing(): CloudVaultKeyRing {
    return cloneKeyRing(this.keyRing);
  }

  async publish(input: PublishCloudVaultArtifactInput): Promise<CloudVaultPublishReceipt> {
    const workspaceId = requireIdentifier(input.workspaceId, 'cloud_vault_workspace_required');
    const artifactId = requireIdentifier(input.artifactId, 'cloud_vault_artifact_required');
    const happenedAt = normalizeIsoTimestamp(input.now ?? this.now(), 'cloud_vault_publish_at_invalid');
    const pointerKey = pointerObjectKey(workspaceId, artifactId);
    const current = await this.loadCurrent(workspaceId, artifactId);
    const currentRevision = current?.metadata.revision ?? null;
    if (input.expectedCurrentRevision !== undefined && input.expectedCurrentRevision !== currentRevision) {
      return this.publishReceipt({
        workspaceId,
        artifactId,
        keyId: this.keyRing.activeKeyId,
        happenedAt,
        status: 'rejected',
        revision: currentRevision ?? 0,
        pointerKey,
        reason: 'cloud_vault_expected_revision_mismatch',
      });
    }
    const proposedRevision = input.proposedRevision ?? (currentRevision ?? 0) + 1;
    if (!Number.isInteger(proposedRevision) || proposedRevision <= 0) throw new Error('cloud_vault_revision_invalid');
    if (currentRevision !== null && proposedRevision <= currentRevision) {
      return this.publishReceipt({
        workspaceId,
        artifactId,
        keyId: this.keyRing.activeKeyId,
        happenedAt,
        status: 'rejected',
        revision: proposedRevision,
        pointerKey,
        reason: 'cloud_vault_rollback_rejected',
      });
    }

    const controls = normalizeControls(input.controls);
    const key = this.requireActiveWrappingKey();
    const plaintext = toBytes(input.plaintext);
    const dek = this.randomBytes(DEK_BYTES);
    const dataIv = this.randomBytes(GCM_IV_BYTES);
    const encrypted = encryptBytes(plaintext, dek, dataIv);
    const wrapped = wrapDek(dek, key, this.randomBytes(GCM_IV_BYTES));
    const scope = opaqueScope(workspaceId, artifactId);
    const stagingKey = stagingObjectKey(scope, proposedRevision, encrypted.ciphertext);
    const ciphertextKey = ciphertextObjectKey(scope, proposedRevision, encrypted.ciphertext);
    const receiptId = opaqueId('receipt', workspaceId, artifactId, proposedRevision, happenedAt);
    const metadataKey = metadataObjectKey(scope, proposedRevision, receiptId);
    const metadata: CloudVaultArtifactMetadata = {
      schemaVersion: 'wonder.cloud-vault-metadata.v1',
      artifactId,
      workspaceId,
      revision: proposedRevision,
      lifecycle: 'active',
      publishedAt: happenedAt,
      plaintextSha256: sha256Bytes(plaintext),
      plaintextBytes: plaintext.byteLength,
      ciphertextSha256: sha256Bytes(encrypted.ciphertext),
      ciphertextBytes: encrypted.ciphertext.byteLength,
      ciphertextKey,
      contentType: normalizeContentType(input.contentType ?? 'application/octet-stream'),
      dataIv: toBase64(dataIv),
      dataAuthTag: toBase64(encrypted.authTag),
      wrappedDek: wrapped,
      controls,
      rewrapGeneration: current?.metadata.rewrapGeneration ?? 0,
    };
    const pointer: CloudVaultPointer = {
      schemaVersion: 'wonder.cloud-vault-pointer.v1',
      artifactId,
      workspaceId,
      revision: proposedRevision,
      metadataKey,
      receiptId,
      updatedAt: happenedAt,
    };
    const orphanedKeys: string[] = [];

    try {
      await this.store.putObject({
        key: stagingKey,
        body: encrypted.ciphertext,
        contentType: 'application/octet-stream',
        metadata: { workspaceId: opaqueScope(workspaceId, artifactId), artifactRevision: String(proposedRevision) },
        ifAbsent: true,
        now: happenedAt,
      });
      await this.store.copyObject({
        fromKey: stagingKey,
        toKey: ciphertextKey,
        contentType: 'application/octet-stream',
        metadata: { receiptId, artifactRevision: String(proposedRevision) },
        ifAbsent: true,
        now: happenedAt,
      });
      await this.store.putObject({
        key: metadataKey,
        body: encodeJson(metadata),
        contentType: 'application/json',
        metadata: { receiptId, artifactRevision: String(proposedRevision) },
        ifAbsent: true,
        now: happenedAt,
      });
      await this.store.putObject({
        key: pointerKey,
        body: encodeJson(pointer),
        contentType: 'application/json',
        metadata: { artifactRevision: String(proposedRevision), receiptId },
        now: happenedAt,
      });
      await this.store.deleteObject(stagingKey);
      return this.publishReceipt({
        workspaceId,
        artifactId,
        keyId: key.keyId,
        happenedAt,
        status: 'published',
        revision: proposedRevision,
        pointerKey,
        metadataKey,
        ciphertextKey,
        stagingKey,
        orphanedKeys,
      });
    } catch (error) {
      orphanedKeys.push(...await this.detectOrphanCandidates([stagingKey, ciphertextKey, metadataKey], pointerKey));
      return this.publishReceipt({
        workspaceId,
        artifactId,
        keyId: key.keyId,
        happenedAt,
        status: 'failed',
        revision: proposedRevision,
        pointerKey,
        metadataKey,
        ciphertextKey,
        stagingKey,
        orphanedKeys,
        reason: normalizeStorageError(error),
      });
    }
  }

  async exportArtifact(input: {
    workspaceId: string;
    artifactId: string;
    ttlSeconds?: number;
    now?: string;
  }): Promise<CloudVaultExportReceipt> {
    const workspaceId = requireIdentifier(input.workspaceId, 'cloud_vault_workspace_required');
    const artifactId = requireIdentifier(input.artifactId, 'cloud_vault_artifact_required');
    const happenedAt = normalizeIsoTimestamp(input.now ?? this.now(), 'cloud_vault_export_at_invalid');
    const current = await this.loadCurrent(workspaceId, artifactId);
    if (!current) {
      return this.exportReceipt({ workspaceId, artifactId, happenedAt, status: 'rejected', reason: 'cloud_vault_not_found' });
    }
    const metadata = current.metadata;
    if (metadata.lifecycle === 'deleted') {
      return this.exportReceipt({ workspaceId, artifactId, happenedAt, status: 'rejected', revision: metadata.revision, keyId: metadata.wrappedDek.keyId, reason: 'cloud_vault_deleted' });
    }
    if (!metadata.controls.exportable) {
      return this.exportReceipt({ workspaceId, artifactId, happenedAt, status: 'rejected', revision: metadata.revision, keyId: metadata.wrappedDek.keyId, reason: 'cloud_vault_export_disabled' });
    }
    const wrappingKey = this.keyRing.keys[metadata.wrappedDek.keyId];
    if (!wrappingKey || wrappingKey.status === 'revoked') {
      return this.exportReceipt({ workspaceId, artifactId, happenedAt, status: 'rejected', revision: metadata.revision, keyId: metadata.wrappedDek.keyId, reason: 'cloud_vault_wrapping_key_revoked' });
    }
    const ttlSeconds = clampTtl(input.ttlSeconds ?? metadata.controls.maxPresignTtlSeconds);
    const ciphertextRequest = validateCloudVaultPresignedRequest({
      schemaVersion: 'wonder.cloud-vault-presigned-request.v1',
      requestId: opaqueId('presign', workspaceId, artifactId, 'ciphertext', happenedAt),
      purpose: 'download_ciphertext',
      method: 'GET',
      key: metadata.ciphertextKey ?? '',
      contentType: 'application/octet-stream',
      requiredHeaders: [{ name: 'content-type', value: 'application/octet-stream' }],
      maxBytes: metadata.ciphertextBytes,
      issuedAt: happenedAt,
      expiresAt: new Date(Date.parse(happenedAt) + ttlSeconds * 1000).toISOString(),
    }, happenedAt);
    const metadataRequest = validateCloudVaultPresignedRequest({
      schemaVersion: 'wonder.cloud-vault-presigned-request.v1',
      requestId: opaqueId('presign', workspaceId, artifactId, 'metadata', happenedAt),
      purpose: 'download_metadata',
      method: 'GET',
      key: current.pointer.metadataKey,
      contentType: 'application/json',
      requiredHeaders: [{ name: 'content-type', value: 'application/json' }],
      maxBytes: encodeJson(metadata).byteLength,
      issuedAt: happenedAt,
      expiresAt: new Date(Date.parse(happenedAt) + ttlSeconds * 1000).toISOString(),
    }, happenedAt);
    return this.exportReceipt({
      workspaceId,
      artifactId,
      happenedAt,
      status: 'exported',
      revision: metadata.revision,
      keyId: metadata.wrappedDek.keyId,
      metadata,
      ciphertextRequest,
      metadataRequest,
    });
  }

  async rotateWrappingKey(input?: { newKeyId?: string; now?: string; material?: Uint8Array }): Promise<CloudVaultRotateReceipt> {
    const happenedAt = normalizeIsoTimestamp(input?.now ?? this.now(), 'cloud_vault_rotation_at_invalid');
    const previousActiveKeyId = this.keyRing.activeKeyId;
    const keyId = requireIdentifier(input?.newKeyId ?? `kek-${Object.keys(this.keyRing.keys).length + 1}`, 'cloud_vault_key_id_required');
    const keyMaterial = toBase64(normalizeAesKeyMaterial(input?.material ?? this.randomBytes(DEK_BYTES)));
    const nextKeys: Record<string, CloudVaultWrappingKey> = {};
    for (const [existingKeyId, key] of Object.entries(this.keyRing.keys)) {
      nextKeys[existingKeyId] = {
        ...key,
        status: existingKeyId === previousActiveKeyId && key.status === 'active' ? 'retired' : key.status,
      };
    }
    nextKeys[keyId] = {
      keyId,
      createdAt: happenedAt,
      status: 'active',
      material: keyMaterial,
    };
    this.keyRing = {
      schemaVersion: 'wonder.cloud-vault-keyring.v1',
      activeKeyId: keyId,
      keys: nextKeys,
    };
    return {
      schemaVersion: 'wonder.cloud-vault-rotation-receipt.v1',
      action: 'rotate',
      keyId,
      previousActiveKeyId,
      activeKeyId: keyId,
      happenedAt,
    };
  }

  async revokeWrappingKey(input: { keyId: string; reason?: string; now?: string }): Promise<CloudVaultRevokeReceipt> {
    const keyId = requireIdentifier(input.keyId, 'cloud_vault_key_id_required');
    const happenedAt = normalizeIsoTimestamp(input.now ?? this.now(), 'cloud_vault_revoke_at_invalid');
    const existing = this.keyRing.keys[keyId];
    if (!existing) throw new Error('cloud_vault_key_not_found');
    if (keyId === this.keyRing.activeKeyId) {
      return {
        schemaVersion: 'wonder.cloud-vault-revoke-receipt.v1',
        action: 'revoke',
        keyId,
        status: 'rejected',
        happenedAt,
        reason: 'cloud_vault_active_key_revoke_blocked',
      };
    }
    this.keyRing = {
      ...this.keyRing,
      keys: {
        ...this.keyRing.keys,
        [keyId]: {
          ...existing,
          status: 'revoked',
          revokedAt: happenedAt,
          revokeReason: input.reason?.trim() || 'manual_revoke',
        },
      },
    };
    return {
      schemaVersion: 'wonder.cloud-vault-revoke-receipt.v1',
      action: 'revoke',
      keyId,
      status: 'revoked',
      happenedAt,
    };
  }

  async rewrapArtifact(input: { workspaceId: string; artifactId: string; now?: string }): Promise<CloudVaultRewrapReceipt> {
    const workspaceId = requireIdentifier(input.workspaceId, 'cloud_vault_workspace_required');
    const artifactId = requireIdentifier(input.artifactId, 'cloud_vault_artifact_required');
    const happenedAt = normalizeIsoTimestamp(input.now ?? this.now(), 'cloud_vault_rewrap_at_invalid');
    const current = await this.loadCurrent(workspaceId, artifactId);
    if (!current) {
      return this.rewrapReceipt({ workspaceId, artifactId, happenedAt, keyId: this.keyRing.activeKeyId, status: 'rejected', revision: 0, rewrapGeneration: 0, reason: 'cloud_vault_not_found' });
    }
    const currentMetadata = current.metadata;
    if (currentMetadata.lifecycle === 'deleted') {
      return this.rewrapReceipt({ workspaceId, artifactId, happenedAt, keyId: currentMetadata.wrappedDek.keyId, status: 'rejected', revision: currentMetadata.revision, rewrapGeneration: currentMetadata.rewrapGeneration, reason: 'cloud_vault_deleted' });
    }
    const previousKey = this.keyRing.keys[currentMetadata.wrappedDek.keyId];
    const activeKey = this.requireActiveWrappingKey();
    if (!previousKey) {
      return this.rewrapReceipt({ workspaceId, artifactId, happenedAt, keyId: activeKey.keyId, status: 'failed', revision: currentMetadata.revision, rewrapGeneration: currentMetadata.rewrapGeneration, reason: 'cloud_vault_key_not_found' });
    }
    if (currentMetadata.wrappedDek.keyId === activeKey.keyId) {
      return this.rewrapReceipt({ workspaceId, artifactId, happenedAt, keyId: activeKey.keyId, status: 'rewrapped', revision: currentMetadata.revision, rewrapGeneration: currentMetadata.rewrapGeneration, previousKeyId: previousKey.keyId, metadataKey: current.pointer.metadataKey });
    }
    try {
      const dek = unwrapDek(currentMetadata.wrappedDek, previousKey);
      const rewrapGeneration = currentMetadata.rewrapGeneration + 1;
      const receiptId = opaqueId('receipt', workspaceId, artifactId, currentMetadata.revision, 'rewrap', rewrapGeneration, happenedAt);
      const metadataKey = metadataObjectKey(opaqueScope(workspaceId, artifactId), currentMetadata.revision, receiptId);
      const nextMetadata: CloudVaultArtifactMetadata = {
        ...currentMetadata,
        wrappedDek: wrapDek(dek, activeKey, this.randomBytes(GCM_IV_BYTES)),
        rewrapGeneration,
      };
      const pointer: CloudVaultPointer = {
        ...current.pointer,
        metadataKey,
        receiptId,
        updatedAt: happenedAt,
      };
      await this.store.putObject({
        key: metadataKey,
        body: encodeJson(nextMetadata),
        contentType: 'application/json',
        metadata: { receiptId, artifactRevision: String(currentMetadata.revision) },
        ifAbsent: true,
        now: happenedAt,
      });
      await this.store.putObject({
        key: pointerObjectKey(workspaceId, artifactId),
        body: encodeJson(pointer),
        contentType: 'application/json',
        metadata: { receiptId, artifactRevision: String(currentMetadata.revision) },
        now: happenedAt,
      });
      return this.rewrapReceipt({
        workspaceId,
        artifactId,
        happenedAt,
        keyId: activeKey.keyId,
        status: 'rewrapped',
        revision: currentMetadata.revision,
        rewrapGeneration,
        previousKeyId: previousKey.keyId,
        metadataKey,
      });
    } catch (error) {
      return this.rewrapReceipt({
        workspaceId,
        artifactId,
        happenedAt,
        keyId: activeKey.keyId,
        status: 'failed',
        revision: currentMetadata.revision,
        rewrapGeneration: currentMetadata.rewrapGeneration,
        previousKeyId: previousKey.keyId,
        reason: normalizeStorageError(error),
      });
    }
  }

  async deleteArtifact(input: {
    workspaceId: string;
    artifactId: string;
    reason?: string;
    now?: string;
  }): Promise<CloudVaultDeleteReceipt> {
    const workspaceId = requireIdentifier(input.workspaceId, 'cloud_vault_workspace_required');
    const artifactId = requireIdentifier(input.artifactId, 'cloud_vault_artifact_required');
    const happenedAt = normalizeIsoTimestamp(input.now ?? this.now(), 'cloud_vault_delete_at_invalid');
    const current = await this.loadCurrent(workspaceId, artifactId);
    if (!current) {
      return this.deleteReceipt({ workspaceId, artifactId, happenedAt, keyId: this.keyRing.activeKeyId, status: 'rejected', revision: 0, reason: 'cloud_vault_not_found' });
    }
    if (current.metadata.lifecycle === 'deleted') {
      return this.deleteReceipt({ workspaceId, artifactId, happenedAt, keyId: current.metadata.wrappedDek.keyId, status: 'rejected', revision: current.metadata.revision, reason: 'cloud_vault_already_deleted' });
    }
    if (!current.metadata.controls.deletable) {
      return this.deleteReceipt({ workspaceId, artifactId, happenedAt, keyId: current.metadata.wrappedDek.keyId, status: 'rejected', revision: current.metadata.revision, reason: 'cloud_vault_delete_disabled' });
    }
    const revision = current.metadata.revision + 1;
    const receiptId = opaqueId('receipt', workspaceId, artifactId, revision, 'delete', happenedAt);
    const metadataKey = metadataObjectKey(opaqueScope(workspaceId, artifactId), revision, receiptId);
    const nextMetadata: CloudVaultArtifactMetadata = {
      ...current.metadata,
      revision,
      lifecycle: 'deleted',
      publishedAt: happenedAt,
      ciphertextKey: null,
      ciphertextBytes: 0,
      ciphertextSha256: current.metadata.ciphertextSha256,
      deletedAt: happenedAt,
      deleteReason: input.reason?.trim() || 'manual_delete',
    };
    const pointer: CloudVaultPointer = {
      schemaVersion: 'wonder.cloud-vault-pointer.v1',
      artifactId,
      workspaceId,
      revision,
      metadataKey,
      receiptId,
      updatedAt: happenedAt,
    };
    try {
      await this.store.putObject({
        key: metadataKey,
        body: encodeJson(nextMetadata),
        contentType: 'application/json',
        metadata: { receiptId, artifactRevision: String(revision) },
        ifAbsent: true,
        now: happenedAt,
      });
      await this.store.putObject({
        key: pointerObjectKey(workspaceId, artifactId),
        body: encodeJson(pointer),
        contentType: 'application/json',
        metadata: { receiptId, artifactRevision: String(revision) },
        now: happenedAt,
      });
      if (current.metadata.ciphertextKey) await this.store.deleteObject(current.metadata.ciphertextKey);
      return this.deleteReceipt({
        workspaceId,
        artifactId,
        happenedAt,
        keyId: current.metadata.wrappedDek.keyId,
        status: 'deleted',
        revision,
        metadataKey,
        deletedCiphertextKey: current.metadata.ciphertextKey,
      });
    } catch (error) {
      return this.deleteReceipt({
        workspaceId,
        artifactId,
        happenedAt,
        keyId: current.metadata.wrappedDek.keyId,
        status: 'failed',
        revision,
        metadataKey,
        deletedCiphertextKey: current.metadata.ciphertextKey,
        reason: normalizeStorageError(error),
      });
    }
  }

  async cleanupOrphans(input: { workspaceId: string; now?: string }): Promise<CloudVaultCleanupReceipt> {
    const workspaceId = requireIdentifier(input.workspaceId, 'cloud_vault_workspace_required');
    const happenedAt = normalizeIsoTimestamp(input.now ?? this.now(), 'cloud_vault_cleanup_at_invalid');
    const scopePrefix = scopePrefixForWorkspace(workspaceId);
    const pointerPrefix = `${scopePrefix}/pointers/`;
    const [workspaceObjects, pointerObjects] = await Promise.all([
      this.store.listObjects(`${scopePrefix}/`),
      this.store.listObjects(pointerPrefix),
    ]);
    const stagingObjects = workspaceObjects.filter((record) => record.key.includes('/staging/'));
    const metadataObjects = workspaceObjects.filter((record) => record.key.includes('/metadata/'));
    const ciphertextObjects = workspaceObjects.filter((record) => record.key.includes('/ciphertext/'));
    const referenced = new Set<string>();
    for (const pointerObject of pointerObjects) {
      const pointer = decodeJson<CloudVaultPointer>(pointerObject, 'cloud_vault_pointer_invalid');
      referenced.add(pointer.metadataKey);
      const metadataRecord = await this.store.getObject(pointer.metadataKey);
      if (!metadataRecord) continue;
      const metadata = decodeJson<CloudVaultArtifactMetadata>(metadataRecord, 'cloud_vault_metadata_invalid');
      if (metadata.ciphertextKey) referenced.add(metadata.ciphertextKey);
    }
    const deletedKeys: string[] = [];
    for (const record of [...stagingObjects, ...metadataObjects, ...ciphertextObjects]) {
      if (referenced.has(record.key)) continue;
      const deleted = await this.store.deleteObject(record.key);
      if (deleted) deletedKeys.push(record.key);
    }
    return {
      schemaVersion: 'wonder.cloud-vault-cleanup-receipt.v1',
      action: 'cleanup_orphans',
      workspaceId,
      happenedAt,
      deletedKeys: deletedKeys.sort(),
    };
  }

  private async loadCurrent(workspaceId: string, artifactId: string): Promise<{ pointer: CloudVaultPointer; metadata: CloudVaultArtifactMetadata } | null> {
    const pointerRecord = await this.store.getObject(pointerObjectKey(workspaceId, artifactId));
    if (!pointerRecord) return null;
    const pointer = decodeJson<CloudVaultPointer>(pointerRecord, 'cloud_vault_pointer_invalid');
    const metadataRecord = await this.store.getObject(pointer.metadataKey);
    if (!metadataRecord) throw new Error('cloud_vault_metadata_missing');
    return {
      pointer,
      metadata: decodeJson<CloudVaultArtifactMetadata>(metadataRecord, 'cloud_vault_metadata_invalid'),
    };
  }

  private requireActiveWrappingKey(): CloudVaultWrappingKey {
    const key = this.keyRing.keys[this.keyRing.activeKeyId];
    if (!key) throw new Error('cloud_vault_active_key_missing');
    if (key.status === 'revoked') throw new Error('cloud_vault_active_key_revoked');
    return key;
  }

  private publishReceipt(input: {
    workspaceId: string;
    artifactId: string;
    keyId: string;
    happenedAt: string;
    status: 'published' | 'rejected' | 'failed';
    revision: number;
    pointerKey: string;
    metadataKey?: string | null;
    ciphertextKey?: string | null;
    stagingKey?: string | null;
    orphanedKeys?: readonly string[];
    reason?: string;
  }): CloudVaultPublishReceipt {
    const quotaBytesUsed = this.store instanceof LocalFakeBlobStore ? this.store.currentBytes() : 0;
    return {
      schemaVersion: 'wonder.cloud-vault-receipt.v1',
      action: 'publish',
      receiptId: opaqueId('receipt', input.workspaceId, input.artifactId, input.revision, input.happenedAt, input.status),
      artifactId: input.artifactId,
      workspaceId: input.workspaceId,
      keyId: input.keyId,
      happenedAt: input.happenedAt,
      status: input.status,
      revision: input.revision,
      reason: input.reason,
      pointerKey: input.pointerKey,
      metadataKey: input.metadataKey ?? null,
      ciphertextKey: input.ciphertextKey ?? null,
      stagingKey: input.stagingKey ?? null,
      orphanedKeys: [...(input.orphanedKeys ?? [])].sort(),
      quotaBytesUsed,
    };
  }

  private exportReceipt(input: {
    workspaceId: string;
    artifactId: string;
    happenedAt: string;
    status: 'exported' | 'rejected';
    revision?: number;
    keyId?: string;
    metadata?: CloudVaultArtifactMetadata | null;
    ciphertextRequest?: CloudVaultPresignedRequest | null;
    metadataRequest?: CloudVaultPresignedRequest | null;
    reason?: string;
  }): CloudVaultExportReceipt {
    return {
      schemaVersion: 'wonder.cloud-vault-receipt.v1',
      action: 'export',
      receiptId: opaqueId('receipt', input.workspaceId, input.artifactId, 'export', input.happenedAt),
      artifactId: input.artifactId,
      workspaceId: input.workspaceId,
      keyId: input.keyId ?? this.keyRing.activeKeyId,
      happenedAt: input.happenedAt,
      status: input.status,
      revision: input.revision ?? 0,
      metadata: input.metadata ?? null,
      ciphertextRequest: input.ciphertextRequest ?? null,
      metadataRequest: input.metadataRequest ?? null,
      reason: input.reason,
    };
  }

  private rewrapReceipt(input: {
    workspaceId: string;
    artifactId: string;
    happenedAt: string;
    keyId: string;
    status: 'rewrapped' | 'rejected' | 'failed';
    revision: number;
    rewrapGeneration: number;
    previousKeyId?: string | null;
    metadataKey?: string | null;
    reason?: string;
  }): CloudVaultRewrapReceipt {
    return {
      schemaVersion: 'wonder.cloud-vault-receipt.v1',
      action: 'rewrap',
      receiptId: opaqueId('receipt', input.workspaceId, input.artifactId, 'rewrap', input.revision, input.happenedAt),
      artifactId: input.artifactId,
      workspaceId: input.workspaceId,
      keyId: input.keyId,
      happenedAt: input.happenedAt,
      status: input.status,
      revision: input.revision,
      rewrapGeneration: input.rewrapGeneration,
      previousKeyId: input.previousKeyId ?? null,
      metadataKey: input.metadataKey ?? null,
      reason: input.reason,
    };
  }

  private deleteReceipt(input: {
    workspaceId: string;
    artifactId: string;
    happenedAt: string;
    keyId: string;
    status: 'deleted' | 'rejected' | 'failed';
    revision: number;
    metadataKey?: string | null;
    deletedCiphertextKey?: string | null;
    reason?: string;
  }): CloudVaultDeleteReceipt {
    return {
      schemaVersion: 'wonder.cloud-vault-receipt.v1',
      action: 'delete',
      receiptId: opaqueId('receipt', input.workspaceId, input.artifactId, 'delete', input.revision, input.happenedAt),
      artifactId: input.artifactId,
      workspaceId: input.workspaceId,
      keyId: input.keyId,
      happenedAt: input.happenedAt,
      status: input.status,
      revision: input.revision,
      metadataKey: input.metadataKey ?? null,
      deletedCiphertextKey: input.deletedCiphertextKey ?? null,
      reason: input.reason,
    };
  }

  private async detectOrphanCandidates(keys: readonly string[], pointerKey: string): Promise<string[]> {
    const pointer = await this.store.getObject(pointerKey);
    if (pointer) return [];
    const candidates: string[] = [];
    for (const key of keys) {
      if (!key) continue;
      if (await this.store.getObject(key)) candidates.push(key);
    }
    return candidates;
  }
}

function cloneKeyRing(keyRing: CloudVaultKeyRing): CloudVaultKeyRing {
  return {
    schemaVersion: keyRing.schemaVersion,
    activeKeyId: keyRing.activeKeyId,
    keys: Object.fromEntries(Object.entries(keyRing.keys).map(([keyId, value]) => [keyId, { ...value }])),
  };
}

function normalizeControls(input?: Partial<CloudVaultDataControls>): CloudVaultDataControls {
  return {
    exportable: input?.exportable ?? true,
    deletable: input?.deletable ?? true,
    maxPresignTtlSeconds: clampTtl(input?.maxPresignTtlSeconds ?? 300),
  };
}

function clampTtl(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_PRESIGN_TTL_SECONDS) throw new Error('cloud_vault_presign_ttl_invalid');
  return value;
}

function wrapDek(dek: Uint8Array, key: CloudVaultWrappingKey, iv: Uint8Array): CloudVaultWrappedKey {
  const encrypted = encryptBytes(dek, normalizeAesKeyMaterial(fromBase64(key.material)), iv);
  return {
    algorithm: WRAP_CIPHER_ALGORITHM,
    keyId: key.keyId,
    iv: toBase64(iv),
    authTag: toBase64(encrypted.authTag),
    ciphertext: toBase64(encrypted.ciphertext),
  };
}

function unwrapDek(wrapped: CloudVaultWrappedKey, key: CloudVaultWrappingKey): Uint8Array {
  return decryptBytes({
    ciphertext: fromBase64(wrapped.ciphertext),
    authTag: fromBase64Fixed(wrapped.authTag, GCM_TAG_BYTES, 'cloud_vault_auth_tag_invalid'),
    iv: fromBase64Fixed(wrapped.iv, GCM_IV_BYTES, 'cloud_vault_iv_invalid'),
    key: normalizeAesKeyMaterial(fromBase64(key.material)),
  });
}

function encryptBytes(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): { ciphertext: Uint8Array; authTag: Uint8Array } {
  return defaultCoreCryptoPort.encryptAesGcm(plaintext, key, iv);
}

function decryptBytes(input: { ciphertext: Uint8Array; authTag: Uint8Array; iv: Uint8Array; key: Uint8Array }): Uint8Array {
  return defaultCoreCryptoPort.decryptAesGcm(input);
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

function decodeJson<T>(record: BlobObjectRecord, error: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(record.body)) as T;
  } catch {
    throw new Error(error);
  }
}

function toBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value);
}

function pointerObjectKey(workspaceId: string, artifactId: string): string {
  return `${scopePrefixForWorkspace(workspaceId)}/${opaqueScope(workspaceId, artifactId)}/pointers/current.json`;
}

function stagingObjectKey(scope: string, revision: number, ciphertext: Uint8Array): string {
  return `${scope}/staging/${revision}-${sha256Bytes(ciphertext).slice(7, 31)}.bin`;
}

function ciphertextObjectKey(scope: string, revision: number, ciphertext: Uint8Array): string {
  return `${scope}/ciphertext/${revision}-${sha256Bytes(ciphertext).slice(7, 31)}.bin`;
}

function metadataObjectKey(scope: string, revision: number, receiptId: string): string {
  return `${scope}/metadata/${revision}-${receiptId}.json`;
}

function scopePrefixForWorkspace(workspaceId: string): string {
  return `vault/${opaqueId('workspace', workspaceId)}`;
}

function opaqueScope(workspaceId: string, artifactId: string): string {
  return `${scopePrefixForWorkspace(workspaceId)}/${opaqueId('scope', workspaceId, artifactId)}`;
}

function opaqueId(...parts: Array<string | number>): string {
  return toHex(defaultCoreCryptoPort.sha256(new TextEncoder().encode(parts.map(String).join('|')))).slice(0, 24);
}

function sha256Bytes(value: Uint8Array): string {
  return `sha256:${toHex(defaultCoreCryptoPort.sha256(value))}`;
}

function isSha256(value: string | undefined): boolean {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function requireIdentifier(value: string, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value.trim();
}

function normalizeIsoTimestamp(value: string, error: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(error);
  return new Date(value).toISOString();
}

function normalizeContentType(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\n')) throw new Error('cloud_vault_content_type_invalid');
  return value.trim().toLowerCase();
}

function normalizeStorageError(error: unknown): string {
  return error instanceof Error ? error.message : 'cloud_vault_storage_failed';
}

function requireBlobKey(value: string, error: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('..')) throw new Error(error);
  return value.trim();
}

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function fromBase64Fixed(value: string, length: number, error: string): Uint8Array {
  const bytes = fromBase64(value);
  if (bytes.byteLength !== length) throw new Error(error);
  return bytes;
}

function secureRandomBytes(size: number): Uint8Array {
  return defaultCoreCryptoPort.randomBytes(size);
}

function normalizeAesKeyMaterial(value: Uint8Array): Uint8Array {
  if (value.byteLength === DEK_BYTES) return Uint8Array.from(value);
  return Uint8Array.from(defaultCoreCryptoPort.sha256(value));
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
