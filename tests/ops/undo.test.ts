import { describe, expect, it } from 'vitest';

import { loadCatalog } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import { undoOperation } from '@/src/ops/undo';
import { MemoryDb } from '../helpers/memory-db';

const manifest = loadCatalog().activeManifest;

async function createRecord(db: any, id = 'undo-record') {
  return applyOperation(db, manifest, {
    op_id: `create-${id}`,
    kind: 'create',
    domain: manifest.id,
    collection: 'inventory',
    record_id: id,
    record: {
      title: 'Undo yogurt',
      properties: { body: 'Original', quantity: 2 },
      relations: [],
      source: { provider: 'sqlite', external_id: id, url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
      archived_at: null,
    },
    actor: 'user',
    origin: 'manual',
  });
}

describe('undoOperation', () => {
  it('undoes create as a soft delete', async () => {
    const db = new MemoryDb() as any;
    await createRecord(db, 'undo-create');
    const undo = await undoOperation(db, manifest, 'create-undo-create');

    expect(undo.status).toBe('applied');
    expect(db.records.get('undo-create')?.deleted).toBe(1);
    expect(db.records.get('undo-create')?.archived_at).toBeTruthy();
    expect(db.operations.get('create-undo-create')?.status).toBe('undone');
  });

  it('undoes update by restoring prior properties', async () => {
    const db = new MemoryDb() as any;
    await createRecord(db, 'undo-update');
    await applyOperation(db, manifest, {
      op_id: 'update-undo-update',
      kind: 'update',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'undo-update',
      expected_revision: 1,
      changes: { body: 'Changed', quantity: 5 },
      actor: 'user',
      origin: 'manual',
    });
    const undo = await undoOperation(db, manifest, 'update-undo-update');

    expect(undo.status).toBe('applied');
    const properties = JSON.parse(db.records.get('undo-update')?.properties);
    expect(properties.body).toBe('Original');
    expect(properties.quantity).toBe(2);
  });

  it('undoes archive and relation changes', async () => {
    const db = new MemoryDb() as any;
    await createRecord(db, 'undo-archive');
    await applyOperation(db, manifest, {
      op_id: 'archive-undo-archive',
      kind: 'archive',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'undo-archive',
      expected_revision: 1,
      actor: 'user',
      origin: 'manual',
    });
    const archiveUndo = await undoOperation(db, manifest, 'archive-undo-archive');
    expect(archiveUndo.status).toBe('applied');
    expect(db.records.get('undo-archive')?.archived_at).toBeNull();

    await applyOperation(db, manifest, {
      op_id: 'relate-undo-archive',
      kind: 'relate',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'undo-archive',
      expected_revision: 3,
      relations_add: [{ name: 'uses', target_id: 'recipe-tandoori' }],
      actor: 'user',
      origin: 'manual',
    });
    expect(db.recordRelations.length).toBe(1);
    const relationUndo = await undoOperation(db, manifest, 'relate-undo-archive');
    expect(relationUndo.status).toBe('applied');
    expect(db.recordRelations.length).toBe(0);
  });
});
