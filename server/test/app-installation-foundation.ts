import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_APP_INSTALLATION_ID,
  DEFAULT_WORKSPACE_ID,
  PackageRegistry,
} from '../src/kernel/package-registry';
import type { AppPackageV2 } from '../src/kernel/package';

function appPackage(id: string, version: string, label = id): AppPackageV2 {
  return {
    schemaVersion: 'wonder.app-package.v2',
    id,
    version,
    collections: { records: { id: 'records', fields: { title: { type: 'text' } } } },
    queries: { all: { from: 'records' } },
    views: { list: { id: 'list', query: 'all', mode: 'list', fields: ['title'] } },
    presentation: {
      label,
      homeSurface: 'records.list',
      surfaces: [{ id: 'records.list', label, collections: ['records'] }],
    },
    rules: [],
    capabilities: [],
    acceptanceTests: ['app-installation-foundation'],
  };
}

const path = join(mkdtempSync(join(tmpdir(), 'utopia-app-installation-')), 'registry.json');
let tick = 0;
const now = () => `2026-07-27T00:00:${String(tick++).padStart(2, '0')}.000Z`;

const registry = new PackageRegistry({ path, now });
assert.equal(registry.listAppInstallations().length, 0);

const base = appPackage('shared-ledger', '1.0.0', 'Shared ledger');
assert.equal(registry.activate(base).version, '1.0.0');
assert.equal(registry.getAppInstallation(DEFAULT_APP_INSTALLATION_ID)?.workspaceId, DEFAULT_WORKSPACE_ID);
assert.equal(registry.getInstallationPackageState(DEFAULT_APP_INSTALLATION_ID)?.activePackageKey, 'shared-ledger@1.0.0');

registry.createAppInstallation({
  id: 'second',
  workspaceId: DEFAULT_WORKSPACE_ID,
  package: base,
});
assert.equal(registry.listAppInstallations(DEFAULT_WORKSPACE_ID).length, 2);
assert.equal(registry.getActiveForInstallation('second')?.version, '1.0.0');

registry.activateForInstallation(DEFAULT_APP_INSTALLATION_ID, appPackage('shared-ledger', '2.0.0', 'Shared ledger v2'));
assert.equal(registry.getActiveForInstallation(DEFAULT_APP_INSTALLATION_ID)?.version, '2.0.0');
assert.equal(registry.getActiveForInstallation('second')?.version, '1.0.0');

assert.equal(registry.rollbackInstallation(DEFAULT_APP_INSTALLATION_ID)?.version, '1.0.0');
assert.equal(registry.getActiveForInstallation(DEFAULT_APP_INSTALLATION_ID)?.version, '1.0.0');
assert.equal(registry.getActiveForInstallation('second')?.version, '1.0.0');

const persisted = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(persisted.schemaVersion, 'wonder.package-registry.v1');
assert.equal(Object.keys(persisted.workspaces).length, 1);
assert.equal(Object.keys(persisted.installations).length, 2);
assert.equal(persisted.packageState.default.activePackageKey, 'shared-ledger@1.0.0');

const restored = new PackageRegistry({ path, now });
assert.equal(restored.listAppInstallations(DEFAULT_WORKSPACE_ID).length, 2);
assert.equal(restored.getActiveForInstallation(DEFAULT_APP_INSTALLATION_ID)?.version, '1.0.0');
assert.equal(restored.getActiveForInstallation('second')?.version, '1.0.0');

const legacyPath = join(mkdtempSync(join(tmpdir(), 'utopia-app-installation-legacy-')), 'registry.json');
writeFileSync(legacyPath, JSON.stringify({
  schemaVersion: 'wonder.package-registry.v1',
  activeKey: 'shared-ledger@1.0.0',
  previousKey: null,
  packages: { 'shared-ledger@1.0.0': base },
  receipts: [],
}), 'utf8');

const legacy = new PackageRegistry({ path: legacyPath, now });
assert.equal(legacy.getAppInstallation(DEFAULT_APP_INSTALLATION_ID)?.id, DEFAULT_APP_INSTALLATION_ID);
assert.equal(legacy.getInstallationPackageState(DEFAULT_APP_INSTALLATION_ID)?.activePackageKey, 'shared-ledger@1.0.0');
legacy.activateForInstallation(DEFAULT_APP_INSTALLATION_ID, appPackage('shared-ledger', '2.0.0'));
const legacyAgain = new PackageRegistry({ path: legacyPath, now });
assert.equal(legacyAgain.listAppInstallations(DEFAULT_WORKSPACE_ID).length, 1);
assert.equal(legacyAgain.getActiveForInstallation(DEFAULT_APP_INSTALLATION_ID)?.version, '2.0.0');

console.log('app-installation-foundation: passed');
