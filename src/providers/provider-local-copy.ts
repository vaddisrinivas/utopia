import type { SQLiteDatabase } from 'expo-sqlite';

import { DomainManifest } from '@/src/domain/catalog';
import { CanonicalRecord, RecordProvider } from '@/src/domain/runtime';
import { getRecord, upsertRecord } from '@/src/db/records';
import { ProviderLink, SourceSnapshot, linkSnapshotToRecord, upsertProviderLink, upsertSourceSnapshot } from '@/src/db/sources';

export type DirectSyncProvider = Extract<RecordProvider, 'notion' | 'google_sheets'>;

export type DirectSyncReceipt = {
  provider: DirectSyncProvider;
  status: 'synced' | 'blocked' | 'error' | 'cleared' | 'restored' | 'disconnected';
  message: string;
  records: number;
  snapshots: number;
  observedAt: string;
  restoreToken?: string;
  restoreUntil?: string;
};

type ProviderClearBackup = {
  provider: DirectSyncProvider;
  records: CanonicalRecord[];
  snapshots: SourceSnapshot[];
  links: ProviderLink[];
  snapshotRelations: Array<{ snapshot_id: string; record_id: string }>;
  createdAt: string;
  restoreUntil: string;
};

const RESTORE_TTL_MS = 15 * 60 * 1000;
const clearBackups = new Map<string, ProviderClearBackup>();

export async function clearProviderLocalCopy(input: {
  db: SQLiteDatabase | null;
  provider: DirectSyncProvider;
}): Promise<DirectSyncReceipt> {
  const observedAt = new Date().toISOString();
  if (!input.db) return blocked(input.provider, 'Local graph is not ready yet.', observedAt);
  const backup = await backupProviderLocalCopy(input.db, input.provider, observedAt);

  const before = await input.db.getFirstAsync<{ records: number; snapshots: number }>(
    `
      SELECT
        (SELECT COUNT(*) FROM records WHERE source_provider = ?) AS records,
        (SELECT COUNT(*) FROM source_snapshots WHERE provider = ?) AS snapshots
    `,
    [input.provider, input.provider],
  );
  const recordCount = before?.records ?? 0;
  const snapshotCount = before?.snapshots ?? 0;

  await input.db.withTransactionAsync(async () => {
    await input.db!.runAsync(
      `
        DELETE FROM record_relations
        WHERE from_id IN (SELECT id FROM records WHERE source_provider = ?)
           OR target_id IN (SELECT id FROM records WHERE source_provider = ?)
      `,
      [input.provider, input.provider],
    );
    await input.db!.runAsync(
      `
        DELETE FROM source_snapshot_relations
        WHERE snapshot_id IN (SELECT id FROM source_snapshots WHERE provider = ?)
           OR record_id IN (SELECT id FROM records WHERE source_provider = ?)
      `,
      [input.provider, input.provider],
    );
    await input.db!.runAsync('DELETE FROM source_snapshots WHERE provider = ?', [input.provider]);
    await input.db!.runAsync('DELETE FROM provider_links WHERE provider = ?', [input.provider]);
    await input.db!.runAsync('DELETE FROM records WHERE source_provider = ?', [input.provider]);
  });

  return {
    provider: input.provider,
    status: 'cleared',
    message: recordCount || snapshotCount
      ? `Cleared the local ${providerDisplayName(input.provider)} copy. Provider data was not changed. You can restore this local copy for 15 minutes.`
      : `No local ${providerDisplayName(input.provider)} copy was present. Provider data was not changed.`,
    records: recordCount,
    snapshots: snapshotCount,
    observedAt,
    restoreToken: recordCount || snapshotCount ? backup.token : undefined,
    restoreUntil: recordCount || snapshotCount ? backup.restoreUntil : undefined,
  };
}

