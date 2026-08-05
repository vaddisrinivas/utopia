import { describe, expect, it, vi } from 'vitest';

import { createDataHome, mergeWithConflicts, retry as retryAdapter } from '@/src/kernel/data-home';
import type { DataHomeConfig } from '@/src/kernel/data-home';

type StorageLike = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

const inMemoryStorage = (): StorageLike => {
  const data = new Map<string, string>();
  return {
    async getItem(key) {
      return data.get(key) ?? null;
    },
    async setItem(key, value) {
      data.set(key, value);
    },
  };
};

const baseUrl = 'http://localhost:8787';

const sample: DataHomeConfig = { id: 'sample', kind: 'sqlite', resource: 'sqlite' };

describe('data-home transport', () => {
  it('supports sqlite local pagination and dedupe merge semantics', async () => {
    const storage = inMemoryStorage();
    const transport = createDataHome({ ...sample, kind: 'sqlite' }, {}, storage);

    await transport.push({
      records: [
        { id: 'one', collection: 'item', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', values: { score: 1 } },
        { id: 'two', collection: 'item', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', values: { score: 2 } },
      ],
    });
    await transport.push({
      records: [
        { id: 'one', collection: 'item', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', values: { score: 3 } },
      ],
    });

    const first = await transport.pull({ limit: 1 });
    const second = await transport.pull({ cursor: first.cursor, limit: 1 });

    expect(first.records).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.records[0].id).toBe('two');

    expect(second.records).toHaveLength(1);
    expect(second.records[0].id).toBe('one');
  });

  it('rejects remote homes without endpoint and bad secret refs', () => {
    expect(() => createDataHome({ id: 'notion', kind: 'notion', secretRef: 'UTOPIA_NOTION', resource: 'resource-id' }, { UTOPIA_NOTION: 'token' }))
      .toThrow('missing data home endpoint for notion');
    expect(() => createDataHome({ id: 'notion', kind: 'notion', secretRef: 'bad-ref', resource: 'resource-id' }, {}, baseUrl))
      .toThrow('invalid secretRef notion');
  });

  it('routes remote pull/push via HTTP transport', async () => {
    const fetcher = vi.fn(async (url, init) => {
      const endpoint = String(url);
      const body = JSON.parse(String(init?.body ?? '{}')) as { cursor?: string; records?: unknown[] };
      if (endpoint.endsWith('/data/notion/pull')) {
        expect(body).toMatchObject({ kind: 'notion', secretRef: 'UTOPIA_NOTION', cursor: 'cursor-1', limit: 2 });
        return new Response(
          JSON.stringify({
            records: [{
              id: 'a', collection: 'items', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', values: { score: 1 },
            }],
            cursor: 'cursor-2', hasMore: true,
          }),
          { status: 200 },
        );
      }
      if (endpoint.endsWith('/data/notion/push')) {
        expect(Array.isArray(body.records)).toBe(true);
        return new Response(JSON.stringify({ cursor: 'cursor-2' }), { status: 200 });
      }
      throw new Error(`unexpected endpoint ${endpoint}`);
    });
    vi.stubGlobal('fetch', fetcher);

    const transport = createDataHome(
      { id: 'notion', kind: 'notion', secretRef: 'UTOPIA_NOTION', resource: 'db-1', mode: 'sync' },
      { UTOPIA_NOTION: 'token' },
      undefined,
      baseUrl,
    );

    const pull = await transport.pull({ cursor: 'cursor-1', limit: 2 });
    const push = await transport.push({ records: [{ id: 'b', collection: 'items', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', values: { score: 2 } }] });

    expect(pull).toMatchObject({
      records: [{ id: 'a' }],
      cursor: 'cursor-2',
      hasMore: true,
    });
    expect(push).toMatchObject({ cursor: 'cursor-2' });
    expect(fetcher).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it('replays local-conflict records with latest-wins merge and conflict marker', () => {
    const local = [
      { id: 'shared', collection: 'item', createdAt: '2026-01-01', updatedAt: '2026-01-02', values: { score: 1 } },
      { id: 'local', collection: 'item', createdAt: '2026-01-01', updatedAt: '2026-01-01', values: { local: true } },
    ];
    const remote = [
      { id: 'shared', collection: 'item', createdAt: '2026-01-01', updatedAt: '2026-01-02', values: { score: 2 } },
      { id: 'remote', collection: 'item', createdAt: '2026-01-01', updatedAt: '2026-01-01', values: { remote: true } },
    ];

    const merged = mergeWithConflicts(local, remote);
    expect(merged.merged.map((item) => item.id)).toEqual(['local', 'remote', 'shared']);
    expect(merged.conflicts).toEqual(['shared']);
  });

  it('retries transient failures and eventually succeeds', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      if (attempts++ === 0) throw new Error('offline');
      return 'ok';
    });
    await expect(retryAdapter(fn, 3)).resolves.toBe('ok');
    expect(attempts).toBe(2);
  });
});
