import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { loadCatalog } from '../../src/domain/catalog';
import { upsertRecord, getRecord } from '../../src/db/records';
import { exportRecoverySnapshot } from '../../src/db/migrations';
import { importRecoverySnapshot } from '../../src/db/recovery';
import { applyOperation } from '../../src/ops/apply';

type Row = Record<string, any>;

const recoveryTables = [
  'meta',
  'records',
  'record_relations',
  'conversations',
  'conversation_messages',
  'source_snapshots',
  'provider_links',
  'outbox_events',
  'action_events',
  'operations',
  'sync_conflicts',
  'config_sources',
  'config_snapshots',
  'config_conflicts',
  'app_packages',
  'app_package_state',
  'app_package_receipts',
  'undo_events',
  'workflow_runs',
  'agent_runs',
  'citations',
  'source_snapshot_relations',
] as const;

class MemoryDb {
  tables = new Map<string, Row[]>(recoveryTables.map((table) => [table, []]));

  constructor() {
    this.tables.set('meta', [{ key: 'lifecycle', value: 'ready' }, { key: 'active_domain_id', value: 'food' }]);
  }

  async execAsync(_sql: string) {}

  async withTransactionAsync(fn: () => Promise<void>) {
    await fn();
  }

  async runAsync(sql: string, params: any[] = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('INSERT INTO records')) {
      const [id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json] = params;
      this.upsert('records', { id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json }, 'id');
      return;
    }
    if (compact === 'DELETE FROM record_relations WHERE from_id = ?') {
      const [fromId] = params;
      this.setRows('record_relations', this.rows('record_relations').filter((row) => row.from_id !== fromId));
      return;
    }
    if (compact.startsWith('INSERT INTO record_relations')) {
      const [from_id, collection, name, target_id, target_domain, target_collection, created_at] = params;
      this.setRows('record_relations', this.rows('record_relations').filter((row) => !(row.from_id === from_id && row.name === name && row.target_id === target_id)));
      this.rows('record_relations').push({ from_id, collection, name, target_id, target_domain, target_collection, created_at });
      return;
    }
    if (compact.startsWith('INSERT INTO operations')) {
      const [op_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at] = params;
      this.upsert('operations', { op_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at }, 'op_id');
      return;
    }
    if (compact.startsWith('DELETE FROM ')) {
      const table = compact.split(' ')[2];
      this.setRows(table, []);
      return;
    }
    if (compact.startsWith('INSERT INTO ')) {
      const match = compact.match(/^INSERT INTO ([A-Za-z_][A-Za-z0-9_]*) \(([^)]+)\) VALUES/);
      if (!match) throw new Error(`Unsupported recovery insert: ${compact}`);
      const [, table, columnText] = match;
      const columns = columnText.split(',').map((column) => column.trim());
      const row = Object.fromEntries(columns.map((column, index) => [column, params[index] ?? null]));
      this.rows(table).push(row);
      return;
    }
    throw new Error(`Unsupported runAsync SQL: ${compact}`);
  }

  async getFirstAsync<T>(sql: string, params: any[] = []): Promise<T | null> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT * FROM records WHERE id = ?') {
      return (this.rows('records').find((row) => row.id === params[0]) ?? null) as T | null;
    }
    if (compact === 'SELECT op_id, after_json, status FROM operations WHERE idempotency_key = ?') {
      const row = this.rows('operations').find((item) => item.idempotency_key === params[0]);
      return (row ? { op_id: row.op_id, after_json: row.after_json, status: row.status } : null) as T | null;
    }
    throw new Error(`Unsupported getFirstAsync SQL: ${compact}`);
  }

  async getAllAsync<T>(sql: string, params: any[] = []): Promise<T[]> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT name, target_id FROM record_relations WHERE from_id = ?') {
      return this.rows('record_relations').filter((row) => row.from_id === params[0]).map((row) => ({ name: row.name, target_id: row.target_id })) as T[];
    }
    if (compact.startsWith('SELECT * FROM ')) {
      const table = compact.split(' ')[3];
      return this.rows(table).map((row) => ({ ...row })) as T[];
    }
    throw new Error(`Unsupported getAllAsync SQL: ${compact}`);
  }

  private rows(table: string) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  private setRows(table: string, rows: Row[]) {
    this.tables.set(table, rows);
  }

  private upsert(table: string, row: Row, key: string) {
    const rows = this.rows(table).filter((existing) => existing[key] !== row[key]);
    rows.push(row);
    this.setRows(table, rows);
  }
}

