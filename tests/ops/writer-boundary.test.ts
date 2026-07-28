import { describe, expect, it } from 'vitest';

import { applyAiProposals } from '@/src/ai/runtime';
import { getRecord, upsertRecord } from '@/src/db/records';
import { loadCatalog } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import { undoOperation } from '@/src/ops/undo';
import type { Operation } from '@/src/ops/operation';
import { MemoryDb } from '../helpers/memory-db';

const manifest = loadCatalog().activeManifest;
const now = '2026-07-23T00:00:00.000Z';

function rowsFor(db: MemoryDb, recordId: string) {
  return Array.from(db.operations.values()).filter((row) => row.record_id === recordId);
}

function createUserRecord(recordId: string): Operation {
  return {
    op_id: `writer-user-create-${recordId}`,
    kind: 'create',
    domain: manifest.id,
    collection: 'inventory',
    record_id: recordId,
    record: {
      title: `Writer boundary ${recordId}`,
      properties: { body: 'User body', quantity: 1 },
      relations: [],
      source: { provider: 'sqlite', external_id: recordId, url: null, observed_at: now, content_hash: null },
      archived_at: null,
    },
    actor: 'user',
    origin: 'manual',
  };
}

function aiUpdate(recordId: string, expectedRevision: number): Operation {
  return {
    op_id: `writer-ai-update-${recordId}`,
    kind: 'update',
    domain: manifest.id,
    collection: 'inventory',
    record_id: recordId,
    expected_revision: expectedRevision,
    changes: { body: 'AI body' },
    actor: 'ai',
    origin: 'chat',
    confidence: null,
    evidence: [`record:${recordId}`],
    reason: 'Writer boundary AI update.',
  };
}

describe('writer boundary actors', () => {
  it('routes user, sync and AI writes for one record through operation rows', async () => {
    const db = new MemoryDb();
    const recordId = 'writer-boundary-shared';

    const user = await applyOperation(db as any, manifest, createUserRecord(recordId));
    expect(user.status).toBe('applied');

    const sync = await upsertRecord(db as any, manifest, {
      ...user.record!,
      title: 'Writer boundary synced',
      properties: { ...user.record!.properties, body: 'Sync body' },
      source: {
        provider: 'notion',
        external_id: 'writer-boundary-page',
        url: 'https://notion.so/writer-boundary-page',
        observed_at: now,
        content_hash: 'writer-boundary-sync',
      },
      operation_actor: 'sync',
      operation_origin: 'sync',
    });

    const ai = await applyAiProposals({
      db: db as any,
      manifest,
      intent: { id: 'writer-boundary-ai', operations: [aiUpdate(recordId, sync.revision)] },
      context: { agentId: 'executor' },
    });
    expect(ai.status).toBe('applied');

    const rows = rowsFor(db, recordId);
    expect(rows.map((row) => row.actor)).toEqual(['user', 'sync', 'ai']);
    expect(rows.map((row) => row.origin)).toEqual(['manual', 'sync', 'chat']);
    expect(rows.every((row) => row.status === 'applied')).toBe(true);

    const aiUndo = await undoOperation(db as any, manifest, 'writer-ai-update-writer-boundary-shared');
    expect(aiUndo.status).toBe('applied');
    const afterAiUndo = await getRecord(db as any, recordId);
    expect(afterAiUndo?.properties.body).toBe('Sync body');

    const syncRow = rows.find((row) => row.actor === 'sync')!;
    const staleSyncUndo = await undoOperation(db as any, manifest, syncRow.op_id);
    expect(staleSyncUndo.status).toBe('rejected');
    expect(staleSyncUndo.reject_reason).toBe('revision_conflict');
  });

  it('can undo current user, sync and AI operation paths', async () => {
    const db = new MemoryDb();

    const user = await applyOperation(db as any, manifest, createUserRecord('writer-current-user'));
    expect((await undoOperation(db as any, manifest, user.op_id)).status).toBe('applied');
    expect((await getRecord(db as any, 'writer-current-user'))?.deleted).toBe(true);

    const sync = await upsertRecord(db as any, manifest, {
      id: 'writer-current-sync',
      title: 'Writer current sync',
      collection: 'inventory',
      properties: { body: 'Sync current body', quantity: 1 },
      relations: [],
      source: {
        provider: 'notion',
        external_id: 'writer-current-sync-page',
        url: 'https://notion.so/writer-current-sync-page',
        observed_at: now,
        content_hash: 'writer-current-sync',
      },
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    const syncRow = rowsFor(db, sync.id).find((row) => row.actor === 'sync')!;
    expect((await undoOperation(db as any, manifest, syncRow.op_id)).status).toBe('applied');
    expect((await getRecord(db as any, sync.id))?.deleted).toBe(true);

    const aiSeed = await applyOperation(db as any, manifest, createUserRecord('writer-current-ai'));
    const ai = await applyAiProposals({
      db: db as any,
      manifest,
      intent: { id: 'writer-current-ai', operations: [aiUpdate('writer-current-ai', aiSeed.record!.revision)] },
      context: { agentId: 'executor' },
    });
    expect(ai.status).toBe('applied');
    expect((await undoOperation(db as any, manifest, 'writer-ai-update-writer-current-ai')).status).toBe('applied');
    expect((await getRecord(db as any, 'writer-current-ai'))?.properties.body).toBe('User body');
  });
});
