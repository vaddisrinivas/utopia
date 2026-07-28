import { QueryPredicate, QuerySort, QuerySpec } from '@/packages/shared/contracts/query';
import { validateJsonSchema } from '../kernel/validation';
import { stableJson } from '../kernel/query';
import { sha256Canonical } from '@/src/domain/canonical-json';

export const LOCAL_QUERY_SCHEMA_VERSION = 'wonder.local-query.v1' as const;
export const LOCAL_QUERY_RESULT_SCHEMA_VERSION = 'wonder.local-query-result.v1' as const;
export const LOCAL_QUERY_DEFAULT_MAX_ROWS = 25;
export const LOCAL_QUERY_HARD_MAX_ROWS = 100;
export const LOCAL_QUERY_MAX_PROJECTED_FIELDS = 20;
export const LOCAL_QUERY_MAX_OUTPUT_BYTES = 1024 * 8;
export const LOCAL_QUERY_MAX_EXECUTION_MS = 5000;

const FIELD_NAME_PATTERN = '^[A-Za-z_][A-Za-z0-9_.-]*$';
const DRAFT_2020_12_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export type CanonicalQuerySpec = Omit<QuerySpec, 'getField' | 'provenance'>;

export type LocalQueryRequest = {
  schemaVersion: typeof LOCAL_QUERY_SCHEMA_VERSION;
  query: CanonicalQuerySpec;
  purpose: string;
  requestedFields: string[];
  maxRows?: number;
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

export type BoundLocalQueryRequest = {
  schemaVersion: typeof LOCAL_QUERY_SCHEMA_VERSION;
  query: CanonicalQuerySpec & {
    limit: number;
    project: string[];
  };
  purpose: string;
  requestedFields: string[];
  maxRows: number;
};

export const localQueryRequestSchema = {
  $schema: DRAFT_2020_12_SCHEMA,
  type: 'object',
  required: ['schemaVersion', 'query', 'purpose', 'requestedFields'],
  additionalProperties: false,
  $defs: {
    queryPredicate: {
      oneOf: [
        {
          type: 'object',
          required: ['op', 'args'],
          additionalProperties: false,
          properties: {
            op: { const: 'and' },
            args: {
              type: 'array',
              minItems: 1,
              items: { $ref: '#/$defs/queryPredicate' },
            },
          },
        },
        {
          type: 'object',
          required: ['op', 'args'],
          additionalProperties: false,
          properties: {
            op: { const: 'or' },
            args: {
              type: 'array',
              minItems: 1,
              items: { $ref: '#/$defs/queryPredicate' },
            },
          },
        },
        {
          type: 'object',
          required: ['op', 'arg'],
          additionalProperties: false,
          properties: {
            op: { const: 'not' },
            arg: { $ref: '#/$defs/queryPredicate' },
          },
        },
        {
          type: 'object',
          required: ['op', 'field'],
          additionalProperties: false,
          properties: {
            op: { const: 'exists' },
            field: { type: 'string', pattern: FIELD_NAME_PATTERN },
            value: { type: 'boolean' },
          },
        },
        {
          type: 'object',
          required: ['op', 'field', 'value'],
          additionalProperties: false,
          properties: {
            op: { enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] },
            field: { type: 'string', pattern: FIELD_NAME_PATTERN },
            value: {},
          },
        },
        {
          type: 'object',
          required: ['op', 'field', 'value'],
          additionalProperties: false,
          properties: {
            op: { enum: ['contains', 'starts_with'] },
            field: { type: 'string', pattern: FIELD_NAME_PATTERN },
            value: { type: 'string' },
          },
        },
      ],
    },
  },
  properties: {
    schemaVersion: { const: LOCAL_QUERY_SCHEMA_VERSION },
    purpose: { type: 'string', minLength: 1, maxLength: 240 },
    requestedFields: {
      type: 'array',
      minItems: 1,
      maxItems: LOCAL_QUERY_MAX_PROJECTED_FIELDS,
      items: { type: 'string', minLength: 1, pattern: FIELD_NAME_PATTERN },
      uniqueItems: true,
    },
    maxRows: { type: 'integer', minimum: 1, maximum: LOCAL_QUERY_HARD_MAX_ROWS },
    query: {
      type: 'object',
      required: ['from', 'where'],
      additionalProperties: false,
      properties: {
        from: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' },
        where: { $ref: '#/$defs/queryPredicate' },
        orderBy: {
          type: 'array',
          items: {
            type: 'object',
            required: ['field'],
            additionalProperties: false,
            properties: {
              field: { type: 'string', pattern: FIELD_NAME_PATTERN },
              direction: { type: 'string', enum: ['asc', 'desc'] },
            },
          },
        },
        limit: { type: 'integer', minimum: 1, maximum: LOCAL_QUERY_HARD_MAX_ROWS },
        offset: { type: 'integer', minimum: 0 },
        project: {
          type: 'array',
          minItems: 1,
          maxItems: LOCAL_QUERY_MAX_PROJECTED_FIELDS,
          items: { type: 'string', minLength: 1, pattern: FIELD_NAME_PATTERN },
          uniqueItems: true,
        },
      },
    },
  },
};

