import assert from 'node:assert/strict';

import {
  createReactiveOutboxStore,
  enqueueReactiveProposals,
  listRunnableReactiveOutboxItems,
  markReactiveOutboxAcked,
  drainReactiveOutbox,
  markReactiveOutboxFailed,
  markReactiveOutboxRunning,
  parseReactiveOutboxStore,
  serializeReactiveOutboxStore,
} from '../src/kernel/reactive-outbox';
import type { ReactiveCycleResult } from '../src/kernel/reactive-cycle';
import type { OperationCommitEvent } from '../src/kernel/operation-observer';
import { createOperationProposalIdempotencyKey } from '../src/kernel/rules';

const now = '2026-07-23T00:00:00.000Z';
const proposalEvent = { kind: 'query_transition' as const, id: 'open:enter', queryId: 'open', transition: 'enter' as const };
const operationTemplate = { kind: 'custom' as const, tool: 'request_review' };
const authorization = {
  policyId: 'wonder.reactive-proposal-policy' as const,
  policyVersion: 'v1' as const,
  allowed: true,
  risk: 'standard' as const,
  reviewRequired: true,
  requiredCapability: 'reactive:propose:custom',
  capabilityPresent: false,
  providerAuthority: {
    targetProvider: 'user',
    authorityProvider: 'notion',
    allowed: true,
    requiredCapability: null,
    capabilityPresent: true,
    reason: 'provider_authority_ok',
  },
  reason: 'suggest_mode_requires_review',
};
const dryRun = {
  ok: true,
  effect: 'queue_review_action' as const,
  executable: false,
  reason: 'proposal_can_be_queued',
};
const proposalEvidence = {
  queryId: 'open',
  transition: 'enter' as const,
  beforeHash: 'before-hash',
  afterHash: 'after-hash',
  querySpecHash: 'sha256:query',
  packageHash: 'sha256:package',
  evaluatorVersion: 'wonder.query-evaluator.v1',
  targetRecordId: 'record-a',
  targetBeforeRevision: 1,
  targetAfterRevision: 2,
  beforeVersionVectorHash: 'sha256:before-version-vector',
  afterVersionVectorHash: 'sha256:after-version-vector',
  sourceEventId: 'operation-a',
};
const proposalIdempotencyKey = createOperationProposalIdempotencyKey({
  packageId: 'package-a',
  packageVersion: '1.0.0',
  ruleId: 'rule-a',
  event: proposalEvent,
  causeId: 'cause-a',
  operationTemplate,
  evidence: proposalEvidence,
});
const event: OperationCommitEvent = {
  actionId: 'action-a',
  operationId: 'operation-a',
  causeId: 'cause-a',
  domain: 'food',
  recordId: 'record-a',
  before: null,
  after: { id: 'record-a' },
};
const cycle: ReactiveCycleResult = {
  cycleId: 'cycle-a',
  transitions: [],
  queryHashes: { open: { before: 'before-hash', after: 'after-hash' } },
  proposals: [{
    id: 'proposal-a',
    eventId: 'open:enter',
    event: proposalEvent,
    ruleId: 'rule-a',
    operation: 'request_review',
    operationTemplate,
    mode: 'suggest',
    causeId: 'cause-a',
    packageVersion: '1.0.0',
    depth: 0,
    envelope: {
      schemaVersion: 'wonder.operation-proposal.v1',
      proposalId: 'proposal-a',
      operation: 'request_review',
      operationTemplate,
      mode: 'suggest',
      ruleId: 'rule-a',
      packageId: 'package-a',
      packageVersion: '1.0.0',
      eventId: 'open:enter',
      event: proposalEvent,
      causeId: 'cause-a',
      depth: 0,
      idempotencyKey: proposalIdempotencyKey,
      review: { required: true, reason: 'suggest_mode', policyId: authorization.policyId, policyVersion: authorization.policyVersion },
      authorization,
      dryRun,
      evidence: proposalEvidence,
    },
  }],
};

const empty = createReactiveOutboxStore();
const queued = enqueueReactiveProposals(empty, { cycle, event, proposalIds: ['proposal-a'], now });
assert.equal(Object.keys(queued.items).length, 1);
assert.equal(queued.items['proposal-a'].status, 'pending');
assert.equal(queued.items['proposal-a'].attempts, 0);
assert.equal(queued.items['proposal-a'].proposal.envelope.schemaVersion, 'wonder.operation-proposal.v1');
assert.equal(queued.items['proposal-a'].proposal.envelope.idempotencyKey, proposalIdempotencyKey);
assert.notEqual(
  createOperationProposalIdempotencyKey({
    packageId: 'package-a',
    packageVersion: '1.0.0',
    ruleId: 'rule-a',
    event: proposalEvent,
    causeId: 'cause-a',
    operationTemplate,
    evidence: { ...proposalEvidence, targetAfterRevision: 3 },
  }),
  proposalIdempotencyKey,
  'target revision change should change idempotency key',
);
assert.deepEqual(listRunnableReactiveOutboxItems(queued, now).map((item) => item.proposalId), ['proposal-a']);