function canonicalRecordChecksum(db: MemoryDb) {
  const normalized = db.tables.get('records')!
    .map((row) => ({
      id: row.id,
      collection: row.collection,
      title: row.title,
      properties: JSON.parse(row.properties || '{}'),
      archived_at: row.archived_at,
      revision: row.revision,
      deleted: row.deleted,
      privacy: row.privacy,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

(async () => {
  const manifest = loadCatalog().activeManifest;
  const sourceDb = new MemoryDb() as any;
  const sourceProof = sourceDb as MemoryDb;
  const restoredDb = new MemoryDb() as any;
  const restoredProof = restoredDb as MemoryDb;
  const now = new Date().toISOString();

  await upsertRecord(sourceDb, manifest, {
    id: 'roundtrip-pantry-yogurt',
    title: 'Roundtrip yogurt',
    collection: 'inventory',
    properties: { status: 'Use soon', body: 'Must survive recovery.', quantity: 2 },
    relations: [],
    source: { provider: 'sqlite', external_id: 'roundtrip-pantry-yogurt', url: null, observed_at: now, content_hash: null },
    archived_at: null,
    created_at: now,
    updated_at: now,
  });
  await applyOperation(sourceDb, manifest, {
    op_id: 'roundtrip-delete-yogurt',
    kind: 'delete',
    domain: manifest.id,
    collection: 'inventory',
    record_id: 'roundtrip-pantry-yogurt',
    expected_revision: 1,
    actor: 'user',
    origin: 'manual',
    reason: 'Roundtrip tombstone proof.',
  });
  await upsertRecord(sourceDb, manifest, {
    id: 'roundtrip-meal-dal',
    title: 'Roundtrip dal',
    collection: 'meal_plan',
    properties: { status: 'Planned', body: 'Dinner stays active.' },
    relations: [{ name: 'uses', target_id: 'roundtrip-pantry-yogurt' }],
    source: { provider: 'sqlite', external_id: 'roundtrip-meal-dal', url: null, observed_at: now, content_hash: null },
    archived_at: null,
    created_at: now,
    updated_at: now,
  });
  sourceProof.tables.get('config_sources')!.push({
    id: 'roundtrip-config-local',
    kind: 'local',
    label: 'Roundtrip local config',
    location_json: JSON.stringify({ path: 'domains/food.yaml' }),
    auto_refresh: 0,
    refresh_minutes: 60,
    precedence: 1,
    enabled: 1,
    created_at: now,
    updated_at: now,
  });
  sourceProof.tables.get('config_snapshots')!.push({
    source_id: 'roundtrip-config-local',
    fetched_at: now,
    content_hash: 'roundtrip-config-hash',
    etag: null,
    raw: 'domains:\n  - food',
    validation_status: 'valid',
    error_json: null,
  });
  sourceProof.tables.get('config_conflicts')!.push({
    id: 'roundtrip-config-conflict',
    key: 'activeDomain',
    sources_json: JSON.stringify(['roundtrip-config-local']),
    reason: 'Roundtrip config conflict proof.',
    status: 'needs_review',
    created_at: now,
    resolved_at: null,
  });
  sourceProof.tables.get('workflow_runs')!.push({
    id: 'roundtrip-workflow-weekly-reset',
    domain: 'food',
    workflow_id: 'weekly-food-reset',
    inputs_json: JSON.stringify({ day: 'Thursday' }),
    status: 'cancelled',
    payload_json: JSON.stringify({
      schema_version: 'utopia.workflow-run.v1',
      run_id: 'roundtrip-workflow-weekly-reset',
      domain: 'food',
      workflow_id: 'weekly-food-reset',
      cursor: 2,
      resume_count: 1,
      steps: [
        {
          id: 'choose-dinner',
          title: 'Choose dinner',
          status: 'completed',
          receipts: [{ operation_ids: ['roundtrip-delete-yogurt'], record_ids: ['roundtrip-meal-dal'] }],
          completed_at: now,
        },
        {
          id: 'build-shopping',
          title: 'Build shopping',
          status: 'cancelled',
          receipts: [],
          cancelled_at: now,
        },
      ],
      completed_operation_ids: ['roundtrip-delete-yogurt'],
      completed_action_ids: [],
      source_ids: ['sqlite:roundtrip-meal-dal'],
      created_at: now,
      updated_at: now,
      cancelled_at: now,
      cancel_reason: 'Roundtrip proof cancellation.',
    }),
    created_at: now,
    updated_at: now,
  });

  const beforeChecksum = canonicalRecordChecksum(sourceProof);
  const snapshot = await exportRecoverySnapshot(sourceDb);
  await importRecoverySnapshot(restoredDb, snapshot);
  const afterChecksum = canonicalRecordChecksum(restoredProof);
  const tombstone = await getRecord(restoredDb, 'roundtrip-pantry-yogurt');
  const active = await getRecord(restoredDb, 'roundtrip-meal-dal');

  assert(beforeChecksum === afterChecksum, `record checksum mismatch ${beforeChecksum}/${afterChecksum}`);
  assert(tombstone?.deleted === true, 'deleted tombstone resurrected as active record');
  assert(Boolean(tombstone?.archived_at), 'deleted tombstone lost archived_at');
  assert(active?.deleted === false, 'active record imported as deleted');
  assert(active?.relations.some((relation) => relation.target_id === 'roundtrip-pantry-yogurt'), 'relation not preserved');
  assert(restoredProof.tables.get('operations')!.length === sourceProof.tables.get('operations')!.length, 'operation ledger not preserved');
  assert(restoredProof.tables.get('config_sources')!.length === 1, 'config sources not preserved');
  assert(restoredProof.tables.get('config_snapshots')!.length === 1, 'config snapshots not preserved');
  assert(restoredProof.tables.get('config_conflicts')!.length === 1, 'config conflicts not preserved');
  assert(restoredProof.tables.get('workflow_runs')!.length === 1, 'workflow runs not preserved');
  assert(restoredProof.tables.get('workflow_runs')![0].status === 'cancelled', 'workflow status not preserved');

  const outDir = join(process.cwd(), 'app', 'build', 'evidence', 'roundtrip');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'roundtrip-proof.json');
  writeFileSync(outPath, JSON.stringify({
    proof: 'recovery_roundtrip',
    schema_version: snapshot.schema_version,
    beforeChecksum,
    afterChecksum,
    records: restoredProof.tables.get('records')!.length,
    operations: restoredProof.tables.get('operations')!.length,
    config_sources: restoredProof.tables.get('config_sources')!.length,
    config_snapshots: restoredProof.tables.get('config_snapshots')!.length,
    config_conflicts: restoredProof.tables.get('config_conflicts')!.length,
    workflow_runs: restoredProof.tables.get('workflow_runs')!.length,
    workflow_cancel_resume_preserved: restoredProof.tables.get('workflow_runs')![0]?.status === 'cancelled',
    tombstone: {
      id: tombstone?.id,
      deleted: tombstone?.deleted,
      archived_at_present: Boolean(tombstone?.archived_at),
    },
    all_passed: true,
  }, null, 2));
  console.log(`PASS ${outPath}`);
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