export async function disconnectProviderLocalCopy(input: {
  db: SQLiteDatabase | null;
  provider: DirectSyncProvider;
}): Promise<DirectSyncReceipt> {
  const clear = await clearProviderLocalCopy(input);
  if (clear.status === 'blocked' || clear.status === 'error') return clear;
  return {
    ...clear,
    status: 'disconnected',
    message: clear.records || clear.snapshots
      ? `Disconnected ${providerDisplayName(input.provider)} in this app and cleared the local copy. Provider data was not changed. You can restore this local copy for 15 minutes.`
      : `Disconnected ${providerDisplayName(input.provider)} in this app. No local copy was present, and provider data was not changed.`,
  };
}

export async function restoreClearedProviderLocalCopy(input: {
  db: SQLiteDatabase | null;
  restoreToken?: string;
}): Promise<DirectSyncReceipt> {
  const observedAt = new Date().toISOString();
  if (!input.db) return blocked('notion', 'Local graph is not ready yet.', observedAt);
  const token = input.restoreToken?.trim() ?? '';
  const backup = token ? clearBackups.get(token) : undefined;
  if (!backup) {
    return blocked('notion', 'Nothing to restore. Clear receipts can restore only during the current app session.', observedAt);
  }
  if (Date.now() > Date.parse(backup.restoreUntil)) {
    clearBackups.delete(token);
    return blocked(backup.provider, 'Restore window expired. Pull the provider again to rebuild the local copy.', observedAt);
  }

  for (const link of backup.links) {
    await upsertProviderLink(input.db, link);
  }
  for (const snapshot of backup.snapshots) {
    await upsertSourceSnapshot(input.db, snapshot);
  }
  for (const record of backup.records) {
    await upsertRecord(input.db, restoreManifestFor(record), record);
  }
  for (const relation of backup.snapshotRelations) {
    await linkSnapshotToRecord(input.db, relation);
  }
  clearBackups.delete(token);

  return {
    provider: backup.provider,
    status: 'restored',
    message: `Restored the local ${providerDisplayName(backup.provider)} copy from the clear receipt.`,
    records: backup.records.length,
    snapshots: backup.snapshots.length,
    observedAt,
  };
}

function restoreManifestFor(record: CanonicalRecord): DomainManifest {
  return {
    schema_version: 'utopia.domain.v1',
    id: record.domain,
    label: record.domain,
    surfaces: [],
    collections: [record.collection],
    relations: [],
    skills: [],
    workflows: [],
    data_homes: [],
    mcp: { resources: [], tools: [] },
  };
}

async function backupProviderLocalCopy(db: SQLiteDatabase, provider: DirectSyncProvider, observedAt: string) {
  const restoreUntil = new Date(Date.now() + RESTORE_TTL_MS).toISOString();
  const token = `restore-${provider}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const recordIds = await db.getAllAsync<{ id: string }>('SELECT id FROM records WHERE source_provider = ?', [provider]);
  const records = (await Promise.all(recordIds.map((row) => getRecord(db, row.id)))).filter((record): record is CanonicalRecord => record !== null);
  const snapshots = await db.getAllAsync<SourceSnapshot>('SELECT * FROM source_snapshots WHERE provider = ? ORDER BY observed_at DESC', [provider]);
  const links = await db.getAllAsync<ProviderLink>('SELECT * FROM provider_links WHERE provider = ? ORDER BY updated_at DESC', [provider]);
  const snapshotRelations = await db.getAllAsync<{ snapshot_id: string; record_id: string }>(
    `
      SELECT snapshot_id, record_id
      FROM source_snapshot_relations
      WHERE snapshot_id IN (SELECT id FROM source_snapshots WHERE provider = ?)
         OR record_id IN (SELECT id FROM records WHERE source_provider = ?)
    `,
    [provider, provider],
  );
  clearBackups.set(token, { provider, records, snapshots, links, snapshotRelations, createdAt: observedAt, restoreUntil });
  return { token, restoreUntil };
}

function blocked(provider: DirectSyncProvider, message: string, observedAt: string): DirectSyncReceipt {
  return { provider, status: 'blocked', message, records: 0, snapshots: 0, observedAt };
}

function providerDisplayName(provider: DirectSyncProvider) {
  return provider === 'google_sheets' ? 'Sheets' : 'Notion';
}
