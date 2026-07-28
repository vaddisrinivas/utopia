import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { readAppPackageSourceFolder } from '@/packages/app-compiler';
import { buildPackageInstallApprovalReceipt, buildPackageInstallPreview } from '@/packages/shared/contracts/package-install';
import type { DomainManifest } from '@/src/domain/catalog';
import { installApprovedAppPackage, getActiveAppPackage, getAppInstallation } from '@/src/db/app-package-registry';
import { exportRecoverySnapshot, runMigrations } from '@/src/db/migrations';
import { importRecoverySnapshot } from '@/src/db/recovery';
import { createInstallationRepository } from '@/src/db/records';
import {
  activateDryRunPackageMigration,
  buildPackageMigrationApprovalReceipt,
  dryRunPackageMigration,
  rollbackPackageMigration,
} from '@/src/domain/package-migrations';
import {
  approvePackageAuthoringEvaluation,
  createPackageAuthoringChange,
  computePackageSourceRevision,
  evaluatePackageAuthoringChange,
} from '@/src/domain/package-authoring';
import { createPackageInstallFetcher, fetchPackageInstallCandidate, fetchRegistryManifest } from '@/src/domain/package-install';
import {
  buildGitHubRegistryDistribution,
  buildGitHubReleaseAssetUrl,
  buildOperationStreamDesign,
  buildRegistryInstallDescriptor,
  buildRegistryManifest,
  buildShareInviteDescriptor,
  checkRegistryInstallCompatibility,
  exportEncryptedWorkspaceVault,
  installSharedPackageInvite,
  previewEncryptedWorkspaceVault,
  restoreEncryptedWorkspaceVault,
} from '@/src/domain/package-sharing';
import { currentGit } from './evidence-provenance.mjs';

type SqlParams = any[] | Record<string, unknown>;

type OperationRow = {
  op_id: string;
  record_id: string;
  created_at: string;
  changes_json: string;
};

type PackageStateRow = {
  installation_id: string;
  active_package_key: string | null;
  previous_package_key: string | null;
  updated_at: string;
};

type WorkspaceRow = {
  installation_id: string;
  workspace_id: string;
  app_name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

class FileSqliteDb {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  async execAsync(sql: string) {
    this.db.exec(sql);
  }

  async withTransactionAsync(fn: () => Promise<void>) {
    this.db.exec('BEGIN');
    try {
      await fn();
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure after original error.
      }
      throw error;
    }
  }

  async runAsync(sql: string, params: SqlParams = []) {
    const statement = this.db.prepare(sql);
    return Array.isArray(params) ? statement.run(...params) : statement.run(params as Record<string, any>);
  }

  async getFirstAsync<T>(sql: string, params: SqlParams = []): Promise<T | null> {
    const statement = this.db.prepare(sql);
    const row = Array.isArray(params) ? statement.get(...params) : statement.get(params as Record<string, any>);
    return (row ?? null) as T | null;
  }

  async getAllAsync<T>(sql: string, params: SqlParams = []): Promise<T[]> {
    const statement = this.db.prepare(sql);
    return (Array.isArray(params) ? statement.all(...params) : statement.all(params as Record<string, any>)) as T[];
  }

  close() {
    this.db.close();
  }
}

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, 'app', 'build', 'evidence', 'utopia-h1-e2e', stamp);
const outPath = join(outDir, 'summary.json');
const IMPORTABLE_RECOVERY_TABLES = new Set([
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
  'workspaces',
  'app_installations',
  'app_packages',
  'app_package_state',
  'app_installation_package_state',
  'app_package_receipts',
  'undo_events',
  'workflow_runs',
  'agent_runs',
  'citations',
  'source_snapshot_relations',
]);

const now = {
  boot: '2026-07-28T00:00:00.000Z',
  author: '2026-07-28T00:01:00.000Z',
  installA: '2026-07-28T00:02:00.000Z',
  installB: '2026-07-28T00:03:00.000Z',
  recordCreate: '2026-07-28T00:04:00.000Z',
  recordUpdate: '2026-07-28T00:05:00.000Z',
  migrationPlan: '2026-07-28T00:06:00.000Z',
  migrationApprove: '2026-07-28T00:07:00.000Z',
  migrationActivate: '2026-07-28T00:08:00.000Z',
  rollback: '2026-07-28T00:09:00.000Z',
  vault: '2026-07-28T00:10:00.000Z',
  registry: '2026-07-28T00:11:00.000Z',
  reinstall: '2026-07-28T00:12:00.000Z',
};

