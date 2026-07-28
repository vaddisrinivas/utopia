import type { SQLiteDatabase } from 'expo-sqlite';

import type { QueryPredicate, QuerySort } from '@/packages/shared/contracts/query';
import type { CanonicalRecord } from '@/src/domain/runtime';
import { getDomainManifest, loadCatalog } from '@/src/domain/catalog';
import { listRecordsForDomainAndInstallation } from '@/src/db/records';
import { canonicalJson } from '@/src/domain/canonical-json';
import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';

export const LOCAL_QUERY_SCHEMA_VERSION = 'wonder.local-query.v1' as const;
export const LOCAL_QUERY_RESULT_SCHEMA_VERSION = 'wonder.local-query-result.v1' as const;
export const LOCAL_QUERY_HARD_MAX_ROWS = 100;
export const LOCAL_QUERY_MAX_PROJECTED_FIELDS = 20;
export const LOCAL_QUERY_MAX_OUTPUT_BYTES = 1024 * 8;
export const LOCAL_QUERY_MAX_EXECUTION_MS = 5000;

export type LocalQueryRequest = {
  schemaVersion: typeof LOCAL_QUERY_SCHEMA_VERSION;
  purpose: string;
  requestedFields: string[];
  maxRows?: number;
  query: {
    from: string;
    where?: QueryPredicate;
    orderBy?: QuerySort[];
    limit?: number;
    offset?: number;
    project?: string[];
  };
};

export type LocalQueryResultRow = {
  id: string;
  collection: string;
  fields: Record<string, unknown>;
};

export type LocalQueryResult = {
  schemaVersion: typeof LOCAL_QUERY_RESULT_SCHEMA_VERSION;
  queryHash: string;
  resultHash: string;
  activePackageId: string;
  activePackageVersion: string;
  rows: LocalQueryResultRow[];
  truncated: boolean;
  executedAt: string;
  metadata: {
    requestedRows: number;
    returnedRows: number;
    projectedFields: number;
    executionMs: number;
    outputBytes: number;
    maxRows: number;
    maxProjectedFields: number;
  };
};

export type LocalQueryExecution =
  | { ok: true; result: LocalQueryResult }
  | { ok: false; error: string };

const FORBIDDEN_FIELD = /(^|[._-])(secret|token|api[_-]?key|raw[_-]?snapshot|provider[_-]?token)($|[._-])/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  return canonicalJson(value);
}

async function schemaHash(value: unknown): Promise<string> {
  const raw = stableJson(value);
  return `sha256:${await sha256Hex(raw)}`;
}

async function sha256Hex(raw: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  try {
    const optionalRequire = typeof require === 'function' ? require : null;
    const nodeCrypto = optionalRequire?.(`node${':crypto'}`) as typeof import('node:crypto') | undefined;
    if (nodeCrypto?.createHash) {
      return nodeCrypto.createHash('sha256').update(raw).digest('hex');
    }
  } catch {
    // fall through to Expo runtime
  }

  try {
    const optionalRequire = typeof require === 'function' ? require : null;
    const expoCrypto = optionalRequire?.(`expo${'-crypto'}`) as {
      digestStringAsync?: (algorithm: string, value: string) => Promise<string>;
      CryptoDigestAlgorithm?: { SHA256?: string };
    } | undefined;
    if (expoCrypto?.digestStringAsync && expoCrypto.CryptoDigestAlgorithm?.SHA256) {
      return expoCrypto.digestStringAsync(expoCrypto.CryptoDigestAlgorithm.SHA256, raw);
    }
  } catch {
    // fall through to explicit error
  }

  throw new Error('local_query_hash_unavailable');
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function validatePositiveInteger(value: unknown, name: string, max?: number): string | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || typeof value !== 'number') return `${name}_invalid`;
  if (value < 1) return `${name}_invalid`;
  if (max !== undefined && value > max) return `${name}_too_large`;
  return null;
}

