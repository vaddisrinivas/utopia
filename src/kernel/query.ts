export type QueryWhere = { op?: string; field?: string; value?: unknown; args?: unknown[]; filter?: string };

export type QueryOptions = {
  where?: unknown;
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  offset?: number;
  limit?: number;
  query?: string;
  savedFilters?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function readPathParts(value: unknown, parts: string[]): unknown[] {
  if (!parts.length || !parts[0]) return [value];
  let current = [value];

  for (const part of parts) {
    const next: unknown[] = [];
    for (const item of current) {
      if (item == null) continue;
      if (Array.isArray(item)) {
        for (const node of item) next.push((node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined));
        continue;
      }
      if (part === 'length' && Array.isArray(item)) {
        next.push(item.length);
        continue;
      }
      if (typeof item === 'object') {
        next.push(asRecord(item)[part]);
      }
    }
    current = asArray(next).flatMap((item) => (Array.isArray(item) ? item : item == null ? [] : [item]));
    if (!current.length) return [];
  }
  return current;
}

export function resolvePath(value: Record<string, unknown> | null | undefined, path = ''): unknown {
  const root = value ?? {};
  const parts = path === '' ? [] : path.split('.');
  const direct = readPathParts(root, parts);
  if (direct.length) {
    if (direct.length === 1) return direct[0];
    return direct;
  }

  const nested = readPathParts(asRecord(root.values), parts);
  if (!nested.length) return undefined;
  if (nested.length === 1) return nested[0];
  return nested;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  if (typeof left === 'object') return JSON.stringify(left) === JSON.stringify(right);
  return false;
}

function asFiniteInteger(value: unknown, fallback: number, allowNegative = false): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  const normalized = Math.trunc(next);
  if (!allowNegative && normalized < 0) return fallback;
  return normalized;
}

