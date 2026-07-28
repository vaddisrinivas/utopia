import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertPackageInstallApprovalMatchesPreview,
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
  parsePackageInstallTarget,
  validateRegistryManifest,
} from '@/packages/shared/contracts/package-install';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import {
  BUNDLED_DEMO_PACKAGE_URL,
  BUNDLED_UTOPIA_REGISTRY_URL,
  createPackageInstallFetcher,
  fetchPackageInstallCandidate,
  fetchRegistryManifest,
  getBundledRegistryManifest,
  packageInstallPreviewRows,
  packageInstallTrustLabel,
  type PackageInstallFetcher,
} from '@/src/domain/package-install';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-install');
const packageFixture = JSON.parse(readFileSync(path.join(fixtureDir, 'valid-package.json'), 'utf8'));
const registryFixture = JSON.parse(readFileSync(path.join(fixtureDir, 'registry.json'), 'utf8'));

describe('package install link and registry contracts', () => {
  it('parses deep links, universal links, and direct HTTPS package URLs', () => {
    expect(parsePackageInstallTarget('wonder://install?url=https%3A%2F%2Fexample.com%2Fapps%2Fdemo.package.json')).toEqual({
      source: 'deep_link',
      packageUrl: 'https://example.com/apps/demo.package.json',
    });
    expect(parsePackageInstallTarget('https://wonder.app/install?url=https%3A%2F%2Fexample.com%2Fapps%2Fdemo.package.json')).toEqual({
      source: 'universal_link',
      packageUrl: 'https://example.com/apps/demo.package.json',
    });
    expect(parsePackageInstallTarget('https://example.com/apps/demo.package.json#ignored')).toEqual({
      source: 'package_url',
      packageUrl: 'https://example.com/apps/demo.package.json',
    });
  });

  it('fails bad install URLs before fetch', async () => {
    let called = false;
    const fetcher: PackageInstallFetcher = async () => {
      called = true;
      throw new Error('should not fetch');
    };

    await expect(fetchPackageInstallCandidate('http://example.com/app.package.json', fetcher)).rejects.toThrow('install_url_must_be_https');
    expect(called).toBe(false);
  });

  it('validates registry manifest and fetches registry JSON through an injected fetcher', async () => {
    const manifest = {
      ...registryFixture,
      packages: [
        {
          ...registryFixture.packages[0],
          checksum: sha256Canonical(packageFixture),
        },
        registryFixture.packages[1],
      ],
    };
    const fetcher = jsonFetcher({
      'https://example.com/registry.json': manifest,
    });

    await expect(fetchRegistryManifest('https://example.com/registry.json', fetcher)).resolves.toEqual(validateRegistryManifest(manifest));
    expect(() => validateRegistryManifest({ ...manifest, packages: [{ ...manifest.packages[0], url: 'http://bad.test/app.json' }] })).toThrow(
      /must be HTTPS/,
    );
  });

  it('serves bundled registry and demo package without remote fetch', async () => {
    const fetcher = createPackageInstallFetcher(async () => {
      throw new Error('remote_fetch_forbidden');
    });
    const manifest = await fetchRegistryManifest(BUNDLED_UTOPIA_REGISTRY_URL, fetcher);
    const bundled = getBundledRegistryManifest();

    expect(manifest).toEqual(bundled);
    expect(manifest.packages).toHaveLength(1);

    const candidate = await fetchPackageInstallCandidate(BUNDLED_DEMO_PACKAGE_URL, fetcher, {
      registryPackage: manifest.packages[0],
    });
    expect(candidate.preview.status).toBe('ready_for_review');
    expect(candidate.preview.trust.status).toBe('checksum_verified');
    expect(candidate.preview.approvalRequired).toBe(true);
  });

  it('builds review-only preview with checksum trust metadata', async () => {
    const checksum = sha256Canonical(packageFixture);
    const fetcher = jsonFetcher({
      'https://example.com/apps/demo.package.json': packageFixture,
    });

    const result = await fetchPackageInstallCandidate(
      'wonder://install?url=https%3A%2F%2Fexample.com%2Fapps%2Fdemo.package.json',
      fetcher,
      {
        registryPackage: { ...registryFixture.packages[0], checksum },
      },
    );

    expect(result.preview).toMatchObject({
      schemaVersion: 'utopia.install-preview.v1',
      status: 'ready_for_review',
      approvalRequired: true,
      appName: 'Demo Shelf',
      description: 'Portable demo app.',
      packageId: 'demo.shelf',
      version: '1.0.0',
      sourceUrl: 'https://example.com/apps/demo.package.json',
      runtimeCompatibility: { status: 'compatible', reasons: [] },
      trust: { status: 'checksum_verified', checksum, computedChecksum: checksum },
    });
    expect(result.preview.screensIncluded).toEqual(['home', 'review']);
    expect(result.preview.dataCollections).toEqual(['task']);
    expect(result.preview.providersRequested).toEqual(['provider:notion']);
    expect(result.preview.widgetsRequired).toEqual(['metricTile']);
    expect(packageInstallTrustLabel(result.preview)).toBe('Checksum verified');
    expect(packageInstallPreviewRows(result.preview)).toEqual([
      { label: 'Screens', values: ['home', 'review'] },
      { label: 'Collections', values: ['task'] },
      { label: 'Providers', values: ['provider:notion'] },
      { label: 'Native permissions', values: [] },
      { label: 'Widgets', values: ['metricTile'] },
      { label: 'Plugins', values: ['plugin:metricTile'] },
      { label: 'Fallbacks', values: [] },
    ]);

    const approval = buildPackageInstallApprovalReceipt(result.preview, 'test-user', '2026-07-27T00:00:00.000Z');
    expect(approval).toMatchObject({
      schemaVersion: 'utopia.install-approval.v1',
      approved: true,
      sourceUrl: 'https://example.com/apps/demo.package.json',
      packageId: 'demo.shelf',
      version: '1.0.0',
      checksum,
      approvedBy: 'test-user',
      approvedAt: '2026-07-27T00:00:00.000Z',
    });
    expect(() => assertPackageInstallApprovalMatchesPreview(approval, result.preview)).not.toThrow();
    expect(() => assertPackageInstallApprovalMatchesPreview({ ...approval, version: '2.0.0' }, result.preview)).toThrow(
      'package_install_approval_mismatch',
    );
  });

  it('rejects registry descriptors whose bound identity does not match the fetched package', async () => {
    const fetcher = jsonFetcher({
      'https://example.com/apps/demo.package.json': packageFixture,
    });

    await expect(fetchPackageInstallCandidate(
      'https://example.com/apps/demo.package.json',
      fetcher,
      {
        registryPackage: { ...registryFixture.packages[0], id: 'wrong.app', version: '9.9.9' },
      },
    )).rejects.toThrow('package_descriptor_identity_mismatch:wrong.app@9.9.9');
  });

  it('blocks invalid package and checksum mismatch without activating anything', () => {
    const invalid = { schemaVersion: 'wonder.app-package.v2' };
    const preview = buildPackageInstallPreview(invalid, {
      sourceUrl: 'https://example.com/apps/bad.package.json',
      expectedChecksum: `sha256:${'0'.repeat(64)}`,
    });

    expect(preview.status).toBe('blocked');
    expect(preview.approvalRequired).toBe(true);
    expect(preview.packageId).toBeNull();
    expect(preview.trust.status).toBe('checksum_mismatch');
    expect(preview.validationErrors).toContain('id is required');
    expect(preview.validationErrors).toContain('checksum mismatch');
    expect(() => buildPackageInstallApprovalReceipt(preview, 'test-user')).toThrow('package_install_preview_blocked');
  });
});

function jsonFetcher(routes: Record<string, unknown>): PackageInstallFetcher {
  return async (url) => {
    if (!Object.hasOwn(routes, url)) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      json: async () => routes[url],
    };
  };
}
