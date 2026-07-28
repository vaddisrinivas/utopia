import assert from 'node:assert/strict';
import { evaluateRules } from '../src/kernel/rules';

const rules = [{
  id: 'high-risk-review',
  trigger: { kind: 'operation' as const },
  when: { ">=": [{ var: 'risk' }, 3] },
  effect: { kind: 'propose_operation' as const, operation: 'request_review' },
  mode: 'suggest' as const,
  maxRunsPerEvent: 1,
}];

const proposals = evaluateRules(rules, {
  event: { kind: 'operation', id: 'op-1' },
  data: { risk: 4 },
  packageVersion: '1.0.0',
  causeId: 'action-1',
  depth: 0,
});
assert.deepEqual(proposals, [{
  ruleId: 'high-risk-review',
  operation: 'request_review',
  operationTemplate: { kind: 'custom', tool: 'request_review' },
  mode: 'suggest',
  causeId: 'action-1',
  packageVersion: '1.0.0',
  depth: 0,
  event: { kind: 'operation', id: 'op-1' },
}]);
assert.equal(evaluateRules(rules, { event: { kind: 'schedule', id: 'nightly' }, data: { risk: 4 }, packageVersion: '1.0.0', causeId: 'a', depth: 0 }).length, 0);
console.log('rule-engine: passed');
