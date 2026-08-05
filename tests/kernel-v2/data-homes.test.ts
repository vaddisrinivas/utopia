import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataHome, mergeWithConflicts, retry as retryAdapter } from '@/src/kernel/data-home';
import type { DataHomeConfig } from '@/src/kernel/data-home';

beforeEach(() => {
  vi.clearAllMocks();
});

const notionQuery = vi.fn();
const notionCreate = vi.fn();
const notionUpdate = vi.fn();
const pgConnect = vi.fn();
const pgQuery = vi.fn();
const pgEnd = vi.fn();
const sheetsGet = vi.fn();
const sheetsAppend = vi.fn();
const sheetsUpdate = vi.fn();
const sheetsClear = vi.fn();

const makeNotion = () => ({
  dataSources: { query: notionQuery },
  pages: { create: notionCreate, update: notionUpdate },
});

const makePostgresClient = () => ({
  connect: pgConnect,
  query: pgQuery,
  end: pgEnd,
});

const makeGoogleClient = () => ({
  spreadsheets: {
    values: {
      get: sheetsGet,
      clear: sheetsClear,
      update: sheetsUpdate,
      append: sheetsAppend,
    },
  },
});

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

const scope = { appId: 'food', tenantId: 'tenant-a' };

const sample: DataHomeConfig = { id: 'sample', kind: 'sqlite', resource: 'utopia_data' };

describe('data-home transport', () => {
  it('supports sqlite local pagination and dedupe merge semantics', async () => {
    const storage = inMemoryStorage();
    const transport = createDataHome({ ...sample, kind: 'sqlite' }, {}, storage, undefined, scope);

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

  it('requires data-home scope and secret binding for non-sqlite homes', () => {
    expect(() => createDataHome({ id: 'notion', kind: 'notion', secretRef: 'UTOPIA_NOTION', resource: 'resource-id' }, { UTOPIA_NOTION: 'token' }))
      .toThrow('missing data home scope for notion');

    expect(() => createDataHome({ id: 'notion', kind: 'notion', secretRef: 'bad-ref', resource: 'resource-id' }, {}, undefined, undefined, scope))
      .toThrow('invalid secretRef notion');
  });

  it('uses notion provider for scoped pull and push', async () => {
    const scoped = `${scope.tenantId}:${scope.appId}:notion`;
    notionQuery.mockResolvedValueOnce({
      results: [
        {
          id: 'page-1',
          properties: {
            UtopiaId: { rich_text: [{ type: 'text', text: { content: `${scoped}:one` } }] },
            Collection: { rich_text: [{ type: 'text', text: { content: 'item' } }] },
            Created: { date: { start: '2026-01-01T00:00:00.000Z' } },
            Updated: { date: { start: '2026-01-01T00:00:00.000Z' } },
            Payload: { rich_text: [{ type: 'text', text: { content: '{"a":1}' } }] },
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
    notionQuery.mockResolvedValueOnce({
      results: [
        {
          id: 'page-1',
          properties: {
            UtopiaId: { rich_text: [{ type: 'text', text: { content: `${scoped}:one` } }] },
            Collection: { rich_text: [{ type: 'text', text: { content: 'item' } }] },
            Created: { date: { start: '2026-01-01T00:00:00.000Z' } },
            Updated: { date: { start: '2026-01-01T00:00:00.000Z' } },
            Payload: { rich_text: [{ type: 'text', text: { content: '{"a":1}' } }] },
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    notionCreate.mockResolvedValue(undefined);
    notionUpdate.mockResolvedValue(undefined);

    const notion = createDataHome(
      { id: 'notion', kind: 'notion', resource: 'database-id', secretRef: 'UTOPIA_NOTION', mode: 'sync' },
      { UTOPIA_NOTION: 'token' },
      undefined,
      undefined,
      scope,
      { notionClient: makeNotion },
    );

    const pull = await notion.pull({ limit: 10 });
    expect(pull.records).toEqual([
      { id: 'one', collection: 'item', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', values: { a: 1 } },
    ]);

    await notion.push({
      records: [{ id: 'one', collection: 'item', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', values: { a: 2 } }],
    });
    expect(notionUpdate).toHaveBeenCalled();
  });

  it('uses postgres provider for scoped push and pull', async () => {
    pgConnect.mockResolvedValue(undefined);
    pgQuery.mockImplementation(async (text) => {
      if (typeof text === 'string' && text.includes('select')) {
        return {
          rows: [
            {
              id: 'one',
              collection: 'item',
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
              values_json: '{"a":1}',
            },
          ],
        };
      }

      return { rows: [] };
    });
    pgEnd.mockResolvedValue(undefined);

    const postgres = createDataHome(
      { id: 'pg', kind: 'postgres', resource: 'records', secretRef: 'UTOPIA_POSTGRES' },
      {
        UTOPIA_POSTGRES: 'postgres://example',
      },
      undefined,
      undefined,
      scope,
      { postgresClient: makePostgresClient },
    );

    const pulled = await postgres.pull({ limit: 1 });
    expect(pulled.records).toEqual([{ id: 'one', collection: 'item', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', values: { a: 1 } }]);

    await postgres.push({ records: [{ id: 'two', collection: 'item', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', values: { a: 2 } }] });
    expect(pgQuery).toHaveBeenCalled();
    expect(pgEnd).toHaveBeenCalledTimes(2);
  });

  it('uses google sheets provider with scoped keys and row update path', async () => {
    const scoped = `${scope.tenantId}:${scope.appId}:sheet`;
    sheetsGet.mockResolvedValue({
      data: {
        values: [
          ['UtopiaId', 'Collection', 'Created', 'Updated', 'Payload'],
          [`${scoped}:one`, 'item', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '{"a":1}'],
        ],
      },
    });
    sheetsAppend.mockResolvedValue({});
    sheetsUpdate.mockResolvedValue({});
    sheetsClear.mockResolvedValue({});

    const sheets = createDataHome(
      { id: 'sheet', kind: 'google-sheets', resource: 'sheet-id!A1:E', secretRef: 'UTOPIA_GOOGLE' },
      {
        UTOPIA_GOOGLE: '{"type":"service_account","client_email":"x","private_key":"y"}',
      },
      undefined,
      undefined,
      scope,
      {
        googleAuth: vi.fn(() => ({ token: 'google' })),
        sheetsClient: vi.fn(() => makeGoogleClient()),
      },
    );

    const pulled = await sheets.pull({ limit: 10 });
    expect(pulled.records).toHaveLength(1);
    expect(pulled.records[0].id).toBe('one');

    await sheets.push({ records: [{ id: 'two', collection: 'item', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', values: { a: 2 } }] });
    expect(sheetsAppend).toHaveBeenCalled();
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
