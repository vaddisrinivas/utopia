import { describe, expect, it } from 'vitest';

import type { DomainRecordViewModel } from '@/src/domain/renderer';
import { queryChartResult, queryMetricResult, resolveDataBinding } from '@/src/presentation/widgets/query-visualization';

const records: DomainRecordViewModel[] = [
  view('one', 'Jan', 12, 'alpha'),
  view('two', 'Jan', -4, 'beta'),
  view('three', 'Feb', 8, 'gamma'),
];

describe('query visualization binding', () => {
  it('aggregates computed numeric fields for a metric', () => {
    const binding = resolveDataBinding({ source: 'query-aggregate', aggregate: 'sum', valueField: 'computed.total' }, undefined);
    const result = queryMetricResult(records, binding);

    expect(result).toEqual({ state: 'ready', value: 16 });
  });

  it('groups query records into chart points using a computed field', () => {
    const binding = resolveDataBinding({
      source: 'query-aggregate',
      aggregate: 'sum',
      groupBy: 'month',
      valueField: 'computed.total',
      labelField: 'month',
    }, undefined);
    const result = queryChartResult(records, binding);

    expect(result).toEqual({
      state: 'ready',
      points: [
        { label: 'Jan', value: 8 },
        { label: 'Feb', value: 8 },
      ],
    });
  });

  it('maps query records directly to points', () => {
    const binding = resolveDataBinding({ source: 'query-records', xField: 'month', yField: 'computed.total' }, undefined);

    expect(queryChartResult(records, binding)).toEqual({
      state: 'ready',
      points: [
        { label: 'Jan', value: 12 },
        { label: 'Jan', value: -4 },
        { label: 'Feb', value: 8 },
      ],
    });
  });

  it('fails closed with loading, empty, and invalid-data states', () => {
    const binding = resolveDataBinding({ source: 'query-aggregate', aggregate: 'sum', valueField: 'computed.total' }, undefined);

    expect(queryMetricResult(records, binding, 'loading')).toEqual({ state: 'loading' });
    expect(queryMetricResult([], binding)).toEqual({ state: 'ready', message: 'No values yet.' });
    expect(queryMetricResult([
      view('bad', 'Mar', 'not-a-number', 'bad'),
    ], binding)).toEqual({
      state: 'error',
      message: 'Aggregate field computed.total contains a non-numeric value.',
    });
    expect(queryChartResult(records, resolveDataBinding({ source: 'query-records', xField: 'month' }, undefined))).toEqual({
      state: 'error',
      message: 'Invalid visualization data binding.',
    });
  });
});

function view(id: string, month: string, total: number | string, label: string): DomainRecordViewModel {
  return {
    id,
    collection: 'entry',
    title: label,
    body: '',
    source: 'sqlite',
    status: 'Active',
    tone: 'neutral',
    meta: '',
    properties: {
      month,
      computed: { total },
    },
  };
}
