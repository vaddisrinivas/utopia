import assert from 'node:assert/strict';

import type { AppPackageV2 } from '../src/kernel/package';
import { runLivingRuleWorker } from '../src/kernel/living-rule-worker';

const foodPackage: AppPackageV2 = {
  schemaVersion: 'wonder.app-package.v2',
  id: 'food',
  version: '1.0.0',
  collections: {
    inventory: {
      id: 'inventory',
      fields: {
        status: { type: 'text' },
      },
    },
    meal_plan: {
      id: 'meal_plan',
      fields: {
        status: { type: 'text' },
      },
    },
    shopping_list: {
      id: 'shopping_list',
      fields: {
        status: { type: 'text' },
      },
    },
  },
  queries: {
    'food:inventory-use-soon': {
      from: 'inventory',
      where: { op: 'eq', field: 'properties.status', value: 'use soon' },
    },
    'food:inventory-expired': {
      from: 'inventory',
      where: { op: 'eq', field: 'properties.status', value: 'expired' },
    },
  },
  views: {},
  rules: [
    {
      id: 'food-propose-dinner-help',
      trigger: { kind: 'query_transition', query: 'food:inventory-use-soon', transition: 'enter' },
      when: {
        and: [
          { '==': [{ var: 'query.before.total' }, 0] },
          { '>': [{ var: 'query.after.total' }, 0] },
        ],
      },
      effect: {
        kind: 'propose_operation',
        operation: {
          kind: 'update_record',
          collection: 'meal_plan',
          recordId: 'food-dinner-help',
          changes: {
            status: 'dinner-help',
          },
        },
      },
      mode: 'suggest',
      maxRunsPerEvent: 1,
    },
    {
      id: 'food-propose-shopping-help',
      trigger: { kind: 'query_transition', query: 'food:inventory-expired', transition: 'enter' },
      when: {
        and: [
          { '==': [{ var: 'query.before.total' }, 0] },
          { '>': [{ var: 'query.after.total' }, 0] },
        ],
      },
      effect: {
        kind: 'propose_operation',
        operation: {
          kind: 'update_record',
          collection: 'shopping_list',
          recordId: 'food-shopping-help',
          changes: {
            status: 'need-shopping-help',
          },
        },
      },
      mode: 'suggest',
      maxRunsPerEvent: 1,
    },
  ],
  capabilities: [],
  acceptanceTests: ['living-rule-worker'],
};

const beforeRows = [
  { id: 'meal-help', collection: 'meal_plan', properties: { status: 'ready' }, revision: 1 },
  { id: 'shopping-help', collection: 'shopping_list', properties: { status: 'ready' }, revision: 1 },
  { id: 'milk', collection: 'inventory', properties: { status: 'fresh', body: 'plain' }, revision: 1 },
];

const useSoonAfterRows = [
  beforeRows[0],
  beforeRows[1],
  { id: 'milk', collection: 'inventory', properties: { status: 'use soon', body: 'plain' }, revision: 2 },
];

const expiredAfterRows = [
  beforeRows[0],
  beforeRows[1],
  { id: 'milk', collection: 'inventory', properties: { status: 'expired', body: 'plain' }, revision: 3 },
];

const unchangedAfterRows = [
  beforeRows[0],
  beforeRows[1],
  { id: 'milk', collection: 'inventory', properties: { status: 'use soon', body: 'freshly updated' }, revision: 2 },
];

const useSoonCycle = runLivingRuleWorker({
  package: foodPackage,
  beforeRows,
  afterRows: useSoonAfterRows,
  event: { kind: 'operation', id: 'op-inventory-use-soon' },
  causeId: 'cause-inventory-use-soon',
  data: {
    source: 'food-utopia-rule-worker',
  },
});

assert.equal(useSoonCycle.proposals.length, 1);
assert.equal(useSoonCycle.proposals[0]!.operation, 'update_record');
assert.equal(useSoonCycle.proposals[0]!.mode, 'suggest');
assert.equal(useSoonCycle.proposals[0]!.envelope.operationTemplate.kind, 'update_record');
if (useSoonCycle.proposals[0]!.envelope.operationTemplate.kind === 'update_record') {
  assert.equal(useSoonCycle.proposals[0]!.envelope.operationTemplate.recordId, 'food-dinner-help');
}
assert.match(useSoonCycle.proposals[0]!.envelope.idempotencyKey, /^reactive:[a-f0-9]{64}$/);

const useSoonReplay = runLivingRuleWorker({
  package: foodPackage,
  beforeRows: [...beforeRows].reverse(),
  afterRows: [...useSoonAfterRows].reverse(),
  event: { kind: 'operation', id: 'op-inventory-use-soon' },
  causeId: 'cause-inventory-use-soon',
  data: {
    source: 'food-utopia-rule-worker',
  },
});

assert.equal(useSoonReplay.proposals[0]!.id, useSoonCycle.proposals[0]!.id);
assert.equal(useSoonReplay.proposals[0]!.envelope.idempotencyKey, useSoonCycle.proposals[0]!.envelope.idempotencyKey);

const expireCycle = runLivingRuleWorker({
  package: foodPackage,
  beforeRows: useSoonAfterRows,
  afterRows: expiredAfterRows,
  event: { kind: 'operation', id: 'op-inventory-expired' },
  causeId: 'cause-inventory-expired',
  data: {
    source: 'food-utopia-rule-worker',
  },
});

assert.equal(expireCycle.proposals.length, 1);
assert.equal(expireCycle.proposals[0]!.envelope.operationTemplate.kind, 'update_record');
if (expireCycle.proposals[0]!.envelope.operationTemplate.kind === 'update_record') {
  assert.equal(expireCycle.proposals[0]!.envelope.operationTemplate.recordId, 'food-shopping-help');
}

const unchangedCycle = runLivingRuleWorker({
  package: foodPackage,
  beforeRows: useSoonAfterRows,
  afterRows: unchangedAfterRows,
  event: { kind: 'operation', id: 'op-inventory-no-query-change' },
  causeId: 'cause-inventory-no-query-change',
});

assert.equal(unchangedCycle.proposals.length, 0);
assert.equal(beforeRows[0]!.properties?.status, 'ready');
assert.equal(beforeRows[1]!.properties?.status, 'ready');
assert.equal(beforeRows[2]!.properties?.status, 'fresh');

const firstProposalContext = useSoonCycle.proposals[0]!.envelope;
assert.equal(firstProposalContext.review.required, true);
assert.equal(firstProposalContext.review.reason, 'suggest_mode');
assert.equal(useSoonCycle.proposals[0]!.envelope.evidence.queryId, 'food:inventory-use-soon');
assert.equal(useSoonCycle.proposals[0]!.envelope.evidence.transition, 'enter');

console.log('living-rule-worker: passed');
