import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileAppPackageSource } from '@/packages/app-compiler';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import {
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
  parsePackageInstallTarget,
} from '@/packages/shared/contracts/package-install';
import { validateArtifact } from '@/packages/schemas/src';
import {
  activateApprovedAppPackageUpdate,
  getActiveAppPackage,
  installApprovedAppPackage,
  rollbackAppPackage,
  previewAppPackageUpdate,
} from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import { getRecordForInstallation } from '@/src/db/records';
import { loadAppPackage } from '@/src/domain/package-loader';
import { applyOperation } from '@/src/ops/apply';
import {
  assessFactoryPrompt,
  normalizeModelSource,
} from '@/scripts/factory/generate-app-from-prompt';
import { validateAppPackage } from '@/server/src/kernel/package';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const prompt = [
  'Build a shared household board with tasks, routines, members, and expenses.',
  'It must work offline, preserve data through updates, and use only generic Utopia widgets.',
].join(' ');
const fixturePath = path.resolve('tests/fixtures/golden-loop/shared-household-board.source.json');
const rawSource = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;
const allowedGenericWidgets = new Set([
  'kanbanBoard',
  'formCard',
  'dataTable',
  'chartBlock',
  'checklistCard',
]);

describe('Utopia Golden Loop', () => {
  const databases: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('generates, validates, installs, updates, rolls back, and preserves scoped data', async () => {
    expect(assessFactoryPrompt(prompt)).toEqual({ allowed: true });

    const source = normalizeModelSource(rawSource, prompt);
    const firstCompile = compileAppPackageSource(source);
    const secondCompile = compileAppPackageSource(JSON.parse(JSON.stringify(source)));
    expect(firstCompile.valid).toBe(true);
    expect(secondCompile.valid).toBe(true);
    if (!firstCompile.valid || !secondCompile.valid) throw new Error('golden_package_compile_failed');

    expect(firstCompile.checksum).toBe(secondCompile.checksum);
    expect(firstCompile.package.id).toBe('shared-household-board');
    expect(firstCompile.preview.widgets.length).toBeGreaterThan(0);
    expect(firstCompile.preview.widgets.every((widget) => allowedGenericWidgets.has(widget))).toBe(true);
    expect(firstCompile.package.capabilities).toEqual([]);
    const artifactValidation = validateArtifact({ value: firstCompile.package });
    if (!artifactValidation.ok) {
      throw new Error(artifactValidation.issues.map((issue) => `${issue.path}:${issue.message}`).join('|'));
    }
    expect(validateAppPackage(firstCompile.package).valid).toBe(true);

    const packageUrl = 'https://utoia.thetechcruise.com/p/shared-household-board.json';
    const installUrl = `utopia://install?url=${encodeURIComponent(packageUrl)}`;
    expect(parsePackageInstallTarget(installUrl)).toEqual({
      source: 'deep_link',
      packageUrl,
    });

    const database = new NodeSqliteDb();
    databases.push(database);
    await runMigrations(database as never);

    const installationId = 'golden-household-installation';
    const v1 = firstCompile.package;
    const installPreview = buildPackageInstallPreview(v1, {
      sourceUrl: packageUrl,
      expectedChecksum: sha256Canonical(v1),
    });
    expect(installPreview.status).toBe('ready_for_review');
    const installApproval = buildPackageInstallApprovalReceipt(
      installPreview,
      'golden-loop-user',
      '2026-07-30T00:00:00.000Z',
    );
    await installApprovedAppPackage(database as never, {
      packageJson: v1,
      preview: installPreview,
      approval: installApproval,
      installationId,
      now: '2026-07-30T00:00:01.000Z',
    });

    const runtimeV1 = loadAppPackage(v1);
    const createResult = await applyOperation(database as never, runtimeV1.activeManifest, {
      op_id: 'golden-create-task',
      kind: 'create',
      domain: v1.id,
      collection: 'task',
      record_id: 'task-1',
      record: {
        title: 'Prepare dinner',
        properties: {
          owner: 'Alex',
          status: 'todo',
          routine: 'weekday',
        },
        relations: [],
        source: {
          provider: 'sqlite',
          external_id: 'task-1',
          url: null,
          observed_at: '2026-07-30T00:00:02.000Z',
          content_hash: null,
        },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'golden-create-task',
    }, { appInstallationId: installationId });
    expect(createResult.status).toBe('applied');

    const v2 = structuredClone(v1);
    v2.version = '1.1.0';
    v2.collections.task.fields.priority = { type: 'text', indexed: true };
    const updateUrl = 'https://utoia.thetechcruise.com/p/shared-household-board-1.1.0.json';
    const updatePreview = buildPackageInstallPreview(v2, {
      sourceUrl: updateUrl,
      expectedChecksum: sha256Canonical(v2),
    });
    const updateApproval = buildPackageInstallApprovalReceipt(
      updatePreview,
      'golden-loop-user',
      '2026-07-30T00:01:00.000Z',
    );
    await activateApprovedAppPackageUpdate(database as never, {
      packageJson: v2,
      preview: updatePreview,
      approval: updateApproval,
      installationId,
      now: '2026-07-30T00:01:01.000Z',
    });
    expect((await getActiveAppPackage(database as never, installationId))?.version).toBe('1.1.0');

    const rolledBack = await rollbackAppPackage(database as never, installationId);
    const record = await getRecordForInstallation(database as never, installationId, 'task-1');
    expect(rolledBack?.version).toBe('1.0.0');
    expect(record).toMatchObject({
      id: 'task-1',
      title: 'Prepare dinner',
      collection: 'task',
      properties: {
        owner: 'Alex',
        status: 'todo',
      },
    });
  });

  it('rejects hostile/tampered package payloads during install with payload mismatch', async () => {
    expect(assessFactoryPrompt(prompt)).toEqual({ allowed: true });

    const source = normalizeModelSource(rawSource, prompt);
    const compile = compileAppPackageSource(source);
    if (!compile.valid) throw new Error('golden_package_compile_failed');

    const packageUrl = 'https://utoia.thetechcruise.com/p/shared-household-board.json';
    const installPreview = buildPackageInstallPreview(compile.package, {
      sourceUrl: packageUrl,
      expectedChecksum: sha256Canonical(compile.package),
    });
    expect(installPreview.status).toBe('ready_for_review');
    const installApproval = buildPackageInstallApprovalReceipt(
      installPreview,
      'golden-loop-user',
      '2026-07-30T00:00:00.000Z',
    );

    const database = new NodeSqliteDb();
    databases.push(database);
    await runMigrations(database as never);

    const tamperedPackage = structuredClone(compile.package);
    if (!tamperedPackage.presentation) throw new Error('missing_presentation');
    tamperedPackage.presentation.label = 'Compromised Household Board';

    await expect(installApprovedAppPackage(database as never, {
      packageJson: tamperedPackage,
      preview: installPreview,
      approval: installApproval,
      installationId: 'golden-household-hostile',
      now: '2026-07-30T00:00:01.000Z',
    })).rejects.toThrow('package_install_payload_mismatch');

    expect(await getActiveAppPackage(database as never, 'golden-household-hostile')).toBeNull();
  });

  it('rejects install approvals that do not match preview identity', async () => {
    expect(assessFactoryPrompt(prompt)).toEqual({ allowed: true });

    const source = normalizeModelSource(rawSource, prompt);
    const compile = compileAppPackageSource(source);
    if (!compile.valid) throw new Error('golden_package_compile_failed');

    const installPreview = buildPackageInstallPreview(compile.package, {
      sourceUrl: 'https://utoia.thetechcruise.com/p/shared-household-board.json',
    });
    expect(installPreview.status).toBe('ready_for_review');

    const approval = buildPackageInstallApprovalReceipt(
      installPreview,
      'golden-loop-user',
      '2026-07-30T00:00:00.000Z',
    );
    const mismatchedApproval = {
      ...approval,
      version: '9.9.9',
    };

    const database = new NodeSqliteDb();
    databases.push(database);
    await runMigrations(database as never);

    await expect(installApprovedAppPackage(database as never, {
      packageJson: compile.package,
      preview: installPreview,
      approval: mismatchedApproval,
      installationId: 'golden-household-approval-mismatch',
      now: '2026-07-30T00:00:01.000Z',
    })).rejects.toThrow('package_install_approval_mismatch');

    expect(await getActiveAppPackage(database as never, 'golden-household-approval-mismatch')).toBeNull();
  });

  it('requires a fresh approval when update introduces capability escalation', async () => {
    const source = normalizeModelSource(rawSource, prompt);
    const compile = compileAppPackageSource(source);
    if (!compile.valid) throw new Error('golden_package_compile_failed');

    const packageUrl = 'https://utoia.thetechcruise.com/p/shared-household-board.json';
    const installPreview = buildPackageInstallPreview(compile.package, {
      sourceUrl: packageUrl,
      expectedChecksum: sha256Canonical(compile.package),
    });
    const installApproval = buildPackageInstallApprovalReceipt(
      installPreview,
      'golden-loop-user',
      '2026-07-30T00:00:00.000Z',
    );

    const database = new NodeSqliteDb();
    databases.push(database);
    await runMigrations(database as never);
    const installationId = 'golden-household-capability-escalation';
    await installApprovedAppPackage(database as never, {
      packageJson: compile.package,
      preview: installPreview,
      approval: installApproval,
      installationId,
      now: '2026-07-30T00:00:01.000Z',
    });

    const escalatedPackage = structuredClone(compile.package);
    escalatedPackage.version = '1.1.0';
    escalatedPackage.capabilities = [...compile.package.capabilities, 'provider:notion'];
    const escalatedPreview = buildPackageInstallPreview(escalatedPackage, {
      sourceUrl: 'https://utoia.thetechcruise.com/p/shared-household-board-1.1.0.json',
      expectedChecksum: sha256Canonical(escalatedPackage),
    });
    const updatePreview = await previewAppPackageUpdate(database as never, installationId, escalatedPackage, escalatedPreview);

    expect(updatePreview).toMatchObject({
      status: 'ready_for_review',
      approvalRequired: true,
      currentVersion: compile.package.version,
      nextVersion: '1.1.0',
      capabilityDiff: {
        addedProviders: ['provider:notion'],
      },
    });

    await expect(activateApprovedAppPackageUpdate(database as never, {
      packageJson: escalatedPackage,
      preview: escalatedPreview,
      approval: installApproval,
      installationId,
      now: '2026-07-30T00:01:01.000Z',
    })).rejects.toThrow('package_install_approval_mismatch');

    const escalatedApproval = buildPackageInstallApprovalReceipt(
      escalatedPreview,
      'golden-loop-user',
      '2026-07-30T00:01:00.000Z',
    );
    const updated = await activateApprovedAppPackageUpdate(database as never, {
      packageJson: escalatedPackage,
      preview: escalatedPreview,
      approval: escalatedApproval,
      installationId,
      now: '2026-07-30T00:01:02.000Z',
    });

    expect(updated.packageBinding?.version).toBe('1.1.0');
    expect((await getActiveAppPackage(database as never, installationId))?.version).toBe('1.1.0');
  });

  it('preserves scoped data across update/rollback boundaries', async () => {
    const source = normalizeModelSource(rawSource, prompt);
    const compile = compileAppPackageSource(source);
    if (!compile.valid) throw new Error('golden_package_compile_failed');

    const packageUrl = 'https://utoia.thetechcruise.com/p/shared-household-board.json';
    const installPreview = buildPackageInstallPreview(compile.package, {
      sourceUrl: packageUrl,
      expectedChecksum: sha256Canonical(compile.package),
    });
    const installApproval = buildPackageInstallApprovalReceipt(
      installPreview,
      'golden-loop-user',
      '2026-07-30T00:00:00.000Z',
    );

    const database = new NodeSqliteDb();
    databases.push(database);
    await runMigrations(database as never);
    const activeManifest = loadAppPackage(compile.package).activeManifest;

    const installationA = 'golden-household-scoped-a';
    const installationB = 'golden-household-scoped-b';
    await installApprovedAppPackage(database as never, {
      packageJson: compile.package,
      preview: installPreview,
      approval: installApproval,
      installationId: installationA,
      now: '2026-07-30T00:00:01.000Z',
    });
    await installApprovedAppPackage(database as never, {
      packageJson: compile.package,
      preview: installPreview,
      approval: installApproval,
      installationId: installationB,
      now: '2026-07-30T00:00:02.000Z',
    });

    await applyOperation(database as never, activeManifest, {
      op_id: 'golden-create-scoped-a',
      kind: 'create',
      domain: compile.package.id,
      collection: 'task',
      record_id: 'task-shared',
      record: {
        title: 'Prepare dinner',
        properties: { owner: 'Alex', status: 'todo', routine: 'weekday' },
        relations: [],
        source: {
          provider: 'sqlite',
          external_id: 'task-shared',
          url: null,
          observed_at: '2026-07-30T00:00:03.000Z',
          content_hash: null,
        },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'golden-create-scoped-a',
    }, { appInstallationId: installationA });

    await applyOperation(database as never, activeManifest, {
      op_id: 'golden-create-scoped-b',
      kind: 'create',
      domain: compile.package.id,
      collection: 'task',
      record_id: 'task-shared',
      record: {
        title: 'Reconcile budget',
        properties: { owner: 'Jordan', status: 'todo', routine: 'weekend' },
        relations: [],
        source: {
          provider: 'sqlite',
          external_id: 'task-shared',
          url: null,
          observed_at: '2026-07-30T00:00:04.000Z',
          content_hash: null,
        },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'golden-create-scoped-b',
    }, { appInstallationId: installationB });

    const escalatedPackage = structuredClone(compile.package);
    escalatedPackage.version = '1.1.0';
    escalatedPackage.collections.task.fields.priority = { type: 'text', indexed: true };
    const escalatedPreview = buildPackageInstallPreview(escalatedPackage, {
      sourceUrl: 'https://utoia.thetechcruise.com/p/shared-household-board-1.1.0.json',
      expectedChecksum: sha256Canonical(escalatedPackage),
    });
    const escalatedApproval = buildPackageInstallApprovalReceipt(
      escalatedPreview,
      'golden-loop-user',
      '2026-07-30T00:01:00.000Z',
    );
    await activateApprovedAppPackageUpdate(database as never, {
      packageJson: escalatedPackage,
      preview: escalatedPreview,
      approval: escalatedApproval,
      installationId: installationA,
      now: '2026-07-30T00:01:01.000Z',
    });

    expect((await getActiveAppPackage(database as never, installationA))?.version).toBe('1.1.0');
    expect((await getRecordForInstallation(database as never, installationB, 'task-shared'))?.properties?.owner).toBe('Jordan');

    const rolledBack = await rollbackAppPackage(database as never, installationA);
    expect(rolledBack?.version).toBe('1.0.0');
    expect((await getRecordForInstallation(database as never, installationA, 'task-shared'))?.title).toBe('Prepare dinner');
    expect((await getRecordForInstallation(database as never, installationA, 'task-shared'))?.properties.owner).toBe('Alex');
    expect((await getRecordForInstallation(database as never, installationB, 'task-shared'))?.title).toBe('Reconcile budget');
    expect((await getRecordForInstallation(database as never, installationB, 'task-shared'))?.properties.owner).toBe('Jordan');
  });
});
