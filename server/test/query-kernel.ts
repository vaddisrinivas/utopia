import assert from 'node:assert/strict';
import { executeQuery } from '../src/kernel/query';
import { evaluateExpression } from '../src/kernel/expression';

const rows = [
  { id: 'b', state: 'open', score: 2, owner: { name: 'Bo' } },
  { id: 'a', state: 'closed', score: 5, owner: { name: 'Al' } },
  { id: 'c', state: 'open', score: 8, owner: { name: 'Cy' } },
];

const result = executeQuery(rows, {
  from: 'decisions',
  where: { op: 'eq', field: 'state', value: 'open' },
  orderBy: [{ field: 'score', direction: 'desc' }],
  project: ['id', 'score'],
  provenance: 'decision-ledger.open.v1',
});

assert.deepEqual(result.rows, [{ id: 'c', score: 8 }, { id: 'b', score: 2 }]);
assert.equal(result.total, 2);
assert.equal(result.provenance, 'decision-ledger.open.v1');
assert.equal(result.resultHash, executeQuery(rows, {
  from: 'decisions',
  where: { op: 'eq', field: 'state', value: 'open' },
  orderBy: [{ field: 'score', direction: 'desc' }],
  project: ['id', 'score'],
}).resultHash);
assert.equal(evaluateExpression({ decision: { risk: 4, title: 'Rotate key' } }, {
  and: [
    { ">=": [{ var: 'decision.risk' }, 3] },
    { '==': [{ var: 'decision.title' }, 'Rotate key'] },
  ],
}), true);

const conformanceRows = [
  { id: 'b', value: null, label: '100% real', rank: 1 },
  { id: 'a', label: '100x real', rank: 1 },
  { id: 'c', value: 'present', label: '100_percent', rank: 1 },
];
assert.deepEqual(executeQuery(conformanceRows, {
  from: 'records',
  where: { op: 'exists', field: 'value' },
}).rows.map((row) => row.id), ['c'], 'exists must match SQL IS NOT NULL semantics');
assert.deepEqual(executeQuery(conformanceRows, {
  from: 'records',
  where: { op: 'exists', field: 'value', value: false },
}).rows.map((row) => row.id), ['b', 'a'], 'exists false must include null and missing fields');
assert.deepEqual(executeQuery(conformanceRows, {
  from: 'records',
  where: { op: 'not', arg: { op: 'eq', field: 'value', value: 'present' } },
}).rows.map((row) => row.id), ['b', 'a'], 'not must invert predicate');
assert.throws(() => executeQuery(rows, {
  from: 'records',
  where: {
    // @ts-expect-error exercise unsupported operator failure
    op: 'contains_any',
    field: 'state',
    value: 'open',
  },
}), /unsupported_query_predicate/);
assert.deepEqual(executeQuery(conformanceRows, {
  from: 'records',
  where: { op: 'eq', field: 'value', value: null },
}).rows.map((row) => row.id), ['b']);
assert.deepEqual(executeQuery(conformanceRows, {
  from: 'records',
  orderBy: [{ field: 'rank' }],
}).rows.map((row) => row.id), ['a', 'b', 'c'], 'sort ties must be deterministic by id');
console.log('query-kernel: passed');
