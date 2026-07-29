import { describe, expect, it } from 'vitest';

import { loadCatalog } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import { MemoryDb } from '../helpers/memory-db';

const manifest = loadCatalog().activeManifest;
type CommittedOperationOutboxPayload = {
  schema_version: 'wonder.committed-operation.v1';
  operation_id: string;
  cause_id: string;
  domain: string;
  collection: string;
  record_id: string;
  before_revision: number;
  after_revision: number;
  changed_fields: string[];
  committed_at: string;
};

function committedOutboxRows(db: MemoryDb) {
  return Array.from(db.outbox.values()).filter((row) => row.action_key.startsWith('committed-operation:'));
}

describe('applyOperation', () => {
  it('applies creates, records one ledger row, and deduplicates idempotency keys', async () => {
    const db = new MemoryDb() as any;
    const first = await applyOperation(db, manifest, {
      op_id: 'create-yogurt',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'test-yogurt',
      record: {
        title: 'Test yogurt',
        properties: { body: 'Greek yogurt', quantity: 2 },
        relations: [],
        source: { provider: 'sqlite', external_id: 'test-yogurt', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'idem-create-yogurt',
    });
    const duplicate = await applyOperation(db, manifest, {
      op_id: 'create-yogurt-again',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'test-yogurt',
      record: {
        title: 'Different title',
        properties: { body: 'Should not write' },
        relations: [],
        source: { provider: 'sqlite', external_id: 'test-yogurt', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'idem-create-yogurt',
    });

    expect(first.status).toBe('applied');
    expect(first.record?.revision).toBe(1);
    expect(duplicate.status).toBe('duplicate');
    expect(db.records.get('test-yogurt')?.title).toBe('Test yogurt');
    expect(db.operations.size).toBe(1);
  });

  it('rejects stale revision without changing the record', async () => {
    const db = new MemoryDb() as any;
    await applyOperation(db, manifest, {
      op_id: 'create-dal',
      kind: 'create',
      domain: manifest.id,
      collection: 'meal_plan',
      record_id: 'test-dal',
      record: {
        title: 'Test dal',
        properties: { body: 'Original', quantity: 1 },
        relations: [],
        source: { provider: 'sqlite', external_id: 'test-dal', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });
    await applyOperation(db, manifest, {
      op_id: 'update-dal',
      kind: 'update',
      domain: manifest.id,
      collection: 'meal_plan',
      record_id: 'test-dal',
      expected_revision: 1,
      changes: { body: 'Updated once' },
      actor: 'user',
      origin: 'manual',
    });
    const stale = await applyOperation(db, manifest, {
      op_id: 'stale-dal',
      kind: 'update',
      domain: manifest.id,
      collection: 'meal_plan',
      record_id: 'test-dal',
      expected_revision: 1,
      changes: { body: 'Stale overwrite' },
      actor: 'user',
      origin: 'manual',
    });

    expect(stale.status).toBe('rejected');
    expect(stale.reject_reason).toBe('revision_conflict');
    expect(JSON.parse(db.records.get('test-dal')?.properties).body).toBe('Updated once');
  });

  it('rejects create on an existing record without overwriting it', async () => {
    const db = new MemoryDb() as any;
    await applyOperation(db, manifest, {
      op_id: 'create-unique-yogurt',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'unique-yogurt',
      record: {
        title: 'Original yogurt',
        properties: { body: 'Original body' },
        relations: [],
        source: { provider: 'sqlite', external_id: 'unique-yogurt', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });

    const duplicateCreate = await applyOperation(db, manifest, {
      op_id: 'create-unique-yogurt-overwrite',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'unique-yogurt',
      record: {
        title: 'Overwrite yogurt',
        properties: { body: 'Bad overwrite' },
        relations: [],
        source: { provider: 'sqlite', external_id: 'unique-yogurt', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });

    expect(duplicateCreate.status).toBe('rejected');
    expect(duplicateCreate.reject_reason).toBe('record_already_exists');
    expect(db.records.get('unique-yogurt')?.title).toBe('Original yogurt');
    expect(JSON.parse(db.records.get('unique-yogurt')?.properties).body).toBe('Original body');
  });

  it('enforces canonical revision progression across create/archive/restore and idempotent replay', async () => {
    const db = new MemoryDb() as any;
    const created = await applyOperation(db, manifest, {
      op_id: 'canonical-revision-create',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'cycle-revision',
      record: {
        title: 'Revision yogurt',
        properties: { body: 'Original', quantity: 1 },
        relations: [],
        source: { provider: 'sqlite', external_id: 'cycle-revision', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });
    expect(created.status).toBe('applied');
    expect(created.record?.revision).toBe(1);

    const archive = await applyOperation(db, manifest, {
      op_id: 'canonical-revision-archive',
      kind: 'archive',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'cycle-revision',
      expected_revision: 1,
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'idempotent-archive',
    });
    expect(archive.status).toBe('applied');
    expect(archive.record?.revision).toBe(2);
    expect(Boolean(db.records.get('cycle-revision')?.archived_at)).toBe(true);

    const archiveReplay = await applyOperation(db, manifest, {
      op_id: 'canonical-revision-archive-replay',
      kind: 'archive',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'cycle-revision',
      expected_revision: 1,
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'idempotent-archive',
    });
    expect(archiveReplay.status).toBe('duplicate');
    expect(archiveReplay.op_id).toBe('canonical-revision-archive');
    expect(db.records.get('cycle-revision')?.revision).toBe(2);

    const restore = await applyOperation(db, manifest, {
      op_id: 'canonical-revision-restore',
      kind: 'restore',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'cycle-revision',
      expected_revision: 2,
      actor: 'user',
      origin: 'manual',
    });
    expect(restore.status).toBe('applied');
    expect(restore.record?.revision).toBe(3);
    expect(db.records.get('cycle-revision')?.archived_at).toBeNull();
  });

  it('rejects invalid records without partial record writes', async () => {
    const db = new MemoryDb() as any;
    const rejected = await applyOperation(db, manifest, {
      op_id: 'bad-collection',
      kind: 'create',
      domain: manifest.id,
      collection: 'not_a_collection',
      record_id: 'bad-record',
      record: {
        title: 'Bad',
        properties: {},
        relations: [],
        source: { provider: 'sqlite', external_id: 'bad-record', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });

    expect(rejected.status).toBe('rejected');
    expect(db.records.has('bad-record')).toBe(false);
    expect(db.operations.get('bad-collection')?.status).toBe('rejected');
  });

  it('rejects operations outside the loaded domain manifest before record writes', async () => {
    const db = new MemoryDb() as any;
    const rejected = await applyOperation(db, manifest, {
      op_id: 'cross-domain-create',
      kind: 'create',
      domain: 'health',
      collection: 'inventory',
      record_id: 'cross-domain-record',
      record: {
        title: 'Wrong domain',
        properties: { body: 'Should not write' },
        relations: [],
        source: { provider: 'sqlite', external_id: 'cross-domain-record', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.reject_reason).toBe('domain_scope_rejected:health');
    expect(db.records.has('cross-domain-record')).toBe(false);
    expect(db.operations.get('cross-domain-create')?.status).toBe('rejected');
  });

  it('emits committed-operation outbox payload with operation/cause/version context after successful commit', async () => {
    const db = new MemoryDb() as any;
    type OutboxRow = {
      id: string;
      action_key: string;
      domain: string;
      payload_json: string;
      status: string;
      attempts: number;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    };
    const committed = await applyOperation(db, manifest, {
      op_id: 'outbox-committed-create',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'outbox-committed-record',
      idempotency_key: 'outbox-cause-001',
      record: {
        title: 'Outbox committed yogurt',
        properties: { body: 'Greek yogurt', quantity: 1 },
        relations: [],
        source: { provider: 'sqlite', external_id: 'outbox-committed-record', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });

    expect(committed.status).toBe('applied');
    const rows = committedOutboxRows(db) as OutboxRow[];
    const [outboxRow] = rows;
    expect(rows).toHaveLength(1);
    expect(outboxRow).toBeTruthy();
    const payload = JSON.parse(String(outboxRow.payload_json)) as CommittedOperationOutboxPayload;
    expect(outboxRow.action_key).toBe('committed-operation:food:default:outbox-committed-create');
    expect(outboxRow.domain).toBe(manifest.id);
    expect(payload).toEqual({
      schema_version: 'wonder.committed-operation.v1',
      app_installation_id: 'default',
      operation_id: 'outbox-committed-create',
      cause_id: 'outbox-cause-001',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'outbox-committed-record',
      before_revision: 0,
      after_revision: 1,
      changed_fields: ['record'],
      committed_at: committed.record!.updated_at,
    });
  });

  it('does not emit committed-operation events for duplicate, rejected, or dry-run operations', async () => {
    const db = new MemoryDb() as any;
    const first = await applyOperation(db, manifest, {
      op_id: 'outbox-filter-first',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'outbox-filter-record',
      idempotency_key: 'outbox-filter-id',
      record: {
        title: 'Outbox filter yogurt',
        properties: { body: 'Greek yogurt', quantity: 2 },
        relations: [],
        source: { provider: 'sqlite', external_id: 'outbox-filter-record', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });
    expect(first.status).toBe('applied');
    const afterFirstOutboxCount = committedOutboxRows(db).length;

    const duplicate = await applyOperation(db, manifest, {
      op_id: 'outbox-filter-first-replay',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'outbox-filter-record',
      idempotency_key: 'outbox-filter-id',
      record: {
        title: 'Outbox should not overwrite',
        properties: { body: 'No-op body', quantity: 9 },
        relations: [],
        source: { provider: 'sqlite', external_id: 'outbox-filter-record', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });

    const rejected = await applyOperation(db, manifest, {
      op_id: 'outbox-filter-cross-domain',
      kind: 'create',
      domain: 'health',
      collection: 'inventory',
      record_id: 'outbox-filter-rejected',
      record: {
        title: 'Rejected domain write',
        properties: { body: 'Should not write' },
        relations: [],
        source: { provider: 'sqlite', external_id: 'outbox-filter-rejected', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });

    const dryRun = await applyOperation(db, manifest, {
      op_id: 'outbox-filter-dry-run',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'outbox-filter-dry',
      record: {
        title: 'Dry run yogurt',
        properties: { body: 'Dry body', quantity: 1 },
        relations: [],
        source: { provider: 'sqlite', external_id: 'outbox-filter-dry', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    }, { dryRun: true });

    expect(duplicate.status).toBe('duplicate');
    expect(rejected.status).toBe('rejected');
    expect(dryRun.status).toBe('dry_run');
    expect(committedOutboxRows(db)).toHaveLength(afterFirstOutboxCount);
    expect(db.records.has('outbox-filter-record')).toBe(true);
    expect(db.records.has('outbox-filter-dry')).toBe(false);
    expect(db.operations.has('outbox-filter-cross-domain')).toBe(true);
    expect(db.operations.get('outbox-filter-cross-domain')?.status).toBe('rejected');
  });

  it('keeps event and operation mutation atomic: failed outbox enqueue rolls back canonical mutation', async () => {
    class OutboxWriteFailureDb extends MemoryDb {
      override async runAsync(sql: string, params: any[] = []) {
        const compact = sql.replace(/\s+/g, ' ').trim();
        if (compact.startsWith('INSERT INTO outbox_events')) {
          throw new Error('outbox write failure');
        }
        return super.runAsync(sql, params);
      }
    }

    const db = new OutboxWriteFailureDb() as any;
    const attempt = applyOperation(db, manifest, {
      op_id: 'outbox-failed-commit',
      kind: 'create',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'outbox-failed-record',
      record: {
        title: 'Outbox rollback yogurt',
        properties: { body: 'Rollback body', quantity: 2 },
        relations: [],
        source: { provider: 'sqlite', external_id: 'outbox-failed-record', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
    });

    await expect(attempt).rejects.toThrow('outbox write failure');
    expect(db.records.size).toBe(0);
    expect(db.operations.size).toBe(0);
    expect(db.outbox.size).toBe(0);
  });
});
