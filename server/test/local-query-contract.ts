import assert from 'node:assert/strict';

import {
  buildLocalQueryResult,
  LOCAL_QUERY_DEFAULT_MAX_ROWS,
  LOCAL_QUERY_HARD_MAX_ROWS,
  LOCAL_QUERY_MAX_PROJECTED_FIELDS,
  LOCAL_QUERY_SCHEMA_VERSION,
  parseLocalQueryRequest,
  parseLocalQueryResult,
} from '../src/types/local-query';

type RequestBuilder = {
  requestedFields: string[];
  purpose: string;
  query: {
    from: string;
    where: { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with' | 'exists'; field: string; value: unknown };
    orderBy?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
    project?: string[];
    limit?: number;
  };
  maxRows?: number;
};

const baseRequest: RequestBuilder = {
  requestedFields: ['title', 'properties.expires_at'],
  purpose: 'Find food expiring soon before a meal.',
  query: {
    from: 'records',
    where: {
      op: 'exists',
      field: 'properties.expires_at',
      value: true,
    },
    orderBy: [{ field: 'properties.expires_at', direction: 'asc' }],
    limit: 12,
    project: ['title', 'properties.expires_at'],
  },
};

const localQueryRequest = {
  schemaVersion: LOCAL_QUERY_SCHEMA_VERSION,
  ...baseRequest,
};

const validRequest = parseLocalQueryRequest(localQueryRequest);
assert.equal(validRequest.ok, true);
assert.equal(validRequest.value?.query.limit, 12);
assert.equal(validRequest.value?.query.project?.length, 2);
assert.equal(validRequest.value?.maxRows, 12);
assert.equal(validRequest.value?.requestedFields[0], 'title');

const defaultRows = buildLocalQueryResult(
  validRequest.value,
  [
    {
      id: 'i-001',
      collection: 'records',
      fields: { title: 'Baby spinach', properties: { expires_at: '2026-07-27T00:00:00.000Z' } },
    },
    {
      id: 'i-002',
      collection: 'records',
      fields: { title: 'Cabbage', properties: { expires_at: '2026-07-28T00:00:00.000Z' } },
    },
  ],
  { id: 'food', version: '1.0.0' },
  13,
);

const validResult = parseLocalQueryResult(defaultRows);
assert.equal(validResult.ok, true);

const unconstrainedRequest = parseLocalQueryRequest({
  ...localQueryRequest,
  query: {
    from: 'records',
    where: undefined,
    orderBy: [{ field: 'title' }],
    project: ['title'],
  },
});
assert.equal(unconstrainedRequest.ok, false);
assert.equal(unconstrainedRequest.ok === false && unconstrainedRequest.errors[0].includes('where'), true);

const excessiveRows = parseLocalQueryRequest({
  ...localQueryRequest,
  maxRows: LOCAL_QUERY_HARD_MAX_ROWS + 1,
});
assert.equal(excessiveRows.ok, false);

const excessiveFields = parseLocalQueryRequest({
  ...localQueryRequest,
  requestedFields: Array.from({ length: LOCAL_QUERY_MAX_PROJECTED_FIELDS + 1 }, (_, index) => `field_${index + 1}`),
});
assert.equal(excessiveFields.ok, false);
assert.equal(excessiveFields.ok === false && excessiveFields.errors.some((entry) => entry.includes('requestedFields')), true);

const secretField = parseLocalQueryRequest({
  ...localQueryRequest,
  requestedFields: ['title', 'provider_token'],
});
assert.equal(secretField.ok, false);
assert.equal(secretField.ok === false && secretField.errors.some((entry) => entry.includes('forbidden')), true);

const truncatedPayload = buildLocalQueryResult(
  validRequest.value,
  Array.from({ length: validRequest.value.maxRows + 1 }, (_, index) => ({
    id: `i-${index + 1}`,
    collection: 'records',
    fields: { title: `Item ${index + 1}` },
  })),
  { id: 'food', version: '1.0.0' },
  8,
);
assert.equal(truncatedPayload.rows.length, validRequest.value.maxRows);
assert.equal(truncatedPayload.metadata.returnedRows, validRequest.value.maxRows);
assert.equal(truncatedPayload.truncated, true);

const invalidResult = {
  ...truncatedPayload,
  rows: [
    ...truncatedPayload.rows,
    { id: 'overflow', collection: 'records', fields: { title: 'Overflow' } },
  ],
  metadata: {
    ...truncatedPayload.metadata,
    returnedRows: truncatedPayload.rows.length + 1,
    outputBytes: Buffer.byteLength(JSON.stringify([
      ...truncatedPayload.rows,
      { id: 'overflow', collection: 'records', fields: { title: 'Overflow' } },
    ]), 'utf8'),
  },
};
const truncatedError = parseLocalQueryResult(invalidResult);
assert.equal(truncatedError.ok, false);
assert.equal(truncatedError.ok === false && truncatedError.errors.some((entry) => entry.includes('result rows cannot exceed requested/max rows')), true);

const malformedResult = parseLocalQueryResult({
  ...truncatedPayload,
  rows: [{
    id: 'bad',
    collection: 'records',
    fields: { provider_token: 'should be blocked', title: 'A' },
  }],
  metadata: {
    ...truncatedPayload.metadata,
    outputBytes: 0,
    returnedRows: 1,
    requestedRows: 1,
  },
});
assert.equal(malformedResult.ok, false);
assert.equal(malformedResult.ok === false && malformedResult.errors.some((entry) => entry.includes('forbidden')), true);

const forbiddenOrderBy = parseLocalQueryRequest({
  ...localQueryRequest,
  requestedFields: ['title'],
  query: {
    ...localQueryRequest.query,
    orderBy: [{ field: 'provider_token', direction: 'asc' }],
  },
});
assert.equal(forbiddenOrderBy.ok, false);
assert.equal(forbiddenOrderBy.ok === false && forbiddenOrderBy.errors.some((entry) => entry.includes('orderBy contains forbidden field')), true);

const forbiddenWhereField = parseLocalQueryRequest({
  ...localQueryRequest,
  requestedFields: ['title'],
  query: {
    ...localQueryRequest.query,
    where: { op: 'eq', field: 'raw_snapshot', value: 'x' },
  },
});
assert.equal(forbiddenWhereField.ok, false);
assert.equal(forbiddenWhereField.ok === false && forbiddenWhereField.errors.some((entry) => entry.includes('query.where contains forbidden field')), true);

const mismatchedOutputBytes = parseLocalQueryResult({
  ...truncatedPayload,
  metadata: {
    ...truncatedPayload.metadata,
    returnedRows: truncatedPayload.rows.length,
    outputBytes: 999,
  },
});
assert.equal(mismatchedOutputBytes.ok, false);
assert.equal(mismatchedOutputBytes.ok === false && mismatchedOutputBytes.errors.some((entry) => entry.includes('metadata.outputBytes must match payload size')), true);

const tamperedHash = parseLocalQueryResult({
  ...truncatedPayload,
  resultHash: `sha256:${'f'.repeat(64)}`,
});
assert.equal(tamperedHash.ok, false);
assert.equal(tamperedHash.ok === false && tamperedHash.errors.some((entry) => entry.includes('resultHash must match rows payload')), true);

const oversizedTrimmed = buildLocalQueryResult(
  {
    ...validRequest.value,
    maxRows: 4,
    query: {
      ...validRequest.value.query,
      limit: 4,
      project: ['title'],
    },
    requestedFields: ['title'],
  },
  Array.from({ length: 4 }, (_, index) => ({
    id: `oversize-${index + 1}`,
    collection: 'records',
    fields: { title: 'x'.repeat(5000) },
  })),
  { id: 'food', version: '1.0.0' },
  9,
);
assert.equal(oversizedTrimmed.metadata.outputBytes <= 1024 * 8, true);
assert.equal(oversizedTrimmed.truncated, true);
assert.equal(oversizedTrimmed.rows.length < 4, true);
assert.equal(parseLocalQueryResult(oversizedTrimmed).ok, true);

const deterministicErrors = parseLocalQueryRequest({
  ...localQueryRequest,
  requestedFields: ['provider_token'],
});
const deterministicErrorsRepeat = parseLocalQueryRequest({
  ...localQueryRequest,
  requestedFields: ['provider_token'],
});
assert.deepEqual(
  (deterministicErrors.ok ? [] : deterministicErrors.errors),
  (deterministicErrorsRepeat.ok ? [] : deterministicErrorsRepeat.errors),
);

const defaultBound = parseLocalQueryRequest({
  schemaVersion: LOCAL_QUERY_SCHEMA_VERSION,
  requestedFields: ['title'],
  purpose: 'Default maxRows check',
  query: {
    from: 'records',
    where: {
      op: 'eq',
      field: 'collection',
      value: 'inventory',
    },
  },
});
assert.equal(defaultBound.ok, true);
assert.equal(defaultBound.value?.maxRows, LOCAL_QUERY_DEFAULT_MAX_ROWS);

console.log('local-query-contract: passed');
