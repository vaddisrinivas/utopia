import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
  hashPackageInstallApprovalReceipt,
  type PackageInstallApprovalReceipt,
} from '@/packages/shared/contracts/package-install';
import {
  activateAppPackage,
  getActiveAppPackage,
  getAppInstallation,
  installApprovedAppPackage,
  listAppInstallations,
} from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import {
  createPackageInstallFetcher,
  fetchPackageInstallCandidate,
  fetchRegistryManifest,
} from '@/src/domain/package-install';
import { loadAppPackage } from '@/src/domain/package-loader';
import { MemoryDb } from '@/tests/helpers/memory-db';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-install');
const validPackage = JSON.parse(readFileSync(path.join(fixtureDir, 'valid-package.json'), 'utf8'));
const registryFixture = JSON.parse(readFileSync(path.join(fixtureDir, 'registry.json'), 'utf8'));

describe('package install launcher flow', () => {
  const dbs: FileSqliteDb[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('keeps install-from-link review-gated before creating an installation', async () => {
    const db = new MemoryDb() as any;
    const fetcher = createPackageInstallFetcher(async (url) => {
      if (url !== 'https://example.com/apps/demo.package.json') return { ok: false, status: 404 };
      return jsonResponse(validPackage);
    });

    const candidate = await fetchPackageInstallCandidate('https://example.com/apps/demo.package.json', fetcher);
    expect(candidate.preview.status).toBe('ready_for_review');
    expect(candidate.preview.trust.status).toBe('checksum_missing');
    expect(candidate.preview.approvalRequired).toBe(true);
    expect(await getActiveAppPackage(db)).toBeNull();

    const approval = buildPackageInstallApprovalReceipt(candidate.preview, 'test-user', '2026-07-27T00:00:00.000Z');
    const installation = await installApprovedAppPackage(db, {
      packageJson: candidate.packageJson,
      preview: candidate.preview,
      approval,
      installationId: 'link-install-one',
      now: '2026-07-27T00:00:01.000Z',
    });

    expect(installation).toMatchObject({
      id: 'link-install-one',
      workspaceId: 'default-workspace',
      label: 'Demo Shelf',
      status: 'active',
    });
    expect(installation.activation?.launchPath).toBe('/apps/link-install-one');
    const reopened = reopen(db) as any;
    expect((await getAppInstallation(reopened, 'link-install-one'))?.label).toBe('Demo Shelf');
    expect((await getActiveAppPackage(reopened, 'link-install-one'))?.id).toBe('demo.shelf');
  });

  it('persists approved link install binding across restart and creates distinct installs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'utopia-link-install-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'utopia.db');
    const db = new FileSqliteDb(dbPath);
    dbs.push(db);
    await runMigrations(db as any);

    const preview = buildPackageInstallPreview(validPackage, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
    });
    const approval = buildPackageInstallApprovalReceipt(preview, 'test-user', '2026-07-27T00:00:00.000Z');
    const expectedApprovalHash = hashPackageInstallApprovalReceipt(approval);
    const first = await installApprovedAppPackage(db as any, {
      packageJson: validPackage,
      preview,
      approval,
      installationId: 'restart-link-one',
      now: '2026-07-27T00:00:01.000Z',
    });
    const second = await installApprovedAppPackage(db as any, {
      packageJson: validPackage,
      preview,
      approval,
      installationId: 'restart-link-two',
      now: '2026-07-27T00:00:02.000Z',
    });

    expect(first.id).toBe('restart-link-one');
    expect(second.id).toBe('restart-link-two');
    expect(first.id).not.toBe(second.id);
    db.close();
    dbs.splice(dbs.indexOf(db), 1);

    const reopened = new FileSqliteDb(dbPath);
    dbs.push(reopened);
    await runMigrations(reopened as any);

    const installs = await reopened.getAllAsync<{
      installation_id: string;
      package_id: string;
      version: string;
      source_url: string;
      checksum: string;
      launch_path: string;
      approval_hash: string;
      approved_by: string;
    }>(
      `SELECT installation_id, package_id, version, source_url, checksum, launch_path, approval_hash, approved_by
        FROM app_installations
        WHERE installation_id IN ('restart-link-one', 'restart-link-two')
        ORDER BY installation_id`,
    );
    expect(installs).toEqual([
      {
        installation_id: 'restart-link-one',
        package_id: approval.packageId,
        version: approval.version,
        source_url: approval.sourceUrl,
        checksum: approval.checksum,
        launch_path: '/apps/restart-link-one',
        approval_hash: expectedApprovalHash,
        approved_by: approval.approvedBy,
      },
      {
        installation_id: 'restart-link-two',
        package_id: approval.packageId,
        version: approval.version,
        source_url: approval.sourceUrl,
        checksum: approval.checksum,
        launch_path: '/apps/restart-link-two',
        approval_hash: expectedApprovalHash,
        approved_by: approval.approvedBy,
      },
    ]);
    expect(approval.compatibility).toEqual(preview.runtimeCompatibility);
    expect((await getActiveAppPackage(reopened as any, 'restart-link-one'))?.id).toBe(approval.packageId);
    expect((await getActiveAppPackage(reopened as any, 'restart-link-two'))?.id).toBe(approval.packageId);

    const receipts = await reopened.getAllAsync<{
      id: string;
      package_hash: string;
      approval_hash: string;
      approved_by: string;
    }>(
      `SELECT id, package_hash, approval_hash, approved_by
        FROM app_package_receipts
        WHERE id LIKE 'app-package:restart-link-%'
        ORDER BY id`,
    );
    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => ({
      package_hash: receipt.package_hash,
      approval_hash: receipt.approval_hash,
      approved_by: receipt.approved_by,
    }))).toEqual([
      {
        package_hash: approval.checksum,
        approval_hash: expectedApprovalHash,
        approved_by: approval.approvedBy,
      },
      {
        package_hash: approval.checksum,
        approval_hash: expectedApprovalHash,
        approved_by: approval.approvedBy,
      },
    ]);
  });

  it('loads registry choices and installs through app-installation activation', async () => {
    const db = new MemoryDb() as any;
    const registry = {
      ...registryFixture,
      packages: [
        {
          ...registryFixture.packages[0],
          checksum: buildPackageInstallPreview(validPackage, {
            sourceUrl: registryFixture.packages[0].url,
          }).trust.computedChecksum!,
        },
      ],
    };
    const fetcher = createPackageInstallFetcher(async (url) => {
      if (url === 'https://example.com/registry.json') return jsonResponse(registry);
      if (url === registry.packages[0].url) return jsonResponse(validPackage);
      return { ok: false, status: 404 };
    });
    const manifest = await fetchRegistryManifest('https://example.com/registry.json', fetcher);

    expect(manifest.packages.map((item) => item.url)).toEqual([registry.packages[0].url]);
    const candidate = await fetchPackageInstallCandidate(manifest.packages[0].url, fetcher, {
      registryPackage: manifest.packages[0],
    });

    expect(candidate.preview.trust.status).toBe('checksum_verified');
    const approval = buildPackageInstallApprovalReceipt(candidate.preview, 'test-user', '2026-07-27T00:00:00.000Z');
    const installation = await installApprovedAppPackage(db, {
      packageJson: candidate.packageJson,
      preview: candidate.preview,
      approval,
      installationId: 'registry-install-one',
      now: '2026-07-27T00:00:01.000Z',
    });

    const active = await getActiveAppPackage(reopen(db) as any, installation.id);
    expect(active?.id).toBe(manifest.packages[0].id);
    expect(loadAppPackage(active).activeManifest.label).toBe(manifest.packages[0].name);
  });

  it('blocks invalid preview before activation', async () => {
    const preview = buildPackageInstallPreview({ schemaVersion: 'wonder.app-package.v2' }, {
      sourceUrl: 'https://example.com/apps/bad.package.json',
    });
    const db = new MemoryDb() as any;

    expect(preview.status).toBe('blocked');
    await expect(activateAppPackage(db, { schemaVersion: 'wonder.app-package.v2' })).rejects.toThrow(/app_package_invalid/);
    await expect(installApprovedAppPackage(db, {
      packageJson: { schemaVersion: 'wonder.app-package.v2' },
      preview,
      approval: forgedApproval(),
      installationId: 'invalid-install',
    })).rejects.toThrow(/package_install_preview_blocked|app_package_invalid/);
    expect(await getActiveAppPackage(db)).toBeNull();
  });

  it('blocks checksum mismatch and creates a second installation for the same approved package', async () => {
    const db = new MemoryDb() as any;
    const mismatchPreview = buildPackageInstallPreview(validPackage, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
      expectedChecksum: `sha256:${'0'.repeat(64)}`,
    });
    await expect(installApprovedAppPackage(db, {
      packageJson: validPackage,
      preview: mismatchPreview,
      approval: forgedApproval(),
      installationId: 'checksum-mismatch',
    })).rejects.toThrow('package_install_preview_blocked');

    const readyPreview = buildPackageInstallPreview(validPackage, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
    });
    const approval = buildPackageInstallApprovalReceipt(readyPreview, 'test-user', '2026-07-27T00:00:00.000Z');
    const first = await installApprovedAppPackage(db, {
      packageJson: validPackage,
      preview: readyPreview,
      approval,
      installationId: 'same-app-one',
      now: '2026-07-27T00:00:01.000Z',
    });
    const second = await installApprovedAppPackage(db, {
      packageJson: validPackage,
      preview: readyPreview,
      approval,
      installationId: 'same-app-two',
      now: '2026-07-27T00:00:02.000Z',
    });

    expect(first.id).not.toBe(second.id);
    expect((await listAppInstallations(db)).map((item) => item.id)).toEqual(['same-app-one', 'same-app-two']);
    expect(first.activation?.launchPath).toBe('/apps/same-app-one');
    expect(second.activation?.launchPath).toBe('/apps/same-app-two');
    expect((await getActiveAppPackage(db, 'same-app-one'))?.id).toBe('demo.shelf');
    expect((await getActiveAppPackage(db, 'same-app-two'))?.id).toBe('demo.shelf');
  });

  it('fails bad URLs safely before fetch', async () => {
    let called = false;
    const fetcher = createPackageInstallFetcher(async () => {
      called = true;
      return jsonResponse(validPackage);
    });

    await expect(fetchPackageInstallCandidate('ftp://example.com/app.package.json', fetcher)).rejects.toThrow('install_url_must_be_https');
    expect(called).toBe(false);
  });
});

function jsonResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => value,
  };
}

function reopen(db: MemoryDb): MemoryDb {
  const next = new MemoryDb();
  next.workspaces = new Map(db.workspaces);
  next.appInstallations = new Map(db.appInstallations);
  next.appInstallationPackageState = new Map(db.appInstallationPackageState);
  next.appPackages = new Map(db.appPackages);
  next.appPackageState = db.appPackageState ? { ...db.appPackageState } : null;
  next.appPackageReceipts = db.appPackageReceipts.map((row) => ({ ...row }));
  return next;
}

function forgedApproval(): PackageInstallApprovalReceipt {
  return {
    schemaVersion: 'utopia.install-approval.v1',
    approved: true,
    sourceUrl: 'https://example.com/apps/demo.package.json',
    packageId: 'demo.shelf',
    version: '1.0.0',
    checksum: `sha256:${'0'.repeat(64)}`,
    compatibility: { status: 'compatible', reasons: [] },
    previewHash: `sha256:${'0'.repeat(64)}`,
    approvedBy: 'test-user',
    approvedAt: '2026-07-27T00:00:00.000Z',
  };
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
        // Ignore rollback failures after the original error.
      }
      throw error;
    }
  }

  async runAsync(sql: string, params: any[] | Record<string, unknown> = []) {
    const statement = this.db.prepare(sql);
    return Array.isArray(params) ? statement.run(...params) : statement.run(params as Record<string, any>);
  }

  async getFirstAsync<T>(sql: string, params: any[] | Record<string, unknown> = []): Promise<T | null> {
    const statement = this.db.prepare(sql);
    const row = Array.isArray(params) ? statement.get(...params) : statement.get(params as Record<string, any>);
    return (row ?? null) as T | null;
  }

  async getAllAsync<T>(sql: string, params: any[] | Record<string, unknown> = []): Promise<T[]> {
    const statement = this.db.prepare(sql);
    return (Array.isArray(params) ? statement.all(...params) : statement.all(params as Record<string, any>)) as T[];
  }

  close() {
    this.db.close();
  }
}
