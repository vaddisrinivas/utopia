import { afterEach, describe, expect, it } from 'vitest';

import { loadCatalog } from '@/src/domain/catalog';
import { DATABASE_VERSION, getDatabaseVersion, runMigrations } from '@/src/db/migrations';
import { getRecord, upsertRecord } from '@/src/db/records';
import { undoOperation } from '@/src/ops/undo';
import { appendMessage, createConversation, getConversation } from '@/src/db/conversations';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const manifest = loadCatalog().activeManifest;
const now = '2026-07-23T00:00:00.000Z';

describe('real SQLite persistence', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) {
      db.close();
    }
  });

  it('runs migrations, persists writers, and preserves JSON queries', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);

    await runMigrations(db as any);
    expect(await getDatabaseVersion(db as any)).toBe(DATABASE_VERSION);

    const created = await upsertRecord(db as any, manifest, {
      id: 'sqlite-persistence-record',
      title: 'SQLite persistence record',
      collection: 'inventory',
      properties: {
        body: 'Initial body',
        nested: { value: 'json-one' },
        quantity: 2,
      },
      relations: [],
      source: {
        provider: 'sqlite',
        external_id: 'sqlite-persistence-record',
        url: null,
        observed_at: now,
        content_hash: null,
      },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    const updated = await upsertRecord(db as any, manifest, {
      ...created,
      operation_id: 'op-explicit-record-edit',
      properties: {
        ...created.properties,
        body: 'Updated body',
        nested: { value: 'json-two' },
      },
    });

    expect(updated.revision).toBe(created.revision + 1);
    expect(await getRecord(db as any, created.id)).toMatchObject({
      properties: { nested: { value: 'json-two' } },
    });

    const jsonRow = await db.getFirstAsync<{ nested_value: string }>(
      `SELECT json_extract(properties, '$.nested.value') AS nested_value FROM records WHERE id = ?`,
      [created.id],
    );
    expect(jsonRow?.nested_value).toBe('json-two');

    expect(await db.getFirstAsync<{ op_id: string }>(
      'SELECT op_id FROM operations WHERE op_id = ?',
      ['op-explicit-record-edit'],
    )).toEqual({ op_id: 'op-explicit-record-edit' });
    expect((await undoOperation(db as any, manifest, 'op-explicit-record-edit')).status).toBe('applied');
    expect(await getRecord(db as any, created.id)).toMatchObject({
      properties: { body: 'Initial body', nested: { value: 'json-one' } },
    });
  });

  it('rolls back explicit transactions on failure', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);

    await runMigrations(db as any);

    await expect(db.withTransactionAsync(async () => {
      await createConversation(db as any, {
        id: 'sqlite-rollback-conversation',
        domain: manifest.id,
        title: 'SQLite rollback conversation',
        detail: 'Should vanish on rollback',
      });
      await appendMessage(db as any, {
        id: 'sqlite-rollback-message',
        conversation_id: 'sqlite-rollback-conversation',
        role: 'user',
        sort_index: 0,
        body: 'Rollback body',
      });
      throw new Error('rollback-me');
    })).rejects.toThrow('rollback-me');

    expect(await getConversation(db as any, 'sqlite-rollback-conversation')).toBeNull();
  });

  it('enforces foreign keys on persisted conversation messages', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);

    await runMigrations(db as any);

    await expect(appendMessage(db as any, {
      id: 'sqlite-fk-message',
      conversation_id: 'missing-conversation',
      role: 'user',
      sort_index: 0,
      body: 'FK body',
    })).rejects.toThrow(/foreign key|constraint/i);
  });
});
