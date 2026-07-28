import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { loadCatalog } from '@/src/domain/catalog';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import { getRecord, upsertRecord } from '@/src/db/records';
import { upsertSourceSnapshot } from '@/src/db/sources';
import { applyDirectSourceRecords } from '@/src/providers/direct-source-sync';
import { listSyncConflicts, resolveSyncConflict } from '@/src/providers/merge';
import { MemoryDb } from '../helpers/memory-db';

const manifest = loadCatalog().activeManifest;
const now = '2026-07-23T00:00:00.000Z';

function clone(record: CanonicalRecord): CanonicalRecord {
  return JSON.parse(JSON.stringify(record)) as CanonicalRecord;
}

async function seedBase(db: MemoryDb, id: string, properties: Record<string, unknown>) {
  return upsertRecord(db as any, manifest, {
    id,
    title: id,
    collection: 'inventory',
    properties,
    relations: [],
    source: { provider: 'sqlite', external_id: id, url: null, observed_at: now, content_hash: 'local-base' },
    archived_at: null,
    created_at: now,
    updated_at: now,
  });
}

async function seedCanonicalSnapshot(db: MemoryDb, record: CanonicalRecord, externalId: string) {
  await upsertSourceSnapshot(db as any, {
    id: `notion-snapshot-${externalId}`,
    provider: 'notion',
    external_id: externalId,
    scope: manifest.id,
    observed_at: now,
    payload_json: JSON.stringify({ provider_payload: { id: externalId }, canonical_record: record }),
    checksum: 'snapshot-base',
    created_at: now,
    updated_at: now,
  });
}

describe('applyDirectSourceRecords', () => {
  it('keeps local high-risk edits and creates Needs Review on direct provider pull', async () => {
    const db = new MemoryDb();
    const base = await seedBase(db, 'direct-sync-yogurt', { body: 'Base yogurt', quantity: 2 });
    await seedCanonicalSnapshot(db, base, 'page-yogurt');
    const local = await upsertRecord(db as any, manifest, { ...base, properties: { ...base.properties, quantity: 1 } });
    const remote = clone(base);
    remote.source = { provider: 'notion', external_id: 'page-yogurt', url: 'https://notion.so/page-yogurt', observed_at: now, content_hash: 'remote-yogurt' };
    remote.properties = { ...remote.properties, quantity: 4 };

    await applyDirectSourceRecords(db as any, manifest, [remote], [{
      id: 'notion-snapshot-page-yogurt',
      provider: 'notion',
      externalId: 'page-yogurt',
      payload: { id: 'page-yogurt', quantity: 4 },
      checksum: 'remote-yogurt',
    }], {
      provider: 'notion',
      externalId: 'food-db',
      name: 'Notion',
      workspace: 'Utopia',
      url: 'https://notion.so/food-db',
      observedAt: now,
    });

    const saved = await getRecord(db as any, 'direct-sync-yogurt');
    const conflicts = await listSyncConflicts(db as any);
    expect(saved?.revision).toBe(local.revision);
    expect(saved?.properties.quantity).toBe(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].fields).toContain('quantity');
    expect(db.sourceSnapshots.get('notion-snapshot-page-yogurt')?.payload_json).toContain('canonical_record');
  });

  it('auto-merges disjoint direct provider pulls through operations', async () => {
    const db = new MemoryDb();
    const base = await seedBase(db, 'direct-sync-dal', { body: 'Base body', aisle: 'Pantry' });
    await seedCanonicalSnapshot(db, base, 'page-dal');
    const local = await upsertRecord(db as any, manifest, { ...base, properties: { ...base.properties, body: 'Local dinner note' } });
    const remote = clone(base);
    remote.source = { provider: 'notion', external_id: 'page-dal', url: 'https://notion.so/page-dal', observed_at: now, content_hash: 'remote-dal' };
    remote.properties = { ...remote.properties, aisle: 'Kitchen shelf' };

    await applyDirectSourceRecords(db as any, manifest, [remote], [{
      id: 'notion-snapshot-page-dal',
      provider: 'notion',
      externalId: 'page-dal',
      payload: { id: 'page-dal', aisle: 'Kitchen shelf' },
      checksum: 'remote-dal',
    }], {
      provider: 'notion',
      externalId: 'food-db',
      name: 'Notion',
      workspace: 'Utopia',
      url: 'https://notion.so/food-db',
      observedAt: now,
    });

    const saved = await getRecord(db as any, 'direct-sync-dal');
    expect(saved?.revision).toBe(local.revision + 1);
    expect(saved?.properties.body).toBe('Local dinner note');
    expect(saved?.properties.aisle).toBe('Kitchen shelf');
    expect(db.conflicts.size).toBe(0);
  });

  it('resolves a direct provider conflict through one audited operation', async () => {
    const db = new MemoryDb();
    const base = await seedBase(db, 'direct-sync-resolve', { body: 'Base body', quantity: 2 });
    await seedCanonicalSnapshot(db, base, 'page-resolve');
    await upsertRecord(db as any, manifest, { ...base, properties: { ...base.properties, quantity: 1 } });
    const remote = clone(base);
    remote.source = { provider: 'notion', external_id: 'page-resolve', url: 'https://notion.so/page-resolve', observed_at: now, content_hash: 'remote-resolve' };
    remote.properties = { ...remote.properties, quantity: 4 };

    await applyDirectSourceRecords(db as any, manifest, [remote], [{
      id: 'notion-snapshot-page-resolve',
      provider: 'notion',
      externalId: 'page-resolve',
      payload: { id: 'page-resolve', quantity: 4 },
      checksum: 'remote-resolve',
    }], {
      provider: 'notion',
      externalId: 'food-db',
      name: 'Notion',
      workspace: 'Utopia',
      url: 'https://notion.so/food-db',
      observedAt: now,
    });

    const conflicts = await listSyncConflicts(db as any);
    const operationCount = db.operations.size;
    const resolved = await resolveSyncConflict({ db: db as any, manifest, conflictId: conflicts[0].id, resolution: 'remote' });
    const saved = await getRecord(db as any, 'direct-sync-resolve');

    expect(resolved.status).toBe('resolved');
    expect(saved?.properties.quantity).toBe(4);
    expect(db.operations.size).toBe(operationCount + 1);
  });
});