const choreManifest: DomainManifest = {
  schema_version: 'utopia.domain.v1',
  id: 'food',
  label: 'Food',
  render: {
    answer_label: 'Food',
    empty_intro: 'No matching records.',
  },
  surfaces: [],
  collections: ['chore'],
  relations: [],
  skills: [],
  workflows: [],
  data_homes: [],
  mcp: { resources: [], tools: [] },
};

const summary: Record<string, unknown> = {
  proof: 'utopia_h1_deterministic_e2e',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  pass: false,
  evidence_dir: outDir,
  db: {},
  authoring: {},
  installs: {},
  mutation: {},
  migration: {},
  export_restore: {},
  registry_reinstall: {},
};

function writeSummary() {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), 'utopia-utopia-h1-'));
  const dbPath = join(tempDir, 'utopia-h1.sqlite');
  const db = new FileSqliteDb(dbPath);
  (summary.db as Record<string, unknown>).path = dbPath;
  (summary.db as Record<string, unknown>).clean_start = true;
  writeSummary();

  try {
    await runMigrations(db as any);

    const fixtureRoot = resolve(pathFromHere('../../tests/fixtures/package-source/reference-app'));
    const source = readAppPackageSourceFolder(fixtureRoot);
    const authoringChange = createPackageAuthoringChange({
      baseSourceRevision: computePackageSourceRevision(source),
      intent: 'Add deterministic H1 operator notes field',
      proposedBy: 'ai:fixture-utopia-h1',
      proposals: [
        { op: 'add', path: '/collections/chore/fields/utopia_note', value: { type: 'text' } },
        { op: 'add', path: '/screens/chores/fields/-', value: 'utopia_note' },
      ],
    });
    const evaluation = evaluatePackageAuthoringChange(source, authoringChange);
    if (!evaluation.valid) {
      throw new Error(evaluation.errors.map((error) => error.message).join('; '));
    }
    const authoringApproval = approvePackageAuthoringEvaluation(evaluation, {
      approvedBy: 'user:utopia-h1',
      approvedAt: now.author,
    });
    const compiledPackage = clone(evaluation.package);
    compiledPackage.version = '1.0.1';
    (summary.authoring as Record<string, unknown>) = {
      change_id: evaluation.changeId,
      base_source_revision: evaluation.baseSourceRevision,
      next_source_revision: evaluation.nextSourceRevision,
      package_checksum: evaluation.packageChecksum,
      diff_entries: evaluation.diff.length,
      approval_by: authoringApproval.approvedBy,
      compiled_package_key: `${compiledPackage.id}@${compiledPackage.version}`,
    };
    writeSummary();

    const immutablePackageUrl = buildGitHubReleaseAssetUrl({
      owner: 'utopia',
      repo: 'utopia-packages',
      tag: 'v1.0.1',
      assetName: 'utopia-h1.package.json',
    });
    const descriptor = buildRegistryInstallDescriptor({
      packageJson: compiledPackage,
      name: compiledPackage.presentation?.label ?? compiledPackage.id,
      description: 'Deterministic H1 compiled package',
      url: immutablePackageUrl,
    });
    const installPreview = buildPackageInstallPreview(compiledPackage, {
      sourceUrl: descriptor.url,
      registryPackage: descriptor,
    });
    const installApproval = buildPackageInstallApprovalReceipt(installPreview, 'user:utopia-h1', now.installA);
    const installA = await installApprovedAppPackage(db as any, {
      packageJson: compiledPackage,
      preview: installPreview,
      approval: installApproval,
      installationId: 'utopia-h1-a',
      workspaceId: 'workspace-utopia-h1',
      now: now.installA,
    });

    const invite = buildShareInviteDescriptor({
      inviteId: 'utopia-h1-invite',
      workspaceId: 'workspace-utopia-h1',
      workspaceLabel: 'Utopia H1',
      targetInstallationId: 'utopia-h1-b',
      invitedBy: 'owner@example.test',
      invitedAt: now.installB,
      installDescriptor: descriptor,
      operationStream: buildOperationStreamDesign({
        workspaceId: 'workspace-utopia-h1',
        installationId: 'utopia-h1-b',
        cursor: '0',
        entries: [],
      }),
    });
    const installBApproval = buildPackageInstallApprovalReceipt(installPreview, 'recipient@example.test', now.installB);
    const installB = await installSharedPackageInvite(db as any, {
      invite,
      packageJson: compiledPackage,
      approval: installBApproval,
      now: now.installB,
    });
    assert((await getActiveAppPackage(db as any, 'utopia-h1-a'))?.version === '1.0.1', 'install_a_active_package_missing');
    assert((await getActiveAppPackage(db as any, 'utopia-h1-b'))?.version === '1.0.1', 'install_b_active_package_missing');
    (summary.installs as Record<string, unknown>) = {
      install_a: installA.id,
      install_b: installB.id,
      workspace_id: installA.workspaceId,
      package_key: `${compiledPackage.id}@${compiledPackage.version}`,
    };
    writeSummary();

    const repoA = createInstallationRepository({
      db: db as any,
      workspaceId: 'workspace-utopia-h1',
      installationId: 'utopia-h1-a',
    });
    await repoA.upsertRecord(choreManifest, {
      id: 'h1-chore-1',
      title: 'Wash produce',
      collection: 'chore',
      properties: {
        status: 'todo',
        utopia_note: 'from fixture compile',
      },
      relations: [],
      source: {
        provider: 'sqlite',
        external_id: 'h1-chore-1',
        url: null,
        observed_at: now.recordCreate,
        content_hash: null,
      },
      archived_at: null,
      created_at: now.recordCreate,
      updated_at: now.recordCreate,
      idempotency_key: 'h1-create-1',
    });
    const created = await repoA.getRecord('h1-chore-1');
    assert(created?.revision === 1, 'record_create_revision_invalid');
    const updated = await repoA.applyOperation(choreManifest, {
      op_id: 'h1-update-1',
      kind: 'update',
      domain: choreManifest.id,
      collection: 'chore',
      record_id: 'h1-chore-1',
      expected_revision: created.revision,
      changes: {
        status: 'done',
        utopia_note: 'mutated-before-migration',
      },
      actor: 'user',
      origin: 'manual',
      reason: 'Mutate deterministic fixture record',
    });
    assert(updated.status === 'applied', `record_update_failed:${updated.status}`);
    const mutated = await repoA.getRecord('h1-chore-1');
    assert(mutated?.revision === 2, 'record_update_revision_invalid');
    (summary.mutation as Record<string, unknown>) = {
      record_id: mutated?.id,
      revision: mutated?.revision,
      status: mutated?.properties.status,
      note: mutated?.properties.utopia_note,
    };
    writeSummary();

    const migratedPackage = clone(compiledPackage);
    migratedPackage.version = '1.0.2';
    migratedPackage.collections.chore.fields.estimated_minutes = { type: 'number', indexed: true };

    const dryRun = await dryRunPackageMigration({
      db: db as any,
      installationId: 'utopia-h1-a',
      toPackageJson: migratedPackage,
      now: now.migrationPlan,
    });
    assert(dryRun.status === 'ready', `migration_not_ready:${dryRun.status}`);
    const migrationApproval = buildPackageMigrationApprovalReceipt({
      plan: dryRun.plan,
      snapshot: dryRun.snapshot,
      approvedBy: 'reviewer@example.test',
      approvedAt: now.migrationApprove,
      nonce: 'utopia-h1-migrate',
    });
    const activated = await activateDryRunPackageMigration({
      db: db as any,
      installationId: 'utopia-h1-a',
      toPackageJson: migratedPackage,
      expectedSnapshot: dryRun.snapshot,
      approval: migrationApproval,
      now: now.migrationActivate,
    });
    assert(activated.status === 'activated', `migration_activate_failed:${activated.status}`);
    assert((await getActiveAppPackage(db as any, 'utopia-h1-a'))?.version === '1.0.2', 'migration_active_version_invalid');

    const rolledBack = await rollbackPackageMigration({
      db: db as any,
      installationId: 'utopia-h1-a',
      expectedActivePackageKey: `${migratedPackage.id}@${migratedPackage.version}`,
      now: now.rollback,
    });
    assert(rolledBack.status === 'rolled_back', `migration_rollback_failed:${rolledBack.status}`);
    assert((await getActiveAppPackage(db as any, 'utopia-h1-a'))?.version === '1.0.1', 'rollback_active_version_invalid');
    (summary.migration as Record<string, unknown>) = {
      dry_run_status: dryRun.status,
      affected_record_count: dryRun.plan.affectedRecordCount,
      activated_package_key: activated.activePackageKey,
      rollback_status: rolledBack.status,
      rollback_active_package_key: rolledBack.activePackageKey,
    };
    writeSummary();

    const snapshot = await exportRecoverySnapshot(db as any);
    const filteredTables = snapshot.tables
      .map((table) => table.name)
      .filter((name) => !IMPORTABLE_RECOVERY_TABLES.has(name));
    const importableSnapshot = {
      ...snapshot,
      tables: snapshot.tables.filter((table) => IMPORTABLE_RECOVERY_TABLES.has(table.name)),
    };
    const workspaceInstallations = await db.getAllAsync<WorkspaceRow>(
      `SELECT installation_id, workspace_id, app_name, status, created_at, updated_at
       FROM app_installations WHERE workspace_id = ? ORDER BY installation_id ASC`,
      ['workspace-utopia-h1'],
    );
    const packageStates = await db.getAllAsync<PackageStateRow>(
      `SELECT installation_id, active_package_key, previous_package_key, updated_at
       FROM app_installation_package_state WHERE installation_id IN (?, ?) ORDER BY installation_id ASC`,
      ['utopia-h1-a', 'utopia-h1-b'],
    );
    const records = (await repoA.listRecordsForDomain(choreManifest.id)).filter((record) => !record.deleted);
    const opRows = await db.getAllAsync<OperationRow>(
      `SELECT op_id, record_id, created_at, changes_json
       FROM operations
       WHERE app_installation_id = ? AND status = 'applied'
       ORDER BY created_at ASC, op_id ASC`,
      ['utopia-h1-a'],
    );
    const operationStream = buildOperationStreamDesign({
      workspaceId: 'workspace-utopia-h1',
      installationId: 'utopia-h1-a',
      entries: opRows.map((row, index) => ({
        cursor: String(index + 1),
        opId: row.op_id,
        recordId: row.record_id,
        createdAt: row.created_at,
        operation: JSON.parse(row.changes_json),
      })),
    });
    const workspaceVault = exportEncryptedWorkspaceVault({
      workspaceId: 'workspace-utopia-h1',
      workspaceLabel: 'Utopia H1',
      installations: await Promise.all(workspaceInstallations.map(async (row) => {
        const installation = await getAppInstallation(db as any, row.installation_id);
        assert(installation, `installation_missing:${row.installation_id}`);
        return installation;
      })),
      packageStates: packageStates.map((row) => ({
        installationId: row.installation_id,
        activePackageKey: row.active_package_key,
        previousPackageKey: row.previous_package_key,
        updatedAt: row.updated_at,
      })),
      installDescriptors: [descriptor],
      records,
      operationStreams: [operationStream],
      passphrase: 'utopia h1 deterministic passphrase',
      now: now.vault,
    });
    const workspacePreview = previewEncryptedWorkspaceVault({
      vault: workspaceVault,
      passphrase: 'utopia h1 deterministic passphrase',
    });
    const workspaceRestore = restoreEncryptedWorkspaceVault({
      vault: workspaceVault,
      passphrase: 'utopia h1 deterministic passphrase',
      policy: 'backup_wins',
    });

    const deleted = await repoA.applyOperation(choreManifest, {
      op_id: 'h1-delete-1',
      kind: 'delete',
      domain: choreManifest.id,
      collection: 'chore',
      record_id: 'h1-chore-1',
      expected_revision: mutated!.revision,
      actor: 'user',
      origin: 'manual',
      reason: 'Delete before restore import',
    });
    assert(deleted.status === 'applied', `delete_failed:${deleted.status}`);
    assert((await repoA.getRecord('h1-chore-1'))?.deleted === true, 'delete_not_persisted');

    await importRecoverySnapshot(db as any, importableSnapshot);
    const restoredRecord = await repoA.getRecord('h1-chore-1');
    assert(restoredRecord?.deleted === false, 'restore_deleted_flag_invalid');
    assert(restoredRecord?.revision === 2, 'restore_revision_invalid');
    assert((await getActiveAppPackage(db as any, 'utopia-h1-a'))?.version === '1.0.1', 'restore_package_version_invalid');
    (summary.export_restore as Record<string, unknown>) = {
      recovery_snapshot_tables: snapshot.tables.length,
      recovery_import_tables: importableSnapshot.tables.length,
      filtered_tables: filteredTables,
      vault_preview_counts: workspacePreview.counts,
      vault_restore_policy: workspaceRestore.policy,
      post_restore_record_revision: restoredRecord.revision,
      post_restore_deleted: restoredRecord.deleted,
    };
    writeSummary();

    const registryUrl = buildGitHubReleaseAssetUrl({
      owner: 'utopia',
      repo: 'utopia-packages',
      tag: 'v1.0.1',
      assetName: 'registry.json',
    });
    const manifest = buildRegistryManifest({
      name: 'Utopia immutable local registry',
      packages: [descriptor],
    });
    const distribution = buildGitHubRegistryDistribution({
      owner: 'utopia',
      repo: 'utopia-packages',
      releaseTag: 'v1.0.1',
      assetName: 'registry.json',
      pagesPath: 'registries/index.json',
      sourceRevision: '0123456789abcdef0123456789abcdef01234567',
      manifest,
      generatedAt: now.registry,
    });
    const localFetcher = createPackageInstallFetcher(async (url) => {
      if (url === registryUrl) {
        return jsonResponse(manifest);
      }
      if (url === immutablePackageUrl) {
        return jsonResponse(compiledPackage);
      }
      return { ok: false, status: 404 };
    });
    const fetchedManifest = await fetchRegistryManifest(registryUrl, localFetcher);
    const compatibility = checkRegistryInstallCompatibility({
      manifest: fetchedManifest,
      packagesByUrl: new Map([[immutablePackageUrl, compiledPackage]]),
    });
    const registryCandidate = await fetchPackageInstallCandidate(immutablePackageUrl, localFetcher, {
      registryPackage: fetchedManifest.packages[0],
    });
    const registryApproval = buildPackageInstallApprovalReceipt(
      registryCandidate.preview,
      'user:utopia-h1-registry',
      now.reinstall,
    );
    const reinstall = await installApprovedAppPackage(db as any, {
      packageJson: registryCandidate.packageJson,
      preview: registryCandidate.preview,
      approval: registryApproval,
      installationId: 'utopia-h1-registry',
      workspaceId: 'workspace-utopia-h1',
      now: now.reinstall,
    });
    assert((await getActiveAppPackage(db as any, 'utopia-h1-registry'))?.version === '1.0.1', 'registry_reinstall_failed');
    (summary.registry_reinstall as Record<string, unknown>) = {
      registry_url: registryUrl,
      package_url: immutablePackageUrl,
      compatibility,
      distribution,
      installation_id: reinstall.id,
    };

    summary.pass = true;
    writeSummary();
    console.log(`[utopia-h1] PASS ${outPath}`);
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function jsonResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      },
    },
    json: async () => value,
  };
}

function pathFromHere(relativePath: string) {
  return join(fileURLToPath(new URL('.', import.meta.url)), relativePath);
}

main().catch((error) => {
  summary.pass = false;
  summary.error = error instanceof Error ? {
    message: error.message,
    stack: error.stack,
  } : { message: String(error) };
  writeSummary();
  console.error(`[utopia-h1] FAIL ${outPath}`);
  process.exit(1);
});
