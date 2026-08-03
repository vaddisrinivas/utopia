import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_APP_INSTALLATION_ID,
  DEFAULT_WORKSPACE_ID,
  PackageRegistry,
} from '@/server/src/kernel/package-registry';
import type { AppPackageV2 } from '@/server/src/kernel/package';

const canonicalBundledFoodPackage: AppPackageV2 = {
  schemaVersion: 'wonder.app-package.v2',
  id: 'food',
  version: '1.0.0',
  collections: { records: { id: 'records', fields: { state: { type: 'text' } } } },
  queries: { all: { from: 'records' } },
  views: { list: { id: 'list', query: 'all', mode: 'list', fields: ['state'] } },
  presentation: {
    label: 'Food',
    sourceSchemaVersion: 'wonder.package-source.v1',
    surfaces: [{ id: 'overview', label: 'Overview', collections: ['records'] }],
    ui: {
      screens: {
        overview: {
          components: [{ kind: 'widget', widget: 'recordHeroSummary', title: 'Food overview' }],
        },
      },
    },
  },
  rules: [],
  capabilities: [],
  acceptanceTests: ['package-registry:bundled-recovery'],
};

const staleBundledFoodPackage = {
  ...canonicalBundledFoodPackage,
  version: '1.0.0+bundle.legacy',
  presentation: {
    ...canonicalBundledFoodPackage.presentation,
    sourceSchemaVersion: 'utopia.domain.v1',
    ui: {
      screens: {
        overview: {
          components: [{ kind: 'widget', widget: 'pantryShelf', title: 'Stale pantry' }],
        },
      },
    },
  },
};

describe('server package registry bundled recovery', () => {
  it('recovers stale bundled Food from current source authority before widget enum validation', () => {
    const staleFoodKey = 'food@1.0.0+bundle.legacy';
    const registryPath = join(mkdtempSync(join(tmpdir(), 'utopia-stale-food-registry-')), 'registry.json');
    writeFileSync(registryPath, JSON.stringify({
      schemaVersion: 'wonder.package-registry.v1',
      activeKey: staleFoodKey,
      previousKey: null,
      workspaces: {
        [DEFAULT_WORKSPACE_ID]: {
          id: DEFAULT_WORKSPACE_ID,
          label: 'Default workspace',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      },
      installations: {
        [DEFAULT_APP_INSTALLATION_ID]: {
          id: DEFAULT_APP_INSTALLATION_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          label: 'Food',
          status: 'active',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      },
      packageState: {
        [DEFAULT_APP_INSTALLATION_ID]: {
          installationId: DEFAULT_APP_INSTALLATION_ID,
          activePackageKey: staleFoodKey,
          previousPackageKey: null,
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      },
      packages: { [staleFoodKey]: staleBundledFoodPackage },
      receipts: [],
    }), 'utf8');

    const registry = new PackageRegistry({
      path: registryPath,
      now: () => '2026-07-23T00:00:09.000Z',
      bundledPackages: [canonicalBundledFoodPackage],
    });

    expect(registry.getActive()?.id).toBe('food');
    expect(registry.getActive()?.version).toBe('1.0.0');
    expect(registry.getActive()?.presentation?.ui?.screens?.overview.components?.[0]?.widget).toBe('recordHeroSummary');

    const persisted = JSON.parse(readFileSync(registryPath, 'utf8'));
    expect(persisted.activeKey).toBe('food@1.0.0');
    expect(persisted.packageState[DEFAULT_APP_INSTALLATION_ID].activePackageKey).toBe('food@1.0.0');
    expect(JSON.stringify(persisted)).not.toContain('pantryShelf');
    expect(persisted.receipts.at(-1)?.packageKey).toBe('food@1.0.0');
    expect(new PackageRegistry({ path: registryPath }).getActive()?.version).toBe('1.0.0');
  });

  it('does not rescue arbitrary invalid packages with bundled Food authority', () => {
    const registryPath = join(mkdtempSync(join(tmpdir(), 'utopia-invalid-unbundled-registry-')), 'registry.json');
    writeFileSync(registryPath, JSON.stringify({
      schemaVersion: 'wonder.package-registry.v1',
      activeKey: 'external-food@1.0.0+bundle.legacy',
      previousKey: null,
      packages: {
        'external-food@1.0.0+bundle.legacy': {
          ...staleBundledFoodPackage,
          id: 'external-food',
        },
      },
      receipts: [],
    }), 'utf8');

    expect(() => new PackageRegistry({
      path: registryPath,
      bundledPackages: [canonicalBundledFoodPackage],
    })).toThrow(/package_registry_package_invalid:external-food@1.0.0\+bundle.legacy/);
  });
});
