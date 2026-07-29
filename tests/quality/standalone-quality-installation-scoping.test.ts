import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_APP_INSTALLATION_ID, DEFAULT_WORKSPACE_ID } from '@/packages/shared/contracts/app-installation';
import { exportRecoverySnapshot, runMigrations } from '@/src/db/migrations';
import { createInstallationRepository } from '@/src/db/records';
import { importRecoverySnapshot } from '@/src/db/recovery';
import { linkSnapshotToRecord, upsertProviderLink, upsertSourceSnapshot } from '@/src/db/sources';
import { loadCatalog } from '@/src/domain/catalog';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

describe('standalone quality sqlite adapters', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('preserves installation scoping for records, relations, operations, outbox, and sources across export/import', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);

    const manifest = loadCatalog().activeManifest;
    const installA = createInstallationRepository({
      db: db as any,
      workspaceId: DEFAULT_WORKSPACE_ID,
      installationId: DEFAULT_APP_INSTALLATION_ID,
    });
    const installB = createInstallationRepository({
      db: db as any,
      workspaceId: DEFAULT_WORKSPACE_ID,
      installationId: 'quality-install-b',
    });
    const now = '2026-07-29T00:00:00.000Z';

    await installA.upsertRecord(manifest, {
      id: 'shared-anchor',
      title: 'Shared anchor A',
      collection: 'inventory',
      properties: { body: 'A body' },
      relations: [{ name: 'uses', target_id: 'shared-target' }],
      source: { provider: 'sqlite', external_id: 'shared-anchor', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    await installA.upsertRecord(manifest, {
      id: 'shared-target',
      title: 'Shared target A',
      collection: 'inventory',
      properties: { body: 'A target' },
      relations: [],
      source: { provider: 'sqlite', external_id: 'shared-target', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });

    await installB.upsertRecord(manifest, {
      id: 'shared-anchor',
      title: 'Shared anchor B',
      collection: 'inventory',
      properties: { body: 'B body' },
      relations: [{ name: 'uses', target_id: 'shared-target' }],
      source: { provider: 'sqlite', external_id: 'shared-anchor', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    await installB.upsertRecord(manifest, {
      id: 'shared-target',
      title: 'Shared target B',
      collection: 'inventory',
      properties: { body: 'B target' },
      relations: [],
      source: { provider: 'sqlite', external_id: 'shared-target', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });

    await upsertProviderLink(db as any, {
      id: 'provider-link',
      app_installation_id: DEFAULT_APP_INSTALLATION_ID,
      provider: 'notion',
      external_id: 'a-link',
      name: 'Notion A',
      status: 'Synced',
      freshness: now,
      workspace: 'A',
      url: 'https://example.com/a',
      created_at: now,
      updated_at: now,
    });
    await upsertProviderLink(db as any, {
      id: 'provider-link',
      app_installation_id: 'quality-install-b',
      provider: 'notion',
      external_id: 'b-link',
      name: 'Notion B',
      status: 'Synced',
      freshness: now,
      workspace: 'B',
      url: 'https://example.com/b',
      created_at: now,
      updated_at: now,
    });
    await upsertSourceSnapshot(db as any, {
      id: 'provider-snapshot',
      app_installation_id: DEFAULT_APP_INSTALLATION_ID,
      provider: 'notion',
      external_id: 'a-snapshot',
      scope: 'food',
      observed_at: now,
      payload_json: JSON.stringify({ id: 'a-snapshot' }),
      checksum: 'a',
      created_at: now,
      updated_at: now,
    });
    await upsertSourceSnapshot(db as any, {
      id: 'provider-snapshot',
      app_installation_id: 'quality-install-b',
      provider: 'notion',
      external_id: 'b-snapshot',
      scope: 'food',
      observed_at: now,
      payload_json: JSON.stringify({ id: 'b-snapshot' }),
      checksum: 'b',
      created_at: now,
      updated_at: now,
    });
    await linkSnapshotToRecord(db as any, {
      app_installation_id: DEFAULT_APP_INSTALLATION_ID,
      snapshot_id: 'provider-snapshot',
      record_id: 'shared-anchor',
    });
    await linkSnapshotToRecord(db as any, {
      app_installation_id: 'quality-install-b',
      snapshot_id: 'provider-snapshot',
      record_id: 'shared-anchor',
    });

    const snapshot = await exportRecoverySnapshot(db as any);
    const restored = new NodeSqliteDb();
    dbs.push(restored);
    await runMigrations(restored as any);
    await importRecoverySnapshot(restored as any, snapshot);

    const scopedCounts = async (database: NodeSqliteDb, installationId: string) => ({
      records: (await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM records WHERE app_installation_id = ?', [installationId]))?.count ?? 0,
      relations: (await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM record_relations WHERE app_installation_id = ?', [installationId]))?.count ?? 0,
      operations: (await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM operations WHERE app_installation_id = ?', [installationId]))?.count ?? 0,
      outbox: (await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM outbox_events WHERE app_installation_id = ?', [installationId]))?.count ?? 0,
      links: (await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM provider_links WHERE app_installation_id = ?', [installationId]))?.count ?? 0,
      snapshots: (await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM source_snapshots WHERE app_installation_id = ?', [installationId]))?.count ?? 0,
      snapshotRelations: (await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM source_snapshot_relations WHERE app_installation_id = ?', [installationId]))?.count ?? 0,
    });

    await expect(scopedCounts(restored, DEFAULT_APP_INSTALLATION_ID)).resolves.toMatchObject({
      records: 2,
      relations: 1,
      operations: 2,
      outbox: 2,
      links: 1,
      snapshots: 1,
      snapshotRelations: 1,
    });
    await expect(scopedCounts(restored, 'quality-install-b')).resolves.toMatchObject({
      records: 2,
      relations: 1,
      operations: 2,
      outbox: 2,
      links: 1,
      snapshots: 1,
      snapshotRelations: 1,
    });
  });
});
