import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadCatalog } from '../../src/domain/catalog';
import type { CanonicalRecord } from '../../src/domain/runtime';
import { upsertRecord, getRecord } from '../../src/db/records';
import { listSyncConflicts, mergeRemoteRecord, resolveSyncConflict } from '../../src/providers/merge';

type Row = Record<string, any>;

function recordKey(appInstallationId: string, id: string) {
  return `${appInstallationId}:${id}`;
}

class MemoryDb {
  records = new Map<string, Row>();
  recordRelations: Row[] = [];
  operations = new Map<string, Row>();
  conflicts = new Map<string, Row>();
  outbox = new Map<string, Row>();

  async execAsync(_sql: string) {}

  async withTransactionAsync(fn: () => Promise<void>) {
    await fn();
  }

  async runAsync(sql: string, params: any[] = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('INSERT INTO records')) {
      const [app_installation_id, id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json] = params;
      this.records.set(recordKey(app_installation_id, id), { app_installation_id, id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json });
      return;
    }
    if (compact === 'DELETE FROM record_relations WHERE app_installation_id = ? AND from_id = ?') {
      this.recordRelations = this.recordRelations.filter((row) => !(row.app_installation_id === params[0] && row.from_id === params[1]));
      return;
    }
    if (compact.startsWith('INSERT INTO record_relations')) {
      const [app_installation_id, from_id, collection, name, target_id, target_domain, target_collection, created_at] = params;
      this.recordRelations = this.recordRelations.filter((row) => !(row.app_installation_id === app_installation_id && row.from_id === from_id && row.name === name && row.target_id === target_id));
      this.recordRelations.push({ app_installation_id, from_id, collection, name, target_id, target_domain, target_collection, created_at });
      return;
    }
    if (compact.startsWith('INSERT INTO operations')) {
      const [op_id, app_installation_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at] = params;
      this.operations.set(op_id, { op_id, app_installation_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at });
      return;
    }
    if (compact.startsWith('INSERT INTO outbox_events')) {
      const [id, app_installation_id, action_key, domain, payload_json, status, created_at, updated_at] = params;
      this.outbox.set(id, { id, app_installation_id, action_key, domain, payload_json, status, attempts: 0, last_error: null, created_at, updated_at });
      return;
    }
    if (compact.startsWith('INSERT INTO sync_conflicts')) {
      const [id, domain, collection, record_id, provider, external_id, fields_json, base_json, local_json, remote_json, status, resolution_op_id, created_at, resolved_at] = params;
      this.conflicts.set(id, { id, domain, collection, record_id, provider, external_id, fields_json, base_json, local_json, remote_json, status, resolution_op_id, created_at, resolved_at });
      return;
    }
    if (compact === 'UPDATE sync_conflicts SET status = ?, resolution_op_id = ?, resolved_at = ? WHERE id = ?') {
      const [status, resolution_op_id, resolved_at, id] = params;
      const row = this.conflicts.get(id);
      if (row) {
        row.status = status;
        row.resolution_op_id = resolution_op_id;
        row.resolved_at = resolved_at;
      }
      return;
    }
    throw new Error(`Unsupported runAsync SQL: ${compact}`);
  }

  async getFirstAsync<T>(sql: string, params: any[] = []): Promise<T | null> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT * FROM records WHERE app_installation_id = ? AND id = ?') {
      return (this.records.get(recordKey(params[0], params[1])) ?? null) as T | null;
    }
    if (compact === 'SELECT op_id, app_installation_id, after_json, status FROM operations WHERE app_installation_id = ? AND idempotency_key = ?') {
      const row = Array.from(this.operations.values()).find((item) => item.app_installation_id === params[0] && item.idempotency_key === params[1]);
      return (row ? { op_id: row.op_id, app_installation_id: row.app_installation_id, after_json: row.after_json, status: row.status } : null) as T | null;
    }
    if (compact === 'SELECT * FROM operations WHERE app_installation_id = ? AND op_id = ?') {
      const row = this.operations.get(params[1]);
      return (row?.app_installation_id === params[0] ? row : null) as T | null;
    }
    if (compact === 'SELECT * FROM sync_conflicts WHERE id = ?') {
      return (this.conflicts.get(params[0]) ?? null) as T | null;
    }
    throw new Error(`Unsupported getFirstAsync SQL: ${compact}`);
  }

  async getAllAsync<T>(sql: string, params: any[] = []): Promise<T[]> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT name, target_id FROM record_relations WHERE app_installation_id = ? AND from_id = ?') {
      return this.recordRelations
        .filter((row) => row.app_installation_id === params[0] && row.from_id === params[1])
        .map((row) => ({ name: row.name, target_id: row.target_id })) as T[];
    }
    if (compact === 'SELECT * FROM sync_conflicts WHERE status = ? ORDER BY created_at DESC') {
      return Array.from(this.conflicts.values())
        .filter((row) => row.status === params[0])
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at))) as T[];
    }
    throw new Error(`Unsupported getAllAsync SQL: ${compact}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone(record: CanonicalRecord): CanonicalRecord {
  return JSON.parse(JSON.stringify(record)) as CanonicalRecord;
}

(async () => {
  const db = new MemoryDb() as any;
  const proofDb = db as MemoryDb;
  const manifest = loadCatalog().activeManifest;
  const now = new Date().toISOString();

  const base = await upsertRecord(db, manifest, {
    id: 'merge-yogurt',
    title: 'Merge yogurt',
    collection: 'inventory',
    properties: { body: 'Original note', quantity: 2, aisle: 'Dairy' },
    relations: [],
    source: { provider: 'sqlite', external_id: 'merge-yogurt', url: null, observed_at: now, content_hash: null },
    archived_at: null,
    created_at: now,
    updated_at: now,
  });

  const local = await upsertRecord(db, manifest, {
    ...base,
    properties: { ...base.properties, body: 'Local note changed' },
  });
  const remoteDisjoint = clone(base);
  remoteDisjoint.properties = { ...remoteDisjoint.properties, aisle: 'Cold case' };
  remoteDisjoint.source = { provider: 'notion', external_id: 'merge-yogurt-page', url: 'https://notion.so/merge-yogurt-page', observed_at: now, content_hash: 'remote-1' };
  const applied = await mergeRemoteRecord({
    db,
    manifest,
    provider: 'notion',
    externalId: 'merge-yogurt-page',
    base,
    local,
    remote: remoteDisjoint,
  });
  assert(applied.status === 'applied', `disjoint merge status ${applied.status}`);
  const afterApply = await getRecord(db, 'merge-yogurt');
  assert(afterApply?.properties.body === 'Local note changed', 'disjoint merge lost local body');
  assert(afterApply?.properties.aisle === 'Cold case', 'disjoint merge did not apply remote aisle');
  assert(proofDb.conflicts.size === 0, 'disjoint merge created conflict');

  const baseAfterApply = clone(afterApply!);
  const localQuantity = await upsertRecord(db, manifest, {
    ...baseAfterApply,
    properties: { ...baseAfterApply.properties, quantity: 1 },
  });
  const remoteQuantity = clone(baseAfterApply);
  remoteQuantity.properties = { ...remoteQuantity.properties, quantity: 4 };
  remoteQuantity.source = { provider: 'notion', external_id: 'merge-yogurt-page', url: 'https://notion.so/merge-yogurt-page', observed_at: now, content_hash: 'remote-2' };
  const conflict = await mergeRemoteRecord({
    db,
    manifest,
    provider: 'notion',
    externalId: 'merge-yogurt-page',
    base: baseAfterApply,
    local: localQuantity,
    remote: remoteQuantity,
  });
  assert(conflict.status === 'needs_review', `quantity conflict status ${conflict.status}`);
  const afterConflict = await getRecord(db, 'merge-yogurt');
  assert(afterConflict?.properties.quantity === 1, 'conflict silently overwrote local quantity');
  const conflictCount = Array.from(proofDb.conflicts.values()).length;
  assert(conflictCount === 1, `expected one conflict, got ${conflictCount}`);
  const conflictRow = Array.from(proofDb.conflicts.values())[0];
  assert(String(conflictRow.fields_json).includes('quantity'), 'conflict row did not name quantity');
  const pending = await listSyncConflicts(db);
  assert(pending.length === 1, `expected one pending conflict, got ${pending.length}`);
  const operationCountBeforeResolve = proofDb.operations.size;
  const resolved = await resolveSyncConflict({
    db,
    manifest,
    conflictId: pending[0].id,
    resolution: 'remote',
  });
  assert(resolved.status === 'resolved', `conflict resolve status ${resolved.status}`);
  const afterResolve = await getRecord(db, 'merge-yogurt');
  assert(afterResolve?.properties.quantity === 4, 'remote resolution did not apply provider quantity');
  const resolvedRow = proofDb.conflicts.get(pending[0].id);
  assert(resolvedRow?.status === 'resolved', 'conflict row not marked resolved');
  assert(Boolean(resolvedRow?.resolution_op_id), 'conflict row missing resolution operation id');
  assert(proofDb.operations.size === operationCountBeforeResolve + 1, 'remote resolution did not write exactly one operation');

  const outDir = join(process.cwd(), 'app', 'build', 'evidence', 'sync-merge');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'sync-merge-proof.json');
  writeFileSync(outPath, JSON.stringify({
    proof: 'sync_merge_conflict',
    disjoint: {
      status: applied.status,
      body: afterApply?.properties.body,
      aisle: afterApply?.properties.aisle,
    },
    conflict: {
      status: conflict.status,
      fields: JSON.parse(conflictRow.fields_json),
      localQuantityPreserved: afterConflict?.properties.quantity,
      conflictRows: proofDb.conflicts.size,
      pendingBeforeResolve: pending.length,
      resolutionStatus: resolved.status,
      resolvedQuantity: afterResolve?.properties.quantity,
      resolutionOperationId: resolvedRow?.resolution_op_id,
    },
    operations: proofDb.operations.size,
    all_passed: true,
  }, null, 2));
  console.log(`PASS ${outPath}`);
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
