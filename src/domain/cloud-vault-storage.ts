import { defaultCoreCryptoPort } from '../../adapters/core-crypto';

export type BlobObjectRecord = Readonly<{
  key: string;
  body: Uint8Array;
  contentType: string;
  metadata: Readonly<Record<string, string>>;
  etag: string;
  size: number;
  writtenAt: string;
}>;

export type BlobPutInput = Readonly<{
  key: string;
  body: Uint8Array;
  contentType: string;
  metadata?: Readonly<Record<string, string>>;
  ifAbsent?: boolean;
  now?: string;
}>;

export type BlobCopyInput = Readonly<{
  fromKey: string;
  toKey: string;
  contentType?: string;
  metadata?: Readonly<Record<string, string>>;
  ifAbsent?: boolean;
  now?: string;
}>;

export interface BlobStore {
  putObject(input: BlobPutInput): Promise<BlobObjectRecord>;
  copyObject(input: BlobCopyInput): Promise<BlobObjectRecord>;
  getObject(key: string): Promise<BlobObjectRecord | null>;
  deleteObject(key: string): Promise<boolean>;
  listObjects(prefix: string): Promise<readonly BlobObjectRecord[]>;
}

export type LocalFakeBlobStoreFault =
  | 'none'
  | 'outage'
  | 'put_after_write'
  | 'copy_after_write';

export class LocalFakeBlobStore implements BlobStore {
  private readonly objects = new Map<string, BlobObjectRecord>();
  private readonly quotaBytes: number;
  private fault: LocalFakeBlobStoreFault;

  constructor(input?: { quotaBytes?: number; fault?: LocalFakeBlobStoreFault }) {
    this.quotaBytes = input?.quotaBytes ?? 32 * 1024 * 1024;
    this.fault = input?.fault ?? 'none';
  }

  setFault(fault: LocalFakeBlobStoreFault): void {
    this.fault = fault;
  }

  currentBytes(): number {
    return [...this.objects.values()].reduce((total, record) => total + record.size, 0);
  }

  keys(): readonly string[] {
    return [...this.objects.keys()].sort();
  }

  async putObject(input: BlobPutInput): Promise<BlobObjectRecord> {
    this.assertAvailable();
    const key = requireKey(input.key);
    if (input.ifAbsent && this.objects.has(key)) throw new Error('cloud_vault_blob_exists');
    const body = cloneBytes(input.body);
    const next = buildRecord({
      key,
      body,
      contentType: requireContentType(input.contentType),
      metadata: input.metadata ?? {},
      now: input.now,
    });
    this.assertQuota(key, next.size);
    this.objects.set(key, next);
    if (this.fault === 'put_after_write') throw new Error('cloud_vault_storage_unavailable');
    return next;
  }

  async copyObject(input: BlobCopyInput): Promise<BlobObjectRecord> {
    this.assertAvailable();
    const source = this.objects.get(requireKey(input.fromKey));
    if (!source) throw new Error('cloud_vault_blob_missing');
    const toKey = requireKey(input.toKey);
    if (input.ifAbsent && this.objects.has(toKey)) throw new Error('cloud_vault_blob_exists');
    const next = buildRecord({
      key: toKey,
      body: source.body,
      contentType: input.contentType ? requireContentType(input.contentType) : source.contentType,
      metadata: input.metadata ?? source.metadata,
      now: input.now,
    });
    this.assertQuota(toKey, next.size);
    this.objects.set(toKey, next);
    if (this.fault === 'copy_after_write') throw new Error('cloud_vault_storage_unavailable');
    return next;
  }

  async getObject(key: string): Promise<BlobObjectRecord | null> {
    const record = this.objects.get(requireKey(key));
    return record ? cloneRecord(record) : null;
  }

  async deleteObject(key: string): Promise<boolean> {
    return this.objects.delete(requireKey(key));
  }

  async listObjects(prefix: string): Promise<readonly BlobObjectRecord[]> {
    const normalized = prefix.trim();
    return [...this.objects.values()]
      .filter((record) => record.key.startsWith(normalized))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(cloneRecord);
  }

  private assertAvailable(): void {
    if (this.fault === 'outage') throw new Error('cloud_vault_storage_unavailable');
  }

  private assertQuota(key: string, nextSize: number): void {
    const current = this.currentBytes();
    const existing = this.objects.get(key)?.size ?? 0;
    if (current - existing + nextSize > this.quotaBytes) throw new Error('cloud_vault_quota_exceeded');
  }
}

function buildRecord(input: {
  key: string;
  body: Uint8Array;
  contentType: string;
  metadata: Readonly<Record<string, string>>;
  now?: string;
}): BlobObjectRecord {
  const writtenAt = normalizeIsoTimestamp(input.now ?? new Date().toISOString(), 'cloud_vault_blob_written_at_invalid');
  const body = cloneBytes(input.body);
  return {
    key: input.key,
    body,
    contentType: input.contentType,
    metadata: { ...input.metadata },
    etag: `sha256:${toHex(defaultCoreCryptoPort.sha256(body))}`,
    size: body.byteLength,
    writtenAt,
  };
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cloneRecord(record: BlobObjectRecord): BlobObjectRecord {
  return {
    ...record,
    body: cloneBytes(record.body),
    metadata: { ...record.metadata },
  };
}

function cloneBytes(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value);
}

function requireKey(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('cloud_vault_blob_key_required');
  return value.trim();
}

function requireContentType(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\n')) throw new Error('cloud_vault_blob_content_type_invalid');
  return value.trim().toLowerCase();
}

function normalizeIsoTimestamp(value: string, error: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(error);
  return new Date(value).toISOString();
}
