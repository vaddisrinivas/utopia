import assert from 'node:assert/strict';
import { detectQueryTransitions } from '../src/kernel/query-transition';
import { evaluateRules } from '../src/kernel/rules';

const before = { rows: [{ id: 'a', status: 'open' }], total: 1, offset: 0, limit: null, resultHash: 'before' };
const after = { rows: [{ id: 'a', status: 'done' }, { id: 'b', status: 'open' }], total: 2, offset: 0, limit: null, resultHash: 'after' };
const events = detectQueryTransitions('open-items', before, after);
assert.deepEqual(events.map((event) => [event.transition, event.changedIds, event.addedIds]), [
  ['enter', [], ['b']],
  ['change', ['a'], []],
]);

const rules = [{
  id: 'notify-new',
  trigger: { kind: 'query_transition' as const, query: 'open-items', transition: 'enter' as const },
  effect: { kind: 'propose_operation' as const, operation: 'notify' },
  mode: 'suggest' as const,
  maxRunsPerEvent: 1,
}];
const proposals = evaluateRules(rules, {
  event: events[0], data: { id: 'b' }, packageVersion: '1.0.0', causeId: 'cause-1', depth: 0,
});
assert.equal(proposals.length, 1);
assert.equal(proposals[0].operation, 'notify');
console.log('query-transition: passed');
