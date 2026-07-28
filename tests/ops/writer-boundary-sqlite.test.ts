import { afterEach, describe, expect, it } from 'vitest';

import { applyAiProposals } from '@/src/ai/runtime';
import { runMigrations } from '@/src/db/migrations';
import { getRecord, upsertRecord } from '@/src/db/records';
import { loadCatalog } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import { undoOperation } from '@/src/ops/undo';
import type { Operation } from '@/src/ops/operation';
import { NodeSqliteDb } from '../helpers/node-sqlite-db';

const manifest = loadCatalog().activeManifest;
const now = '2026-07-23T00:00:00.000Z';

type OperationRow = { op_id: string; actor: string; origin: string; status: string };

class FailingOperationInsertDb extends NodeSqliteDb {
  override async runAsync(sql: string, params: any[] | Record<string, unknown> = []) {
    if (/^\s*INSERT INTO operations\b/i.test(sql)) {
      throw new Error('operation-row-write-failed');
    }
    return super.runAsync(sql, params);
  }
}

function createUserRecord(recordId: string, idempotencyKey?: string): Operation {
  return {
    op_id: `sqlite-writer-user-create-${recordId}`,
    kind: 'create',
    domain: manifest.id,
    collection: 'inventory',
    record_id: recordId,
    record: {
      title: `SQLite writer ${recordId}`,
      properties: { body: 'User body', quantity: 1, nested: { source: 'user' } },
      relations: [],
      source: { provider: 'sqlite', external_id: recordId, url: null, observed_at: now, content_hash: null },
      archived_at: null,
    },
    actor: 'user',
    origin: 'manual',
    idempotency_key: idempotencyKey,
  };
}

function aiUpdate(recordId: string, expectedRevision: number): Operation {
  return {
    op_id: `sqlite-writer-ai-update-${recordId}`,
    kind: 'update',
    domain: manifest.id,
    collection: 'inventory',
    record_id: recordId,
    expected_revision: expectedRevision,
    changes: { body: 'AI body', nested: { source: 'ai', verified: true } },
    actor: 'ai',
    origin: 'chat',
    confidence: null,
    evidence: [`record:${recordId}`],
    reason: 'SQLite writer boundary AI update.',
  };
}

describe('writer boundary on real SQLite', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('routes user, sync, AI, and undo through durable operation rows with JSON persistence', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);
    const recordId = 'sqlite-writer-shared';

    const user = await applyOperation(db as any, manifest, createUserRecord(recordId));
    expect(user.status).toBe('applied');

    const sync = await upsertRecord(db as any, manifest, {
      ...user.record!,
      title: 'SQLite writer synced',
      properties: { ...user.record!.properties, body: 'Sync body', nested: { source: 'sync', version: 2 } },
      source: {
        provider: 'notion',
        external_id: 'sqlite-writer-notion-page',
        url: 'https://notion.so/sqlite-writer-notion-page',
        observed_at: now,
        content_hash: 'sqlite-writer-sync',
      },
      operation_actor: 'sync',
      operation_origin: 'sync',
    });

    const ai = await applyAiProposals({
      db: db as any,
      manifest,
      intent: { id: 'sqlite-writer-ai', operations: [aiUpdate(recordId, sync.revision)] },
      context: { agentId: 'executor' },
    });
    expect(ai.status).toBe('applied');

    const rows = await db.getAllAsync<OperationRow>(
      'SELECT op_id, actor, origin, status FROM operations WHERE record_id = ? ORDER BY rowid',
      [recordId],
    );
    expect(rows.map((row) => row.actor)).toEqual(['user', 'sync', 'ai']);
    expect(rows.map((row) => row.origin)).toEqual(['manual', 'sync', 'chat']);
    expect(rows.every((row) => row.status === 'applied')).toBe(true);

    const storedJson = await db.getFirstAsync<{ source: string; verified: number }>(
      "SELECT json_extract(properties, '$.nested.source') AS source, json_extract(properties, '$.nested.verified') AS verified FROM records WHERE id = ?",
      [recordId],
    );
    expect(storedJson).toEqual({ source: 'ai', verified: 1 });

    const undo = await undoOperation(db as any, manifest, `sqlite-writer-ai-update-${recordId}`);
    expect(undo.status).toBe('applied');
    expect((await undoOperation(db as any, manifest, `sqlite-writer-ai-update-${recordId}`)).status).toBe('duplicate');
    expect((await getRecord(db as any, recordId))?.properties).toMatchObject({ body: 'Sync body', nested: { source: 'sync', version: 2 } });
  });

  it('enforces operation idempotency through the actual unique index', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);
    const recordId = 'sqlite-writer-idempotent';
    const first = createUserRecord(recordId, 'sqlite-writer-idempotency-key');
    const replay = { ...createUserRecord(recordId, 'sqlite-writer-idempotency-key'), op_id: 'sqlite-writer-replay-op' };

    expect((await applyOperation(db as any, manifest, first)).status).toBe('applied');
    expect((await applyOperation(db as any, manifest, replay)).status).toBe('duplicate');
    expect(await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM operations WHERE idempotency_key = ?', ['sqlite-writer-idempotency-key'])).toEqual({ count: 1 });
    expect((await getRecord(db as any, recordId))?.revision).toBe(1);
  });

  it('rolls back the record when SQLite rejects the operation row constraint/write', async () => {
    const db = new FailingOperationInsertDb();
    dbs.push(db);
    await runMigrations(db as any);
    const recordId = 'sqlite-writer-atomic-rollback';

    await expect(applyOperation(db as any, manifest, createUserRecord(recordId))).rejects.toThrow('operation-row-write-failed');
    expect(await getRecord(db as any, recordId)).toBeNull();
    expect(await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM outbox_events WHERE domain = ?', [manifest.id])).toEqual({ count: 0 });
  });
});
