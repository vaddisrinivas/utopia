import { describe, expect, it } from 'vitest';

import { computedRecords, evaluateExpression, sortComputedFields } from '@/src/kernel/computed';
import { fixtureActivePackage } from './v3-fixtures';

describe('computed field dependency and arithmetic correctness', () => {
  it('orders explicit and inferred dependencies and detects cycles', () => {
    const pkg = fixtureActivePackage();
    const state = { records: [{ id: 'r1', collection: 'item', createdAt: '', updatedAt: '', values: { base: 10 } }] };

    pkg.computedFields = [
      { id: 'total', collection: 'item', dependsOn: ['tax'], expression: { '+': [{ var: 'record.tax' }, { var: 'record.tip' }] } },
      { id: 'tax', collection: 'item', dependsOn: ['base'], expression: { '*': [{ var: 'record.base' }, 0.2] } },
      { id: 'tip', collection: 'item', expression: { '+': [{ var: 'record.tax' }, { var: 'record.base' }] } },
      { id: 'base', collection: 'item', dependsOn: [], expression: { var: 'record.base' } },
    ];

    const ordered = sortComputedFields(pkg.computedFields);
    expect(ordered.map((item) => item.id)).toEqual(['base', 'tax', 'tip', 'total']);
    expect(computedRecords(pkg, state).at(0)?.values.total).toBe('14');

    pkg.computedFields[0].dependsOn = ['total'];
    expect(() => sortComputedFields(pkg.computedFields)).toThrow('computed_field_cycle');
  });

  it('performs exact decimal group_sum and balance allocation', () => {
    const context = {
      record: { id: 'r1', total: '1.00' },
      queries: {
        rows: {
          rows: [
            { member: 'a', paid: '0.10' },
            { member: 'a', paid: 0.20 },
            { member: 'a', paid: '0.30' },
            { member: 'b', paid: '0.40' },
          ],
        },
      },
    };

    expect(evaluateExpression({ group_sum: { rows: { var: 'queries.rows.rows' }, groupBy: 'member', equals: 'a', value: 'paid' } }, context)).toBe('0.6');
    expect(evaluateExpression({
      allocate_weighted: {
        rows: { var: 'queries.rows.rows' },
        key: 'member',
        weight: 'paid',
        total: { var: 'record.total' },
      },
    }, context)).toEqual([
      { member: 'a', paid: '0.1', amount: '0.1' },
      { member: 'a', paid: '0.2', amount: '0.2' },
      { member: 'a', paid: '0.3', amount: '0.3' },
      { member: 'b', paid: '0.4', amount: '0.4' },
    ]);
  });
});