export const localQueryResultSchema = {
  $schema: DRAFT_2020_12_SCHEMA,
  type: 'object',
  required: ['schemaVersion', 'queryHash', 'resultHash', 'activePackageId', 'activePackageVersion', 'rows', 'truncated', 'executedAt', 'metadata'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: LOCAL_QUERY_RESULT_SCHEMA_VERSION },
    queryHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    resultHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    activePackageId: { type: 'string', minLength: 1 },
    activePackageVersion: { type: 'string', minLength: 1 },
    rows: {
      type: 'array',
      maxItems: LOCAL_QUERY_HARD_MAX_ROWS,
      items: {
        type: 'object',
        required: ['id', 'collection', 'fields'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          collection: { type: 'string', minLength: 1 },
          fields: { type: 'object', additionalProperties: true },
        },
      },
    },
    truncated: { type: 'boolean' },
    executedAt: { type: 'string', format: 'date-time' },
    metadata: {
      type: 'object',
      required: ['requestedRows', 'returnedRows', 'projectedFields', 'executionMs', 'outputBytes', 'maxRows', 'maxProjectedFields'],
      additionalProperties: false,
      properties: {
        requestedRows: { type: 'integer', minimum: 1, maximum: LOCAL_QUERY_HARD_MAX_ROWS },
        returnedRows: { type: 'integer', minimum: 0, maximum: LOCAL_QUERY_HARD_MAX_ROWS },
        projectedFields: { type: 'integer', minimum: 1, maximum: LOCAL_QUERY_MAX_PROJECTED_FIELDS },
        executionMs: { type: 'integer', minimum: 0, maximum: LOCAL_QUERY_MAX_EXECUTION_MS },
        outputBytes: { type: 'integer', minimum: 0, maximum: LOCAL_QUERY_MAX_OUTPUT_BYTES },
        maxRows: { type: 'integer', minimum: 1, maximum: LOCAL_QUERY_HARD_MAX_ROWS },
        maxProjectedFields: { type: 'integer', minimum: 1, maximum: LOCAL_QUERY_MAX_PROJECTED_FIELDS },
      },
    },
  },
};

const FORBIDDEN_FIELD_PATTERNS = [
  /^.*(?:^|[._])secret(?:$|[._])/i,
  /^.*(?:^|[._])raw[_-]?snapshot(?:$|[._])/i,
  /^.*(?:^|[._])provider[_-]?token(?:$|[._])/i,
  /^.*(?:^|[._])token(?:$|[._])/i,
  /^.*(?:^|[._])api[_-]?token(?:$|[._])/i,
];

export function parseLocalQueryRequest(input: unknown): ValidationResult<BoundLocalQueryRequest> {
  const schemaResult = validateJsonSchema(localQueryRequestSchema, input);
  if (!schemaResult.valid) {
    return { ok: false, errors: schemaErrors(schemaResult.errors) };
  }

  const errors: string[] = [];
  const normalized = normalizeLocalQueryRequest(schemaResult.value as LocalQueryRequest, errors);
  if (errors.length > 0) {
    return { ok: false, errors: schemaErrors(errors) };
  }

  return { ok: true, value: normalized };
}

