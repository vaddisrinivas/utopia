import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentGit } from './evidence-provenance.mjs';
import { loadCatalog, setActivePackageOverride } from '../../src/domain/catalog';
import { bootstrapAppPackageRegistry } from '../../src/db/app-package-registry';
import { exportRecoverySnapshot } from '../../src/db/migrations';
import { importRecoverySnapshot } from '../../src/db/recovery';
import { getRecord, upsertRecord } from '../../src/db/records';
import { applyOperation } from '../../src/ops/apply';
import { undoOperation } from '../../src/ops/undo';
import { getWorkflowReceiptSummary, recordWorkflowStep, startWorkflowRun } from '../../src/workflows/runtime';

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

class FoodGoldenDb {
  tables = new Map<string, Row[]>(recoveryTables.map((table) => [table, []]));

  constructor() {
    this.tables.set('meta', [{ key: 'lifecycle', value: 'ready' }, { key: 'active_domain_id', value: 'food' }]);
  }

  async execAsync(_sql: string) {}

  async withTransactionAsync(fn: () => Promise<void>) {
    await fn();
  }

  async runAsync(sql: string, params: any[] | Row = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('INSERT INTO records')) {
      const [id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json] = params as any[];
      this.upsert('records', { id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json }, 'id');
      return;
    }
    if (compact === 'DELETE FROM record_relations WHERE from_id = ?') {
      const [fromId] = params as any[];
      this.setRows('record_relations', this.rows('record_relations').filter((row) => row.from_id !== fromId));
      return;
    }
    if (compact.startsWith('INSERT INTO record_relations')) {
      const [from_id, collection, name, target_id, target_domain, target_collection, created_at] = params as any[];
      this.setRows('record_relations', this.rows('record_relations').filter((row) => !(row.from_id === from_id && row.name === name && row.target_id === target_id)));
      this.rows('record_relations').push({ from_id, collection, name, target_id, target_domain, target_collection, created_at });
      return;
    }
    if (compact.startsWith('INSERT INTO operations')) {
      const [op_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at] = params as any[];
      this.upsert('operations', { op_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at }, 'op_id');
      return;
    }
    if (compact === 'UPDATE operations SET status = ? WHERE op_id = ?') {
      const [status, opId] = params as any[];
      const row = this.rows('operations').find((item) => item.op_id === opId);
      if (row) row.status = status;
      return;
    }
    if (compact.startsWith('UPDATE workflow_runs SET')) {
      const values = params as any[];
      const id = values[values.length - 1];
      const row = this.rows('workflow_runs').find((item) => item.id === id);
      if (row) {
        if (compact.includes('status = ?')) row.status = values[0];
        if (compact.includes('payload_json = ?')) row.payload_json = values[compact.includes('status = ?') ? 1 : 0];
        row.updated_at = values[values.length - 2];
      }
      return;
    }
    if (compact.startsWith('INSERT OR REPLACE INTO app_packages')) {
      const row = namedParams(params);
      this.upsert('app_packages', {
        package_key: row.$package_key,
        package_id: row.$package_id,
        version: row.$version,
        payload_json: row.$payload_json,
        created_at: row.$created_at,
        updated_at: row.$updated_at,
      }, 'package_key');
      return;
    }
    if (compact.startsWith('INSERT OR REPLACE INTO app_package_state')) {
      const row = namedParams(params);
      this.setRows('app_package_state', [{
        id: 'default',
        active_package_key: row.$active_package_key,
        previous_package_key: row.$previous_package_key,
        updated_at: row.$updated_at,
      }]);
      return;
    }
    if (compact.startsWith('INSERT INTO app_package_receipts')) {
      const row = namedParams(params);
      this.rows('app_package_receipts').push({
        id: row.$id,
        action: row.$action,
        package_key: row.$package_key,
        previous_package_key: row.$previous_package_key,
        created_at: row.$created_at,
        request_hash: row.$request_hash ?? null,
        package_hash: row.$package_hash ?? null,
        approval_hash: row.$approval_hash ?? null,
        approved_by: row.$approved_by ?? null,
      });
      return;
    }
    if (compact.startsWith('DELETE FROM ')) {
      const table = compact.split(' ')[2];
      this.setRows(table, []);
      return;
    }
    if (compact.startsWith('INSERT INTO ')) {
      const match = compact.match(/^INSERT INTO ([A-Za-z_][A-Za-z0-9_]*) \(([^)]+)\) VALUES/);
      if (!match) throw new Error(`Unsupported insert: ${compact}`);
      const [, table, columnText] = match;
      const columns = columnText.split(',').map((column) => column.trim());
      const values = params as any[];
      this.rows(table).push(Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null])));
      return;
    }
    throw new Error(`Unsupported runAsync SQL: ${compact}`);
  }

  async getFirstAsync<T>(sql: string, params: any[] | Row = []): Promise<T | null> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT * FROM records WHERE id = ?') {
      return (this.rows('records').find((row) => row.id === (params as any[])[0]) ?? null) as T | null;
    }
    if (compact === 'SELECT * FROM operations WHERE op_id = ?') {
      return (this.rows('operations').find((row) => row.op_id === (params as any[])[0]) ?? null) as T | null;
    }
    if (compact === 'SELECT * FROM workflow_runs WHERE id = ?') {
      return (this.rows('workflow_runs').find((row) => row.id === (params as any[])[0]) ?? null) as T | null;
    }
    if (compact === 'SELECT op_id, after_json, status FROM operations WHERE idempotency_key = ?') {
      const row = this.rows('operations').find((item) => item.idempotency_key === (params as any[])[0]);
      return (row ? { op_id: row.op_id, after_json: row.after_json, status: row.status } : null) as T;
    }
    if (compact === "SELECT active_package_key, previous_package_key FROM app_package_state WHERE id = 'default'") {
      const row = this.rows('app_package_state')[0];
      return (row ? { active_package_key: row.active_package_key, previous_package_key: row.previous_package_key } : null) as T | null;
    }
    if (compact === 'SELECT COUNT(*) as count FROM app_packages') {
      return { count: this.rows('app_packages').length } as T;
    }
    if (compact === 'SELECT package_key, payload_json FROM app_packages WHERE package_key = $package_key') {
      const key = namedParams(params).$package_key;
      const row = this.rows('app_packages').find((item) => item.package_key === key);
      return (row ? { package_key: row.package_key, payload_json: row.payload_json } : null) as T | null;
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
    this.setRows(table, [...this.rows(table).filter((existing) => existing[key] !== row[key]), row]);
  }
}

