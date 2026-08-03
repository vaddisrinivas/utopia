import type { PresentationAggregate, PresentationDataBinding } from '@/packages/shared/contracts/package';
import type { DomainRecordViewModel } from '@/src/domain/renderer';

export type QueryVisualizationPoint = {
  label: string;
  value: number;
};

export type QueryVisualizationResult = {
  state: 'loading' | 'ready' | 'error';
  value?: number;
  points?: QueryVisualizationPoint[];
  message?: string;
};

export type ResolvedDataBinding = PresentationDataBinding | { source: 'invalid'; message: string };

export function resolveDataBinding(
  componentBinding: unknown,
  propsBinding: unknown,
): ResolvedDataBinding | null {
  const candidate = componentBinding ?? propsBinding;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const raw = candidate as Record<string, unknown>;
  if (raw.source === 'query-records' && isText(raw.xField) && isText(raw.yField)) {
    return { source: 'query-records', xField: raw.xField, yField: raw.yField };
  }
  if (raw.source === 'query-aggregate' && isAggregate(raw.aggregate)) {
    return {
      source: 'query-aggregate',
      aggregate: raw.aggregate,
      ...(isText(raw.valueField) ? { valueField: raw.valueField } : {}),
      ...(isText(raw.groupBy) ? { groupBy: raw.groupBy } : {}),
      ...(isText(raw.labelField) ? { labelField: raw.labelField } : {}),
    };
  }
  return { source: 'invalid', message: 'Invalid visualization data binding.' };
}

export function queryMetricResult(
  records: readonly DomainRecordViewModel[],
  binding: ResolvedDataBinding | null,
  state: 'loading' | 'ready' | 'error' = 'ready',
  errorMessage?: string,
): QueryVisualizationResult {
  if (state === 'loading') return { state };
  if (state === 'error') return { state, message: errorMessage ?? 'Unable to load data.' };
  if (!binding) return { state, value: records.length };
  if (binding.source === 'invalid') return { state: 'error', message: binding.message };
  if (binding.source !== 'query-aggregate') {
    return { state: 'error', message: 'This metric requires an aggregate data binding.' };
  }
  if (binding.groupBy) {
    return { state: 'error', message: 'Grouped aggregate data belongs in a chart.' };
  }
  if (binding.aggregate === 'count') return { state, value: records.length };
  if (!binding.valueField) return { state: 'error', message: 'Aggregate value field is missing.' };
  const values = numericValues(records, binding.valueField);
  if (values.error) return { state: 'error', message: values.error };
  if (!values.values.length) return { state, message: 'No values yet.' };
  return { state, value: aggregate(values.values, binding.aggregate) };
}

export function queryChartResult(
  records: readonly DomainRecordViewModel[],
  binding: ResolvedDataBinding | null,
  state: 'loading' | 'ready' | 'error' = 'ready',
  errorMessage?: string,
): QueryVisualizationResult {
  if (state === 'loading') return { state };
  if (state === 'error') return { state, message: errorMessage ?? 'Unable to load data.' };
  if (!binding) return { state, points: [] };
  if (binding.source === 'invalid') return { state: 'error', message: binding.message };
  if (binding.source === 'query-records') {
    if (!records.length) return { state, points: [], message: 'No values yet.' };
    const points: QueryVisualizationPoint[] = [];
    for (const record of records) {
      const label = textValue(record, binding.xField);
      const value = numberValue(record, binding.yField);
      if (!label || value === null) return { state: 'error', message: 'Chart binding contains an invalid record.' };
      points.push({ label, value });
    }
    return { state, points };
  }
  if (!binding.groupBy) {
    const metric = queryMetricResult(records, binding, state, errorMessage);
    return metric.value === undefined ? metric : {
      state,
      points: [{ label: binding.labelField ?? binding.aggregate, value: metric.value }],
    };
  }
  if (binding.aggregate === 'count') {
    const grouped = new Map<string, number>();
    for (const record of records) {
      const group = textValue(record, binding.groupBy);
      if (!group) return { state: 'error', message: 'Chart group field is missing.' };
      grouped.set(group, (grouped.get(group) ?? 0) + 1);
    }
    return { state, points: [...grouped.entries()].map(([label, value]) => ({ label, value })) };
  }
  if (!binding.valueField) return { state: 'error', message: 'Aggregate value field is missing.' };
  const grouped = new Map<string, number[]>();
  for (const record of records) {
    const group = textValue(record, binding.groupBy);
    const value = numberValue(record, binding.valueField);
    if (!group || value === null) return { state: 'error', message: 'Chart binding contains an invalid record.' };
    const values = grouped.get(group) ?? [];
    values.push(value);
    grouped.set(group, values);
  }
  return {
    state,
    points: [...grouped.entries()].map(([label, values]) => ({ label, value: aggregate(values, binding.aggregate) })),
  };
}

function numericValues(records: readonly DomainRecordViewModel[], field: string) {
  const values: number[] = [];
  for (const record of records) {
    const value = numberValue(record, field);
    if (value === null) return { values, error: `Aggregate field ${field} contains a non-numeric value.` };
    values.push(value);
  }
  return { values, error: undefined };
}

function aggregate(values: readonly number[], operation: PresentationAggregate): number {
  if (operation === 'count') return values.length;
  if (operation === 'sum') return values.reduce((total, value) => total + value, 0);
  if (operation === 'avg') return values.reduce((total, value) => total + value, 0) / values.length;
  if (operation === 'min') return Math.min(...values);
  return Math.max(...values);
}

function numberValue(record: DomainRecordViewModel, field: string): number | null {
  const value = rawValue(record, field);
  const parsed = typeof value === 'number' ? value : Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? null : parsed;
}

function textValue(record: DomainRecordViewModel, field: string): string {
  const value = rawValue(record, field);
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function rawValue(record: DomainRecordViewModel, field: string): unknown {
  if (field === 'id') return record.id;
  if (field === 'collection') return record.collection;
  if (field === 'title') return record.title;
  if (field === 'body') return record.body;
  if (field === 'source') return record.source;
  if (field === 'status') return record.status;
  if (field === 'meta') return record.meta;
  return field.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, record.properties);
}

function isAggregate(value: unknown): value is PresentationAggregate {
  return value === 'count' || value === 'sum' || value === 'avg' || value === 'min' || value === 'max';
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
