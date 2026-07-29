import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runMigrations } from '@/src/db/migrations';
import { getRecord, upsertRecord } from '@/src/db/records';
import { linkSnapshotToRecord, upsertProviderLink, upsertSourceSnapshot } from '@/src/db/sources';
import { loadCatalog } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import { undoOperation } from '@/src/ops/undo';
import { clearProviderLocalCopy, disconnectProviderLocalCopy, restoreClearedProviderLocalCopy } from '@/src/providers/provider-local-copy';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

type Db = NodeSqliteDb & {
  getFirstAsync<T>(sql: string, params?: unknown): Promise<T | null>;
  runAsync(sql: string, params?: unknown): Promise<unknown>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createDb(): Db {
  return new NodeSqliteDb() as Db;
}

async function count(db: Db, sql: string, params: string[] = []) {
  const row = await db.getFirstAsync<{ count: number }>(sql, params);
  return row?.count ?? 0;
}

(async () => {
  const db = createDb();
  try {
    await runMigrations(db as never);

    const manifest = loadCatalog().activeManifest;
    const now = new Date().toISOString();

    await upsertRecord(db as never, manifest, {
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
    await upsertRecord(db as never, manifest, {
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
    await upsertProviderLink(db as never, {
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
    await upsertSourceSnapshot(db as never, {
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
    await linkSnapshotToRecord(db as never, { snapshot_id: 'notion-snapshot-restore-proof', record_id: 'notion-restore-meal' });

    const before = {
      records: await count(db, 'SELECT COUNT(*) AS count FROM records WHERE source_provider = ?', ['notion']),
      snapshots: await count(db, 'SELECT COUNT(*) AS count FROM source_snapshots WHERE provider = ?', ['notion']),
      links: await count(db, 'SELECT COUNT(*) AS count FROM provider_links WHERE provider = ?', ['notion']),
      snapshotRelations: await count(db, 'SELECT COUNT(*) AS count FROM source_snapshot_relations'),
    };
    assert(before.records === 2, `expected 2 notion records before clear, got ${before.records}`);
    assert(before.snapshots === 1, `expected 1 notion snapshot before clear, got ${before.snapshots}`);
    assert(before.links === 1, `expected 1 notion link before clear, got ${before.links}`);
    assert(before.snapshotRelations === 1, `expected 1 snapshot relation before clear, got ${before.snapshotRelations}`);

    const clear = await clearProviderLocalCopy({ db: db as never, provider: 'notion' });
    assert(clear.status === 'cleared', `clear status ${clear.status}`);
    assert(clear.restoreToken, 'clear receipt missing restore token');
    assert(clear.restoreUntil, 'clear receipt missing restore deadline');
    assert(clear.records === 2, `clear records ${clear.records}`);

    const afterClear = {
      records: await count(db, 'SELECT COUNT(*) AS count FROM records WHERE source_provider = ?', ['notion']),
      snapshots: await count(db, 'SELECT COUNT(*) AS count FROM source_snapshots WHERE provider = ?', ['notion']),
      links: await count(db, 'SELECT COUNT(*) AS count FROM provider_links WHERE provider = ?', ['notion']),
      snapshotRelations: await count(db, 'SELECT COUNT(*) AS count FROM source_snapshot_relations'),
    };
    assert(afterClear.records === 0, `records remained after clear: ${afterClear.records}`);
    assert(afterClear.snapshots === 0, `snapshots remained after clear: ${afterClear.snapshots}`);
    assert(afterClear.links === 0, `links remained after clear: ${afterClear.links}`);
    assert(afterClear.snapshotRelations === 0, `snapshot relations remained after clear: ${afterClear.snapshotRelations}`);

    const restore = await restoreClearedProviderLocalCopy({ db: db as never, restoreToken: clear.restoreToken });
    assert(restore.status === 'restored', `restore status ${restore.status}`);
    assert(restore.records === 2, `restore records ${restore.records}`);
    assert(restore.snapshots === 1, `restore snapshots ${restore.snapshots}`);

    const restoredMeal = await getRecord(db as never, 'notion-restore-meal');
    const afterRestore = {
      records: await count(db, 'SELECT COUNT(*) AS count FROM records WHERE source_provider = ?', ['notion']),
      snapshots: await count(db, 'SELECT COUNT(*) AS count FROM source_snapshots WHERE provider = ?', ['notion']),
      links: await count(db, 'SELECT COUNT(*) AS count FROM provider_links WHERE provider = ?', ['notion']),
      snapshotRelations: await count(db, 'SELECT COUNT(*) AS count FROM source_snapshot_relations'),
      relationCount: restoredMeal?.relations.length ?? 0,
    };
    assert(afterRestore.records === before.records, `records not restored: ${afterRestore.records}/${before.records}`);
    assert(afterRestore.snapshots === before.snapshots, `snapshots not restored: ${afterRestore.snapshots}/${before.snapshots}`);
    assert(afterRestore.links === before.links, `links not restored: ${afterRestore.links}/${before.links}`);
    assert(afterRestore.snapshotRelations === before.snapshotRelations, `snapshot relations not restored: ${afterRestore.snapshotRelations}/${before.snapshotRelations}`);
    assert(afterRestore.relationCount === 1, `record relation not restored: ${afterRestore.relationCount}`);
    assert(restoredMeal?.revision === 1, `expected restored revision 1, got ${restoredMeal?.revision}`);

    const revisioned = await applyOperation(db as never, manifest, {
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

    const duplicate = await applyOperation(db as never, manifest, {
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

    const conflict = await applyOperation(db as never, manifest, {
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

    const undo = await undoOperation(db as never, manifest, 'proof-update-revision');
    assert(undo.status === 'applied' || undo.status === 'duplicate', `undo status ${undo.status}`);
    const undoneRecord = await getRecord(db as never, 'notion-restore-meal');
    const operationsCount = await count(db, 'SELECT COUNT(*) AS count FROM operations');
    assert(undoneRecord?.revision === 3, `expected undo revision 3, got ${undoneRecord?.revision}`);
    assert(undoneRecord?.properties.body === 'A provider-owned row that must survive clear through restore.', 'undo did not restore body');
    assert(operationsCount >= 7, `expected operation ledger rows, got ${operationsCount}`);

    const disconnect = await disconnectProviderLocalCopy({ db: db as never, provider: 'notion' });
    assert(disconnect.status === 'disconnected', `disconnect status ${disconnect.status}`);
    assert(disconnect.restoreToken, 'disconnect receipt missing restore token');
    assert(disconnect.message.includes('Provider data was not changed'), 'disconnect receipt must state provider data was not changed');
    const afterDisconnect = {
      records: await count(db, 'SELECT COUNT(*) AS count FROM records WHERE source_provider = ?', ['notion']),
      snapshots: await count(db, 'SELECT COUNT(*) AS count FROM source_snapshots WHERE provider = ?', ['notion']),
      links: await count(db, 'SELECT COUNT(*) AS count FROM provider_links WHERE provider = ?', ['notion']),
      snapshotRelations: await count(db, 'SELECT COUNT(*) AS count FROM source_snapshot_relations'),
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
        operations: operationsCount,
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
    const outDir = join(process.cwd(), 'app', 'build', 'evidence');
    mkdirSync(outDir, { recursive: true });
    const evidencePath = join(outDir, 'provider-clear-restore-proof.json');
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`PASS ${evidencePath}`);
  } finally {
    db.close();
  }
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
