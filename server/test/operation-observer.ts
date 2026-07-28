import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-operation-observer-')), 'wonder-runtime.json');

const { setOperationCommitFailureObserver, setOperationCommitObserver } = await import('../src/kernel/operation-observer');
const {
  createRecordWithAction,
  deleteRecord,
  drainOperationCommitOutbox,
  listOperationCommitOutbox,
} = await import('../src/runtime/state');

const events: unknown[] = [];
setOperationCommitObserver((event) => events.push(event));
const result = createRecordWithAction({
  actionId: 'observer-action',
  actor: 'test',
  domain: 'food',
  tool: 'create_record',
  risk: 'low',
  command: 'create observer proof',
  record: { id: 'observer-record', domain: 'food', collection: 'recipe', title: 'Observer proof', properties: {}, relations: [], source: { provider: 'user', external_id: 'observer-record', url: null, observed_at: new Date().toISOString(), content_hash: null }, archived_at: null },
});
setOperationCommitObserver(null);
assert.equal(events.length, 1);
const event = events[0] as { actionId: string; operationId: string; recordId: string; before: unknown; after: unknown };
assert.equal(event.actionId, result.action.id);
assert.equal(event.operationId, result.action.operation_id);
assert.equal(event.recordId, 'observer-record');
assert.equal(event.before, null);
assert.equal((event.after as { id: string }).id, 'observer-record');
deleteRecord('observer-record');

const failures: Array<{ phase: string; event: { operationId: string }; error: { message: string } }> = [];
setOperationCommitFailureObserver((failure) => failures.push(failure));
setOperationCommitObserver(() => {
  throw Object.assign(new Error('observer exploded'), { phase: 'commit_cycle' });
});
const failureResult = createRecordWithAction({
  actionId: 'observer-failure-action',
  actor: 'test',
  domain: 'food',
  tool: 'create_record',
  risk: 'low',
  command: 'create observer failure proof',
  record: { id: 'observer-failure-record', domain: 'food', collection: 'recipe', title: 'Observer failure proof', properties: {}, relations: [], source: { provider: 'user', external_id: 'observer-failure-record', url: null, observed_at: new Date().toISOString(), content_hash: null }, archived_at: null },
});
const secondFailureResult = createRecordWithAction({
  actionId: 'observer-second-failure-action',
  actor: 'test',
  domain: 'food',
  tool: 'create_record',
  risk: 'low',
  command: 'create second observer failure proof',
  record: { id: 'observer-second-failure-record', domain: 'food', collection: 'recipe', title: 'Second observer failure proof', properties: {}, relations: [], source: { provider: 'user', external_id: 'observer-second-failure-record', url: null, observed_at: new Date().toISOString(), content_hash: null }, archived_at: null },
});
setOperationCommitObserver(null);
setOperationCommitFailureObserver(null);
assert.equal(failureResult.action.status, 'completed');
assert.equal(secondFailureResult.action.status, 'completed');
assert.equal(failures.length, 2);
assert.equal(failures[0]?.phase, 'commit_cycle');
assert.equal(failures[0]?.event.operationId, failureResult.action.operation_id);
assert.equal(failures[0]?.error.message, 'observer exploded');
assert.equal(listOperationCommitOutbox().some((item) => item.event.operationId === failureResult.action.operation_id), true);
let transientCalls = 0;
setOperationCommitObserver(() => {
  transientCalls += 1;
  throw new Error('retry still unavailable');
});
const retainedRetry = drainOperationCommitOutbox();
assert.deepEqual(retainedRetry.retained, [failureResult.action.operation_id]);
assert.equal(transientCalls, 1, 'a retained event must block later commit events from overtaking it');
let retryCalls = 0;
setOperationCommitObserver(() => {
  retryCalls += 1;
});
const retry = drainOperationCommitOutbox();
assert.equal(retry.delivered.includes(failureResult.action.operation_id), true);
assert.equal(retry.delivered.includes(secondFailureResult.action.operation_id), true);
assert.equal(retryCalls, 2);
drainOperationCommitOutbox();
assert.equal(retryCalls, 2, 'acked commit events must never redeliver');
setOperationCommitObserver(null);
deleteRecord('observer-failure-record');
deleteRecord('observer-second-failure-record');
console.log('operation-observer: passed');
