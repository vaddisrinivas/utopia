import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppInstallation, activateAppPackage, getActiveAppPackage } from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import {
  activateDryRunPackageMigration,
  buildPackageMigrationApprovalReceipt,
  dryRunPackageMigration,
  planPackageMigration,
  recoverInterruptedPackageMigration,
  rollbackPackageMigration,
} from '@/src/domain/package-migrations';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-install');
const basePackage = JSON.parse(readFileSync(path.join(fixtureDir, 'valid-package.json'), 'utf8'));

describe('package migration safety', () => {
  const dbs: Array<{ close: () => void }> = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('persists journal snapshots and activates safe changes with affected counts', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);
    await createAppInstallation(db as any, { id: 'migration-a', label: 'Migration A', now: '2026-07-28T00:00:00.000Z' });
    await activateAppPackage(db as any, 'migration-a', basePackage, 'bootstrap');
    await insertTaskRecord(db, 'migration-a', 'task-1');

    const safeNext = clonePackage('1.0.1');
    safeNext.collections.task.fields.priority_score = { type: 'number', indexed: true };

    const dryRun = await dryRunPackageMigration({
      db: db as any,
      installationId: 'migration-a',
      toPackageJson: safeNext,
      now: '2026-07-28T00:01:00.000Z',
    });
    expect(dryRun.status).toBe('ready');
    expect(dryRun.plan.affectedRecordCount).toBe(1);
    expect(dryRun.plan.operationHash).toMatch(/^sha256:/);

    const planned = await getJournalRow(db, dryRun.journalId);
    expect(planned).toMatchObject({
      state: 'planned',
      installation_id: 'migration-a',
      workspace_id: 'default-workspace',
      affected_record_count: 1,
    });

    const activated = await activateDryRunPackageMigration({
      db: db as any,
      installationId: 'migration-a',
      toPackageJson: safeNext,
      expectedSnapshot: dryRun.snapshot,
      now: '2026-07-28T00:02:00.000Z',
    });
    expect(activated.status).toBe('activated');
    expect(activated.receipt.status).toBe('activated');
    expect(activated.receipt.affectedRecordCount).toBe(1);
    expect((await getActiveAppPackage(db as any, 'migration-a'))?.version).toBe('1.0.1');

    const finalJournal = await getJournalRow(db, dryRun.journalId);
    expect(finalJournal).toMatchObject({
      state: 'activated',
      from_package_key: `${basePackage.id}@${basePackage.version}`,
      to_package_key: `${safeNext.id}@${safeNext.version}`,
    });
  });

  it('requires bound approval for review-required migrations and rejects cross-installation replay', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);
    await createAppInstallation(db as any, { id: 'migration-review-a', label: 'Migration Review A', now: '2026-07-28T00:00:00.000Z' });
    await createAppInstallation(db as any, { id: 'migration-review-b', label: 'Migration Review B', now: '2026-07-28T00:00:00.000Z' });
    await activateAppPackage(db as any, 'migration-review-a', basePackage, 'bootstrap');
    await activateAppPackage(db as any, 'migration-review-b', basePackage, 'bootstrap');

    const reviewNext = clonePackage('1.1.0');
    reviewNext.collections.task.fields.required_note = { type: 'text', required: true };

    const dryRun = await dryRunPackageMigration({
      db: db as any,
      installationId: 'migration-review-a',
      toPackageJson: reviewNext,
      now: '2026-07-28T00:01:00.000Z',
    });
    expect(dryRun.status).toBe('review_required');

    const noApproval = await activateDryRunPackageMigration({
      db: db as any,
      installationId: 'migration-review-a',
      toPackageJson: reviewNext,
      expectedSnapshot: dryRun.snapshot,
    });
    expect(noApproval.reason).toBe('package_migration_approval_required');

    const approval = buildPackageMigrationApprovalReceipt({
      plan: dryRun.plan,
      snapshot: dryRun.snapshot,
      approvedBy: 'reviewer@example.test',
      approvedAt: '2026-07-28T00:02:00.000Z',
      expiresAt: '2026-07-28T01:02:00.000Z',
      nonce: 'review-a-1',
    });

    const activated = await activateDryRunPackageMigration({
      db: db as any,
      installationId: 'migration-review-a',
      toPackageJson: reviewNext,
      expectedSnapshot: dryRun.snapshot,
      approval,
      now: '2026-07-28T00:03:00.000Z',
    });
    expect(activated.status).toBe('activated');
    expect(activated.receipt.approvalHash).toMatch(/^sha256:/);

    const otherDryRun = await dryRunPackageMigration({
      db: db as any,
      installationId: 'migration-review-b',
      toPackageJson: reviewNext,
      now: '2026-07-28T00:04:00.000Z',
    });
    await expect(activateDryRunPackageMigration({
      db: db as any,
      installationId: 'migration-review-b',
      toPackageJson: reviewNext,
      expectedSnapshot: otherDryRun.snapshot,
      approval,
      now: '2026-07-28T00:05:00.000Z',
    })).rejects.toThrow(/package_migration_approval_mismatch|package_migration_approval_cross_installation/);
  });

  it('rolls back record and package state when invariant validation fails mid-activation', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);
    await createAppInstallation(db as any, { id: 'migration-atomic', label: 'Migration Atomic', now: '2026-07-28T00:00:00.000Z' });
    await activateAppPackage(db as any, 'migration-atomic', basePackage, 'bootstrap');
    await insertTaskRecord(db, 'migration-atomic', 'task-atomic');

    const next = clonePackage('1.2.0');
    next.collections.task.fields.required_note = { type: 'text', required: true };
    next.migration = {
      operations: [
        { kind: 'rename_field', collectionId: 'task', fromFieldId: 'title', toFieldId: 'name' },
      ],
    };

    const dryRun = await dryRunPackageMigration({
      db: db as any,
      installationId: 'migration-atomic',
      toPackageJson: next,
      now: '2026-07-28T00:01:00.000Z',
    });
    const approval = buildPackageMigrationApprovalReceipt({
      plan: dryRun.plan,
      snapshot: dryRun.snapshot,
      approvedBy: 'reviewer@example.test',
      approvedAt: '2026-07-28T00:02:00.000Z',
      nonce: 'atomic-1',
    });

    const result = await activateDryRunPackageMigration({
      db: db as any,
      installationId: 'migration-atomic',
      toPackageJson: next,
      expectedSnapshot: dryRun.snapshot,
      approval,
      now: '2026-07-28T00:03:00.000Z',
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('package_migration_invariant_failed');
    expect((await getActiveAppPackage(db as any, 'migration-atomic'))?.version).toBe(basePackage.version);

    const row = await (db as any).getFirstAsync(
      `SELECT properties FROM records WHERE app_installation_id = ? AND id = ?`,
      ['migration-atomic', 'task-atomic'],
    ) as { properties: string } | null;
    expect(JSON.parse(row!.properties)).toMatchObject({ title: 'Task 1' });
    expect(JSON.parse(row!.properties)).not.toHaveProperty('name');

    const journal = await getJournalRow(db, dryRun.journalId);
    expect(journal).toMatchObject({
      state: 'failed',
      error_reason: expect.stringContaining('package_migration_invariant_failed'),
    });
  });

  it('recovers interrupted restart from durable journal without caller snapshot', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'utopia-package-migration-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'migration.sqlite');

    {
      const db = new FileSqliteDb(dbPath);
      dbs.push(db);
      await runMigrations(db as any);
      await createAppInstallation(db as any, { id: 'migration-restart', label: 'Migration Restart', now: '2026-07-28T00:00:00.000Z' });
      await activateAppPackage(db as any, 'migration-restart', basePackage, 'bootstrap');

      const next = clonePackage('1.0.3');
      next.collections.task.fields.priority_score = { type: 'number', indexed: true };
      const dryRun = await dryRunPackageMigration({
        db: db as any,
        installationId: 'migration-restart',
        toPackageJson: next,
        now: '2026-07-28T00:01:00.000Z',
      });
      await activateDryRunPackageMigration({
        db: db as any,
        installationId: 'migration-restart',
        toPackageJson: next,
        expectedSnapshot: dryRun.snapshot,
        now: '2026-07-28T00:02:00.000Z',
      });
      await (db as any).runAsync(
        `UPDATE package_migration_journal SET state = ?, receipt_json = NULL, updated_at = ? WHERE id = ?`,
        ['applying', '2026-07-28T00:02:30.000Z', dryRun.journalId],
      );
      db.close();
      dbs.pop();
    }

    const reopened = new FileSqliteDb(dbPath);
    dbs.push(reopened);
    const recovery = await recoverInterruptedPackageMigration({
      db: reopened as any,
      installationId: 'migration-restart',
      now: '2026-07-28T00:03:00.000Z',
    });
    expect(recovery).toMatchObject({
      status: 'completed',
      activePackageKey: `${basePackage.id}@1.0.3`,
    });

    const journal = await getLatestJournal(reopened, 'migration-restart');
    expect(journal).toMatchObject({
      state: 'recovered',
    });
  });

  it('marks ambiguous interrupted state for manual review', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);
    await createAppInstallation(db as any, { id: 'migration-manual', label: 'Migration Manual', now: '2026-07-28T00:00:00.000Z' });
    await activateAppPackage(db as any, 'migration-manual', basePackage, 'bootstrap');

    const next = clonePackage('1.0.9');
    next.collections.task.fields.priority_score = { type: 'number', indexed: true };
    const dryRun = await dryRunPackageMigration({
      db: db as any,
      installationId: 'migration-manual',
      toPackageJson: next,
      now: '2026-07-28T00:01:00.000Z',
    });
    await activateDryRunPackageMigration({
      db: db as any,
      installationId: 'migration-manual',
      toPackageJson: next,
      expectedSnapshot: dryRun.snapshot,
      now: '2026-07-28T00:01:30.000Z',
    });
    await (db as any).runAsync(
      `UPDATE package_migration_journal
        SET state = ?, from_checksum = ?, updated_at = ?
        WHERE id = ?`,
      ['applying', 'sha256:corrupt', '2026-07-28T00:02:00.000Z', dryRun.journalId],
    );

    const recovery = await recoverInterruptedPackageMigration({
      db: db as any,
      installationId: 'migration-manual',
      now: '2026-07-28T00:03:00.000Z',
    });
    expect(recovery.status).toBe('manual_review');
    expect(recovery.reason).toBe('package_migration_package_checksum_mismatch');

    const journal = await getJournalRow(db, dryRun.journalId);
    expect(journal).toMatchObject({
      state: 'manual_review',
      error_reason: 'package_migration_package_checksum_mismatch',
    });
  });

  it('plans and applies declared data migration operations', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);
    await createAppInstallation(db as any, { id: 'migration-ops', label: 'Migration Ops', now: '2026-07-28T00:00:00.000Z' });
    await activateAppPackage(db as any, 'migration-ops', basePackage, 'bootstrap');
    await insertTaskRecord(db, 'migration-ops', 'task-ops');

    const next = clonePackage('1.2.0');
    next.migration = {
      operations: [
        { kind: 'add_field', collectionId: 'task', fieldId: 'added', defaultValue: 'new' },
        { kind: 'rename_field', collectionId: 'task', fromFieldId: 'title', toFieldId: 'name' },
        { kind: 'copy_field', collectionId: 'task', fromFieldId: 'collection', toFieldId: 'bucket' },
        { kind: 'set_default', collectionId: 'task', fieldId: 'state', value: 'open' },
        { kind: 'map_enum', collectionId: 'task', fieldId: 'state', values: { open: 'todo' } },
      ],
    };

    const dryRun = await dryRunPackageMigration({
      db: db as any,
      installationId: 'migration-ops',
      toPackageJson: next,
      now: '2026-07-28T00:01:00.000Z',
    });
    expect(dryRun.status).toBe('ready');
    expect(dryRun.plan.affectedRecordCount).toBe(1);

    const activated = await activateDryRunPackageMigration({
      db: db as any,
      installationId: 'migration-ops',
      toPackageJson: next,
      expectedSnapshot: dryRun.snapshot,
      now: '2026-07-28T00:03:00.000Z',
    });
    expect(activated.status).toBe('activated');
    const row = await (db as any).getFirstAsync(
      `SELECT properties FROM records WHERE app_installation_id = ? AND id = ?`,
      ['migration-ops', 'task-ops'],
    ) as { properties: string } | null;
    expect(JSON.parse(row!.properties)).toMatchObject({
      added: 'new',
      name: 'Task 1',
      bucket: 'task',
      state: 'todo',
    });
  });

  it('still blocks destructive plans and explicit rollback returns prior package', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);
    await createAppInstallation(db as any, { id: 'migration-b', label: 'Migration B', now: '2026-07-28T00:00:00.000Z' });
    await activateAppPackage(db as any, 'migration-b', basePackage, 'bootstrap');

    const fieldRemoval = clonePackage('2.0.0');
    delete fieldRemoval.collections.task.fields.title;
    const plan = planPackageMigration({ fromPackageJson: basePackage, toPackageJson: fieldRemoval });
    expect(plan.risk).toBe('destructive');
    expect(plan.compatibilityMatrix.rollbackAllowed).toBe(false);

    const destructive = clonePackage('2.0.1');
    destructive.migration = {
      operations: [
        { kind: 'archive_collection', collectionId: 'task', risk: 'destructive' },
      ],
    };

    const blocked = await dryRunPackageMigration({
      db: db as any,
      installationId: 'migration-b',
      toPackageJson: destructive,
    });
    expect(blocked.status).toBe('blocked');

    const activatedSafe = await activateDryRunPackageMigration({
      db: db as any,
      installationId: 'migration-b',
      toPackageJson: clonePackage('1.0.2'),
      expectedSnapshot: blocked.snapshot,
      now: '2026-07-28T00:02:00.000Z',
    });
    expect(activatedSafe.status).toBe('activated');

    const rollback = await rollbackPackageMigration({
      db: db as any,
      installationId: 'migration-b',
      expectedActivePackageKey: `${basePackage.id}@1.0.2`,
      now: '2026-07-28T00:03:00.000Z',
    });
    expect(rollback).toMatchObject({
      status: 'rolled_back',
      activePackageKey: `${basePackage.id}@${basePackage.version}`,
    });
  });
});

