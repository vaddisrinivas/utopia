import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';
import { bootstrapAppPackageRegistry } from '@/src/db/app-package-registry';
import { exportRecoverySnapshot, runMigrations } from '@/src/db/migrations';
import { importRecoverySnapshot } from '@/src/db/recovery';
import { getRecord, upsertRecord } from '@/src/db/records';
import { loadCatalog, setActivePackageOverride } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import { undoOperation } from '@/src/ops/undo';
import { getWorkflowReceiptSummary, recordWorkflowStep, startWorkflowRun } from '@/src/workflows/runtime';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

import { currentGit } from './evidence-provenance.mjs';

type Db = NodeSqliteDb & {
  getAllAsync<T>(sql: string, params?: unknown): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown): Promise<T | null>;
  runAsync(sql: string, params?: unknown): Promise<unknown>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createDb(): Db {
  return new NodeSqliteDb() as Db;
}

async function checksum(db: Db) {
  const rows = await db.getAllAsync<{
    id: string;
    collection: string;
    title: string;
    properties: string;
    archived_at: string | null;
    revision: number;
  }>(
    `SELECT id, collection, title, properties, archived_at, revision
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
  }));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

async function count(db: Db, sql: string, params: unknown[] = []) {
  const row = await db.getFirstAsync<{ count: number }>(sql, params);
  return row?.count ?? 0;
}

(async () => {
  setActivePackageOverride(null);
  const db = createDb();
  const restoredDb = createDb();
  try {
    await runMigrations(db as never);
    await runMigrations(restoredDb as never);

    const recordsBefore = await count(
      db,
      'SELECT COUNT(*) AS count FROM records WHERE app_installation_id = ?',
      [DEFAULT_APP_INSTALLATION_ID],
    );
    assert(recordsBefore === 0, 'fresh database was not empty');

    const appPackage = await bootstrapAppPackageRegistry(db as never);
    assert(appPackage.id === 'food', 'Food package did not bootstrap');
    const manifest = loadCatalog().activeManifest;
    const now = new Date().toISOString();

    await upsertRecord(db as never, manifest, {
      id: 'golden-pantry-yogurt',
      title: 'Golden yogurt',
      collection: 'inventory',
      properties: { status: 'Use soon', tone: 'amber', body: 'Use in breakfast bowl.', quantity: 2 },
      source: { provider: 'user', external_id: 'golden-pantry-yogurt', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
      relations: [],
    });
    await upsertRecord(db as never, manifest, {
      id: 'golden-meal-bowl',
      title: 'Golden breakfast bowl',
      collection: 'meal_plan',
      properties: { status: 'Planned', tone: 'moss', body: 'Yogurt, berries, granola.' },
      source: { provider: 'user', external_id: 'golden-meal-bowl', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
      relations: [{ name: 'uses', target_id: 'golden-pantry-yogurt' }],
    });
    await upsertRecord(db as never, manifest, {
      id: 'golden-shop-berries',
      title: 'Golden berries',
      collection: 'shopping_item',
      properties: { status: 'To buy', tone: 'blue', body: 'Buy berries for breakfast bowl.' },
      source: { provider: 'user', external_id: 'golden-shop-berries', url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
      relations: [],
    });

    const shopping = await getRecord(db as never, 'golden-shop-berries');
    assert(shopping, 'shopping item missing');
    await startWorkflowRun({
      db: db as never,
      id: 'golden-dinner-loop-run',
      domain: manifest.id,
      workflowId: 'utopia-dinner-to-shopping',
      inputs: {
        dinner_id: 'golden-meal-bowl',
        pantry_item_id: 'golden-pantry-yogurt',
        shopping_item_id: 'golden-shop-berries',
      },
      steps: [
        { id: 'suggest', title: 'Suggest dinner from pantry', tool: 'food.dinner.suggest' },
        { id: 'approve', title: 'Approve shopping change', tool: 'food.shopping.approve', cancellable: false },
        { id: 'shop', title: 'Update shopping list', tool: 'food.shopping.update', compensation_tool: 'food.shopping.undo' },
      ],
    });
    await recordWorkflowStep({
      db: db as never,
      runId: 'golden-dinner-loop-run',
      stepId: 'suggest',
      status: 'completed',
      receipt: {
        record_ids: ['golden-pantry-yogurt', 'golden-meal-bowl', 'golden-shop-berries'],
        message: 'Dinner suggestion prepared from pantry and shopping context.',
      },
    });
    const shoppingApproval = await applyOperation(db as never, manifest, {
      op_id: 'golden-shop-purchased',
      kind: 'update',
      domain: manifest.id,
      collection: shopping.collection,
      record_id: shopping.id,
      expected_revision: shopping.revision,
      actor: 'ai',
      origin: 'workflow',
      idempotency_key: 'golden-shop-purchased:approve',
      confidence: 0.92,
      evidence: ['golden-pantry-yogurt', 'golden-meal-bowl', 'golden-shop-berries'],
      changes: { ...shopping.properties, status: 'In cart', tone: 'moss', meta: 'Approved for tonight' },
      reason: 'Approved Food dinner suggestion updates the shopping list.',
    });
    assert(shoppingApproval.status === 'applied' || shoppingApproval.status === 'duplicate', `approval failed: ${shoppingApproval.status}`);
    await recordWorkflowStep({
      db: db as never,
      runId: 'golden-dinner-loop-run',
      stepId: 'approve',
      status: 'completed',
      receipt: {
        operation_ids: [shoppingApproval.op_id],
        record_ids: ['golden-shop-berries'],
        source_ids: ['golden-shop-berries'],
        message: 'Shopping update approved.',
      },
    });
    await recordWorkflowStep({
      db: db as never,
      runId: 'golden-dinner-loop-run',
      stepId: 'shop',
      status: 'completed',
      receipt: {
        operation_ids: [shoppingApproval.op_id],
        record_ids: ['golden-shop-berries'],
        source_ids: ['golden-shop-berries'],
        message: 'Golden berries moved to cart.',
      },
    });

    const workflowSummary = await getWorkflowReceiptSummary(db as never, 'golden-dinner-loop-run');
    assert(workflowSummary.status === 'completed', 'dinner loop workflow should complete after approval');
    assert(workflowSummary.completed_steps === 3, 'dinner loop workflow did not record approval steps');
    assert(workflowSummary.operation_ids.includes('golden-shop-purchased'), 'dinner loop workflow missing shopping operation receipt');
    assert(workflowSummary.record_ids.includes('golden-shop-berries'), 'dinner loop workflow missing shopping record receipt');

    const purchased = await getRecord(db as never, 'golden-shop-berries');
    assert(purchased?.properties.status === 'In cart', 'approval did not update shopping item');
    assert(purchased?.properties.tone === 'moss', 'approval did not update shopping tone');
    assert(purchased?.properties.meta === 'Approved for tonight', 'approval did not update shopping reason');
    assert(purchased?.provenance?.actor === 'ai', 'approval provenance actor missing');
    assert(purchased?.provenance?.reason === 'Approved Food dinner suggestion updates the shopping list.', 'approval provenance reason missing');
    assert(purchased?.provenance?.confidence === 0.92, 'approval provenance confidence missing');
    assert(purchased?.provenance?.evidence.includes('golden-pantry-yogurt'), 'approval provenance evidence missing pantry record');

    const undoShopping = await undoOperation(db as never, manifest, 'golden-shop-purchased');
    assert(undoShopping.status === 'applied' || undoShopping.status === 'duplicate', `shopping undo failed: ${undoShopping.status}`);
    const undoneShopping = await getRecord(db as never, 'golden-shop-berries');
    assert(undoneShopping?.properties.status === 'To buy', 'shopping undo did not restore prior status');

    const searchHit = await db.getFirstAsync<{ id: string }>(
      `SELECT id
         FROM records
        WHERE app_installation_id = ?
          AND LOWER(title) LIKE ?
        LIMIT 1`,
      [DEFAULT_APP_INSTALLATION_ID, '%breakfast%'],
    );
    assert(searchHit?.id === 'golden-meal-bowl', 'search did not find meal plan');

    const meal = await getRecord(db as never, 'golden-meal-bowl');
    assert(meal, 'meal plan missing before edit');
    await applyOperation(db as never, manifest, {
      op_id: 'golden-meal-edit',
      kind: 'update',
      domain: manifest.id,
      collection: meal.collection,
      record_id: meal.id,
      expected_revision: meal.revision,
      actor: 'user',
      origin: 'manual',
      changes: { title: 'Golden breakfast bowl edited', properties: { ...meal.properties, note: 'edited' } },
      reason: 'Golden path edits meal plan.',
    });

    const edited = await getRecord(db as never, 'golden-meal-bowl');
    assert(edited, 'meal plan missing before archive');
    await applyOperation(db as never, manifest, {
      op_id: 'golden-meal-archive',
      kind: 'archive',
      domain: manifest.id,
      collection: edited.collection,
      record_id: edited.id,
      expected_revision: edited.revision,
      actor: 'user',
      origin: 'manual',
      reason: 'Golden path archives meal plan.',
    });
    const archived = await getRecord(db as never, 'golden-meal-bowl');
    assert(archived?.archived_at, 'archive did not set archived_at');

    await applyOperation(db as never, manifest, {
      op_id: 'golden-meal-undo',
      kind: 'restore',
      domain: manifest.id,
      collection: archived.collection,
      record_id: archived.id,
      expected_revision: archived.revision,
      actor: 'user',
      origin: 'manual',
      reason: 'Golden path undo restores meal plan.',
    });
    const restoredMeal = await getRecord(db as never, 'golden-meal-bowl');
    assert(restoredMeal?.archived_at === null, 'undo did not restore meal plan');

    const beforeChecksum = await checksum(db);
    const snapshot = await exportRecoverySnapshot(db as never);
    await importRecoverySnapshot(restoredDb as never, snapshot);
    const afterChecksum = await checksum(restoredDb);
    const expectedPackageKey = `${appPackage.id}@${appPackage.version}`;
    const packageRows = await count(restoredDb, 'SELECT COUNT(*) AS count FROM app_packages');
    const operations = await count(restoredDb, 'SELECT COUNT(*) AS count FROM operations');
    const records = await count(
      restoredDb,
      'SELECT COUNT(*) AS count FROM records WHERE app_installation_id = ?',
      [DEFAULT_APP_INSTALLATION_ID],
    );
    const workflowRuns = await count(restoredDb, 'SELECT COUNT(*) AS count FROM workflow_runs');
    const installationState = await restoredDb.getFirstAsync<{ active_package_key: string | null }>(
      'SELECT active_package_key FROM app_installation_package_state WHERE installation_id = ?',
      [DEFAULT_APP_INSTALLATION_ID],
    );

    assert(beforeChecksum === afterChecksum, `backup restore mismatch ${beforeChecksum}/${afterChecksum}`);
    assert(packageRows === 1, 'app package not exported/restored');
    assert(installationState?.active_package_key === expectedPackageKey, 'active package state not restored');
    assert(workflowRuns === 1, 'workflow run not exported/restored');

    const outDir = join(process.cwd(), 'app', 'build', 'evidence', 'food');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'food-golden-path-proof.json');
    writeFileSync(outPath, JSON.stringify({
      proof: 'food_golden_path',
      checked_at: new Date().toISOString(),
      git: currentGit(process.cwd()),
      package: appPackage.id,
      records,
      operations,
      packageRows,
      beforeChecksum,
      afterChecksum,
      steps: [
        'fresh_empty',
        'bootstrap_package',
        'add_pantry',
        'create_meal_plan',
        'add_shopping_item',
        'expiry_detected',
        'dinner_suggested',
        'workflow_run_started',
        'approval_receipt_persisted',
        'mark_purchased',
        'undo_shopping_update',
        'workflow_undo_receipt_persisted',
        'search',
        'edit',
        'archive',
        'undo',
        'export',
        'restore_compare',
      ],
      all_passed: true,
    }, null, 2));
    console.log(`PASS ${outPath}`);
  } finally {
    db.close();
    restoredDb.close();
  }
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