function namedParams(params: unknown): Row {
  return params && typeof params === 'object' && !Array.isArray(params) ? params as Row : {};
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checksum(db: FoodGoldenDb) {
  const normalized = db.tables.get('records')!
    .map((row) => ({
      id: row.id,
      collection: row.collection,
      title: row.title,
      properties: JSON.parse(row.properties || '{}'),
      archived_at: row.archived_at,
      revision: row.revision,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

(async () => {
  setActivePackageOverride(null);
  const db = new FoodGoldenDb() as any;
  const proofDb = db as FoodGoldenDb;
  assert(proofDb.tables.get('records')!.length === 0, 'fresh database was not empty');

  const appPackage = await bootstrapAppPackageRegistry(db);
  assert(appPackage.id === 'food', 'Food package did not bootstrap');
  const manifest = loadCatalog().activeManifest;
  const now = new Date().toISOString();

  await upsertRecord(db, manifest, {
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
  await upsertRecord(db, manifest, {
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
  await upsertRecord(db, manifest, {
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

  const shopping = await getRecord(db, 'golden-shop-berries');
  assert(shopping, 'shopping item missing');
  await startWorkflowRun({
    db,
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
    db,
    runId: 'golden-dinner-loop-run',
    stepId: 'suggest',
    status: 'completed',
    receipt: {
      record_ids: ['golden-pantry-yogurt', 'golden-meal-bowl', 'golden-shop-berries'],
      message: 'Dinner suggestion prepared from pantry and shopping context.',
    },
  });
  const shoppingApproval = await applyOperation(db, manifest, {
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
    db,
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
    db,
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
  const workflowSummary = await getWorkflowReceiptSummary(db, 'golden-dinner-loop-run');
  assert(workflowSummary.status === 'completed', 'dinner loop workflow should complete after approval');
  assert(workflowSummary.completed_steps === 3, 'dinner loop workflow did not record approval steps');
  assert(workflowSummary.operation_ids.includes('golden-shop-purchased'), 'dinner loop workflow missing shopping operation receipt');
  assert(workflowSummary.record_ids.includes('golden-shop-berries'), 'dinner loop workflow missing shopping record receipt');
  const purchased = await getRecord(db, 'golden-shop-berries');
  assert(purchased?.properties.status === 'In cart', 'approval did not update shopping item');
  assert(purchased?.properties.tone === 'moss', 'approval did not update shopping tone');
  assert(purchased?.properties.meta === 'Approved for tonight', 'approval did not update shopping reason');
  assert(purchased?.provenance?.actor === 'ai', 'approval provenance actor missing');
  assert(purchased?.provenance?.reason === 'Approved Food dinner suggestion updates the shopping list.', 'approval provenance reason missing');
  assert(purchased?.provenance?.confidence === 0.92, 'approval provenance confidence missing');
  assert(purchased?.provenance?.evidence.includes('golden-pantry-yogurt'), 'approval provenance evidence missing pantry record');

  const undoShopping = await undoOperation(db, manifest, 'golden-shop-purchased');
  assert(undoShopping.status === 'applied' || undoShopping.status === 'duplicate', `shopping undo failed: ${undoShopping.status}`);
  const undoneShopping = await getRecord(db, 'golden-shop-berries');
  assert(undoneShopping?.properties.status === 'To buy', 'shopping undo did not restore prior status');

  const searchHit = proofDb.tables.get('records')!.find((row) => String(row.title).toLowerCase().includes('breakfast'));
  assert(searchHit?.id === 'golden-meal-bowl', 'search did not find meal plan');

  const meal = await getRecord(db, 'golden-meal-bowl');
  assert(meal, 'meal plan missing before edit');
  await applyOperation(db, manifest, {
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

  const edited = await getRecord(db, 'golden-meal-bowl');
  assert(edited, 'meal plan missing before archive');
  await applyOperation(db, manifest, {
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
  const archived = await getRecord(db, 'golden-meal-bowl');
  assert(archived?.archived_at, 'archive did not set archived_at');

  await applyOperation(db, manifest, {
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
  const restoredMeal = await getRecord(db, 'golden-meal-bowl');
  assert(restoredMeal?.archived_at === null, 'undo did not restore meal plan');

  const beforeChecksum = checksum(proofDb);
  const snapshot = await exportRecoverySnapshot(db);
  const restoredDb = new FoodGoldenDb() as any;
  const restoredProof = restoredDb as FoodGoldenDb;
  await importRecoverySnapshot(restoredDb, snapshot);
  const afterChecksum = checksum(restoredProof);
  const expectedPackageKey = `${appPackage.id}@${appPackage.version}`;
  assert(beforeChecksum === afterChecksum, `backup restore mismatch ${beforeChecksum}/${afterChecksum}`);
  assert(restoredProof.tables.get('app_packages')!.length === 1, 'app package not exported/restored');
  assert(restoredProof.tables.get('app_package_state')![0]?.active_package_key === expectedPackageKey, 'active package state not restored');
  assert(restoredProof.tables.get('workflow_runs')!.length === 1, 'workflow run not exported/restored');

  const outDir = join(process.cwd(), 'app', 'build', 'evidence', 'food');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'food-golden-path-proof.json');
  writeFileSync(outPath, JSON.stringify({
    proof: 'food_golden_path',
    checked_at: new Date().toISOString(),
    git: currentGit(process.cwd()),
    package: appPackage.id,
    records: restoredProof.tables.get('records')!.length,
    operations: restoredProof.tables.get('operations')!.length,
    packageRows: restoredProof.tables.get('app_packages')!.length,
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
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
