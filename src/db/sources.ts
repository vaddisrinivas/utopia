import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';
import { RecordProvider } from '@/packages/shared/contracts/records';

export type ProviderLink = {
  id: string;
  app_installation_id?: string;
  provider: RecordProvider;
  external_id: string;
  name: string;
  status: string;
  freshness: string | null;
  workspace: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
};

type ProviderLinkRow = Omit<ProviderLink, 'freshness' | 'workspace'> & {
  freshness: string | null;
  workspace: string | null;
  app_installation_id: string;
};

export type SourceSnapshot = {
  id: string;
  app_installation_id?: string;
  provider: RecordProvider;
  external_id: string;
  scope: string | null;
  observed_at: string;
  payload_json: string;
  checksum: string | null;
  created_at: string;
  updated_at: string;
};

export type SourceCausality = {
  app_installation_id?: string;
  snapshot_id: string;
  record_id: string;
};

function normalizeInstallationId(value?: string | null): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_APP_INSTALLATION_ID;
}

export async function upsertProviderLink(db: SQLiteDatabase, link: ProviderLink): Promise<void> {
  const appInstallationId = normalizeInstallationId(link.app_installation_id);
  await db.runAsync(
    `
      INSERT INTO provider_links (id, app_installation_id, provider, external_id, name, status, freshness, workspace, url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_installation_id, id) DO UPDATE SET
        app_installation_id = excluded.app_installation_id,
        provider = excluded.provider,
        external_id = excluded.external_id,
        name = excluded.name,
        status = excluded.status,
        freshness = excluded.freshness,
        workspace = excluded.workspace,
        url = excluded.url,
        updated_at = excluded.updated_at
    `,
    [
      link.id,
      appInstallationId,
      link.provider,
      link.external_id,
      link.name,
      link.status,
      link.freshness,
      link.workspace,
      link.url,
      link.created_at,
      link.updated_at,
    ]
  );
}

export async function listProviderLinks(db: SQLiteDatabase): Promise<ProviderLink[]> {
  return listProviderLinksForInstallation(db, DEFAULT_APP_INSTALLATION_ID);
}

export async function listProviderLinksForInstallation(
  db: SQLiteDatabase,
  installationId: string,
): Promise<ProviderLink[]> {
  return db.getAllAsync<ProviderLinkRow>(
    'SELECT * FROM provider_links WHERE app_installation_id = ? ORDER BY updated_at DESC',
    [normalizeInstallationId(installationId)],
  );
}

export async function getAllProviderLinks(db: SQLiteDatabase): Promise<ProviderLink[]> {
  return listProviderLinks(db);
}

export async function getProviderLink(
  db: SQLiteDatabase,
  id: string,
  installationId = DEFAULT_APP_INSTALLATION_ID,
): Promise<ProviderLink | null> {
  return db.getFirstAsync<ProviderLinkRow>(
    'SELECT * FROM provider_links WHERE app_installation_id = ? AND id = ?',
    [normalizeInstallationId(installationId), id],
  );
}

export async function upsertSourceSnapshot(db: SQLiteDatabase, snapshot: SourceSnapshot): Promise<void> {
  const appInstallationId = normalizeInstallationId(snapshot.app_installation_id);
  await db.runAsync(
    `
      INSERT INTO source_snapshots (
        id, app_installation_id, provider, external_id, scope, observed_at, payload_json, checksum, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_installation_id, id) DO UPDATE SET
        app_installation_id = excluded.app_installation_id,
        provider = excluded.provider,
        external_id = excluded.external_id,
        scope = excluded.scope,
        observed_at = excluded.observed_at,
        payload_json = excluded.payload_json,
        checksum = excluded.checksum,
        updated_at = excluded.updated_at
    `,
    [
      snapshot.id,
      appInstallationId,
      snapshot.provider,
      snapshot.external_id,
      snapshot.scope,
      snapshot.observed_at,
      snapshot.payload_json,
      snapshot.checksum,
      snapshot.created_at,
      snapshot.updated_at,
    ]
  );
}

export async function getSnapshot(
  db: SQLiteDatabase,
  id: string,
  installationId = DEFAULT_APP_INSTALLATION_ID,
): Promise<SourceSnapshot | null> {
  return db.getFirstAsync<SourceSnapshot>(
    'SELECT * FROM source_snapshots WHERE app_installation_id = ? AND id = ?',
    [normalizeInstallationId(installationId), id],
  );
}

export async function getLatestSourceSnapshotForExternalId(
  db: SQLiteDatabase,
  provider: RecordProvider,
  externalId: string,
  installationId = DEFAULT_APP_INSTALLATION_ID,
): Promise<SourceSnapshot | null> {
  return db.getFirstAsync<SourceSnapshot>(
    'SELECT * FROM source_snapshots WHERE app_installation_id = ? AND provider = ? AND external_id = ? ORDER BY observed_at DESC LIMIT 1',
    [normalizeInstallationId(installationId), provider, externalId],
  );
}

export async function listSourceSnapshots(
  db: SQLiteDatabase,
  provider?: RecordProvider,
  installationId = DEFAULT_APP_INSTALLATION_ID,
): Promise<SourceSnapshot[]> {
  const appInstallationId = normalizeInstallationId(installationId);
  if (provider) {
    return db.getAllAsync<SourceSnapshot>(
      'SELECT * FROM source_snapshots WHERE app_installation_id = ? AND provider = ? ORDER BY observed_at DESC',
      [appInstallationId, provider],
    );
  }
  return db.getAllAsync<SourceSnapshot>(
    'SELECT * FROM source_snapshots WHERE app_installation_id = ? ORDER BY observed_at DESC',
    [appInstallationId],
  );
}

export async function linkSnapshotToRecord(
  db: SQLiteDatabase,
  linkage: SourceCausality
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO source_snapshot_relations (app_installation_id, snapshot_id, record_id) VALUES (?, ?, ?)`,
    [normalizeInstallationId(linkage.app_installation_id), linkage.snapshot_id, linkage.record_id]
  );
}

export async function listRecordSourceSnapshots(
  db: SQLiteDatabase,
  recordId: string,
  installationId = DEFAULT_APP_INSTALLATION_ID,
): Promise<SourceSnapshot[]> {
  const rows = await db.getAllAsync<SourceSnapshot>(
    `
      SELECT s.*
      FROM source_snapshots s
      INNER JOIN source_snapshot_relations r
        ON r.app_installation_id = s.app_installation_id
       AND r.snapshot_id = s.id
      WHERE s.app_installation_id = ?
        AND r.record_id = ?
      ORDER BY s.observed_at DESC
    `,
    [normalizeInstallationId(installationId), recordId]
  );
  return rows;
}
