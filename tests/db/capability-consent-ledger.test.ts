import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WORKSPACE_ID } from '@/packages/shared/contracts/app-installation';
import {
  UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION,
  buildCapabilityConsentRecordId,
} from '@/packages/shared/contracts/capability-consent-ledger';
import {
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
} from '@/packages/shared/contracts/package-install';
import {
  DATABASE_VERSION,
  getDatabaseVersion,
  rollbackDatabase,
  runMigrations,
} from '@/src/db/migrations';
import {
  getCapabilityConsentLedgerRecord,
  listCapabilityConsentLedgerRecordsForInstallation,
  revokeCapabilityConsentLedgerRecord,
  upsertCapabilityConsentLedgerRecord,
} from '@/src/db/capability-consent-ledger';
import { activateApprovedAppPackageUpdate, installApprovedAppPackage } from '@/src/db/app-package-registry';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const { manifest } = vi.hoisted(() => ({
  manifest: {
    schema_version: 'utopia.domain.v1',
    id: 'food',
    label: 'Food',
    surfaces: [],
    collections: ['inventory'],
    relations: [],
    skills: [],
    workflows: [],
    data_homes: [],
    mcp: { resources: [], tools: [] },
  } as const,
}));

vi.mock('@/src/domain/catalog', () => ({
  loadCatalog: () => ({
    activeDomainId: manifest.id,
    activeManifest: manifest,
    catalog: { domains: [] },
  }),
  getDomainManifest: () => manifest,
  setActivePackageOverride: () => undefined,
}));

function packageJson(overrides: Partial<{ id: string; version: string }> = {}) {
  return {
    schemaVersion: 'wonder.app-package.v2',
    id: overrides.id ?? 'consent.demo',
    version: overrides.version ?? '1.0.0',
    collections: {
      pantry: {
        id: 'pantry',
        fields: {
          id: { type: 'text', required: true, indexed: true },
          title: { type: 'text', required: true, indexed: true },
          updated_at: { type: 'timestamp', required: true, indexed: true },
        },
      },
    },
    queries: {},
    views: {},
    presentation: {
      label: 'Consent Demo',
      homeSurface: 'home',
      surfaces: [{ id: 'home', label: 'Home', collections: ['pantry'], views: [] }],
    },
    rules: [],
    capabilities: [],
    acceptanceTests: [],
  };
}

