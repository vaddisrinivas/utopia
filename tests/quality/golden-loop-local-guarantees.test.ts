import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileAppPackageSource } from '@/packages/app-compiler';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import {
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
} from '@/packages/shared/contracts/package-install';
import {
  activateApprovedAppPackageUpdate,
  getActiveAppPackage,
  installApprovedAppPackage,
  rollbackAppPackage,
} from '@/src/db/app-package-registry';
import { exportRecoverySnapshot, runMigrations } from '@/src/db/migrations';
import { importRecoverySnapshot } from '@/src/db/recovery';
import {
  loadCapabilityDecisionPort,
  upsertCapabilityConsentLedgerRecord,
} from '@/src/db/capability-consent-ledger';
import { getRecordForInstallation } from '@/src/db/records';
import { createPackageInstallFetcher, fetchPackageInstallCandidate } from '@/src/domain/package-install';
import { loadAppPackage } from '@/src/domain/package-loader';
import { requestWidgetCapability } from '@/src/presentation/widgets/package-capability-broker';
import { applyOperation } from '@/src/ops/apply';
import { normalizeModelSource } from '@/scripts/factory/generate-app-from-prompt';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const sourceFixture = JSON.parse(readFileSync(path.join(fixtureDir, 'golden-loop/shared-household-board.source.json'), 'utf8'));
const validV3Fixture = JSON.parse(readFileSync(path.join(fixtureDir, 'package-validation/valid-v3.json'), 'utf8'));
const fixturePrompt = [
  'Build a shared household board with tasks, routines, members, and expenses.',
  'It must work offline, preserve data through updates, and use only generic Utopia widgets.',
].join(' ');

