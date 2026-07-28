import { describe, expect, it } from 'vitest';

import { loadCatalog } from '@/src/domain/catalog';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import { upsertRecord, getRecord } from '@/src/db/records';
import { listSyncConflicts, mergeRemoteRecord, resolveSyncConflict } from '@/src/providers/merge';
import { MemoryDb } from '../helpers/memory-db';

const manifest = loadCatalog().activeManifest;
const now = '2026-07-23T00:00:00.000Z';

function clone(record: CanonicalRecord): CanonicalRecord {
  return JSON.parse(JSON.stringify(record)) as CanonicalRecord;
}

describe('mergeRemoteRecord', () => {
  it('auto-applies disjoint remote changes through operations', async () => {
    const db = new MemoryDb() as any;
    const base = await upsertRecord(db, manifest, {
      id: 'merge-test',
      title: 'Merge test',
      collection: 'inventory',
      properties: { body: 'Base', aisle: 'Dairy', quantity: 2 },
      relations: [],
      source: { provider: 'sqlite', external_id: 'merge-test', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    const local = await upsertRecord(db, manifest, { ...base, properties: { ...base.properties, body: 'Local body' } });
    const remote = clone(base);
    remote.properties = { ...remote.properties, aisle: 'Cold case' };
    remote.source = { provider: 'notion', external_id: 'merge-page', url: 'https://notion.so/merge-page', observed_at: now, content_hash: 'remote-1' };

    const result = await mergeRemoteRecord({ db, manifest, provider: 'notion', externalId: 'merge-page', base, local, remote });
    const saved = await getRecord(db, 'merge-test');

    expect(result.status).toBe('applied');
    expect(saved?.properties.body).toBe('Local body');
    expect(saved?.properties.aisle).toBe('Cold case');
    expect(db.conflicts.size).toBe(0);
  });

  it('creates a Needs Review conflict for overlapping high-risk fields', async () => {
    const db = new MemoryDb() as any;
    const base = await upsertRecord(db, manifest, {
      id: 'merge-conflict',
      title: 'Merge conflict',
      collection: 'inventory',
      properties: { body: 'Base', quantity: 2 },
      relations: [],
      source: { provider: 'sqlite', external_id: 'merge-conflict', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    const local = await upsertRecord(db, manifest, { ...base, properties: { ...base.properties, quantity: 1 } });
    const remote = clone(base);
    remote.properties = { ...remote.properties, quantity: 4 };
    remote.source = { provider: 'google_sheets', external_id: 'row-2', url: 'https://docs.google.com/spreadsheets/d/x/edit', observed_at: now, content_hash: 'remote-2' };

    const result = await mergeRemoteRecord({ db, manifest, provider: 'google_sheets', externalId: 'row-2', base, local, remote });
    const saved = await getRecord(db, 'merge-conflict');

    expect(result.status).toBe('needs_review');
    expect(saved?.properties.quantity).toBe(1);
    expect(db.conflicts.size).toBe(1);
    const conflictRow = Array.from((db as MemoryDb).conflicts.values())[0];
    expect(conflictRow.fields_json).toContain('quantity');
  });

  it('resolves a conflict by choosing remote through one operation', async () => {
    const db = new MemoryDb() as any;
    const base = await upsertRecord(db, manifest, {
      id: 'merge-resolve-remote',
      title: 'Merge resolve remote',
      collection: 'inventory',
      properties: { body: 'Base', quantity: 2 },
      relations: [],
      source: { provider: 'sqlite', external_id: 'merge-resolve-remote', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    const local = await upsertRecord(db, manifest, { ...base, properties: { ...base.properties, quantity: 1 } });
    const remote = clone(base);
    remote.properties = { ...remote.properties, quantity: 4 };
    remote.source = { provider: 'notion', external_id: 'remote-page', url: 'https://notion.so/remote-page', observed_at: now, content_hash: 'remote-3' };

    const result = await mergeRemoteRecord({ db, manifest, provider: 'notion', externalId: 'remote-page', base, local, remote });
    expect(result.status).toBe('needs_review');

    const pending = await listSyncConflicts(db);
    expect(pending).toHaveLength(1);
    const resolved = await resolveSyncConflict({ db, manifest, conflictId: pending[0].id, resolution: 'remote' });
    const saved = await getRecord(db, 'merge-resolve-remote');
    const row = (db as MemoryDb).conflicts.get(pending[0].id);

    expect(resolved.status).toBe('resolved');
    expect(saved?.properties.quantity).toBe(4);
    expect(row?.status).toBe('resolved');
    expect(row?.resolution_op_id).toBeTruthy();
  });

  it('resolves a conflict by keeping local without writing a new record operation', async () => {
    const db = new MemoryDb() as any;
    const base = await upsertRecord(db, manifest, {
      id: 'merge-resolve-local',
      title: 'Merge resolve local',
      collection: 'inventory',
      properties: { body: 'Base', quantity: 2 },
      relations: [],
      source: { provider: 'sqlite', external_id: 'merge-resolve-local', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    const local = await upsertRecord(db, manifest, { ...base, properties: { ...base.properties, quantity: 1 } });
    const remote = clone(base);
    remote.properties = { ...remote.properties, quantity: 4 };
    remote.source = { provider: 'google_sheets', external_id: 'row-local', url: 'https://docs.google.com/spreadsheets/d/x/edit', observed_at: now, content_hash: 'remote-4' };

    const result = await mergeRemoteRecord({ db, manifest, provider: 'google_sheets', externalId: 'row-local', base, local, remote });
    expect(result.status).toBe('needs_review');
    const operationCount = (db as MemoryDb).operations.size;
    const pending = await listSyncConflicts(db);

    const resolved = await resolveSyncConflict({ db, manifest, conflictId: pending[0].id, resolution: 'local' });
    const saved = await getRecord(db, 'merge-resolve-local');
    const row = (db as MemoryDb).conflicts.get(pending[0].id);

    expect(resolved.status).toBe('resolved');
    expect(saved?.properties.quantity).toBe(1);
    expect((db as MemoryDb).operations.size).toBe(operationCount);
    expect(row?.status).toBe('resolved');
    expect(row?.resolution_op_id).toBeNull();
  });
});
