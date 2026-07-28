import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppPackageV2 } from '../src/kernel/package';

process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-reactive-observer-')), 'wonder-runtime.json');

const { createReactiveCycleObserver } = await import('../src/kernel/reactive-observer');
const { createReactiveReceiptStore } = await import('../src/kernel/reactive-receipts');
const { createReactiveOutboxStore, enqueueReactiveProposals } = await import('../src/kernel/reactive-outbox');
const { setOperationCommitFailureObserver, setOperationCommitObserver } = await import('../src/kernel/operation-observer');
const { createRecordWithAction, deleteRecord, listRecords } = await import('../src/runtime/state');

const appPackage: AppPackageV2 = {
  schemaVersion: 'wonder.app-package.v2', id: 'observer-proof', version: '1.0.0',
  collections: { recipe: { id: 'recipe', fields: { status: { type: 'text' } } } },
  queries: { open: { from: 'recipe', where: { op: 'eq', field: 'properties.status', value: 'open' } } },
  views: {}, rules: [{
    id: 'review-enter', trigger: { kind: 'query_transition', query: 'open', transition: 'enter' },
    effect: { kind: 'propose_operation', operation: 'request_review' }, mode: 'suggest', maxRunsPerEvent: 1,
  }], capabilities: [], acceptanceTests: [],
};
let store = createReactiveReceiptStore();
let outbox = createReactiveOutboxStore();
const proposals: string[] = [];
const observer = createReactiveCycleObserver({
  package: appPackage,
  getRows: () => listRecords({ domain: 'food', collection: 'recipe' }) as unknown as Record<string, unknown>[],
  getReceiptStore: () => store,
  setReceiptStore: (next) => { store = next; },
  commitCycle: ({ receipt, cycle, event }) => {
    outbox = enqueueReactiveProposals(outbox, { cycle, event, proposalIds: receipt.newProposalIds, now: '2026-07-23T00:00:00.000Z' });
    store = receipt.store;
    proposals.push(...receipt.newProposalIds);
  },
});
setOperationCommitObserver(observer);
const result = createRecordWithAction({
  actionId: 'reactive-observer-action', actor: 'test', domain: 'food', tool: 'create_record', risk: 'low', command: 'create',
  record: { id: 'reactive-observer-record', domain: 'food', collection: 'recipe', title: 'Observer', properties: { status: 'open' }, relations: [], source: { provider: 'user', external_id: 'reactive-observer-record', url: null, observed_at: new Date().toISOString(), content_hash: null }, archived_at: null },
});
setOperationCommitObserver(null);
assert.equal(result.replayed, false);
assert.equal(proposals.length, 1);
assert.equal(Object.keys(store.cycles).length, 1);
assert.equal(Object.keys(outbox.items).length, 1);
assert.equal(outbox.items[proposals[0]].status, 'pending');
deleteRecord('reactive-observer-record');

const failures: Array<{ phase: string; error: { message: string } }> = [];
const failingObserver = createReactiveCycleObserver({
  package: appPackage,
  getRows: () => listRecords({ domain: 'food', collection: 'recipe' }) as unknown as Record<string, unknown>[],
  getReceiptStore: () => store,
  setReceiptStore: (next) => { store = next; },
  commitCycle: () => {
    throw new Error('commit cycle failed');
  },
  onFailure: (failure) => failures.push(failure),
});
setOperationCommitFailureObserver(() => {});
setOperationCommitObserver(failingObserver);
createRecordWithAction({
  actionId: 'reactive-observer-failure-action', actor: 'test', domain: 'food', tool: 'create_record', risk: 'low', command: 'create failure',
  record: { id: 'reactive-observer-failure-record', domain: 'food', collection: 'recipe', title: 'Observer fail', properties: { status: 'open' }, relations: [], source: { provider: 'user', external_id: 'reactive-observer-failure-record', url: null, observed_at: new Date().toISOString(), content_hash: null }, archived_at: null },
});
setOperationCommitObserver(null);
setOperationCommitFailureObserver(null);
assert.equal(failures.length, 1);
assert.equal(failures[0]?.phase, 'commit_cycle');
assert.equal(failures[0]?.error.message, 'commit cycle failed');
deleteRecord('reactive-observer-failure-record');
console.log('reactive-observer: passed');
