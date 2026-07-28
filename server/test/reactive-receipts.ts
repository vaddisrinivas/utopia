import assert from 'node:assert/strict';

import {
  createReactiveReceiptStore,
  parseReactiveReceiptStore,
  recordReactiveCycle,
  serializeReactiveReceiptStore,
} from '../src/kernel/reactive-receipts';

const empty = createReactiveReceiptStore();
const first = recordReactiveCycle(empty, {
  cycleId: 'cycle-a',
  proposals: [{ id: 'proposal-b' }, { id: 'proposal-a' }],
});

assert.equal(first.isNewCycle, true);
assert.deepEqual(first.newProposalIds, ['proposal-a', 'proposal-b']);
assert.deepEqual(first.duplicateProposalIds, []);
assert.deepEqual(first.receipt.proposalIds, ['proposal-a', 'proposal-b']);
assert.deepEqual(empty.cycles, {}, 'recording must not mutate the prior store');
assert.equal(Object.isFrozen(first.store), true);
assert.equal(Object.isFrozen(first.store.cycles['cycle-a']), true);

const replay = recordReactiveCycle(first.store, {
  cycleId: 'cycle-a',
  proposals: [{ id: 'proposal-a' }, { id: 'proposal-b' }],
});
assert.equal(replay.isNewCycle, false);
assert.equal(replay.store, first.store, 'an exact replay should preserve store identity');
assert.deepEqual(replay.newProposalIds, []);
assert.deepEqual(replay.duplicateProposalIds, ['proposal-a', 'proposal-b']);

const second = recordReactiveCycle(replay.store, {
  cycleId: 'cycle-b',
  proposals: [{ id: 'proposal-c' }, { id: 'proposal-a' }],
});
assert.equal(second.isNewCycle, true);
assert.deepEqual(second.newProposalIds, ['proposal-c']);
assert.deepEqual(second.duplicateProposalIds, ['proposal-a']);
assert.equal(second.store.proposals['proposal-a'].firstCycleId, 'cycle-a');
assert.equal(second.store.proposals['proposal-c'].firstCycleId, 'cycle-b');

const restored = parseReactiveReceiptStore(serializeReactiveReceiptStore(second.store));
assert.deepEqual(restored, second.store, 'receipt state must survive JSON persistence');

assert.throws(
  () => recordReactiveCycle(second.store, {
    cycleId: 'cycle-a',
    proposals: [{ id: 'proposal-a' }],
  }),
  /conflicts with its persisted receipt/,
);
assert.throws(
  () => recordReactiveCycle(second.store, {
    cycleId: 'cycle-c',
    proposals: [{ id: 'proposal-d' }, { id: 'proposal-d' }],
  }),
  /contains duplicate proposal ids/,
);
assert.throws(
  () => parseReactiveReceiptStore(JSON.stringify({
    ...second.store,
    proposals: {},
  })),
  /proposal receipt proposal-a is missing/,
);

console.log('reactive-receipts: passed');