export function parseLocalQueryResult(input: unknown): ValidationResult<LocalQueryResult> {
  const schemaResult = validateJsonSchema(localQueryResultSchema, input);
  if (!schemaResult.valid) {
    return { ok: false, errors: schemaErrors(schemaResult.errors) };
  }

  const errors: string[] = [];
  const result = schemaResult.value as LocalQueryResult;
  const payloadBytes = Buffer.byteLength(stableJson(result.rows), 'utf8');
  if (result.metadata.outputBytes !== payloadBytes) {
    errors.push(`metadata.outputBytes must match payload size (${payloadBytes})`);
  }
  const expectedResultHash = computeResultHash(result.rows);
  if (result.resultHash !== expectedResultHash) {
    errors.push(`resultHash must match rows payload (${expectedResultHash})`);
  }

  if (result.rows.length > result.metadata.maxRows || result.rows.length > result.metadata.requestedRows) {
    errors.push('result rows cannot exceed requested/max rows');
  }

  if (result.rows.length !== result.metadata.returnedRows) {
    errors.push('metadata.returnedRows must equal rows.length');
  }

  if (result.metadata.projectedFields > result.metadata.maxProjectedFields) {
    errors.push('metadata.projectedFields cannot exceed maxProjectedFields');
  }

  for (const row of result.rows) {
    if (!row.id.trim()) errors.push(`result.row.id must be non-empty (collection=${row.collection})`);
    if (!row.collection.trim()) errors.push('result.row.collection must be non-empty');
    walkFieldsForSecretOrToken('fields', row.fields, errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors: schemaErrors(errors) };
  }

  return { ok: true, value: result };
}

export function computeQueryHash(spec: CanonicalQuerySpec): string {
  return computeStableHash({ schemaVersion: LOCAL_QUERY_SCHEMA_VERSION, query: spec });
}

export function computeResultHash(rows: readonly LocalQueryResultRow[]): string {
  return computeStableHash(rows);
}

export function buildLocalQueryResult(
  request: BoundLocalQueryRequest,
  rows: LocalQueryResultRow[],
  packageIdentity: { id: string; version: string },
  executionMs: number,
): LocalQueryResult {
  const requestedRows = request.maxRows;
  const boundedRows = rows.slice(0, requestedRows).map((row) => ({
    id: row.id,
    collection: row.collection,
    fields: row.fields,
  }));
  const resultRows = trimRowsToOutputBudget(boundedRows);
  const returnedRows = resultRows.length;
  const metadata = {
    requestedRows,
    returnedRows,
    projectedFields: request.query.project.length,
    executionMs,
    outputBytes: Buffer.byteLength(stableJson(resultRows), 'utf8'),
    maxRows: request.maxRows,
    maxProjectedFields: LOCAL_QUERY_MAX_PROJECTED_FIELDS,
  };

  return {
    schemaVersion: LOCAL_QUERY_RESULT_SCHEMA_VERSION,
    queryHash: computeQueryHash(request.query),
    resultHash: computeResultHash(resultRows),
    activePackageId: packageIdentity.id,
    activePackageVersion: packageIdentity.version,
    rows: resultRows,
    truncated: rows.length > requestedRows || resultRows.length < boundedRows.length,
    executedAt: new Date().toISOString(),
    metadata,
  };
}

