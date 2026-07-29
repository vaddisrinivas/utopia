import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';
import { exportRecoverySnapshot, runMigrations } from '@/src/db/migrations';
import { importRecoverySnapshot } from '@/src/db/recovery';
import { getRecord, upsertRecord } from '@/src/db/records';
import { loadCatalog } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

type Db = NodeSqliteDb & {
  getFirstAsync<T>(sql: string, params?: unknown): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: unknown): Promise<T[]>;
  runAsync(sql: string, params?: unknown): Promise<unknown>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createDb(): Db {
  return new NodeSqliteDb() as Db;
}

async function canonicalRecordChecksum(db: Db) {
  const rows = await db.getAllAsync<{
    id: string;
    collection: string;
    title: string;
    properties: string;
    archived_at: string | null;
    revision: number;
    deleted: number;
    privacy: string;
  }>(
    `SELECT id, collection, title, properties, archived_at, revision, deleted, privacy
       FROM records
      WHERE app_installation_id = ?
      ORDER BY id ASC`,
    [DEFAULT_APP_INSTALLATION_ID],
  );
  const normalized = rows.map((row) => ({
    id: row.id,
    collection: row.collection,
    title: row.title,
    properties: JSON.parse(row.properties || '{}'),
    archived_at: row.archived_at,
    revision: row.revision,
    deleted: Boolean(row.deleted),
    privacy: row.privacy,
  }));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

async function count(db: Db, table: string) {
  const row = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return row?.count ?? 0;
}

async function workflowStatus(db: Db, id: string) {
  const row = await db.getFirstAsync<{ status: string }>(
    'SELECT status FROM workflow_runs WHERE id = ?',
    [id],
  );
  return row?.status ?? null;
}

(async () => {
  const manifest = loadCatalog().activeManifest;
  const sourceDb = createDb();
  const restoredDb = createDb();
  try {
    await runMigrations(sourceDb as never);
    await runMigrations(restoredDb as never);

    const now = new Date().toISOString();

    await upsertRecord(sourceDb as never, manifest, {
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
    await applyOperation(sourceDb as never, manifest, {
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
    await upsertRecord(sourceDb as never, manifest, {
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

    await sourceDb.runAsync(
      `INSERT INTO config_sources
        (id, kind, label, location_json, auto_refresh, refresh_minutes, precedence, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'roundtrip-config-local',
        'local',
        'Roundtrip local config',
        JSON.stringify({ path: 'domains/food.yaml' }),
        0,
        60,
        1,
        1,
        now,
        now,
      ],
    );
    await sourceDb.runAsync(
      `INSERT INTO config_snapshots
        (source_id, fetched_at, content_hash, etag, raw, validation_status, error_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'roundtrip-config-local',
        now,
        'roundtrip-config-hash',
        null,
        'domains:\n  - food',
        'valid',
        null,
      ],
    );
    await sourceDb.runAsync(
      `INSERT INTO config_conflicts
        (id, key, sources_json, reason, status, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'roundtrip-config-conflict',
        'activeDomain',
        JSON.stringify(['roundtrip-config-local']),
        'Roundtrip config conflict proof.',
        'needs_review',
        now,
        null,
      ],
    );
    await sourceDb.runAsync(
      `INSERT INTO workflow_runs
        (id, domain, workflow_id, inputs_json, status, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'roundtrip-workflow-weekly-reset',
        'food',
        'weekly-food-reset',
        JSON.stringify({ day: 'Thursday' }),
        'cancelled',
        JSON.stringify({
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
        now,
        now,
      ],
    );

    const beforeChecksum = await canonicalRecordChecksum(sourceDb);
    const snapshot = await exportRecoverySnapshot(sourceDb as never);
    await importRecoverySnapshot(restoredDb as never, snapshot);
    const afterChecksum = await canonicalRecordChecksum(restoredDb);
    const tombstone = await getRecord(restoredDb as never, 'roundtrip-pantry-yogurt');
    const active = await getRecord(restoredDb as never, 'roundtrip-meal-dal');
    const operationCount = await count(restoredDb, 'operations');
    const sourceOperationCount = await count(sourceDb, 'operations');
    const configSourceCount = await count(restoredDb, 'config_sources');
    const configSnapshotCount = await count(restoredDb, 'config_snapshots');
    const configConflictCount = await count(restoredDb, 'config_conflicts');
    const workflowRunCount = await count(restoredDb, 'workflow_runs');
    const restoredWorkflowStatus = await workflowStatus(restoredDb, 'roundtrip-workflow-weekly-reset');
    const recordCount = await restoredDb.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM records WHERE app_installation_id = ?',
      [DEFAULT_APP_INSTALLATION_ID],
    );

    assert(beforeChecksum === afterChecksum, `record checksum mismatch ${beforeChecksum}/${afterChecksum}`);
    assert(tombstone?.deleted === true, 'deleted tombstone resurrected as active record');
    assert(Boolean(tombstone?.archived_at), 'deleted tombstone lost archived_at');
    assert(active?.deleted === false, 'active record imported as deleted');
    assert(active?.relations.some((relation) => relation.target_id === 'roundtrip-pantry-yogurt'), 'relation not preserved');
    assert(operationCount === sourceOperationCount, 'operation ledger not preserved');
    assert(configSourceCount === 1, 'config sources not preserved');
    assert(configSnapshotCount === 1, 'config snapshots not preserved');
    assert(configConflictCount === 1, 'config conflicts not preserved');
    assert(workflowRunCount === 1, 'workflow runs not preserved');
    assert(restoredWorkflowStatus === 'cancelled', 'workflow status not preserved');

    const outDir = join(process.cwd(), 'app', 'build', 'evidence', 'roundtrip');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'roundtrip-proof.json');
    writeFileSync(outPath, JSON.stringify({
      proof: 'recovery_roundtrip',
      schema_version: snapshot.schema_version,
      beforeChecksum,
      afterChecksum,
      records: recordCount?.count ?? 0,
      operations: operationCount,
      config_sources: configSourceCount,
      config_snapshots: configSnapshotCount,
      config_conflicts: configConflictCount,
      workflow_runs: workflowRunCount,
      workflow_cancel_resume_preserved: restoredWorkflowStatus === 'cancelled',
      tombstone: {
        id: tombstone?.id,
        deleted: tombstone?.deleted,
        archived_at_present: Boolean(tombstone?.archived_at),
      },
      all_passed: true,
    }, null, 2));
    console.log(`PASS ${outPath}`);
  } finally {
    sourceDb.close();
    restoredDb.close();
  }
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
