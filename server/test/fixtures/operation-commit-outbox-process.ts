import assert from 'node:assert/strict';

const phase = process.env.LIFEOS_OUTBOX_TEST_PHASE;
const {
  createRecordWithAction,
  drainOperationCommitOutbox,
  listOperationCommitOutbox,
} = await import('../../src/runtime/state');
const {
  setOperationCommitObserver,
} = await import('../../src/kernel/operation-observer');

if (phase === 'commit') {
  setOperationCommitObserver(null);
  const result = createRecordWithAction({
    actionId: 'restart-outbox-action',
    actor: 'test',
    domain: 'food',
    tool: 'create_record',
    risk: 'low',
    command: 'prove durable delivery',
    record: {
      id: 'restart-outbox-record',
      domain: 'food',
      collection: 'recipe',
      title: 'Restart outbox proof',
      properties: { status: 'open' },
      relations: [],
      source: {
        provider: 'user',
        external_id: 'restart-outbox-record',
        url: null,
        observed_at: '2026-07-26T00:00:00.000Z',
        content_hash: null,
      },
      archived_at: null,
    },
  });
  assert.equal(result.action.status, 'completed');
  assert.equal(listOperationCommitOutbox().length, 1);
} else if (phase === 'recover') {
  const delivered: string[] = [];
  setOperationCommitObserver((event) => {
    delivered.push(event.operationId);
  });
  const result = drainOperationCommitOutbox();
  assert.deepEqual(result.delivered, ['restart-outbox-action:operation']);
  assert.deepEqual(delivered, ['restart-outbox-action:operation']);
  assert.equal(listOperationCommitOutbox().length, 0);
} else if (phase === 'verify-empty') {
  let calls = 0;
  setOperationCommitObserver(() => {
    calls += 1;
  });
  assert.equal(drainOperationCommitOutbox().attempted, 0);
  assert.equal(calls, 0);
} else {
  throw new Error(`Unknown LIFEOS_OUTBOX_TEST_PHASE: ${phase}`);
}
