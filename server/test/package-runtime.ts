import assert from 'node:assert/strict';
import { evaluatePackage } from '../src/kernel/runtime';
import { validateAppPackage } from '../src/kernel/package';

const candidate = {
  schemaVersion: 'wonder.app-package.v2' as const,
  id: 'flight-control',
  version: '1.0.0',
  collections: {
    flights: { id: 'flights', fields: { status: { type: 'text' as const }, gate: { type: 'text' as const } } },
  },
  queries: {
    delayed: { from: 'flights', where: { op: 'eq' as const, field: 'status', value: 'delayed' }, orderBy: [{ field: 'gate' as const }], limit: 10 },
  },
  views: {
    board: { id: 'board', query: 'delayed', mode: 'board' as const, fields: ['gate', 'status'], groupBy: 'gate' },
  },
  rules: [],
  capabilities: [],
  acceptanceTests: [],
};

const checked = validateAppPackage(candidate);
if (!checked.valid) throw new Error('package rejected');

const result = evaluatePackage({
  package: checked.package,
  collections: {
    flights: [
      { id: 'f2', status: 'delayed', gate: 'B' },
      { id: 'f1', status: 'on_time', gate: 'A' },
      { id: 'f3', status: 'delayed', gate: 'A' },
    ],
  },
});

assert.deepEqual(result.queries.delayed.rows.map((row) => row.id), ['f3', 'f2']);
assert.deepEqual(Object.keys(result.views.board.groups ?? {}), ['A', 'B']);
assert.equal(result.views.board.provenance, 'flight-control@1.0.0/query:delayed');
console.log('package-runtime: passed');