function clonePackage(version: string) {
  const next = JSON.parse(JSON.stringify(basePackage));
  next.version = version;
  return next;
}

async function insertTaskRecord(db: NodeSqliteDb | FileSqliteDb, installationId: string, id: string) {
  await (db as any).runAsync(
    `INSERT INTO records (
      app_installation_id, id, domain, collection, title, properties, source_provider, source_external_id, source_url,
      source_observed_at, source_content_hash, archived_at, created_at, updated_at,
      revision, schema_version, deleted, privacy, provenance_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      installationId,
      id,
      'demo.shelf',
      'task',
      'Task 1',
      JSON.stringify({ title: 'Task 1', collection: 'task', updated_at: '2026-07-28T00:00:00.000Z' }),
      'user',
      id,
      null,
      '2026-07-28T00:00:00.000Z',
      null,
      null,
      '2026-07-28T00:00:00.000Z',
      '2026-07-28T00:00:00.000Z',
      1,
      '1.0.0',
      0,
      'personal',
      null,
    ],
  );
}

async function getJournalRow(db: NodeSqliteDb | FileSqliteDb, journalId: string) {
  return (db as any).getFirstAsync(
    `SELECT id, installation_id, workspace_id, state, from_package_key, to_package_key, affected_record_count, error_reason
      FROM package_migration_journal
      WHERE id = ?`,
    [journalId],
  ) as Promise<Record<string, unknown> | null>;
}

async function getLatestJournal(db: NodeSqliteDb | FileSqliteDb, installationId: string) {
  return (db as any).getFirstAsync(
    `SELECT state FROM package_migration_journal
      WHERE installation_id = ?
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1`,
    [installationId],
  ) as Promise<Record<string, unknown> | null>;
}

class FileSqliteDb {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath);
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
        // ignore
      }
      throw error;
    }
  }

  async runAsync(sql: string, params: any[] | Record<string, unknown> = []) {
    const statement = this.db.prepare(sql);
    return Array.isArray(params) ? statement.run(...params) : statement.run(params as Record<string, SQLInputValue>);
  }

  async getFirstAsync<T>(sql: string, params: any[] | Record<string, unknown> = []): Promise<T | null> {
    const statement = this.db.prepare(sql);
    const row = Array.isArray(params) ? statement.get(...params) : statement.get(params as Record<string, SQLInputValue>);
    return (row ?? null) as T | null;
  }

  async getAllAsync<T>(sql: string, params: any[] | Record<string, unknown> = []): Promise<T[]> {
    const statement = this.db.prepare(sql);
    return (Array.isArray(params) ? statement.all(...params) : statement.all(params as Record<string, SQLInputValue>)) as T[];
  }

  close() {
    this.db.close();
  }
}
