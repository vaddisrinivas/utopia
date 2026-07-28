import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-observer-failure-state-')), 'wonder-runtime.json');
process.env.LIFEOS_REACTIVE_RUNTIME_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-observer-failure-runtime-')), 'reactive-runtime.json');
process.env.LIFEOS_PACKAGE_REGISTRY_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-observer-failure-registry-')), 'package-registry.json');

const { installReactiveRuntime } = await import('../src/kernel/install-reactive-runtime');
const { setOperationCommitObserver } = await import('../src/kernel/operation-observer');
const { createRecordWithAction, deleteRecord, getActionEvent } = await import('../src/runtime/state');

installReactiveRuntime();
setOperationCommitObserver(() => {
  throw Object.assign(new Error('reactive observer receipt proof'), { phase: 'run_cycle' });
});

const result = createRecordWithAction({
  actionId: 'reactive-observer-receipt-action',
  actor: 'test',
  domain: 'food',
  tool: 'create_record',
  risk: 'low',
  command: 'create receipt proof',
  record: {
    id: 'reactive-observer-receipt-record',
    domain: 'food',
    collection: 'recipe',
    title: 'Receipt proof',
    properties: {},
    relations: [],
    source: {
      provider: 'user',
      external_id: 'reactive-observer-receipt-record',
      url: null,
      observed_at: new Date().toISOString(),
      content_hash: null,
    },
    archived_at: null,
  },
});

const failureActionId = `reactive-observer-failure:${result.action.operation_id.replace(/[^A-Za-z0-9_.:-]/g, '_')}`;
const failureReceipt = getActionEvent(failureActionId);
assert.equal(result.action.status, 'completed');
assert.equal(failureReceipt?.status, 'failed');
assert.equal((failureReceipt?.after_json as { phase?: string; error?: { message?: string } }).phase, 'run_cycle');
assert.equal((failureReceipt?.after_json as { error?: { message?: string } }).error?.message, 'reactive observer receipt proof');

deleteRecord('reactive-observer-receipt-record');
console.log('reactive-observer-failure-receipt: passed');
