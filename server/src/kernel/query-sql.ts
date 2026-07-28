import { QueryPredicate, QuerySort, QuerySpec } from './query';

export type CompiledQuery = { sql: string; params: unknown[] };

function identifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`invalid_${label}`);
  return `"${value}"`;
}

function fieldSql(field: string): string {
  if (field === 'id' || field === 'title' || field === 'domain' || field === 'collection' || field === 'updated_at') return identifier(field, 'field');
  if (field.startsWith('properties.')) {
    const path = field.slice('properties.'.length);
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(path)) throw new Error('invalid_property_path');
    return `json_extract("properties", '$.${path}')`;
  }
  throw new Error('unsupported_query_field');
}

function propertyPath(field: string): string | null {
  if (!field.startsWith('properties.')) return null;
  const path = field.slice('properties.'.length);
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(path)) throw new Error('invalid_property_path');
  return `$.${path}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function predicateSql(predicate: QueryPredicate, params: unknown[]): string {
  const field = 'field' in predicate ? fieldSql(predicate.field) : '';
  switch (predicate.op) {
    case 'and': return `(${predicate.args.map((arg) => predicateSql(arg, params)).join(' AND ') || '1=1'})`;
    case 'or': return `(${predicate.args.map((arg) => predicateSql(arg, params)).join(' OR ') || '0=1'})`;
    case 'not':
      if (predicate.arg.op === 'eq') {
        return `(${predicateSql(
          { op: 'neq', field: predicate.arg.field, value: predicate.arg.value },
          params,
        )})`;
      }
      if (predicate.arg.op === 'neq') {
        return `(${predicateSql({ op: 'eq', field: predicate.arg.field, value: predicate.arg.value }, params)})`;
      }
      return `(NOT ${predicateSql(predicate.arg, params)})`;
    case 'exists': return `${field} IS ${predicate.value === false ? 'NULL' : 'NOT NULL'}`;
    case 'eq':
      if (predicate.value === null) {
        const path = propertyPath(predicate.field);
        if (path === null) return `${field} IS NULL`;
        return `${field} IS NULL AND json_type("properties", '${path}') = 'null'`;
      }
      params.push(predicate.value); return `${field} = ?`;
    case 'neq':
      if (predicate.value === null) {
        const path = propertyPath(predicate.field);
        if (path === null) return `${field} IS NOT NULL`;
        return `(json_type("properties", '${path}') IS NULL OR json_type("properties", '${path}') != 'null')`;
      }
      params.push(predicate.value);
      return `(${field} IS NULL OR ${field} <> ?)`;
    case 'gt': params.push(predicate.value); return `${field} > ?`;
    case 'gte': params.push(predicate.value); return `${field} >= ?`;
    case 'lt': params.push(predicate.value); return `${field} < ?`;
    case 'lte': params.push(predicate.value); return `${field} <= ?`;
    case 'contains': params.push(`%${escapeLike(predicate.value)}%`); return `${field} LIKE ? ESCAPE '\\' COLLATE NOCASE`;
    case 'starts_with': params.push(`${escapeLike(predicate.value)}%`); return `${field} LIKE ? ESCAPE '\\' COLLATE NOCASE`;
    default: {
      const op = (predicate as { op: string }).op;
      throw new Error(`unsupported_query_predicate:${op}`);
    }
  }
}

function withStableTieBreak(orderBy: readonly QuerySort[] | undefined): QuerySort[] {
  const order = [...(orderBy ?? [])];
  if (order.length && !order.some((sort) => sort.field === 'id')) {
    order.push({ field: 'id', direction: 'asc' });
  }
  return order;
}

export function compileQueryToSql<T extends Record<string, unknown>>(spec: QuerySpec<T>): CompiledQuery {
  const params: unknown[] = [];
  const from = identifier(spec.from, 'collection');
  const where = spec.where ? ` WHERE ${predicateSql(spec.where, params)}` : '';
  const orderBy = withStableTieBreak(spec.orderBy);
  const order = orderBy.length
    ? ` ORDER BY ${orderBy.map((sort: QuerySort) => `${fieldSql(sort.field)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`).join(', ')}`
    : '';
  // SQLite requires LIMIT before OFFSET. -1 means unbounded.
  const limit = spec.limit === undefined
    ? (spec.offset === undefined ? '' : ' LIMIT -1')
    : ` LIMIT ${Math.max(0, Math.floor(spec.limit))}`;
  const offset = spec.offset === undefined ? '' : ` OFFSET ${Math.max(0, Math.floor(spec.offset))}`;
  return { sql: `SELECT * FROM ${from}${where}${order}${limit}${offset}`, params };
}