describe('capability consent ledger persistence', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('persists, retrieves, isolates by installation, and revokes records with active package checksum/version context', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);

    const installA = packageJson({ id: 'consent.demo', version: '1.0.0' });
    const installB = packageJson({ id: 'consent.demo', version: '2.0.0' });

    const previewA = buildPackageInstallPreview(installA, { sourceUrl: 'https://example.com/consent-a.package.json' });
    if (!previewA.trust.computedChecksum) throw new Error('expected package checksum');
    const approvalA = buildPackageInstallApprovalReceipt(previewA, 'alice@example.test', '2026-07-30T00:00:00.000Z');
    await installApprovedAppPackage(db as any, {
      packageJson: installA,
      preview: previewA,
      approval: approvalA,
      installationId: 'install-a',
      workspaceId: DEFAULT_WORKSPACE_ID,
      now: '2026-07-30T00:00:01.000Z',
    });

    const previewB = buildPackageInstallPreview(installB, { sourceUrl: 'https://example.com/consent-b.package.json' });
    const approvalB = buildPackageInstallApprovalReceipt(previewB, 'bob@example.test', '2026-07-30T00:00:02.000Z');
    await installApprovedAppPackage(db as any, {
      packageJson: installB,
      preview: previewB,
      approval: approvalB,
      installationId: 'install-b',
      workspaceId: DEFAULT_WORKSPACE_ID,
      now: '2026-07-30T00:00:03.000Z',
    });

    const baseRecordA = {
      schemaVersion: UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION,
      installationId: 'install-a',
      packageId: installA.id,
      packageVersion: installA.version,
      packageChecksum: previewA.trust.computedChecksum,
      capability: 'native.camera',
      scope: ['photos', 'notes'],
      decision: 'allow',
      decidedBy: 'alice',
      decidedAt: '2026-07-30T00:00:04.000Z',
      createdAt: '2026-07-30T00:00:04.000Z',
      updatedAt: '2026-07-30T00:00:04.000Z',
    } as const;

    const recordA = await upsertCapabilityConsentLedgerRecord(db as any, baseRecordA);
    const recordAId = buildCapabilityConsentRecordId(baseRecordA);

    expect(recordA.packageId).toBe('consent.demo');
    expect((await getCapabilityConsentLedgerRecord(db as any, 'install-a', recordAId))?.revocation).toBeUndefined();
    expect((await getCapabilityConsentLedgerRecord(db as any, 'install-b', recordAId))).toBeNull();
    expect(await listCapabilityConsentLedgerRecordsForInstallation(db as any, 'install-a')).toHaveLength(1);
    expect(await listCapabilityConsentLedgerRecordsForInstallation(db as any, 'install-b')).toHaveLength(0);

    const revoked = await revokeCapabilityConsentLedgerRecord(db as any, {
      installationId: 'install-a',
      recordId: recordAId,
      revokedBy: 'admin',
      revokedAt: '2026-07-30T00:00:05.000Z',
      revocationReason: 'user reset',
    });
    expect(revoked.revocation?.revokedBy).toBe('admin');
    expect(revoked.revocation?.revocationReason).toBe('user reset');

    const wrongPackageVersion = {
      ...baseRecordA,
      packageVersion: '9.9.9',
      decidedAt: '2026-07-30T00:00:06.000Z',
      updatedAt: '2026-07-30T00:00:06.000Z',
    } as const;
    await expect(
      upsertCapabilityConsentLedgerRecord(db as any, wrongPackageVersion),
    ).rejects.toThrow('capability_consent_package_context_mismatch');

    const packageUpgrade = packageJson({ id: 'consent.demo', version: '1.0.1' });
    const upgradePreview = buildPackageInstallPreview(
      packageUpgrade,
      { sourceUrl: 'https://example.com/consent-a-upgrade.package.json' },
    );
    const upgradeApproval = buildPackageInstallApprovalReceipt(
      upgradePreview,
      'alice@example.test',
      '2026-07-30T00:00:07.000Z',
    );
    await activateApprovedAppPackageUpdate(db as any, {
      packageJson: packageUpgrade,
      preview: upgradePreview,
      approval: upgradeApproval,
      installationId: 'install-a',
      workspaceId: DEFAULT_WORKSPACE_ID,
      now: '2026-07-30T00:00:08.000Z',
    });
    expect(await listCapabilityConsentLedgerRecordsForInstallation(db as any, 'install-a')).toHaveLength(0);
    expect(await getCapabilityConsentLedgerRecord(db as any, 'install-a', recordAId)).toBeNull();
  });

  it('supports migration forward and backward safely through ledger version', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);

    await runMigrations(db as any);
    await rollbackDatabase(db as any, DATABASE_VERSION - 1);

    const rolledBackTable = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE name = 'capability_consent_ledger'",
    );
    expect(rolledBackTable).toBeNull();

    await runMigrations(db as any);
    await runMigrations(db as any);

    const version = await getDatabaseVersion(db as any);
    expect(version).toBe(DATABASE_VERSION);
    const recreatedTable = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE name = 'capability_consent_ledger'",
    );
    expect(recreatedTable?.name).toBe('capability_consent_ledger');

    const install = packageJson();
    const preview = buildPackageInstallPreview(install, { sourceUrl: 'https://example.com/consent-migrated.package.json' });
    if (!preview.trust.computedChecksum) throw new Error('expected package checksum');
    const approval = buildPackageInstallApprovalReceipt(preview, 'charlie@example.test', '2026-07-30T00:00:07.000Z');
    await installApprovedAppPackage(db as any, {
      packageJson: install,
      preview,
      approval,
      installationId: 'migrated-install',
      workspaceId: DEFAULT_WORKSPACE_ID,
      now: '2026-07-30T00:00:08.000Z',
    });

    const record = await upsertCapabilityConsentLedgerRecord(db as any, {
      schemaVersion: UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION,
      installationId: 'migrated-install',
      packageId: install.id,
      packageVersion: install.version,
      packageChecksum: preview.trust.computedChecksum,
      capability: 'native.files',
      scope: ['home'],
      decision: 'allow',
      decidedBy: 'charlie',
      decidedAt: '2026-07-30T00:00:09.000Z',
      createdAt: '2026-07-30T00:00:09.000Z',
      updatedAt: '2026-07-30T00:00:09.000Z',
    } as const);

    expect(record.capability).toBe('native.files');
    expect(await listCapabilityConsentLedgerRecordsForInstallation(db as any, 'migrated-install')).toHaveLength(1);
  });
});
