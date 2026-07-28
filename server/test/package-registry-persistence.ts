import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PackageRegistry } from '../src/kernel/package-registry';
import type { AppPackageV2 } from '../src/kernel/package';

const pkg: AppPackageV2 = {
  schemaVersion: 'wonder.app-package.v2',
  id: 'persistent-ledger',
  version: '1.0.0',
  collections: { decisions: { id: 'decisions', fields: { state: { type: 'text' } } } },
  queries: { all: { from: 'decisions' } },
  views: { list: { id: 'list', query: 'all', mode: 'list', fields: ['state'] } },
  presentation: {
    label: 'Persistent ledger',
    homeSurface: 'ledger.list',
    surfaces: [{ id: 'ledger.list', label: 'Ledger list', collections: ['decisions'] }],
    visualIdentity: { domain: { icon: 'ledger' } },
    render: { default_title: 'Ledger' },
  },
  rules: [],
  capabilities: ['mcp-tool:decisions'],
  acceptanceTests: ['package:persistence'],
};
const path = join(mkdtempSync(join(tmpdir(), 'utopia-package-registry-')), 'registry.json');
let tick = 0;
const now = () => `2026-07-23T00:00:0${tick++}.000Z`;

const registry = new PackageRegistry({ path, now });
assert.equal(registry.getActive(), null);
assert.equal(registry.activate(pkg).version, '1.0.0');
assert.equal(registry.activate({ ...pkg, version: '2.0.0' }).version, '2.0.0');
assert.equal(registry.getReceipts().length, 2);

const restored = new PackageRegistry({ path, now });
assert.equal(restored.getActive()?.version, '2.0.0');
assert.equal(restored.getActive()?.presentation?.label, 'Persistent ledger');
assert.equal(restored.getActive()?.presentation?.surfaces[0]?.id, 'ledger.list');
assert.equal(restored.rollback()?.version, '1.0.0');
assert.equal(restored.getActive()?.version, '1.0.0');

const afterRollback = new PackageRegistry({ path, now });
assert.equal(afterRollback.getActive()?.version, '1.0.0');
assert.equal(afterRollback.getReceipts().at(-1)?.action, 'rollback');
assert.throws(
  () => afterRollback.activate({ ...pkg, views: { list: { id: 'list', query: 'missing', mode: 'list', fields: ['state'] } } }),
  /package_invalid/,
);
assert.equal(afterRollback.getActive()?.version, '1.0.0', 'failed activation must not change persisted active package');

const persisted = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(persisted.schemaVersion, 'wonder.package-registry.v1');
assert.equal(persisted.activeKey, 'persistent-ledger@1.0.0');
assert.equal(Object.keys(persisted.packages).length, 2);
assert.equal(persisted.receipts.length, 3);

writeFileSync(path, JSON.stringify({ ...persisted, activeKey: 'missing@1.0.0' }), 'utf8');
assert.throws(() => new PackageRegistry({ path }), /package_registry_active_missing/);
writeFileSync(path, JSON.stringify({ ...persisted, extra: true }), 'utf8');
assert.throws(() => new PackageRegistry({ path }), /package_registry_schema_invalid/);
writeFileSync(path, JSON.stringify({ ...persisted, receipts: [{ ...persisted.receipts[0], createdAt: 'not-a-date' }] }), 'utf8');
assert.throws(() => new PackageRegistry({ path }), /package_registry_schema_invalid/);

console.log('package-registry-persistence: passed');