function asSortDirection(value: unknown, fallback: 'asc' | 'desc'): 'asc' | 'desc' {
  return String(value ?? '').toLowerCase() === 'desc' ? 'desc' : fallback;
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function matchPrimitive(where: QueryWhere, value: unknown): boolean {
  const leftValues = asArray(value);
  const right = where.value;
  switch (where.op) {
    case 'eq': return leftValues.some((item) => deepEqual(item, right));
    case 'neq': return leftValues.every((item) => !deepEqual(item, right));
    case 'gt': return leftValues.some((item) => Number(item) > Number(right));
    case 'gte': return leftValues.some((item) => Number(item) >= Number(right));
    case 'lt': return leftValues.some((item) => Number(item) < Number(right));
    case 'lte': return leftValues.some((item) => Number(item) <= Number(right));
    case 'between': return leftValues.some((item) => Array.isArray(right) && Number(item) >= Number(right[0]) && Number(item) <= Number(right[1]));
    case 'in': return leftValues.some((item) => Array.isArray(right) && right.some((entry) => deepEqual(entry, item)));
    case 'nin': return !leftValues.some((item) => Array.isArray(right) && right.some((entry) => deepEqual(entry, item)));
    case 'contains':
      return leftValues.some((item) => {
        if (typeof item === 'string') return item.toLowerCase().includes(String(right ?? '').toLowerCase());
        if (Array.isArray(item)) return item.some((entry) => deepEqual(entry, right));
        return deepEqual(item, right);
      });
    case 'startsWith':
      return leftValues.some((item) => typeof item === 'string' && item.toLowerCase().startsWith(String(right ?? '').toLowerCase()));
    case 'endsWith':
      return leftValues.some((item) => typeof item === 'string' && item.toLowerCase().endsWith(String(right ?? '').toLowerCase()));
    case 'exists': return right === false ? leftValues.length === 0 || leftValues.every((item) => item == null) : leftValues.some((item) => item != null);
    case 'isNull': return !!right ? leftValues.every((item) => item === null || item === undefined) : leftValues.some((item) => item != null);
    default: return false;
  }
}

export function matchesWhere(where: unknown, values: Record<string, unknown>, savedFilters: Record<string, unknown> = {}): boolean {
  if (!where || typeof where !== 'object') return true;
  const filter = where as QueryWhere;
  if (filter.op === 'and') return (filter.args ?? []).every((item) => matchesWhere(item, values, savedFilters));
  if (filter.op === 'or') return (filter.args ?? []).some((item) => matchesWhere(item, values, savedFilters));
  if (filter.op === 'not') return !matchesWhere((filter.args ?? [])[0], values, savedFilters);
  if (filter.op === 'saved' || filter.op === 'savedFilter') {
    const key = String(filter.field ?? filter.value ?? '');
    const candidate = savedFilters[key];
    return candidate != null && matchesWhere(candidate, values, savedFilters);
  }
  return matchPrimitive(filter, resolvePath(values, filter.field ?? ''));
}

function withQueryValues<T extends { id?: unknown; values?: Record<string, unknown>; collection?: unknown; createdAt?: unknown; updatedAt?: unknown }>(record: T): Record<string, unknown> {
  return {
    ...record.values,
    id: record.id,
    collection: record.collection,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function sortByFields(records: Record<string, unknown>[], orderBy: QueryOptions['orderBy'] = []): Record<string, unknown>[] {
  return [...records].sort((left, right) => {
    for (const order of orderBy) {
      const delta = compareValues(resolvePath(left, order.field), resolvePath(right, order.field));
      if (delta !== 0) return order.direction === 'desc' ? -delta : delta;
    }
    return 0;
  });
}

export function normalizeQueryOptions(options: QueryOptions = {}): Required<QueryOptions> {
  const direction = asSortDirection(options.sortDirection, 'asc');
  const resolvedSortField = toText(options.sortField, '');
  const orderBy = options.orderBy?.length
    ? options.orderBy.map((entry) => ({ ...entry, direction: asSortDirection(entry.direction, direction) }))
    : (resolvedSortField ? [{ field: resolvedSortField, direction }] : []);
  const normalizedOffset = Number.isFinite(options.offset ?? NaN) ? Math.max(0, Math.floor(Number(options.offset ?? 0))) : 0;
  const page = Number.isFinite(options.page ?? NaN) ? Math.max(1, Math.floor(Number(options.page ?? 1))) : 1;
  const pageSize = asFiniteInteger(options.pageSize, 0, true);

  const normalizedLimit = Number.isFinite(options.limit ?? NaN)
    ? Math.floor(Number(options.limit))
    : Number.MAX_SAFE_INTEGER;

  const effectiveOffset = options.offset == null
    ? (pageSize > 0 ? (page - 1) * pageSize : normalizedOffset)
    : normalizedOffset;

  return {
    where: options.where,
    orderBy: orderBy,
    sortField: resolvedSortField || '',
    sortDirection: direction,
    page,
    pageSize,
    offset: effectiveOffset,
    limit: normalizedLimit,
    query: options.query ?? '',
    savedFilters: options.savedFilters ?? {},
  };
}

export function applyQueryPagination<T>(rows: T[], options: QueryOptions): T[] {
  const normalizedOffset = Number.isFinite(options.offset ?? NaN) ? Math.max(0, Math.floor(Number(options.offset ?? 0))) : 0;
  if (options.limit == null) return rows.slice(normalizedOffset);
  const normalizedLimit = Number.isFinite(options.limit) ? Math.floor(Number(options.limit)) : rows.length;
  if (normalizedLimit < 0) return rows.slice(normalizedOffset);
  if (normalizedLimit === 0) return [];
  return rows.slice(normalizedOffset, normalizedOffset + normalizedLimit);
}

function toText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function queryRecordsForClient<T extends { values?: Record<string, unknown>; id?: unknown; collection?: unknown; createdAt?: unknown; updatedAt?: unknown }>(rows: T[], options: QueryOptions = {}): T[] {
  const normalized = normalizeQueryOptions(options);
  const query = toText(normalized.query).toLowerCase();

  const filtered = rows
    .filter((record) => !query || JSON.stringify(withQueryValues(record)).toLowerCase().includes(query))
    .filter((record) => matchesWhere(normalized.where, withQueryValues(record), normalized.savedFilters));

  const sorted = sortByFields(
    filtered.map((record) => ({ ...(record as Record<string, unknown>), ...withQueryValues(record) })),
    normalized.orderBy,
  );
  const sliced = applyQueryPagination(sorted, normalized);
  return sliced.map((record) => record as unknown as T);
}
