import assert from 'node:assert/strict';

import { previewReactiveProposalCommand } from '../src/kernel/reactive-proposal-command';

const custom = previewReactiveProposalCommand({
  operationTemplate: { kind: 'custom', tool: 'request_review' },
  domain: 'food',
  idempotencyKey: 'reactive:key',
  actionId: 'reactive-proposal:custom',
  actor: 'tester',
});
assert.deepEqual(custom, {
  ok: false,
  reason: 'custom_operation_requires_review',
  recordIds: [],
});

const update = previewReactiveProposalCommand({
  operationTemplate: { kind: 'update_record', collection: 'decisions', recordId: 'decision-a', expectedRevision: 3, changes: { status: 'review' } },
  domain: 'food',
  idempotencyKey: 'reactive:key',
  actionId: 'reactive-proposal:update',
  actor: 'tester',
});
assert.deepEqual(update, {
  ok: true,
  tool: 'utopia.update_record',
  args: {
    actor: 'tester',
    domain: 'food',
    id: 'decision-a',
    patch: { status: 'review' },
    expected_revision: 3,
    idempotency_key: 'reactive:key',
    action_id: 'reactive-proposal:update',
    data_home: 'local_sqlite',
  },
  recordIds: ['decision-a'],
});

const create = previewReactiveProposalCommand({
  operationTemplate: { kind: 'create_record', collection: 'decisions', properties: { status: 'queued' } },
  domain: 'food',
  idempotencyKey: 'reactive:create',
  actionId: 'reactive-proposal:create',
  actor: 'tester',
});
assert.equal(create.ok, true);
assert.deepEqual(create.recordIds, ['reactive-proposal:create']);
assert.equal(create.ok ? create.args.collection : '', 'decisions');

console.log('reactive-proposal-command: passed');
