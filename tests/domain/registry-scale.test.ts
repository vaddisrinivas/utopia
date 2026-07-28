import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildGitHubPagesIndexUrl,
  buildGitHubRegistryDistribution,
  buildGitHubReleaseAssetUrl,
  buildGitHubRawPackageUrl,
  buildRegistryIndex,
  buildRegistryIndexDescriptor,
  buildRegistryInstallDescriptor,
  buildRegistryManifest,
  checkRegistryInstallCompatibility,
  validateGitHubRegistryDistribution,
  validateRegistryIndex,
} from '@/src/domain/package-sharing';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-install');
const basePackage = JSON.parse(readFileSync(path.join(fixtureDir, 'valid-package.json'), 'utf8'));

describe('Phase 7 registry scale', () => {
  it('keeps a GitHub raw JSON registry installable at scale', () => {
    const packagesByUrl = new Map<string, unknown>();
    const descriptors = Array.from({ length: 32 }, (_, index) => {
      const packageJson = clonePackage(index);
      const url = buildGitHubRawPackageUrl({
        owner: 'utopia',
        repo: 'utopia-packages',
        ref: `release-${index + 1}`,
        path: `apps/demo-${index + 1}.package.json`,
      });
      packagesByUrl.set(url, packageJson);
      return buildRegistryInstallDescriptor({
        packageJson,
        name: `Demo Shelf ${index + 1}`,
        url,
        description: `Release ${index + 1}`,
      });
    });

    const manifest = buildRegistryManifest({
      name: 'Scale registry',
      packages: descriptors,
    });
    const result = checkRegistryInstallCompatibility({ manifest, packagesByUrl });

    expect(result).toEqual({
      packageCount: 32,
      installableCount: 32,
      checksumVerifiedCount: 32,
    });

    const registryUrl = buildGitHubReleaseAssetUrl({
      owner: 'utopia',
      repo: 'utopia-packages',
      tag: 'v1.0.0',
      assetName: 'registry.json',
    });
    const index = buildRegistryIndex({
      name: 'Utopia registries',
      registries: [
        buildRegistryIndexDescriptor({
          id: 'core',
          name: 'Core registry',
          url: registryUrl,
          manifest,
          description: 'Signed release registry',
        }),
      ],
    });

    expect(registryUrl).toBe('https://github.com/utopia/utopia-packages/releases/download/v1.0.0/registry.json');
    expect(validateRegistryIndex(index).registries[0]).toMatchObject({
      id: 'core',
      packageCount: 32,
    });
    expect(validateGitHubRegistryDistribution(buildGitHubRegistryDistribution({
      owner: 'utopia',
      repo: 'utopia-packages',
      releaseTag: 'v1.0.0',
      assetName: 'registry.json',
      pagesPath: 'registries/index.json',
      sourceRevision: '0123456789abcdef0123456789abcdef01234567',
      manifest,
      generatedAt: '2026-07-28T00:00:00.000Z',
    }))).toMatchObject({
      releaseTag: 'v1.0.0',
      registryAssetUrl: registryUrl,
      pagesIndexUrl: buildGitHubPagesIndexUrl({
        owner: 'utopia',
        repo: 'utopia-packages',
        path: 'registries/index.json',
      }),
      integrityLane: 'unsigned_checksum',
      packageCount: 32,
    });
  });

  it('rejects registry entries whose descriptor no longer matches the package', () => {
    const packageJson = clonePackage(0);
    const descriptor = buildRegistryInstallDescriptor({
      packageJson,
      name: 'Demo Shelf',
      url: 'https://raw.githubusercontent.com/utopia/utopia-packages/main/apps/demo.package.json',
    });
    const manifest = buildRegistryManifest({
      name: 'Broken registry',
      packages: [{ ...descriptor, version: '9.9.9' }],
    });

    expect(() => checkRegistryInstallCompatibility({
      manifest,
      packagesByUrl: new Map([[descriptor.url, packageJson]]),
    })).toThrow('registry_package_identity_mismatch');
  });

  it('rejects duplicate registry index descriptors', () => {
    const descriptor = buildRegistryIndexDescriptor({
      id: 'core',
      name: 'Core registry',
      url: 'https://github.com/utopia/utopia-packages/releases/download/v1.0.0/registry.json',
    });

    expect(() => buildRegistryIndex({
      name: 'Duplicate registries',
      registries: [descriptor, descriptor],
    })).toThrow('registry_duplicate:core');
  });

  it('rejects mutable refs and redirect-style distribution URLs', () => {
    const manifest = buildRegistryManifest({
      name: 'Mutable refs',
      packages: [buildRegistryInstallDescriptor({
        packageJson: clonePackage(0),
        name: 'Demo Shelf',
        url: buildGitHubRawPackageUrl({
          owner: 'utopia',
          repo: 'utopia-packages',
          ref: 'release-1',
          path: 'apps/demo.package.json',
        }),
      })],
    });

    expect(() => buildGitHubRegistryDistribution({
      owner: 'utopia',
      repo: 'utopia-packages',
      releaseTag: 'main',
      assetName: 'registry.json',
      pagesPath: 'registries/index.json',
      sourceRevision: '0123456789abcdef0123456789abcdef01234567',
      manifest,
    })).toThrow('registry_distribution_asset_ref_mutable');

    expect(() => validateGitHubRegistryDistribution({
      schemaVersion: 'utopia.registry-distribution.v1',
      sourceRevision: '0123456789abcdef0123456789abcdef01234567',
      releaseTag: 'v1.0.0',
      assetName: 'registry.json',
      registryAssetUrl: 'https://github.com/utopia/utopia-packages/releases/latest/download/registry.json',
      pagesIndexUrl: 'https://utopia.github.io/utopia-packages/registries/index.json',
      manifestChecksum: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      manifestSize: 512,
      packageCount: 1,
      integrityLane: 'unsigned_checksum',
      generatedAt: '2026-07-28T00:00:00.000Z',
    })).toThrow('registry_distribution_asset_path_invalid');
  });
});

function clonePackage(index: number) {
  const next = JSON.parse(JSON.stringify(basePackage));
  next.id = `demo.shelf.${index + 1}`;
  next.version = `1.0.${index}`;
  next.presentation = {
    ...next.presentation,
    label: `Demo Shelf ${index + 1}`,
  };
  return next;
}
