import assert from 'node:assert/strict';

import type { AppPackageV2 } from '../src/kernel/package';
import { runReactiveCycle } from '../src/kernel/reactive-cycle';

const pkg: AppPackageV2 = {
  schemaVersion: 'wonder.app-package.v2',
  id: 'decision-ledger',
  version: '1.0.0',
  collections: {
    decisions: {
      id: 'decisions',
      fields: {
        status: { type: 'text', indexed: true },
        risk: { type: 'number', indexed: true },
      },
    },
  },
  queries: {
    'high-risk-open': {
      from: 'decisions',
      where: {
        op: 'and',
        args: [
          { op: 'eq', field: 'status', value: 'open' },
          { op: 'gte', field: 'risk', value: 3 },
        ],
      },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
  },
  views: {},
  rules: [{
    id: 'review-new-high-risk',
    trigger: { kind: 'query_transition', query: 'high-risk-open', transition: 'enter' },
    when: { '>': [{ var: 'query.after.total' }, { var: 'query.before.total' }] },
    effect: { kind: 'propose_operation', operation: 'request_review' },
    mode: 'suggest',
    maxRunsPerEvent: 4,
  }],
  capabilities: [],
  acceptanceTests: ['reactive-cycle-replay'],
};

const before = [
  { id: 'decision-a', collection: 'decisions', status: 'closed', risk: 4, revision: 1 },
  { id: 'unrelated', collection: 'notes', status: 'open', risk: 5, revision: 7 },
];
const after = [
  { id: 'decision-a', collection: 'decisions', status: 'open', risk: 4, revision: 2 },
  { id: 'unrelated', collection: 'notes', status: 'open', risk: 5, revision: 7 },
];
const input = {
  package: pkg,
  beforeRows: before,
  afterRows: after,
  event: { kind: 'operation' as const, id: 'op-open-decision-a' },
  causeId: 'action-open-decision-a',
};

const first = runReactiveCycle(input);
const replay = runReactiveCycle({
  ...input,
  beforeRows: [...before].reverse(),
  afterRows: [...after].reverse(),
});

assert.deepEqual(replay, first);
assert.equal(first.transitions.length, 1);
assert.deepEqual(first.transitions[0], {
  kind: 'query_transition',
  id: 'high-risk-open',
  transition: 'enter',
  addedIds: ['decision-a'],
  removedIds: [],
  changedIds: [],
});
assert.equal(first.proposals.length, 1, 'identical maxRuns proposals must dedupe');
assert.equal(first.proposals[0].operation, 'request_review');
assert.equal(first.proposals[0].causeId, 'action-open-decision-a');
assert.equal(first.proposals[0].envelope.schemaVersion, 'wonder.operation-proposal.v1');
assert.equal(first.proposals[0].envelope.proposalId, first.proposals[0].id);
assert.equal(first.proposals[0].envelope.operation, 'request_review');
assert.equal(first.proposals[0].envelope.review.required, true);
assert.equal(first.proposals[0].envelope.evidence.queryId, 'high-risk-open');
assert.equal(first.proposals[0].envelope.evidence.transition, 'enter');
assert.equal(first.proposals[0].envelope.evidence.beforeHash, first.queryHashes['high-risk-open'].before);
assert.equal(first.proposals[0].envelope.evidence.afterHash, first.queryHashes['high-risk-open'].after);
assert.match(first.proposals[0].envelope.evidence.querySpecHash ?? '', /^sha256:[a-f0-9]{64}$/);
assert.match(first.proposals[0].envelope.evidence.packageHash ?? '', /^sha256:[a-f0-9]{64}$/);
assert.equal(first.proposals[0].envelope.evidence.evaluatorVersion, 'wonder.query-evaluator.v1');
assert.equal(first.proposals[0].envelope.evidence.sourceEventId, 'op-open-decision-a');
assert.equal(first.proposals[0].envelope.evidence.beforeVersionVectorHash, undefined);
assert.equal(first.proposals[0].envelope.evidence.afterVersionVectorHash, undefined);

const colonQueryPackage: AppPackageV2 = {
  ...pkg,
  id: 'colon-query-package',
  queries: {
    'surface:home': pkg.queries['high-risk-open'],
  },
  rules: [{
    id: 'auto-home-review',
    trigger: { kind: 'query_transition', query: 'surface:home', transition: 'enter' },
    effect: { kind: 'propose_operation', operation: { kind: 'update_record', collection: 'decisions', recordId: 'decision-a', changes: { status: 'needs_review' } } },
    mode: 'automatic',
    maxRunsPerEvent: 1,
  }],
};
const colonCycle = runReactiveCycle({
  ...input,
  package: colonQueryPackage,
});
assert.equal(colonCycle.proposals.length, 1);
assert.equal(colonCycle.proposals[0].operation, 'update_record');
assert.deepEqual(colonCycle.proposals[0].operationTemplate, {
  kind: 'update_record',
  collection: 'decisions',
  recordId: 'decision-a',
  changes: { status: 'needs_review' },
});
assert.equal(colonCycle.proposals[0].envelope.event.queryId, 'surface:home');
assert.equal(colonCycle.proposals[0].envelope.event.transition, 'enter');
assert.equal(colonCycle.proposals[0].envelope.evidence.queryId, 'surface:home');
assert.equal(colonCycle.proposals[0].envelope.evidence.beforeHash, colonCycle.queryHashes['surface:home'].before);
assert.equal(colonCycle.proposals[0].envelope.evidence.afterHash, colonCycle.queryHashes['surface:home'].after);
assert.match(colonCycle.proposals[0].envelope.evidence.querySpecHash ?? '', /^sha256:[a-f0-9]{64}$/);
assert.match(colonCycle.proposals[0].envelope.evidence.packageHash ?? '', /^sha256:[a-f0-9]{64}$/);
assert.equal(colonCycle.proposals[0].envelope.evidence.evaluatorVersion, 'wonder.query-evaluator.v1');
assert.equal(colonCycle.proposals[0].envelope.evidence.sourceEventId, 'op-open-decision-a');
assert.equal(colonCycle.proposals[0].envelope.evidence.targetRecordId, 'decision-a');
assert.equal(colonCycle.proposals[0].envelope.evidence.targetBeforeRevision, 1);
assert.equal(colonCycle.proposals[0].envelope.evidence.targetAfterRevision, 2);
assert.equal(colonCycle.proposals[0].envelope.review.required, true);
assert.equal(colonCycle.proposals[0].envelope.review.reason, 'policy_required');
assert.equal(colonCycle.proposals[0].envelope.authorization.requiredCapability, 'reactive:auto:update_record');
assert.equal(colonCycle.proposals[0].envelope.authorization.capabilityPresent, false);
assert.equal(colonCycle.proposals[0].envelope.authorization.reviewRequired, true);
assert.equal(colonCycle.proposals[0].envelope.dryRun.executable, true);
assert.match(colonCycle.proposals[0].envelope.idempotencyKey, /^reactive:[a-f0-9]{64}$/);

const providerOwnedBefore = [
  { id: 'decision-a', collection: 'decisions', status: 'closed', risk: 4, revision: 1, source: { provider: 'notion' } },
];
const providerOwnedAfter = [
  { id: 'decision-a', collection: 'decisions', status: 'open', risk: 4, revision: 2, source: { provider: 'notion' } },
];
const providerBlockedCycle = runReactiveCycle({
  ...input,
  package: colonQueryPackage,
  beforeRows: providerOwnedBefore,
  afterRows: providerOwnedAfter,
  authorityProvider: 'notion',
});
assert.equal(providerBlockedCycle.proposals[0].envelope.authorization.allowed, false);
assert.equal(providerBlockedCycle.proposals[0].envelope.authorization.reason, 'provider_authority_capability_missing');
assert.deepEqual(providerBlockedCycle.proposals[0].envelope.authorization.providerAuthority, {
  targetProvider: 'notion',
  authorityProvider: 'notion',
  allowed: false,
  requiredCapability: 'reactive:provider:notion:update_record',
  capabilityPresent: false,
  reason: 'provider_authority_capability_missing',
});
assert.equal(providerBlockedCycle.proposals[0].envelope.dryRun.ok, false);

const providerAuthorizedCycle = runReactiveCycle({
  ...input,
  package: {
    ...colonQueryPackage,
    capabilities: ['reactive:provider:notion:update_record'],
  },
  beforeRows: providerOwnedBefore,
  afterRows: providerOwnedAfter,
  authorityProvider: 'notion',
});
assert.equal(providerAuthorizedCycle.proposals[0].envelope.authorization.allowed, true);
assert.equal(providerAuthorizedCycle.proposals[0].envelope.authorization.providerAuthority.allowed, true);
assert.equal(providerAuthorizedCycle.proposals[0].envelope.authorization.providerAuthority.capabilityPresent, true);
assert.equal(providerAuthorizedCycle.proposals[0].envelope.review.required, true);

const authorizedAutoCycle = runReactiveCycle({
  ...input,
  package: {
    ...colonQueryPackage,
    capabilities: ['reactive:auto:create_record'],
    rules: [{
      id: 'auto-create-low-risk',
      trigger: { kind: 'query_transition', query: 'surface:home', transition: 'enter' },
      effect: { kind: 'propose_operation', operation: { kind: 'create_record', collection: 'decisions', properties: { status: 'queued', risk: 1 } } },
      mode: 'automatic',
      maxRunsPerEvent: 1,
    }],
  },
});
assert.equal(authorizedAutoCycle.proposals[0].envelope.authorization.allowed, true);
assert.equal(authorizedAutoCycle.proposals[0].envelope.authorization.capabilityPresent, true);
assert.equal(authorizedAutoCycle.proposals[0].envelope.review.required, false);
assert.equal(authorizedAutoCycle.proposals[0].envelope.review.reason, 'policy_authorized');
assert.equal(authorizedAutoCycle.proposals[0].envelope.dryRun.ok, true);
assert.equal(authorizedAutoCycle.proposals[0].envelope.dryRun.executable, true);

const noChange = runReactiveCycle({
  ...input,
  beforeRows: after,
  afterRows: after,
});
assert.equal(noChange.transitions.length, 0);
assert.equal(noChange.proposals.length, 0);

const computedPackage: AppPackageV2 = {
  ...pkg,
  id: 'computed-decision-ledger',
  computedFields: [{
    id: 'needs_review',
    collection: 'decisions',
    dependsOn: [],
    expression: {
      and: [
        { '==': [{ var: 'record.status' }, 'open'] },
        { '>=': [{ var: 'record.risk' }, 3] },
      ],
    },
  }],
  queries: {
    'computed-review-queue': {
      from: 'decisions',
      where: { op: 'eq', field: 'needs_review', value: true },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
  },
  rules: [{
    id: 'review-computed-risk',
    trigger: { kind: 'query_transition', query: 'computed-review-queue', transition: 'enter' },
    effect: { kind: 'propose_operation', operation: 'request_computed_review' },
    mode: 'suggest',
    maxRunsPerEvent: 1,
  }],
};
const computedBefore = [
  Object.freeze({ id: 'decision-computed', collection: 'decisions', status: 'closed', risk: 4 }),
];
const computedAfter = [
  Object.freeze({ id: 'decision-computed', collection: 'decisions', status: 'open', risk: 4 }),
];
const computedCycle = runReactiveCycle({
  package: computedPackage,
  beforeRows: computedBefore,
  afterRows: computedAfter,
  event: { kind: 'operation', id: 'op-computed' },
  causeId: 'action-computed',
});
assert.equal(computedCycle.transitions[0]?.id, 'computed-review-queue');
assert.equal(computedCycle.transitions[0]?.transition, 'enter');
assert.equal(computedCycle.proposals[0]?.operation, 'request_computed_review');
assert.deepEqual(computedBefore[0], {
  id: 'decision-computed',
  collection: 'decisions',
  status: 'closed',
  risk: 4,
});
assert.deepEqual(computedAfter[0], {
  id: 'decision-computed',
  collection: 'decisions',
  status: 'open',
  risk: 4,
});

console.log('reactive-cycle-replay: passed');
