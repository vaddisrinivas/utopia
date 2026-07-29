import type { QueryPredicate, QueryResult, QuerySort, QuerySpec } from '@/packages/shared/contracts/query';
import { decimalCompare, maybeParseComparableDecimal } from '@/packages/runtime-kernel/decimal';

export type { QueryPredicate, QuerySort, QueryResult, QuerySpec } from '@/packages/shared/contracts/query';

export function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

export function stableJson(value: unknown): string {
  return encodeCanonical(value);
}

export function stableHash(value: unknown): string {
  return hashValue(stableJson(value));
}

export function matches<T extends Record<string, unknown>>(
  row: T,
  predicate: QueryPredicate,
  getField: (row: T, field: string) => unknown = readPath,
): boolean {
  switch (predicate.op) {
    case 'and':
      return predicate.args.every((arg) => matches(row, arg, getField));
    case 'or':
      return predicate.args.some((arg) => matches(row, arg, getField));
    case 'not':
      return !matches(row, predicate.arg, getField);
    case 'exists':
      return exists(getField(row, predicate.field)) === (predicate.value ?? true);
    case 'eq':
      return compare(getField(row, predicate.field), predicate.value) === 0;
    case 'neq':
      return compare(getField(row, predicate.field), predicate.value) !== 0;
    case 'gt':
      return compare(getField(row, predicate.field), predicate.value) > 0;
    case 'gte':
      return compare(getField(row, predicate.field), predicate.value) >= 0;
    case 'lt':
      return compare(getField(row, predicate.field), predicate.value) < 0;
    case 'lte':
      return compare(getField(row, predicate.field), predicate.value) <= 0;
    case 'contains':
      return String(getField(row, predicate.field) ?? '').toLocaleLowerCase().includes(predicate.value.toLocaleLowerCase());
    case 'starts_with':
      return String(getField(row, predicate.field) ?? '').toLocaleLowerCase().startsWith(predicate.value.toLocaleLowerCase());
    default: {
      const op = (predicate as { op: string }).op;
      throw new Error(`unsupported_query_predicate:${op}`);
    }
  }
}

export function executeQuery<T extends Record<string, unknown>>(rows: readonly T[], spec: QuerySpec<T>): QueryResult<T> {
  const getField = spec.getField ?? readPath;
  let selected = rows.filter((row) => !spec.where || matches(row, spec.where, getField));
  const total = selected.length;
  if (spec.orderBy?.length) {
    selected = [...selected].sort((left, right) => {
      for (const sort of spec.orderBy ?? []) {
        const result = compare(getField(left, sort.field), getField(right, sort.field));
        if (result !== 0) return sort.direction === 'desc' ? -result : result;
      }
      return compare(getField(left, 'id'), getField(right, 'id'));
    });
  }
  const offset = Math.max(0, spec.offset ?? 0);
  const limited = spec.limit === undefined
    ? selected.slice(offset)
    : selected.slice(offset, offset + Math.max(0, spec.limit));
  const projected = spec.project?.length
    ? limited.map((row) => Object.fromEntries(spec.project!.map((field) => [field, getField(row, field)])) as T)
    : limited;
  return {
    rows: projected,
    total,
    offset,
    limit: spec.limit ?? null,
    resultHash: stableHash(projected),
    provenance: spec.provenance,
  };
}

function compare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  const leftDecimal = maybeParseComparableDecimal(left);
  const rightDecimal = maybeParseComparableDecimal(right);
  if (leftDecimal !== null && rightDecimal !== null) {
    return decimalCompare(leftDecimal, rightDecimal);
  }
  return compareAsString(left, right);
}

function exists(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function compareAsString(left: unknown, right: unknown): number {
  const leftText = String(left);
  const rightText = String(right);
  if (leftText === rightText) return 0;
  return leftText < rightText ? -1 : 1;
}

function hashValue(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return `fnv1a:${(result >>> 0).toString(16).padStart(8, '0')}`;
}

function encodeCanonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => encodeCanonical(entry)).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${encodeCanonical(entry)}`).join(',')}}`;
}
