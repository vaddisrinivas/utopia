import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WORKSPACE_ID } from '@/packages/shared/contracts/app-installation';
import { buildPackageInstallApprovalReceipt, buildPackageInstallPreview } from '@/packages/shared/contracts/package-install';
import { getAppInstallation, installApprovedAppPackage } from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import { createInstallationRepository } from '@/src/db/records';
import type { DomainManifest } from '@/src/domain/catalog';
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
  } as DomainManifest,
}));

vi.mock('@/src/domain/catalog', () => ({
  loadCatalog: () => ({
    activeDomainId: manifest.id,
    activeManifest: manifest,
    catalog: { domains: [] },
  }),
  getDomainManifest: () => manifest,
  setActivePackageOverride: () => {},
}));

function record(id: string, title: string) {
  const now = '2026-07-27T00:00:00.000Z';
  return {
    id,
    title,
    collection: 'inventory',
    properties: { body: title },
    relations: [],
    source: {
      provider: 'sqlite' as const,
      external_id: id,
      url: null,
      observed_at: '2026-07-27T00:00:00.000Z',
      content_hash: null,
    },
    archived_at: null,
    created_at: now,
    updated_at: now,
  };
}

describe('app installation data isolation', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('isolates records, operations, idempotency, forged scope, and undo by installation', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);

    const appA = createInstallationRepository({ db: db as any, workspaceId: DEFAULT_WORKSPACE_ID, installationId: 'app-a' });
    const appB = createInstallationRepository({ db: db as any, workspaceId: DEFAULT_WORKSPACE_ID, installationId: 'app-b' });

    await appA.upsertRecord(manifest, { ...record('shared-record', 'A original'), idempotency_key: 'same-key' });
    await appB.upsertRecord(manifest, { ...record('shared-record', 'B original'), idempotency_key: 'same-key' });

    const sharedRows = await db.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) AS total FROM records WHERE id = ?`,
      ['shared-record'],
    );
    expect(sharedRows?.total).toBe(2);
    expect((await appA.getRecord('shared-record'))?.title).toBe('A original');
    expect((await appB.getRecord('shared-record'))?.title).toBe('B original');

    await appA.upsertRecord(manifest, {
      ...record('shared-record', 'A updated'),
      revision: 2,
      idempotency_key: 'update-a',
    });
    await appA.archiveRecord('shared-record');
    expect((await appA.getRecord('shared-record'))?.archived_at).toBeTruthy();
    expect((await appB.getRecord('shared-record'))?.archived_at).toBeNull();

    await appA.restoreRecord('shared-record');
    expect((await appA.getRecord('shared-record'))?.archived_at).toBeNull();
    expect((await appB.getRecord('shared-record'))?.title).toBe('B original');

    const forged = await appA.applyOperation(manifest, {
      op_id: 'forged-app-installation',
      app_installation_id: 'app-b',
      kind: 'update',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'shared-record',
      expected_revision: 1,
      changes: { body: 'forged' },
      actor: 'user',
      origin: 'manual',
    });
    expect(forged.status).toBe('rejected');
    expect(forged.reject_reason).toBe('installation_scope_mismatch');
    expect((await appB.getRecord('shared-record'))?.properties.body).toBe('B original');

    const bCreateOp = await db.getFirstAsync<{ op_id: string }>(
      `SELECT op_id FROM operations WHERE app_installation_id = ? AND record_id = ? AND kind = 'create'`,
      ['app-b', 'shared-record'],
    );
    expect(bCreateOp?.op_id).toBeTruthy();
    const crossUndo = await appA.undoOperation(manifest, bCreateOp!.op_id);
    expect(crossUndo.status).toBe('rejected');
    expect(crossUndo.reject_reason).toBe('operation_not_found');
  });

  it('returns persisted package binding, approval, and activation state for installed apps', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);

    const packageJson = {
      schemaVersion: 'wonder.app-package.v2',
      id: 'portable.demo',
      version: '1.2.3',
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
        label: 'Portable Demo',
        homeSurface: 'home',
        surfaces: [{ id: 'home', label: 'Home', collections: ['pantry'], views: [] }],
      },
      rules: [],
      capabilities: [],
      acceptanceTests: [],
    };
    const preview = buildPackageInstallPreview(packageJson, {
      sourceUrl: 'https://example.com/apps/portable-demo.package.json',
    });
    const approval = buildPackageInstallApprovalReceipt(preview, 'tester@example.test', '2026-07-28T00:00:00.000Z');

    await installApprovedAppPackage(db as any, {
      packageJson,
      preview,
      approval,
      installationId: 'portable-demo-install',
      workspaceId: 'workspace-portable',
      now: '2026-07-28T00:00:01.000Z',
    });

    await expect(getAppInstallation(db as any, 'portable-demo-install')).resolves.toMatchObject({
      id: 'portable-demo-install',
      workspaceId: 'workspace-portable',
      label: 'Portable Demo',
      packageBinding: {
        packageKey: 'portable.demo@1.2.3',
        packageId: 'portable.demo',
        version: '1.2.3',
        sourceUrl: 'https://example.com/apps/portable-demo.package.json',
      },
      approval: {
        approvedBy: 'tester@example.test',
      },
      activation: {
        launchPath: '/apps/portable-demo-install',
        activePackageKey: 'portable.demo@1.2.3',
        previousPackageKey: null,
        updatedAt: '2026-07-28T00:00:01.000Z',
      },
    });
  });
});