export function normalizeLocalQueryRequest(request: LocalQueryRequest, errors: string[]): BoundLocalQueryRequest {
  const requestedRows = request.maxRows
    ?? (request.query.limit !== undefined ? request.query.limit : LOCAL_QUERY_DEFAULT_MAX_ROWS);

  const requestedFields = normalizeFieldList(request.requestedFields);
  if (requestedFields.length === 0) {
    errors.push('requestedFields must contain at least one field');
  }
  if (requestedFields.length > LOCAL_QUERY_MAX_PROJECTED_FIELDS) {
    errors.push(`requestedFields cannot exceed ${LOCAL_QUERY_MAX_PROJECTED_FIELDS}`);
  }

  for (const field of requestedFields) {
    if (isForbiddenField(field)) {
      errors.push(`requestedFields contains forbidden field: ${field}`);
    }
  }

  const requestProjection = normalizeFieldList(request.query.project ?? requestedFields);
  if (requestProjection.length === 0) {
    errors.push('query.project cannot be empty when requestedFields is empty');
  }
  if (requestProjection.length > LOCAL_QUERY_MAX_PROJECTED_FIELDS) {
    errors.push(`query.project cannot exceed ${LOCAL_QUERY_MAX_PROJECTED_FIELDS}`);
  }
  for (const field of requestProjection) {
    if (isForbiddenField(field)) {
      errors.push(`query.project contains forbidden field: ${field}`);
    }
  }

  const requestedSet = new Set(requestedFields);
  const projectedSet = new Set(requestProjection);
  for (const field of requestedSet) {
    if (!projectedSet.has(field)) {
      errors.push(`requestedFields and query.project must align: missing ${field}`);
    }
  }
  for (const field of projectedSet) {
    if (!requestedSet.has(field)) {
      errors.push(`requestedFields and query.project must align: project includes extra ${field}`);
    }
  }

  if (request.query.limit !== undefined && request.query.limit > LOCAL_QUERY_HARD_MAX_ROWS) {
    errors.push(`query.limit cannot exceed ${LOCAL_QUERY_HARD_MAX_ROWS}`);
  }

  if (request.maxRows !== undefined && request.maxRows > LOCAL_QUERY_HARD_MAX_ROWS) {
    errors.push(`maxRows cannot exceed ${LOCAL_QUERY_HARD_MAX_ROWS}`);
  }

  const enforcedLimit = Math.min(request.query.limit ?? requestedRows, requestedRows, LOCAL_QUERY_HARD_MAX_ROWS);
  const enforcedRows = Math.min(requestedRows, LOCAL_QUERY_HARD_MAX_ROWS);

  const whereClause = request.query.where;
  if (!queryHasWhereClause(whereClause)) {
    errors.push('query.where is required for bounded localQuery execution');
  } else {
    for (const invalid of collectForbiddenPredicateFields(whereClause)) {
      errors.push(`query.where contains forbidden field: ${invalid}`);
    }
  }

  for (const invalid of collectForbiddenSortFields(request.query.orderBy ?? [])) {
    errors.push(`query.orderBy contains forbidden field: ${invalid}`);
  }

  return {
    schemaVersion: LOCAL_QUERY_SCHEMA_VERSION,
    query: {
      ...request.query,
      limit: enforcedLimit,
      project: requestProjection,
    },
    purpose: request.purpose.trim(),
    requestedFields,
    maxRows: enforcedRows,
  };
}

function collectForbiddenPredicateFields(predicate: QueryPredicate): string[] {
  const fields: string[] = [];
  switch (predicate.op) {
    case 'and':
    case 'or':
      for (const arg of predicate.args) {
        fields.push(...collectForbiddenPredicateFields(arg));
      }
      break;
    case 'not':
      fields.push(...collectForbiddenPredicateFields(predicate.arg));
      break;
    case 'exists':
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'contains':
    case 'starts_with':
      if (isForbiddenField(predicate.field)) fields.push(predicate.field);
      break;
    default:
      break;
  }

  return fields;
}

function collectForbiddenSortFields(orderBy: QuerySort[]): string[] {
  return orderBy
    .filter((sort) => sort.field)
    .filter((sort) => isForbiddenField(sort.field))
    .map((sort) => sort.field);
}

function walkFieldsForSecretOrToken(path: string, value: unknown, errors: string[]) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkFieldsForSecretOrToken(`${path}[${index}]`, entry, errors));
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (isForbiddenField(fieldPath)) {
      errors.push(`result row fields contain forbidden field ${fieldPath}`);
      continue;
    }
    walkFieldsForSecretOrToken(fieldPath, entry, errors);
  }
}

function queryHasWhereClause(clause: QueryPredicate | undefined): clause is QueryPredicate {
  return clause !== undefined && clause !== null;
}

function isForbiddenField(field: string): boolean {
  return FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(field));
}

function normalizeFieldList(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function trimRowsToOutputBudget(rows: LocalQueryResultRow[]): LocalQueryResultRow[] {
  if (Buffer.byteLength(stableJson(rows), 'utf8') <= LOCAL_QUERY_MAX_OUTPUT_BYTES) {
    return rows;
  }

  const out: LocalQueryResultRow[] = [];
  for (const row of rows) {
    const candidate = [...out, row];
    if (Buffer.byteLength(stableJson(candidate), 'utf8') > LOCAL_QUERY_MAX_OUTPUT_BYTES) {
      break;
    }
    out.push(row);
  }
  return out;
}

function computeStableHash(value: unknown): string {
  return sha256Canonical(value);
}

function schemaErrors(errors: string[]): string[] {
  return [...new Set(errors)].sort();
}
