import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'utopia-reactive-runtime-registry-'));
const runtimePath = join(dir, 'runtime.json');
const registryPath = join(dir, 'package-registry.json');
process.env.LIFEOS_REACTIVE_RUNTIME_PATH = runtimePath;
process.env.LIFEOS_PACKAGE_REGISTRY_PATH = registryPath;
process.env.WONDER_RUNTIME_STATE_PATH = join(dir, 'wonder-runtime.json');

const { PackageRegistry } = await import('../src/kernel/package-registry');
const { installReactiveRuntime } = await import('../src/kernel/install-reactive-runtime');
const { notifyOperationCommit } = await import('../src/kernel/operation-observer');

const activePackage = {
  schemaVersion: 'wonder.app-package.v2' as const,
  id: 'runtime-authority',
  version: '9.0.0',
  collections: { records: { id: 'records', fields: { state: { type: 'text' as const } } } },
  queries: { all: { from: 'records' } },
  views: { list: { id: 'list', query: 'all', mode: 'list' as const, fields: ['state'] } },
  presentation: {
    label: 'Runtime Authority',
    surfaces: [{ id: 'runtime.home', label: 'Runtime Home', collections: ['records'] }],
  },
  rules: [{
    id: 'runtime-review',
    trigger: { kind: 'operation' as const },
    effect: { kind: 'propose_operation' as const, operation: 'request_review' },
    mode: 'suggest' as const,
    maxRunsPerEvent: 1,
  }],
  capabilities: [],
  acceptanceTests: ['runtime:registry-authority'],
};

const registry = new PackageRegistry({ path: registryPath, now: () => '2026-07-24T00:00:00.000Z' });
registry.activate(activePackage);

installReactiveRuntime(runtimePath);
const duplicateEvent = {
  actionId: 'runtime-authority-action',
  operationId: 'runtime-authority-operation',
  causeId: 'runtime-authority-cause',
  domain: 'runtime-authority',
  recordId: 'runtime-authority-record',
  before: null,
  after: { id: 'runtime-authority-record', state: 'open' },
};
assert.equal(notifyOperationCommit(duplicateEvent).delivered, true);
assert.equal(notifyOperationCommit(duplicateEvent).delivered, true, 'crash-window redelivery must be idempotent');

const restored = new PackageRegistry({ path: registryPath });
assert.equal(restored.getActive()?.id, 'runtime-authority');
assert.equal(restored.getActive()?.presentation?.label, 'Runtime Authority');

const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
const proposals = Object.values(runtime.outbox.items) as Array<{ proposal: { envelope: { packageId: string; packageVersion: string } } }>;
assert.equal(proposals.length, 1);
assert.equal(proposals[0].proposal.envelope.packageId, 'runtime-authority');
assert.equal(proposals[0].proposal.envelope.packageVersion, '9.0.0');

console.log('reactive-runtime-package-registry: passed');