function readPath(value: Record<string, unknown>, field: string): unknown {
  if (field === 'id') return value.id;
  if (field === 'title') return value.title;
  if (field === 'collection') return value.collection;
  if (field === 'updated_at') return value.updated_at;
  if (field.startsWith('properties.')) {
    return field.slice('properties.'.length).split('.').reduce<unknown>((current, segment) => {
      return isObject(current) ? current[segment] : undefined;
    }, value.properties);
  }
  return field.split('.').reduce<unknown>((current, segment) => {
    return isObject(current) ? current[segment] : undefined;
  }, value);
}

function compare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function matches(row: Record<string, unknown>, predicate: QueryPredicate): boolean {
  switch (predicate.op) {
    case 'and': return predicate.args.every((arg) => matches(row, arg));
    case 'or': return predicate.args.some((arg) => matches(row, arg));
    case 'not': return !matches(row, predicate.arg);
    case 'exists': return (readPath(row, predicate.field) !== undefined && readPath(row, predicate.field) !== null) === (predicate.value ?? true);
    case 'eq': return readPath(row, predicate.field) === predicate.value;
    case 'neq': return readPath(row, predicate.field) !== predicate.value;
    case 'gt': return compare(readPath(row, predicate.field), predicate.value) > 0;
    case 'gte': return compare(readPath(row, predicate.field), predicate.value) >= 0;
    case 'lt': return compare(readPath(row, predicate.field), predicate.value) < 0;
    case 'lte': return compare(readPath(row, predicate.field), predicate.value) <= 0;
    case 'contains': return String(readPath(row, predicate.field) ?? '').toLowerCase().includes(predicate.value.toLowerCase());
    case 'starts_with': return String(readPath(row, predicate.field) ?? '').toLowerCase().startsWith(predicate.value.toLowerCase());
    default: return false;
  }
}

function validateFields(fields: string[]): string | null {
  if (!fields.length) return 'local_query_fields_required';
  if (fields.length > LOCAL_QUERY_MAX_PROJECTED_FIELDS) return 'local_query_too_many_fields';
  const seen = new Set<string>();
  for (const field of fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(field)) return `local_query_field_invalid:${field}`;
    if (FORBIDDEN_FIELD.test(field)) return `local_query_field_forbidden:${field}`;
    if (seen.has(field)) return `local_query_field_duplicate:${field}`;
    seen.add(field);
  }
  return null;
}

function validatePredicate(predicate: QueryPredicate | undefined): string | null {
  if (!predicate) return 'local_query_where_required';
  switch (predicate.op) {
    case 'and':
    case 'or':
      return predicate.args.map(validatePredicate).find(Boolean) ?? null;
    case 'not':
      return validatePredicate(predicate.arg);
    case 'exists':
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'contains':
    case 'starts_with':
      return FORBIDDEN_FIELD.test(predicate.field) ? `local_query_field_forbidden:${predicate.field}` : null;
    default:
      return 'local_query_where_invalid';
  }
}

function recordToRow(record: CanonicalRecord): Record<string, unknown> {
  return {
    id: record.id,
    title: record.title,
    collection: record.collection,
    updated_at: record.updated_at,
    properties: record.properties,
  };
}