const replay = enqueueReactiveProposals(queued, { cycle, event, proposalIds: ['proposal-a'], now });
assert.deepEqual(replay, queued, 'replaying the same proposal must not duplicate outbox work');

const running = markReactiveOutboxRunning(queued, 'proposal-a', '2026-07-23T00:00:01.000Z');
assert.equal(running.items['proposal-a'].status, 'running');
assert.deepEqual(listRunnableReactiveOutboxItems(running, '2026-07-23T00:00:01.000Z'), []);

const failed = markReactiveOutboxFailed(running, 'proposal-a', {
  error: 'temporary outage',
  now: '2026-07-23T00:00:02.000Z',
  retryDelayMs: 1_000,
});
assert.equal(failed.items['proposal-a'].status, 'pending');
assert.equal(failed.items['proposal-a'].attempts, 1);
assert.equal(listRunnableReactiveOutboxItems(failed, '2026-07-23T00:00:02.500Z').length, 0);
assert.equal(listRunnableReactiveOutboxItems(failed, '2026-07-23T00:00:03.000Z').length, 1);

const acked = markReactiveOutboxAcked(failed, 'proposal-a', '2026-07-23T00:00:04.000Z');
assert.equal(acked.items['proposal-a'].status, 'acked');
assert.deepEqual(listRunnableReactiveOutboxItems(acked, '2026-07-23T00:00:05.000Z'), []);

const restored = parseReactiveOutboxStore(serializeReactiveOutboxStore(failed));
assert.deepEqual(restored, failed, 'outbox must survive JSON persistence');
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: {
      ...failed.items,
      'proposal-a': {
        ...failed.items['proposal-a'],
        proposal: { ...failed.items['proposal-a'].proposal, envelope: undefined },
      },
    },
  })),
  /missing its proposal envelope/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, unexpected: 'field' } } } },
  })),
  /missing its proposal envelope/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, operationTemplate: { kind: 'update_record', recordId: 'r1' }, envelope: { ...failed.items['proposal-a'].proposal.envelope, operationTemplate: { kind: 'update_record', recordId: 'r1' } } } } },
  })),
  /missing its proposal envelope/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, packageId: '' } } } },
  })),
  /missing its proposal envelope/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, event: { kind: 'query_transition', id: 'open:enter', queryId: 'other', transition: 'enter' } } } } },
  })),
  /inconsistent proposal envelope/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, review: { required: false, reason: 'policy_required' } } } } },
  })),
  /missing its proposal envelope/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, review: { required: false, reason: 'policy_authorized', policyId: authorization.policyId, policyVersion: authorization.policyVersion } } } } },
  })),
  /inconsistent policy receipt/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, authorization: { ...authorization, allowed: false } } } } },
  })),
  /inconsistent policy receipt/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, dryRun: { ...dryRun, ok: false } } } } },
  })),
  /inconsistent policy receipt/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, evidence: { ...failed.items['proposal-a'].proposal.envelope.evidence, afterHash: 'tampered' } } } } },
  })),
  /invalid idempotency key/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, evidence: { ...failed.items['proposal-a'].proposal.envelope.evidence, sourceEventId: 'other-operation' } } } } },
  })),
  /invalid idempotency key/,
);
assert.throws(
  () => parseReactiveOutboxStore(JSON.stringify({
    ...failed,
    items: { ...failed.items, 'proposal-a': { ...failed.items['proposal-a'], proposal: { ...failed.items['proposal-a'].proposal, envelope: { ...failed.items['proposal-a'].proposal.envelope, idempotencyKey: 'tampered' } } } },
  })),
  /invalid idempotency key/,
);
assert.throws(
  () => enqueueReactiveProposals(empty, { cycle, event, proposalIds: ['missing-proposal'], now }),
  /missing from cycle/,
);

const drainChanges: string[] = [];
const drained = await drainReactiveOutbox({
  store: queued,
  now,
  retryDelayMs: 1_000,
  executeProposal: (item) => item.proposal.operation === 'request_review'
    ? { ok: true, receipt: { status: 'queued' } }
    : { ok: false, error: 'unexpected operation' },
  onStoreChange: (store) => drainChanges.push(store.items['proposal-a'].status),
});
assert.deepEqual(drained.attempted, ['proposal-a']);
assert.deepEqual(drained.acked, []);
assert.deepEqual(drained.queuedForReview, ['proposal-a']);
assert.equal(drained.store.items['proposal-a'].status, 'awaiting_review');
assert.deepEqual(drainChanges, ['running', 'awaiting_review']);

const failing = await drainReactiveOutbox({
  store: queued,
  now,
  retryDelayMs: 1_000,
  executeProposal: () => ({ ok: false, error: 'kernel rejected proposal' }),
});
assert.deepEqual(failing.failed, [{ proposalId: 'proposal-a', error: 'kernel rejected proposal' }]);
assert.equal(failing.store.items['proposal-a'].status, 'pending');
assert.equal(failing.store.items['proposal-a'].attempts, 1);

console.log('reactive-outbox: passed');
