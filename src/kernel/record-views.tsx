import type { AppPackage, AppComponent } from './schema';
import { JsonRecord } from './runtime';

export type SortDirection = 'asc' | 'desc';
export type RecordSortFilter = {
  query?: string;
  sortField?: string;
  sortDirection?: string;
  limit?: number;
};
export type BoardConfig = { field: string; columns: string[] };
export type RecordQuery = { from: string; where?: unknown; orderBy?: Array<{ field: string; direction: SortDirection }>; limit?: number };

export const RESERVED_RECORD_FIELDS = new Set(['id', 'collection', 'createdAt', 'updatedAt', 'created_at', 'updated_at']);

export const toText = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
export const asObject = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
export const asList = (value: unknown) => Array.isArray(value) ? value : [];
export const asNumber = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

export function resolveCollection(component: AppComponent, pkg: AppPackage, declaredQuery: RecordQuery | undefined) {
  const hasExplicit = Boolean(component.props && Object.prototype.hasOwnProperty.call(component.props, 'collection'));
  const explicit = toText(component.props?.collection);
  const fromView = declaredQuery?.from ? toText(declaredQuery.from) : '';

  const candidates: string[] = [];
  if (hasExplicit && explicit) candidates.push(explicit);
  if (fromView) candidates.push(fromView);
  if (!hasExplicit && explicit) candidates.push(explicit);
  if (!hasExplicit) {
    const fromCollections = component.query?.collections?.[0] ? toText(component.query.collections[0]) : '';
    if (fromCollections) candidates.push(fromCollections);
  }

  for (const candidate of candidates) {
    if (pkg.collections[candidate]) return candidate;
  }
  return undefined;
}

function asTextField(value: unknown, fallback: string) {
  return toText(value, fallback) || fallback;
}

export function resolveBoardConfig(component: AppComponent, pkg: AppPackage, collection: string): BoardConfig {
  const configured = toText(
    component.props?.groupBy,
    toText(component.props?.groupField, toText(component.props?.boardBy, 'status')),
  );
  const field = asTextField(configured, Object.entries(pkg.collections[collection]?.fields ?? {})
    .find(([, field]) => field.type === 'text')?.[0] ?? 'status');
  const values = asList(component.props?.boardColumns)
    .map((entry) => toText(entry))
    .filter(Boolean)
    .slice(0, 12);
  const defaults = ['Todo', 'In Progress', 'Done', 'Blocked'];
  return { field, columns: values.length ? values : defaults };
}

export function filterSortRecords(records: JsonRecord[], filters: RecordSortFilter) {
  const query = toText(filters.query).toLowerCase();
  const sorted = [...records]
    .filter((record) => !query || JSON.stringify(record.values).toLowerCase().includes(query))
    .sort((left, right) => {
      if (!filters.sortField) return 0;
      const leftValue = filters.sortField === 'id' ? left.id : left.values[filters.sortField];
      const rightValue = filters.sortField === 'id' ? right.id : right.values[filters.sortField];
      const direction = toText(filters.sortDirection, 'asc') === 'desc' ? -1 : 1;
      const leftNumber = asNumber(leftValue, Number.NaN);
      const rightNumber = asNumber(rightValue, Number.NaN);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return (leftNumber - rightNumber) * direction;
      }
      return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), undefined, { numeric: true }) * direction;
    });
  return Number.isFinite(filters.limit ?? Number.NaN) ? sorted.slice(0, asNumber(filters.limit, sorted.length)) : sorted;
}

export function reservedRecordFields() {
  return RESERVED_RECORD_FIELDS;
}

export function normalizeValue(value: unknown) {
  return String(value ?? '');
}

export function resolveRecordValue(record: JsonRecord, field: string, fallback = '') {
  return toText(record.values?.[field], fallback);
}
