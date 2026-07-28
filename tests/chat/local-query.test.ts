import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => createHash('sha256').update(value).digest('hex'),
}));

import { executeLocalQueryRows, type LocalQueryRequest } from '@/src/chat/local-query';
import type { CanonicalRecord } from '@/src/domain/runtime';

const baseRecord = {
  domain: 'food',
  source: { provider: 'sqlite', external_id: 'local', url: null, observed_at: '2026-07-25T00:00:00.000Z', content_hash: null },
  archived_at: null,
  created_at: '2026-07-25T00:00:00.000Z',
  updated_at: '2026-07-25T00:00:00.000Z',
  relations: [],
  revision: 1,
  schema_version: 'utopia.record.v1',
  deleted: false,
  privacy: 'personal',
  provenance: { actor: 'user', confidence: null, evidence: [], reason: 'test' },
} satisfies Partial<CanonicalRecord>;

const records: CanonicalRecord[] = [
  {
    ...baseRecord,
    id: 'rice',
    collection: 'shopping_item',
    title: 'Rice vinegar',
    properties: { status: 'To buy', aisle: 'pantry' },
  } as CanonicalRecord,
  {
    ...baseRecord,
    id: 'milk',
    collection: 'shopping_item',
    title: 'Milk',
    properties: { status: 'In cart', aisle: 'dairy' },
  } as CanonicalRecord,
  {
    ...baseRecord,
    id: 'eggs',
    collection: 'inventory',
    title: 'Eggs',
    properties: { status: 'Use soon', aisle: 'fridge' },
  } as CanonicalRecord,
];

function request(overrides: Partial<LocalQueryRequest> = {}): LocalQueryRequest {
  return {
    schemaVersion: 'wonder.local-query.v1',
    purpose: 'Find active shopping items',
    requestedFields: ['id', 'title', 'properties.status'],
    maxRows: 5,
    query: {
      from: 'records',
      where: { op: 'eq', field: 'collection', value: 'shopping_item' },
      orderBy: [{ field: 'title', direction: 'asc' }],
      project: ['id', 'title', 'properties.status'],
      limit: 5,
    },
    ...overrides,
  };
}

describe('executeLocalQueryRows', () => {
  it('returns bounded projected local rows for AI tool continuation', async () => {
    const result = await executeLocalQueryRows({
      request: request(),
      records,
      packageIdentity: { id: 'food', version: '1.0.0' },
      now: '2026-07-25T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.result.rows.map((row) => row.id)).toEqual(['milk', 'rice']);
    expect(result.result.rows[0].fields).toEqual({ id: 'milk', title: 'Milk', 'properties.status': 'In cart' });
    expect(result.result.queryHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.result.resultHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.result.metadata.returnedRows).toBe(2);
  });

  it('rejects unbounded and secret-bearing requests', async () => {
    await expect(executeLocalQueryRows({
      request: request({ query: { from: 'records', project: ['id', 'title', 'properties.status'], limit: 5 } }),
      records,
      packageIdentity: { id: 'food', version: '1.0.0' },
    })).resolves.toMatchObject({ ok: false, error: 'local_query_where_required' });

    await expect(executeLocalQueryRows({
      request: request({ requestedFields: ['id', 'provider_token'], query: { ...request().query, project: ['id', 'provider_token'] } }),
      records,
      packageIdentity: { id: 'food', version: '1.0.0' },
    })).resolves.toMatchObject({ ok: false, error: 'local_query_field_forbidden:provider_token' });
  });

  it('rejects invalid row bounds before producing tool output', async () => {
    await expect(executeLocalQueryRows({
      request: request({ maxRows: 0, query: { ...request().query, limit: 0 } }),
      records,
      packageIdentity: { id: 'food', version: '1.0.0' },
    })).resolves.toMatchObject({ ok: false, error: 'local_query_max_rows_invalid' });

    await expect(executeLocalQueryRows({
      request: request({ query: { ...request().query, offset: -1 } }),
      records,
      packageIdentity: { id: 'food', version: '1.0.0' },
    })).resolves.toMatchObject({ ok: false, error: 'local_query_offset_invalid' });
  });

  it('rejects oversized projected payloads before returning tool output', async () => {
    await expect(executeLocalQueryRows({
      request: request({
        requestedFields: ['title'],
        query: {
          ...request().query,
          project: ['title'],
          limit: 2,
        },
        maxRows: 2,
      }),
      records: [
        {
          ...records[0],
          id: 'huge-1',
          title: 'x'.repeat(5000),
        },
        {
          ...records[1],
          id: 'huge-2',
          title: 'y'.repeat(5000),
        },
      ],
      packageIdentity: { id: 'food', version: '1.0.0' },
    })).resolves.toMatchObject({ ok: false, error: 'local_query_output_too_large' });
  });
});
