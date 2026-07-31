import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadCatalog } from '@/src/domain/catalog';
import { runMigrations } from '@/src/db/migrations';
import { listRecordsForDomainAndInstallation, upsertRecord } from '@/src/db/records';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

describe('record list relation loading', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('loads all listed record relations with one batch query', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);
    const manifest = loadCatalog().activeManifest;
    const source = (id: string) => ({
      provider: 'sqlite' as const,
      external_id: id,
      url: null,
      observed_at: '2026-07-30T00:00:00.000Z',
      content_hash: null,
    });

    await upsertRecord(db as any, manifest, {
      id: 'batch-record-a',
      title: 'Batch A',
      collection: 'inventory',
      properties: {},
      relations: [{ name: 'links', target_id: 'target-a' }],
      source: source('batch-record-a'),
      archived_at: null,
      created_at: '2026-07-30T00:00:00.000Z',
      updated_at: '2026-07-30T00:00:00.000Z',
    });
    await upsertRecord(db as any, manifest, {
      id: 'batch-record-b',
      title: 'Batch B',
      collection: 'inventory',
      properties: {},
      relations: [{ name: 'links', target_id: 'target-b' }],
      source: source('batch-record-b'),
      archived_at: null,
      created_at: '2026-07-30T00:00:00.000Z',
      updated_at: '2026-07-30T00:00:00.000Z',
    });

    const relationQueries = vi.spyOn(db, 'getAllAsync').mockImplementation(async (sql: string, params?: any) => {
      return (await (NodeSqliteDb.prototype.getAllAsync as any).call(db, sql, params)) as any;
    });
    const records = await listRecordsForDomainAndInstallation(db as any, 'default', manifest.id, 'inventory');

    expect(records.map((record) => record.id)).toEqual(expect.arrayContaining(['batch-record-a', 'batch-record-b']));
    expect(records.find((record) => record.id === 'batch-record-a')?.relations).toEqual([{ name: 'links', target_id: 'target-a' }]);
    expect(records.find((record) => record.id === 'batch-record-b')?.relations).toEqual([{ name: 'links', target_id: 'target-b' }]);
    expect(relationQueries.mock.calls.filter(([sql]) => sql.includes('FROM record_relations'))).toHaveLength(1);
  });
});
