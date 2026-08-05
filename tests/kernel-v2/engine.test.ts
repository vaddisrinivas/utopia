import { describe, expect, it } from 'vitest';

import { computedRecords, evaluateExpression, executeQuery, matches, recurrence, workflow } from '@/src/kernel/engine';
import type { JsonRecord } from '@/src/kernel/runtime';

import { fixtureActivePackage, fixturePackages } from './v3-fixtures';

const row = (id: string, score: number, status = 'open'): JsonRecord => ({ id, collection: 'person', createdAt: '', updatedAt: `2026-01-0${score}`, values: { score, status, title: id } });
const packages = fixturePackages();

const budgetFixture = fixtureActivePackage();
budgetFixture.queries = {
  ...budgetFixture.queries,
  budget: { from: 'budget_line', orderBy: [{ field: 'name', direction: 'asc' }] },
};
budgetFixture.collections = {
  ...budgetFixture.collections,
  budget_line: {
    id: 'budget_line',
    fields: {
      planned: { type: 'number' },
      actual: { type: 'number' },
      start: { type: 'text' },
      end: { type: 'text' },
    },
  },
};
budgetFixture.views = {
  ...budgetFixture.views,
  budget: { id: 'budget', query: 'budget', mode: 'list', fields: ['planned', 'actual'] },
};
budgetFixture.computedFields = [
  { id: 'variance', collection: 'budget_line', expression: { '-': [{ var: 'record.actual' }, { var: 'record.planned' }] } },
  { id: 'remaining', collection: 'budget_line', expression: { '-': [{ var: 'record.planned' }, { var: 'record.actual' }] } },
];

describe('bounded query engine', () => {
  it('evaluates nested predicates fail-closed', () => {
    const record = row('one', 3);
    expect(matches(record, { op: 'and', args: [{ op: 'gte', field: 'score', value: 3 }, { op: 'eq', field: 'status', value: 'open' }] })).toBe(true);
    expect(matches(record, { op: 'unknown', field: 'score', value: 3 })).toBe(false);
  });

  it('filters, sorts, and limits package queries', () => {
    const pkg = structuredClone(packages[0]);
    pkg.queries.people = { from: 'person', where: { op: 'gte', field: 'score', value: 2 }, orderBy: [{ field: 'score', direction: 'desc' }], limit: 2 };
    expect(executeQuery(pkg, { records: [row('a', 1), row('b', 2), row('c', 3)] }, 'people').map((item) => item.id)).toEqual(['c', 'b']);
  });
});

describe('library engines', () => {
  it('expands RFC recurrence rules', () => {
    expect(recurrence('DTSTART:20260101T000000Z\nRRULE:FREQ=DAILY;COUNT=3', new Date('2026-01-01T00:00:00Z'))).toHaveLength(3);
  });

  it('runs declarative XState workflows', () => {
    const flow = workflow({ initial: 'idle', states: { idle: { on: { START: 'running' } }, running: { on: { STOP: 'idle' } } } });
    expect(flow.initial()).toBe('idle');
    expect(flow.transition('idle', 'START')).toBe('running');
  });
});

describe('current-main expression parity', () => {
  it('evaluates computed dependencies and date differences', () => {
    const pkg = structuredClone(budgetFixture);
    const state = { records: [{ id: 'line', collection: 'budget_line', createdAt: '', updatedAt: '', values: { planned: 100, actual: 35 } }] };
    expect(computedRecords(pkg, state).at(0)?.values).toMatchObject({ variance: -65, remaining: 65 });
    expect(evaluateExpression({ date_diff: {
      start: { var: 'record.start' }, end: { var: 'record.end' }, unit: 'days',
      inputKind: 'date', timezone: 'UTC', onMissing: 'error', onInvalid: 'error', onEndBeforeStart: 'error',
    } }, { record: { start: '2026-08-01', end: '2026-08-04' } })).toBe(3);
  });

  it('evaluates grouped values, transfers, allocations, and recurrence', () => {
    const context = { record: { id: 'a', total: 100 }, queries: { shares: { rows: [
      { member: 'a', paid: 80, owed: 50, weight: 1 }, { member: 'b', paid: 20, owed: 50, weight: 3 },
    ] } } };
    expect(evaluateExpression({ group_sum: { rows: { var: 'queries.shares.rows' }, groupBy: 'member', equals: { var: 'record.id' }, value: 'paid' } }, context)).toBe(80);
    expect(evaluateExpression({ balance_transfers: { rows: { var: 'queries.shares.rows' }, participant: 'member', paid: 'paid', owed: 'owed' } }, context)).toEqual([{ from: 'b', to: 'a', amount: '30' }]);
    expect(evaluateExpression({ allocate_weighted: { rows: { var: 'queries.shares.rows' }, key: 'member', weight: 'weight', total: { var: 'record.total' } } }, context)).toMatchObject([{ key: 'a', amount: '25' }, { key: 'b', amount: '75' }]);
    expect(evaluateExpression({ recurrence_next: { schedule: { frequency: 'daily', interval: 1 }, after: '2026-08-01T00:00:00.000Z' } }, context)).toBe('2026-08-02T00:00:00.000Z');
  });
});
