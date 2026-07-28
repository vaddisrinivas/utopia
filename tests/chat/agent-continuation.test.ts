import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => createHash('sha256').update(value).digest('hex'),
}));

import { localQueryToolResultMessage } from '@/src/chat/client';
import type { LocalQueryRequest, LocalQueryResult } from '@/src/chat/local-query';

describe('chat agent localQuery continuation', () => {
  it('builds the AI SDK UI tool-output message shape', () => {
    const request: LocalQueryRequest = {
      schemaVersion: 'wonder.local-query.v1',
      purpose: 'test',
      requestedFields: ['id'],
      maxRows: 1,
      query: {
        from: 'records',
        where: { op: 'eq', field: 'collection', value: 'shopping_item' },
        project: ['id'],
        limit: 1,
      },
    };
    const result: LocalQueryResult = {
      schemaVersion: 'wonder.local-query-result.v1',
      queryHash: `sha256:${'1'.repeat(64)}`,
      resultHash: `sha256:${'2'.repeat(64)}`,
      activePackageId: 'food',
      activePackageVersion: '1.0.0',
      rows: [{ id: 'rice', collection: 'shopping_item', fields: { id: 'rice' } }],
      truncated: false,
      executedAt: '2026-07-25T00:00:00.000Z',
      metadata: {
        requestedRows: 1,
        returnedRows: 1,
        projectedFields: 1,
        executionMs: 1,
        outputBytes: 12,
        maxRows: 1,
        maxProjectedFields: 20,
      },
    };

    expect(localQueryToolResultMessage({
      id: 'tool-result-call-1',
      toolCallId: 'call-1',
      request,
      result,
    })).toEqual({
      id: 'tool-result-call-1',
      role: 'assistant',
      parts: [{
        type: 'tool-localQuery',
        toolCallId: 'call-1',
        state: 'output-available',
        input: request,
        output: result,
      }],
    });
  });
});
