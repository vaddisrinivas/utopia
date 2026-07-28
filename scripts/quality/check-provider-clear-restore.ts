import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadCatalog } from '../../src/domain/catalog';
import { upsertRecord, getRecord } from '../../src/db/records';
import { linkSnapshotToRecord, upsertProviderLink, upsertSourceSnapshot } from '../../src/db/sources';
import { applyOperation } from '../../src/ops/apply';
import { undoOperation } from '../../src/ops/undo';
import { clearProviderLocalCopy, disconnectProviderLocalCopy, restoreClearedProviderLocalCopy } from '../../src/providers/provider-local-copy';

type Row = Record<string, any>;

class MemoryDb {
  records = new Map<string, Row>();
  recordRelations: Row[] = [];
  sourceSnapshots = new Map<string, Row>();
  providerLinks = new Map<string, Row>();
  snapshotRelations: Row[] = [];
  operations = new Map<string, Row>();
  outbox = new Map<string, Row>();

  async withTransactionAsync(fn: () => Promise<void>) {
    await fn();
  }

  async runAsync(sql: string, params: any[] = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('INSERT INTO records')) {
      const [id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json] = params;
      this.records.set(id, { id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json });
      return;
    }
    if (compact === 'DELETE FROM record_relations WHERE from_id = ?') {
      const [fromId] = params;
      this.recordRelations = this.recordRelations.filter((row) => row.from_id !== fromId);
      return;
    }
    if (compact.startsWith('INSERT INTO record_relations')) {
      const [from_id, collection, name, target_id, target_domain, target_collection, created_at] = params;
      this.recordRelations = this.recordRelations.filter((row) => !(row.from_id === from_id && row.name === name && row.target_id === target_id));
      this.recordRelations.push({ from_id, collection, name, target_id, target_domain, target_collection, created_at });
      return;
    }
    if (compact.startsWith('INSERT INTO provider_links')) {
      const [id, provider, external_id, name, status, freshness, workspace, url, created_at, updated_at] = params;
      this.providerLinks.set(id, { id, provider, external_id, name, status, freshness, workspace, url, created_at, updated_at });
      return;
    }
    if (compact.startsWith('INSERT INTO source_snapshots')) {
      const [id, provider, external_id, scope, observed_at, payload_json, checksum, created_at, updated_at] = params;
      this.sourceSnapshots.set(id, { id, provider, external_id, scope, observed_at, payload_json, checksum, created_at, updated_at });
      return;
    }
    if (compact.startsWith('INSERT OR IGNORE INTO source_snapshot_relations')) {
      const [snapshot_id, record_id] = params;
      if (!this.snapshotRelations.some((row) => row.snapshot_id === snapshot_id && row.record_id === record_id)) {
        this.snapshotRelations.push({ snapshot_id, record_id });
      }
      return;
    }
    if (compact.startsWith('INSERT INTO operations')) {
      const [op_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at] = params;
      this.operations.set(op_id, { op_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at });
      return;
    }
    if (compact.startsWith('INSERT INTO outbox_events')) {
      const [id, action_key, domain, payload_json, status, created_at, updated_at] = params;
      this.outbox.set(id, { id, action_key, domain, payload_json, status, attempts: 0, last_error: null, created_at, updated_at });
      return;
    }
    if (compact === 'UPDATE outbox_events SET status = ?, last_error = ?, updated_at = ? WHERE id = ?') {
      const [status, last_error, updated_at, id] = params;
      const row = this.outbox.get(id);
      if (row) {
        row.status = status;
        row.last_error = last_error;
        row.updated_at = updated_at;
      }
      return;
    }
    if (compact === 'UPDATE outbox_events SET attempts = attempts + ?, status = ?, last_error = ?, updated_at = ? WHERE id = ?') {
      const [attemptsDelta, status, last_error, updated_at, id] = params;
      const row = this.outbox.get(id);
      if (row) {
        row.attempts = Number(row.attempts ?? 0) + Number(attemptsDelta ?? 0);
        row.status = status;
        row.last_error = last_error;
        row.updated_at = updated_at;
      }
      return;
    }
    if (compact === 'UPDATE operations SET status = ? WHERE op_id = ?') {
      const [status, opId] = params;
      const row = this.operations.get(opId);
      if (row) row.status = status;
      return;
    }
    if (compact.startsWith('DELETE FROM record_relations WHERE from_id IN')) {
      const [provider] = params;
      this.recordRelations = this.recordRelations.filter((row) => this.records.get(row.from_id)?.source_provider !== provider && this.records.get(row.target_id)?.source_provider !== provider);
      return;
    }
    if (compact.startsWith('DELETE FROM source_snapshot_relations')) {
      const [provider] = params;
      this.snapshotRelations = this.snapshotRelations.filter((row) => this.sourceSnapshots.get(row.snapshot_id)?.provider !== provider && this.records.get(row.record_id)?.source_provider !== provider);
      return;
    }
    if (compact === 'DELETE FROM source_snapshots WHERE provider = ?') {
      const [provider] = params;
      for (const [id, row] of Array.from(this.sourceSnapshots.entries())) if (row.provider === provider) this.sourceSnapshots.delete(id);
      return;
    }
    if (compact === 'DELETE FROM provider_links WHERE provider = ?') {
      const [provider] = params;
      for (const [id, row] of Array.from(this.providerLinks.entries())) if (row.provider === provider) this.providerLinks.delete(id);
      return;
    }
    if (compact === 'DELETE FROM records WHERE source_provider = ?') {
      const [provider] = params;
      for (const [id, row] of Array.from(this.records.entries())) if (row.source_provider === provider) this.records.delete(id);
      return;
    }
    throw new Error(`Unsupported runAsync SQL: ${compact}`);
  }

  async getFirstAsync<T>(sql: string, params: any[] = []): Promise<T | null> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT * FROM records WHERE id = ?') {
      return (this.records.get(params[0]) ?? null) as T | null;
    }
    if (compact === 'SELECT op_id, after_json, status FROM operations WHERE idempotency_key = ?') {
      const row = Array.from(this.operations.values()).find((item) => item.idempotency_key === params[0]);
      return (row ? { op_id: row.op_id, after_json: row.after_json, status: row.status } : null) as T | null;
    }
    if (compact === 'SELECT * FROM operations WHERE op_id = ?') {
      return (this.operations.get(params[0]) ?? null) as T | null;
    }
    if (compact.startsWith('SELECT (SELECT COUNT(*) FROM records WHERE source_provider = ?')) {
      const [provider] = params;
      return { records: this.countRecords(provider), snapshots: this.countSnapshots(provider) } as T;
    }
    if (compact === 'SELECT COUNT(*) AS count FROM records WHERE source_provider = ?') return { count: this.countRecords(params[0]) } as T;
    if (compact === 'SELECT COUNT(*) AS count FROM source_snapshots WHERE provider = ?') return { count: this.countSnapshots(params[0]) } as T;
    if (compact === 'SELECT COUNT(*) AS count FROM provider_links WHERE provider = ?') return { count: Array.from(this.providerLinks.values()).filter((row) => row.provider === params[0]).length } as T;
    if (compact === 'SELECT COUNT(*) AS count FROM source_snapshot_relations') return { count: this.snapshotRelations.length } as T;
    throw new Error(`Unsupported getFirstAsync SQL: ${compact}`);
  }

  async getAllAsync<T>(sql: string, params: any[] = []): Promise<T[]> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT name, target_id FROM record_relations WHERE from_id = ?') {
      return this.recordRelations.filter((row) => row.from_id === params[0]).map((row) => ({ name: row.name, target_id: row.target_id })) as T[];
    }
    if (compact === 'SELECT id FROM records WHERE source_provider = ?') {
      return Array.from(this.records.values()).filter((row) => row.source_provider === params[0]).map((row) => ({ id: row.id })) as T[];
    }
    if (compact === 'SELECT * FROM source_snapshots WHERE provider = ? ORDER BY observed_at DESC') {
      return Array.from(this.sourceSnapshots.values()).filter((row) => row.provider === params[0]).sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at))) as T[];
    }
    if (compact === 'SELECT * FROM provider_links WHERE provider = ? ORDER BY updated_at DESC') {
      return Array.from(this.providerLinks.values()).filter((row) => row.provider === params[0]).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) as T[];
    }
    if (compact.startsWith('SELECT snapshot_id, record_id FROM source_snapshot_relations')) {
      const [provider] = params;
      return this.snapshotRelations.filter((row) => this.sourceSnapshots.get(row.snapshot_id)?.provider === provider || this.records.get(row.record_id)?.source_provider === provider) as T[];
    }
    throw new Error(`Unsupported getAllAsync SQL: ${compact}`);
  }

  private countRecords(provider: string) {
    return Array.from(this.records.values()).filter((row) => row.source_provider === provider).length;
  }

  private countSnapshots(provider: string) {
    return Array.from(this.sourceSnapshots.values()).filter((row) => row.provider === provider).length;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function count(db: MemoryDb, sql: string, params: string[] = []) {
  const row = await db.getFirstAsync<{ count: number }>(sql, params);
  return row?.count ?? 0;
}

(async () => {
  const db = new MemoryDb() as any;
  const proofDb = db as MemoryDb;
  const manifest = loadCatalog().activeManifest;
  const now = new Date().toISOString();

  await upsertRecord(db, manifest, {
    id: 'notion-restore-meal',
    title: 'Provider restore dinner',
    collection: 'meal_plan',
    properties: {
      status: 'Planned',
      meta: 'Notion restore proof',
      body: 'A provider-owned row that must survive clear through restore.',
      source: 'Notion',
    },
    relations: [{ name: 'plans', target_id: 'notion-restore-recipe' }],
    source: {
      provider: 'notion',
      external_id: 'notion-restore-meal-page',
      url: 'https://notion.so/notion-restore-meal-page',
      observed_at: now,
      content_hash: 'meal-hash',
    },
    archived_at: null,
    created_at: now,
    updated_at: now,
  });
  await upsertRecord(db, manifest, {
    id: 'notion-restore-recipe',
    title: 'Provider restore recipe',
    collection: 'recipe',
    properties: {
      status: 'Active',
      meta: 'Notion restore proof',
      body: 'A linked provider-owned recipe.',
      source: 'Notion',
    },
    relations: [],
    source: {
      provider: 'notion',
      external_id: 'notion-restore-recipe-page',
      url: 'https://notion.so/notion-restore-recipe-page',
      observed_at: now,
      content_hash: 'recipe-hash',
    },
    archived_at: null,
    created_at: now,
    updated_at: now,
  });
  await upsertProviderLink(db, {
    id: 'notion:restore-proof',
    provider: 'notion',
    external_id: 'restore-proof',
    name: 'Notion',
    status: 'Synced',
    freshness: now,
    workspace: 'Restore Proof',
    url: 'https://www.notion.so',
    created_at: now,
    updated_at: now,
  });
  await upsertSourceSnapshot(db, {
    id: 'notion-snapshot-restore-proof',
    provider: 'notion',
    external_id: 'notion-restore-meal-page',
    scope: 'food',
    observed_at: now,
    payload_json: JSON.stringify({ id: 'notion-restore-meal-page', title: 'Provider restore dinner' }),
    checksum: 'snapshot-hash',
    created_at: now,
    updated_at: now,
  });
  await linkSnapshotToRecord(db, { snapshot_id: 'notion-snapshot-restore-proof', record_id: 'notion-restore-meal' });

  const before = {
    records: await count(proofDb, 'SELECT COUNT(*) AS count FROM records WHERE source_provider = ?', ['notion']),
    snapshots: await count(proofDb, 'SELECT COUNT(*) AS count FROM source_snapshots WHERE provider = ?', ['notion']),
    links: await count(proofDb, 'SELECT COUNT(*) AS count FROM provider_links WHERE provider = ?', ['notion']),
    snapshotRelations: await count(proofDb, 'SELECT COUNT(*) AS count FROM source_snapshot_relations'),
  };
  assert(before.records === 2, `expected 2 notion records before clear, got ${before.records}`);
  assert(before.snapshots === 1, `expected 1 notion snapshot before clear, got ${before.snapshots}`);
  assert(before.links === 1, `expected 1 notion link before clear, got ${before.links}`);
  assert(before.snapshotRelations === 1, `expected 1 snapshot relation before clear, got ${before.snapshotRelations}`);

  const clear = await clearProviderLocalCopy({ db, provider: 'notion' });
  assert(clear.status === 'cleared', `clear status ${clear.status}`);
  assert(clear.restoreToken, 'clear receipt missing restore token');
  assert(clear.restoreUntil, 'clear receipt missing restore deadline');
  assert(clear.records === 2, `clear records ${clear.records}`);

  const afterClear = {
    records: await count(proofDb, 'SELECT COUNT(*) AS count FROM records WHERE source_provider = ?', ['notion']),
    snapshots: await count(proofDb, 'SELECT COUNT(*) AS count FROM source_snapshots WHERE provider = ?', ['notion']),
    links: await count(proofDb, 'SELECT COUNT(*) AS count FROM provider_links WHERE provider = ?', ['notion']),
    snapshotRelations: await count(proofDb, 'SELECT COUNT(*) AS count FROM source_snapshot_relations'),
  };
  assert(afterClear.records === 0, `records remained after clear: ${afterClear.records}`);
  assert(afterClear.snapshots === 0, `snapshots remained after clear: ${afterClear.snapshots}`);
  assert(afterClear.links === 0, `links remained after clear: ${afterClear.links}`);
  assert(afterClear.snapshotRelations === 0, `snapshot relations remained after clear: ${afterClear.snapshotRelations}`);

  const restore = await restoreClearedProviderLocalCopy({ db, restoreToken: clear.restoreToken });
  assert(restore.status === 'restored', `restore status ${restore.status}`);
  assert(restore.records === 2, `restore records ${restore.records}`);
  assert(restore.snapshots === 1, `restore snapshots ${restore.snapshots}`);

  const restoredMeal = await getRecord(db, 'notion-restore-meal');
  const afterRestore = {
    records: await count(proofDb, 'SELECT COUNT(*) AS count FROM records WHERE source_provider = ?', ['notion']),
    snapshots: await count(proofDb, 'SELECT COUNT(*) AS count FROM source_snapshots WHERE provider = ?', ['notion']),
    links: await count(proofDb, 'SELECT COUNT(*) AS count FROM provider_links WHERE provider = ?', ['notion']),
    snapshotRelations: await count(proofDb, 'SELECT COUNT(*) AS count FROM source_snapshot_relations'),
    relationCount: restoredMeal?.relations.length ?? 0,
  };
  assert(afterRestore.records === before.records, `records not restored: ${afterRestore.records}/${before.records}`);
  assert(afterRestore.snapshots === before.snapshots, `snapshots not restored: ${afterRestore.snapshots}/${before.snapshots}`);
  assert(afterRestore.links === before.links, `links not restored: ${afterRestore.links}/${before.links}`);
  assert(afterRestore.snapshotRelations === before.snapshotRelations, `snapshot relations not restored: ${afterRestore.snapshotRelations}/${before.snapshotRelations}`);
  assert(afterRestore.relationCount === 1, `record relation not restored: ${afterRestore.relationCount}`);
  assert(restoredMeal?.revision === 1, `expected restored revision 1, got ${restoredMeal?.revision}`);

  const revisioned = await applyOperation(db, manifest, {
    op_id: 'proof-update-revision',
    kind: 'update',
    domain: manifest.id,
    collection: restoredMeal.collection,
    record_id: restoredMeal.id,
    expected_revision: restoredMeal.revision,
    changes: { body: 'Revisioned by operation proof.' },
    actor: 'user',
    origin: 'manual',
    idempotency_key: 'proof-update-revision-idem',
    reason: 'Operation boundary proof.',
  });
  assert(revisioned.status === 'applied', `revisioned status ${revisioned.status}`);
  assert(revisioned.record?.revision === 2, `expected revision 2, got ${revisioned.record?.revision}`);

  const duplicate = await applyOperation(db, manifest, {
    op_id: 'proof-update-revision-again',
    kind: 'update',
    domain: manifest.id,
    collection: restoredMeal.collection,
    record_id: restoredMeal.id,
    expected_revision: restoredMeal.revision,
    changes: { body: 'Should not apply twice.' },
    actor: 'user',
    origin: 'manual',
    idempotency_key: 'proof-update-revision-idem',
  });
  assert(duplicate.status === 'duplicate', `duplicate status ${duplicate.status}`);

  const conflict = await applyOperation(db, manifest, {
    op_id: 'proof-stale-revision',
    kind: 'update',
    domain: manifest.id,
    collection: restoredMeal.collection,
    record_id: restoredMeal.id,
    expected_revision: 1,
    changes: { body: 'Stale writer.' },
    actor: 'user',
    origin: 'manual',
  });
  assert(conflict.status === 'rejected' && conflict.reject_reason === 'revision_conflict', `conflict result ${conflict.status}/${conflict.reject_reason}`);

  const undo = await undoOperation(db, manifest, 'proof-update-revision');
  assert(undo.status === 'applied' || undo.status === 'duplicate', `undo status ${undo.status}`);
  const undoneRecord = await getRecord(db, 'notion-restore-meal');
  assert(undoneRecord?.revision === 3, `expected undo revision 3, got ${undoneRecord?.revision}`);
  assert(undoneRecord?.properties.body === 'A provider-owned row that must survive clear through restore.', 'undo did not restore body');
  assert(proofDb.operations.size >= 7, `expected operation ledger rows, got ${proofDb.operations.size}`);

  const disconnect = await disconnectProviderLocalCopy({ db, provider: 'notion' });
  assert(disconnect.status === 'disconnected', `disconnect status ${disconnect.status}`);
  assert(disconnect.restoreToken, 'disconnect receipt missing restore token');
  assert(disconnect.message.includes('Provider data was not changed'), 'disconnect receipt must state provider data was not changed');
  const afterDisconnect = {
    records: await count(proofDb, 'SELECT COUNT(*) AS count FROM records WHERE source_provider = ?', ['notion']),
    snapshots: await count(proofDb, 'SELECT COUNT(*) AS count FROM source_snapshots WHERE provider = ?', ['notion']),
    links: await count(proofDb, 'SELECT COUNT(*) AS count FROM provider_links WHERE provider = ?', ['notion']),
    snapshotRelations: await count(proofDb, 'SELECT COUNT(*) AS count FROM source_snapshot_relations'),
  };
  assert(afterDisconnect.records === 0, `records remained after disconnect: ${afterDisconnect.records}`);
  assert(afterDisconnect.snapshots === 0, `snapshots remained after disconnect: ${afterDisconnect.snapshots}`);
  assert(afterDisconnect.links === 0, `links remained after disconnect: ${afterDisconnect.links}`);
  assert(afterDisconnect.snapshotRelations === 0, `snapshot relations remained after disconnect: ${afterDisconnect.snapshotRelations}`);

  const evidence = {
    proof: 'provider_clear_restore',
    provider: 'notion',
    before,
    clear: {
      status: clear.status,
      records: clear.records,
      snapshots: clear.snapshots,
      restoreTokenPresent: Boolean(clear.restoreToken),
      restoreUntilPresent: Boolean(clear.restoreUntil),
    },
    afterClear,
    restore: {
      status: restore.status,
      records: restore.records,
      snapshots: restore.snapshots,
    },
    afterRestore,
    operationBoundary: {
      applied: revisioned.status,
      duplicate: duplicate.status,
      conflict: conflict.reject_reason,
      undo: undo.status,
      operations: proofDb.operations.size,
    },
    disconnect: {
      status: disconnect.status,
      records: disconnect.records,
      snapshots: disconnect.snapshots,
      restoreTokenPresent: Boolean(disconnect.restoreToken),
      providerDataUntouchedCopy: disconnect.message.includes('Provider data was not changed'),
    },
    afterDisconnect,
    all_passed: true,
  };
  const evidencePath = join(process.cwd(), 'app', 'build', 'evidence', 'provider-clear-restore-proof.json');
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`PASS ${evidencePath}`);
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
