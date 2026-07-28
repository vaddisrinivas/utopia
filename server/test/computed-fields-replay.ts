import assert from 'node:assert/strict';

import {
  applyComputedFieldsToRows,
  createComputedFieldEvaluationContext,
  evaluateComputedFields,
  type ComputedFieldSpec,
} from '../src/kernel/computed-fields';
import { validateAppPackage, type AppPackageV2 } from '../src/kernel/package';
import { evaluatePackage } from '../src/kernel/runtime';

const specs: ComputedFieldSpec[] = [
  {
    id: 'risk_label',
    collection: 'projects',
    dependsOn: ['remaining_pct'],
    expression: { if: [{ '>=': [{ var: 'computed.remaining_pct' }, 50] }, 'high', 'normal'] },
  },
  {
    id: 'remaining_pct',
    collection: 'projects',
    dependsOn: ['open_count'],
    expression: { '*': [{ var: 'computed.open_count' }, 25] },
  },
  {
    id: 'open_count',
    collection: 'projects',
    dependsOn: [],
    expression: { var: 'queries.open_tasks.total' },
  },
];

const queries = {
  open_tasks: {
    from: 'tasks',
    where: { op: 'eq' as const, field: 'status', value: 'open' as const },
    orderBy: [{ field: 'id', direction: 'asc' as const }],
  },
};
const rows = [
  { id: 'task-b', collection: 'tasks', status: 'done' },
  { id: 'task-a', collection: 'tasks', status: 'open' },
  { id: 'task-c', collection: 'tasks', status: 'open' },
  { id: 'noise', collection: 'notes', status: 'open' },
];
const record = Object.freeze({ id: 'project-1', collection: 'projects', title: 'Launch' });
const input = { specs, record, rows, queries };

const packageWithComputedFields: AppPackageV2 = {
  schemaVersion: 'wonder.app-package.v2',
  id: 'project-ops',
  version: '1.0.0',
  collections: {
    projects: { id: 'projects', fields: {} },
    tasks: { id: 'tasks', fields: { status: { type: 'text', indexed: true } } },
  },
  queries: {
    ...queries,
    high_risk_projects: { from: 'projects', where: { op: 'eq', field: 'risk_label', value: 'high' } },
  },
  views: { risk: { id: 'risk', query: 'high_risk_projects', mode: 'list', fields: ['id', 'risk_label'] } },
  computedFields: specs,
  rules: [],
  capabilities: [],
  acceptanceTests: ['computed-fields-replay'],
};
assert.equal(validateAppPackage(packageWithComputedFields).valid, true);
const runtime = evaluatePackage({
  package: packageWithComputedFields,
  collections: {
    projects: [record],
    tasks: rows,
  },
});
assert.deepEqual(runtime.views.risk.rows, [{ id: 'project-1', risk_label: 'high' }]);

const first = evaluateComputedFields(input);
const replay = evaluateComputedFields({
  ...input,
  specs: [...specs].reverse(),
  rows: [...rows].reverse(),
});

assert.deepEqual(replay, first);
assert.deepEqual(first.order, ['open_count', 'remaining_pct', 'risk_label']);
assert.deepEqual(first.values, {
  open_count: 2,
  remaining_pct: 50,
  risk_label: 'high',
});
assert.deepEqual(record, { id: 'project-1', collection: 'projects', title: 'Launch' });

assert.throws(() => evaluateComputedFields({
  record,
  specs: [
    { id: 'a', collection: 'projects', dependsOn: ['b'], expression: { var: 'computed.b' } },
    { id: 'b', collection: 'projects', dependsOn: ['a'], expression: { var: 'computed.a' } },
  ],
}), /computed_field_cycle:a,b/);

assert.throws(() => evaluateComputedFields({
  record,
  specs,
  rows,
  queries,
  budget: { maxFields: 2 },
}), /computed_field_budget_exceeded/);

assert.throws(() => evaluateComputedFields({
  record,
  specs: [{ id: 'huge', collection: 'projects', dependsOn: [], expression: { and: [true, true, true] } }],
  budget: { maxExpressionNodes: 2 },
}), /expression_budget_exceeded/);

const cachedRows = applyComputedFieldsToRows(
  [
    { id: 'project-b', collection: 'projects' },
    { id: 'project-a', collection: 'projects' },
    { id: 'project-c', collection: 'projects' },
  ],
  specs,
  queries,
  rows,
  createComputedFieldEvaluationContext({ maxQueryEvaluations: 1 }),
);
assert.deepEqual(cachedRows.map((row) => [row.id, row.open_count]), [
  ['project-b', 2],
  ['project-a', 2],
  ['project-c', 2],
]);

const tightContext = createComputedFieldEvaluationContext({ maxQueryEvaluations: 1 });
evaluateComputedFields({ ...input, context: tightContext });
assert.throws(() => evaluateComputedFields({
  ...input,
  rows: [...rows, { id: 'task-d', collection: 'tasks', status: 'open' }],
  context: tightContext,
}), /computed_field_query_evaluation_budget_exceeded/);

console.log('computed-fields-replay: passed');