export async function executeLocalQueryRows(input: {
  request: LocalQueryRequest;
  records: CanonicalRecord[];
  packageIdentity: { id: string; version: string };
  now?: string;
}): Promise<LocalQueryExecution> {
  const started = Date.now();
  const { request } = input;
  if (request.schemaVersion !== LOCAL_QUERY_SCHEMA_VERSION) return { ok: false, error: 'local_query_schema_version_invalid' };
  if (request.query.from !== 'records') return { ok: false, error: `local_query_source_unsupported:${request.query.from}` };
  if (validatePositiveInteger(request.maxRows, 'local_query_max_rows', LOCAL_QUERY_HARD_MAX_ROWS)) return { ok: false, error: validatePositiveInteger(request.maxRows, 'local_query_max_rows', LOCAL_QUERY_HARD_MAX_ROWS)! };
  if (validatePositiveInteger(request.query.limit, 'local_query_limit', LOCAL_QUERY_HARD_MAX_ROWS)) return { ok: false, error: validatePositiveInteger(request.query.limit, 'local_query_limit', LOCAL_QUERY_HARD_MAX_ROWS)! };
  if (request.query.offset !== undefined && (!Number.isInteger(request.query.offset) || request.query.offset < 0)) return { ok: false, error: 'local_query_offset_invalid' };

  const requestedFields = request.requestedFields;
  const project = request.query.project ?? requestedFields;
  const fieldError = validateFields(requestedFields) ?? validateFields(project);
  if (fieldError) return { ok: false, error: fieldError };
  if (stableJson([...requestedFields].sort()) !== stableJson([...project].sort())) return { ok: false, error: 'local_query_fields_project_mismatch' };
  const predicateError = validatePredicate(request.query.where);
  if (predicateError) return { ok: false, error: predicateError };
  for (const sort of request.query.orderBy ?? []) {
    const sortError = validateFields([sort.field]);
    if (sortError) return { ok: false, error: sortError };
  }

  const maxRows = Math.min(request.maxRows ?? request.query.limit ?? 25, LOCAL_QUERY_HARD_MAX_ROWS);
  const limit = Math.min(request.query.limit ?? maxRows, maxRows);
  const offset = Math.max(0, request.query.offset ?? 0);
  const rows = input.records
    .filter((record) => !record.archived_at && !record.deleted)
    .map(recordToRow)
    .filter((row) => !request.query.where || matches(row, request.query.where));
  const total = rows.length;
  const sorted = [...rows].sort((left, right) => {
    for (const sort of request.query.orderBy ?? []) {
      const value = compare(readPath(left, sort.field), readPath(right, sort.field));
      if (value) return sort.direction === 'desc' ? -value : value;
    }
    return compare(readPath(left, 'id'), readPath(right, 'id'));
  });
  const selected = sorted.slice(offset, offset + limit);
  const resultRows = selected.map((row) => ({
    id: String(row.id),
    collection: String(row.collection),
    fields: Object.fromEntries(project.map((field) => [field, readPath(row, field)])),
  }));
  const outputBytes = utf8Bytes(stableJson(resultRows));
  if (outputBytes > LOCAL_QUERY_MAX_OUTPUT_BYTES) return { ok: false, error: 'local_query_output_too_large' };
  const executionMs = Math.min(Math.max(0, Date.now() - started), LOCAL_QUERY_MAX_EXECUTION_MS);

  const result: LocalQueryResult = {
    schemaVersion: LOCAL_QUERY_RESULT_SCHEMA_VERSION,
    queryHash: await schemaHash({ schemaVersion: LOCAL_QUERY_SCHEMA_VERSION, query: request.query }),
    resultHash: await schemaHash(resultRows),
    activePackageId: input.packageIdentity.id,
    activePackageVersion: input.packageIdentity.version,
    rows: resultRows,
    truncated: total > offset + limit,
    executedAt: input.now ?? new Date().toISOString(),
    metadata: {
      requestedRows: maxRows,
      returnedRows: resultRows.length,
      projectedFields: project.length,
      executionMs,
      outputBytes,
      maxRows,
      maxProjectedFields: LOCAL_QUERY_MAX_PROJECTED_FIELDS,
    },
  };

  return { ok: true, result };
}

export async function executeLocalQueryForChat(input: {
  db: SQLiteDatabase | null;
  domainId: string;
  installationId?: string | null;
  request: LocalQueryRequest;
}): Promise<LocalQueryExecution> {
  if (!input.db) return { ok: false, error: 'local_query_database_missing' };
  const catalog = loadCatalog();
  const manifest = getDomainManifest(catalog.catalog.domains, input.domainId) ?? catalog.activeManifest;
  const records = await listRecordsForDomainAndInstallation(
    input.db,
    input.installationId?.trim() || DEFAULT_APP_INSTALLATION_ID,
    input.domainId,
  );
  return executeLocalQueryRows({
    request: input.request,
    records,
    packageIdentity: { id: manifest.id, version: '1.0.0' },
  });
}
