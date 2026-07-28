import { describe, expect, it } from 'vitest';

import { getRecord } from '@/src/db/records';
import { loadCatalog } from '@/src/domain/catalog';
import { applyAiProposals, getAgentCapabilities, propose } from '@/src/ai/runtime';
import { applyOperation } from '@/src/ops/apply';
import type { Operation } from '@/src/ops/operation';
import { MemoryDb } from '../helpers/memory-db';

const manifest = loadCatalog().activeManifest;
const now = '2026-07-23T00:00:00.000Z';

function updateBodyOp(recordId: string, expectedRevision: number): Operation {
  return {
    op_id: `ai-update-${recordId}`,
    kind: 'update',
    domain: manifest.id,
    collection: 'inventory',
    record_id: recordId,
    expected_revision: expectedRevision,
    changes: { body: 'AI proposed body' },
    actor: 'ai',
    origin: 'chat',
    idempotency_key: `ai-update-${recordId}`,
    confidence: null,
    evidence: [`record:${recordId}`],
    reason: 'AI typed proposal test.',
  };
}

async function seedRecord(db: MemoryDb, id = 'ai-runtime-yogurt') {
  const created = await applyOperation(db as any, manifest, {
    op_id: `seed-${id}`,
    kind: 'create',
    domain: manifest.id,
    collection: 'inventory',
    record_id: id,
    record: {
      title: 'AI runtime yogurt',
      properties: { body: 'Original body', quantity: 2 },
      relations: [],
      source: { provider: 'sqlite', external_id: id, url: null, observed_at: now, content_hash: null },
      archived_at: null,
    },
    actor: 'user',
    origin: 'manual',
  });
  expect(created.status).toBe('applied');
  return created.record!;
}

describe('AI runtime contract', () => {
  it('rejects raw mutation channels before any operation apply', () => {
    const plan = propose({
      id: 'raw-sql-intent',
      raw_sql: 'UPDATE records SET title = "bad"',
      operations: [],
    }, { agentId: 'executor' }, manifest);

    expect(plan.status).toBe('rejected');
    expect(plan.rejected[0]?.reason).toBe('raw_mutation_channel_rejected');
  });

  it('rejects write proposals outside agent capability scope before apply', async () => {
    const db = new MemoryDb();
    const seeded = await seedRecord(db, 'ai-runtime-readonly');
    const result = await applyAiProposals({
      db: db as any,
      manifest,
      intent: {
        id: 'readonly-agent-write',
        operations: [updateBodyOp(seeded.id, seeded.revision)],
      },
      context: { agentId: 'retrieval' },
    });

    const saved = await getRecord(db as any, seeded.id);
    expect(result.status).toBe('rejected');
    expect(result.plan.rejected[0]?.reason).toBe('capability_scope_rejected:inventory:update');
    expect(saved?.properties.body).toBe('Original body');
    expect(db.operations.size).toBe(1);
  });

  it('dry-runs accepted AI proposals with a diff and no writes', async () => {
    const db = new MemoryDb();
    const seeded = await seedRecord(db, 'ai-runtime-dry-run');
    const result = await applyAiProposals({
      db: db as any,
      manifest,
      intent: {
        id: 'executor-dry-run',
        operations: [updateBodyOp(seeded.id, seeded.revision)],
      },
      context: { agentId: 'executor' },
      options: { dryRun: true },
    });

    const saved = await getRecord(db as any, seeded.id);
    expect(result.status).toBe('dry_run');
    expect(result.results[0]?.status).toBe('dry_run');
    expect(result.results[0]?.diff?.changed_fields).toContain('properties.body');
    expect(saved?.properties.body).toBe('Original body');
    expect(db.operations.size).toBe(1);
  });

  it('applies accepted AI proposals through the operation ledger', async () => {
    const db = new MemoryDb();
    const seeded = await seedRecord(db, 'ai-runtime-apply');
    const result = await applyAiProposals({
      db: db as any,
      manifest,
      intent: {
        id: 'executor-apply',
        operations: [updateBodyOp(seeded.id, seeded.revision)],
      },
      context: { agentId: 'executor' },
    });

    const saved = await getRecord(db as any, seeded.id);
    expect(result.status).toBe('applied');
    expect(result.results[0]?.status).toBe('applied');
    expect(saved?.properties.body).toBe('AI proposed body');
    expect(db.operations.size).toBe(2);
  });

  it('loads explicit registry capabilities', () => {
    expect(getAgentCapabilities('executor')[0]?.ops).toContain('update');
    expect(getAgentCapabilities('retrieval')[0]?.ops).toEqual([]);
  });
});