describe('golden loop local guarantees', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('keeps installed data usable when package source fetch is unavailable', async () => {
    const source = normalizeModelSource(sourceFixture, fixturePrompt);
    const compile = compileAppPackageSource(source);
    if (!compile.valid) throw new Error('golden_package_compile_failed');
    const packageUrl = 'https://utoia.thetechcruise.com/p/shared-household-board.json';
    const installPreview = buildPackageInstallPreview(
      compile.package,
      { sourceUrl: packageUrl, expectedChecksum: sha256Canonical(compile.package) },
    );
    const installApproval = buildPackageInstallApprovalReceipt(
      installPreview,
      'golden-loop-user',
      '2026-07-30T00:00:00.000Z',
    );

    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);

    const installationId = 'golden-loop-offline-source';
    const baselineRuntime = loadAppPackage(compile.package);
    await installApprovedAppPackage(db as any, {
      packageJson: compile.package,
      preview: installPreview,
      approval: installApproval,
      installationId,
      now: '2026-07-30T00:00:01.000Z',
    });

    await applyOperation(db as any, baselineRuntime.activeManifest, {
      op_id: 'golden-offline-create',
      kind: 'create',
      domain: compile.package.id,
      collection: 'task',
      record_id: 'task-offline',
      record: {
        title: 'Plan grocery list',
        properties: { owner: 'Alex', status: 'todo', routine: 'weekday' },
        relations: [],
        source: {
          provider: 'sqlite',
          external_id: 'task-offline',
          url: null,
          observed_at: '2026-07-30T00:00:02.000Z',
          content_hash: null,
        },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'golden-offline-create',
    }, { appInstallationId: installationId });

    const offlineFetcher = createPackageInstallFetcher(async () => {
      throw new Error('package_source_outage');
    });
    await expect(fetchPackageInstallCandidate(packageUrl, offlineFetcher)).rejects.toThrow('package_fetch_failed');

    const activeAfterOutage = await getActiveAppPackage(db as any, installationId);
    expect(activeAfterOutage?.id).toBe('shared-household-board');
    if (!activeAfterOutage) throw new Error('installed_package_missing_after_source_outage');

    const activeRuntime = loadAppPackage(activeAfterOutage);
    const reopened = await applyOperation(db as any, activeRuntime.activeManifest, {
      op_id: 'golden-offline-update',
      kind: 'update',
      domain: compile.package.id,
      collection: 'task',
      record_id: 'task-offline',
      expected_revision: 1,
      changes: { routine: 'daily' },
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'golden-offline-update',
    }, { appInstallationId: installationId });

    expect(reopened.status).toBe('applied');
    expect(await getRecordForInstallation(db as any, installationId, 'task-offline')).toMatchObject({
      id: 'task-offline',
      properties: { routine: 'daily' },
    });
  });

  it('preserves install-scoped records across backup restore, update, and rollback', async () => {
    const source = normalizeModelSource(sourceFixture, fixturePrompt);
    const compile = compileAppPackageSource(source);
    if (!compile.valid) throw new Error('golden_package_compile_failed');
    const packageUrl = 'https://utoia.thetechcruise.com/p/shared-household-board.json';
    const preview = buildPackageInstallPreview(compile.package, { sourceUrl: packageUrl, expectedChecksum: sha256Canonical(compile.package) });
    const approval = buildPackageInstallApprovalReceipt(preview, 'golden-loop-user', '2026-07-30T00:00:00.000Z');

    const installationId = 'golden-loop-local-backup';
    const backupDb = new NodeSqliteDb();
    dbs.push(backupDb);
    await runMigrations(backupDb as any);
    await installApprovedAppPackage(backupDb as any, {
      packageJson: compile.package,
      preview,
      approval,
      installationId,
      now: '2026-07-30T00:00:01.000Z',
    });

    const baselineRuntime = loadAppPackage(compile.package);
    await applyOperation(backupDb as any, baselineRuntime.activeManifest, {
      op_id: 'golden-backup-create',
      kind: 'create',
      domain: compile.package.id,
      collection: 'task',
      record_id: 'task-backup',
      record: {
        title: 'Review budget',
        properties: { owner: 'Jordan', status: 'todo', routine: 'daily' },
        relations: [],
        source: {
          provider: 'sqlite',
          external_id: 'task-backup',
          url: null,
          observed_at: '2026-07-30T00:00:02.000Z',
          content_hash: null,
        },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'golden-backup-create',
    }, { appInstallationId: installationId });

    const snapshot = await exportRecoverySnapshot(backupDb as any);
    const restoredDb = new NodeSqliteDb();
    dbs.push(restoredDb);
    await runMigrations(restoredDb as any);
    await importRecoverySnapshot(restoredDb as any, snapshot);

    expect(await getRecordForInstallation(restoredDb as any, installationId, 'task-backup')).toMatchObject({
      id: 'task-backup',
      title: 'Review budget',
    });

    const upgraded = structuredClone(compile.package);
    upgraded.version = '1.1.0';
    upgraded.collections.task.fields.priority = { type: 'text', indexed: true };
    const upgradedPreview = buildPackageInstallPreview(upgraded, {
      sourceUrl: 'https://utoia.thetechcruise.com/p/shared-household-board-1.1.0.json',
      expectedChecksum: sha256Canonical(upgraded),
    });
    const upgradedApproval = buildPackageInstallApprovalReceipt(
      upgradedPreview,
      'golden-loop-user',
      '2026-07-30T00:01:00.000Z',
    );

    await activateApprovedAppPackageUpdate(restoredDb as any, {
      packageJson: upgraded,
      preview: upgradedPreview,
      approval: upgradedApproval,
      installationId,
      now: '2026-07-30T00:01:01.000Z',
    });
    expect((await getActiveAppPackage(restoredDb as any, installationId))?.version).toBe('1.1.0');

    const rollback = await rollbackAppPackage(restoredDb as any, installationId);
    expect(rollback?.version).toBe('1.0.0');
    expect((await getActiveAppPackage(restoredDb as any, installationId))?.version).toBe('1.0.0');
    expect(await getRecordForInstallation(restoredDb as any, installationId, 'task-backup')).toMatchObject({
      properties: { routine: 'daily' },
    });
  });

  it('denies, grants, exercises, and revokes a native capability through package updates', async () => {
    const installationId = 'golden-loop-native-capability';
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);

    const deniedPackage = makeV3CapabilityPackage([], [], '1.0.0');
    const deniedPreview = buildPackageInstallPreview(deniedPackage, {
      sourceUrl: 'https://example.com/apps/golden-capability.package.json',
      expectedChecksum: sha256Canonical(deniedPackage),
    });
    const deniedApproval = buildPackageInstallApprovalReceipt(
      deniedPreview,
      'golden-loop-user',
      '2026-07-30T00:00:00.000Z',
    );
    await installApprovedAppPackage(db as any, {
      packageJson: deniedPackage,
      preview: deniedPreview,
      approval: deniedApproval,
      installationId,
      now: '2026-07-30T00:00:01.000Z',
    });

    const deniedRuntime = {
      installationId,
      activePackage: loadAppPackage(await getActiveAppPackage(db as any, installationId) as never).activePackage,
    };
    expect(
      requestWidgetCapability(deniedRuntime, {
        kind: 'audio-recorder',
        action: 'record',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'package_capability_consent_required', kind: 'audio-recorder' },
    });

    const grantedPackage = makeV3CapabilityPackage(['expo-audio'], ['expo-audio'], '1.1.0');
    const grantedPreview = buildPackageInstallPreview(grantedPackage, {
      sourceUrl: 'https://example.com/apps/golden-capability-1.1.0.package.json',
      expectedChecksum: sha256Canonical(grantedPackage),
    });
    const grantedApproval = buildPackageInstallApprovalReceipt(
      grantedPreview,
      'golden-loop-user',
      '2026-07-30T00:01:00.000Z',
    );
    await activateApprovedAppPackageUpdate(db as any, {
      packageJson: grantedPackage,
      preview: grantedPreview,
      approval: grantedApproval,
      installationId,
      now: '2026-07-30T00:01:01.000Z',
    });

    const grantRuntime = {
      installationId,
      activePackage: loadAppPackage(await getActiveAppPackage(db as any, installationId) as never).activePackage,
    };
    const grantedPackageChecksum = sha256Canonical(grantRuntime.activePackage);
    await upsertCapabilityConsentLedgerRecord(db as any, {
      schemaVersion: 'utopia.capability-consent-ledger.v1',
      installationId,
      packageId: grantRuntime.activePackage.id,
      packageVersion: grantRuntime.activePackage.version,
      packageChecksum: grantedPackageChecksum,
      capability: 'native.audio-recorder',
      scope: ['record'],
      decision: 'allow',
      decidedBy: 'golden-loop-test',
      decidedAt: '2026-07-30T00:01:02.000Z',
      createdAt: '2026-07-30T00:01:02.000Z',
      updatedAt: '2026-07-30T00:01:02.000Z',
    });
    const grantRuntimeWithConsent = {
      ...grantRuntime,
      capabilityDecisionPort: await loadCapabilityDecisionPort(db as any, installationId),
    };
    expect(
      requestWidgetCapability(grantRuntimeWithConsent, {
        kind: 'audio-recorder',
        action: 'record',
      }),
    ).toEqual({
      ok: true,
      installationId,
      packageId: 'reference-app',
      kind: 'audio-recorder',
      action: 'record',
      grantedPackages: ['expo-audio'],
      grantedPermissions: ['expo-audio'],
    });

    const revokedPackage = makeV3CapabilityPackage([], [], '1.2.0');
    const revokedPreview = buildPackageInstallPreview(revokedPackage, {
      sourceUrl: 'https://example.com/apps/golden-capability-1.2.0.package.json',
      expectedChecksum: sha256Canonical(revokedPackage),
    });
    const revokedApproval = buildPackageInstallApprovalReceipt(
      revokedPreview,
      'golden-loop-user',
      '2026-07-30T00:02:00.000Z',
    );
    await activateApprovedAppPackageUpdate(db as any, {
      packageJson: revokedPackage,
      preview: revokedPreview,
      approval: revokedApproval,
      installationId,
      now: '2026-07-30T00:02:01.000Z',
    });

    const revokedRuntime = {
      installationId,
      activePackage: loadAppPackage(await getActiveAppPackage(db as any, installationId) as never).activePackage,
    };
    expect(
      requestWidgetCapability(revokedRuntime, {
        kind: 'audio-recorder',
        action: 'record',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'package_capability_consent_required', kind: 'audio-recorder' },
    });
  });
});

function makeV3CapabilityPackage(
  packages: string[],
  permissions: string[],
  version: string,
) {
  const cloned = structuredClone(validV3Fixture);
  cloned.version = version;
  cloned.nativeCapabilities = {
    ...(cloned.nativeCapabilities as Record<string, unknown>),
    packages,
    permissions,
  };
  cloned.contractLock = {
    ...cloned.contractLock,
    nativeCapabilities: cloned.nativeCapabilities,
  };
  cloned.contractLock.checksum = sha256Canonical({
    schemaVersion: cloned.contractLock.schemaVersion,
    algorithm: cloned.contractLock.algorithm,
    pinnedAt: cloned.contractLock.pinnedAt,
    dependencyPins: cloned.contractLock.dependencyPins,
    nativeCapabilities: cloned.contractLock.nativeCapabilities,
  });

  return cloned;
}
