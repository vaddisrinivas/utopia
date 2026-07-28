import { describe, expect, it } from 'vitest';

import { undoChatAction } from '@/src/chat/client';
import { loadCatalog } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import { MemoryDb } from '../helpers/memory-db';

const manifest = loadCatalog().activeManifest;
const now = '2026-07-23T00:00:00.000Z';

async function createLocalOperation(db: any, id = 'chat-undo-record') {
  await applyOperation(db, manifest, {
    op_id: `create-${id}`,
    kind: 'create',
    domain: manifest.id,
    collection: 'inventory',
    record_id: id,
    record: {
      title: 'Chat undo yogurt',
      properties: { body: 'Original', quantity: 2 },
      relations: [],
      source: { provider: 'sqlite', external_id: id, url: null, observed_at: now, content_hash: null },
      archived_at: null,
    },
    actor: 'user',
    origin: 'manual',
  });
  return applyOperation(db, manifest, {
    op_id: `update-${id}`,
    kind: 'update',
    domain: manifest.id,
    collection: 'inventory',
    record_id: id,
    expected_revision: 1,
    changes: { body: 'Changed by chat' },
    actor: 'ai',
    origin: 'chat',
    confidence: null,
    evidence: [`record:${id}`],
    reason: 'Chat accepted update.',
  });
}

describe('undoChatAction', () => {
  it('undoes a local operation with no server URL', async () => {
    const db = new MemoryDb() as any;
    await createLocalOperation(db);

    const result = await undoChatAction({
      db,
      domainId: manifest.id,
      receipt: {
        id: 'receipt-chat-undo',
        status: 'completed',
        record_ids: ['chat-undo-record'],
        operation_ids: ['update-chat-undo-record'],
        created_at: now,
        updated_at: now,
      },
      actor: 'user',
      idempotencyKey: 'local-undo-test',
    });

    expect(result.status).toBe('completed');
    expect(result.undo_result?.success).toBe(true);
    expect(result.undo_result?.message).toBe('Undo applied locally.');
    expect(JSON.parse(db.records.get('chat-undo-record')?.properties).body).toBe('Original');
  });

  it('surfaces revision conflict as needs review instead of calling server', async () => {
    const db = new MemoryDb() as any;
    await createLocalOperation(db, 'chat-conflict-record');
    await applyOperation(db, manifest, {
      op_id: 'later-chat-conflict-record',
      kind: 'update',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'chat-conflict-record',
      expected_revision: 2,
      changes: { body: 'Later user edit' },
      actor: 'user',
      origin: 'manual',
    });

    const result = await undoChatAction({
      db,
      domainId: manifest.id,
      receipt: {
        id: 'receipt-chat-conflict',
        status: 'completed',
        record_ids: ['chat-conflict-record'],
        operation_id: 'update-chat-conflict-record',
        created_at: now,
        updated_at: now,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.undo_result?.success).toBe(false);
    expect(result.undo_result?.message).toContain('needs review');
    expect(JSON.parse(db.records.get('chat-conflict-record')?.properties).body).toBe('Later user edit');
  });
});
