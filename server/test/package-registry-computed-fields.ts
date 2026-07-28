import assert from 'node:assert/strict';

import type { ComputedFieldSpec } from '../src/kernel/computed-fields';
import { PackageRegistry } from '../src/kernel/package-registry';
import type { AppPackageV2 } from '../src/kernel/package';

const base: AppPackageV2 = {
  schemaVersion: 'wonder.app-package.v2',
  id: 'computed-package',
  version: '1.0.0',
  collections: {
    projects: { id: 'projects', fields: {} },
  },
  queries: {},
  views: {},
  rules: [],
  capabilities: [],
  acceptanceTests: [],
};

function packageWith(computedFields: ComputedFieldSpec[]): AppPackageV2 {
  return { ...base, computedFields };
}

const registry = new PackageRegistry();
const valid = packageWith([
  {
    id: 'risk',
    collection: 'projects',
    dependsOn: ['score'],
    expression: { var: 'computed.score' },
  },
  {
    id: 'score',
    collection: 'projects',
    dependsOn: [],
    expression: 1,
  },
]);
assert.equal(registry.preview(valid).valid, true);
assert.equal(registry.activate(valid).id, base.id);

const missing = registry.preview(packageWith([{
  id: 'risk',
  collection: 'projects',
  dependsOn: ['score'],
  expression: { var: 'computed.score' },
}]));
assert.deepEqual(missing, {
  valid: false,
  errors: ['computed_field_dependency_missing:risk:score'],
});
assert.throws(
  () => registry.activate(packageWith([{
    id: 'risk',
    collection: 'projects',
    dependsOn: ['score'],
    expression: null,
  }])),
  /package_invalid:computed_field_dependency_missing:risk:score/,
);
assert.equal(registry.getActive()?.id, base.id, 'failed activation must preserve the active package');

const cycle = registry.preview(packageWith([
  { id: 'a', collection: 'projects', dependsOn: ['b'], expression: 1 },
  { id: 'b', collection: 'projects', dependsOn: ['a'], expression: 1 },
]));
assert.deepEqual(cycle, {
  valid: false,
  errors: ['computed_field_cycle:a,b'],
});

const tooManyFields = registry.preview(packageWith(
  Array.from({ length: 129 }, (_, index) => ({
    id: `field_${index}`,
    collection: 'projects',
    dependsOn: [],
    expression: index,
  })),
));
assert.deepEqual(tooManyFields, {
  valid: false,
  errors: ['computed_field_budget_exceeded'],
});

const tooManyEdges = registry.preview(packageWith(
  Array.from({ length: 33 }, (_, index) => ({
    id: `edge_${index}`,
    collection: 'projects',
    dependsOn: Array.from({ length: index }, (__, dependency) => `edge_${dependency}`),
    expression: index,
  })),
));
assert.deepEqual(tooManyEdges, {
  valid: false,
  errors: ['computed_field_dependency_budget_exceeded'],
});

const oversizedExpression = registry.preview(packageWith([{
  id: 'oversized',
  collection: 'projects',
  dependsOn: [],
  expression: { and: Array.from({ length: 300 }, () => true) },
}]));
assert.deepEqual(oversizedExpression, {
  valid: false,
  errors: ['expression_budget_exceeded'],
});

console.log('package-registry-computed-fields: passed');
