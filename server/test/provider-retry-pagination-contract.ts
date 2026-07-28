import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const previousEnv = {
  notionToken: process.env.NOTION_TOKEN,
  notionSource: process.env.NOTION_DATA_SOURCE_ID,
  sheetsToken: process.env.GOOGLE_SHEETS_ACCESS_TOKEN,
  sheetsSpreadsheet: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  sheetsSource: process.env.GOOGLE_SHEETS_DATA_SOURCE_ID,
  authority: process.env.LIFEOS_AUTHORITY_PROVIDER,
  runtimeState: process.env.WONDER_RUNTIME_STATE_PATH,
};

process.env.NOTION_TOKEN = 'retry-pagination-token';
process.env.NOTION_DATA_SOURCE_ID = 'retry-pagination-source';
process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'retry-pagination-sheets-token';
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'retry-pagination-sheet';
process.env.GOOGLE_SHEETS_DATA_SOURCE_ID = 'retry-pagination-data-source';
process.env.LIFEOS_AUTHORITY_PROVIDER = 'notion';
process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-provider-revision-')), 'wonder-runtime.json');

const { notionFetch } = await import('../src/providers/notion/client');
const { pullNotionRecordsLive } = await import('../src/providers/notion/pull');
const { setNotionPortForTests } = await import('../src/providers/notion/port');
const { pullSheetsRecordsLive } = await import('../src/providers/sheets/pull');
const { setSheetsPortForTests } = await import('../src/providers/sheets/port');
const { upsertProviderCanonicalRecord } = await import('../src/runtime/state');

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

let timerCreated = 0;
let timerCleared = 0;
let retrySignals: Array<AbortSignal | null> = [];
const timerDurations: number[] = [];

globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  timerCreated += 1;
  timerDurations.push(typeof timeout === 'number' ? timeout : 0);
  return originalSetTimeout(handler, timeout, ...args);
}) as typeof globalThis.setTimeout;
globalThis.clearTimeout = ((handle?: number | NodeJS.Timeout) => {
  timerCleared += 1;
  return originalClearTimeout(handle as number);
}) as typeof globalThis.clearTimeout;

let retryCalls = 0;
globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (url === 'https://notion.test/retry-check') {
    retryCalls += 1;
    retrySignals.push((init.signal as AbortSignal | undefined) ?? null);
    if (retryCalls === 1) {
      return jsonResponse(503, { message: 'retry me' });
    }
    return jsonResponse(200, { ok: true });
  }
  return jsonResponse(500, { error: `unexpected retry endpoint ${url}` });
}) as typeof globalThis.fetch;

const retryResult = await notionFetch<{ ok: boolean }>('https://notion.test/retry-check', { method: 'GET' }, { maxRetries: 1 });
assert.equal(retryResult.ok, true, 'retry should eventually succeed');
assert.equal(retryCalls, 2, 'retry should attempt twice');
assert.equal(retrySignals.length, 2, 'retry should use per-attempt signals');
assert.notEqual(retrySignals[0], retrySignals[1], 'retry should not reuse the same abort signal');
assert.equal(retrySignals[1]?.aborted, false, 'fresh retry signal should remain active');
assert.equal(timerDurations.filter((value) => value === 15000).length, 2, 'each retry attempt should create a request timeout');
assert.equal(timerCleared, 2, 'each retry attempt should clear its timeout');

let notionQueryCalls = 0;
setNotionPortForTests({
  async queryDataSource(input) {
    notionQueryCalls += 1;
    assert.equal(input.dataSourceId, 'retry-pagination-source', 'notion port should receive configured data_source_id');
    assert.equal(input.pageSize, 1, 'notion port should honor limit for targeted pull');
    if (!input.startCursor) {
      return {
        ok: true,
        status: 200,
        data: {
        results: [{
          object: 'page',
          id: 'page-before-target',
          properties: {
            Name: { title: [{ plain_text: 'Before target' }] },
            'Utopia Domain': 'food',
            'Utopia Collection': 'recipe',
          },
          created_time: '2026-01-01T00:00:00.000Z',
          last_edited_time: '2026-01-01T00:01:00.000Z',
          archived: false,
          in_trash: false,
          parent: { database_id: 'retry-db' },
        }],
        has_more: true,
        next_cursor: 'cursor-2',
        },
      };
    }
    return {
      ok: true,
      status: 200,
      data: {
      results: [{
        object: 'page',
        id: 'page-target',
        properties: {
          Name: { title: [{ plain_text: 'Target page' }] },
          'Utopia Domain': 'food',
          'Utopia Collection': 'recipe',
        },
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:02:00.000Z',
        archived: false,
        in_trash: false,
        parent: { database_id: 'retry-db' },
      }],
      has_more: false,
      next_cursor: null,
      },
    };
  },
  async createPage() {
    throw new Error('notion createPage should not run in pagination contract');
  },
  async updatePage() {
    throw new Error('notion updatePage should not run in pagination contract');
  },
});

const targetedPull = await pullNotionRecordsLive({
  domain: 'food',
  collection: 'recipe',
  limit: 1,
  pageId: 'page-target',
  externalId: 'page-target',
});
assert.equal(targetedPull.status, 'ready', 'targeted notion pull should succeed');
assert.equal(notionQueryCalls, 2, 'targeted notion pull should paginate past the first page');
assert.equal(targetedPull.records.some((record) => record.id === 'page-target'), true, 'targeted notion pull should include the requested page');

let sheetsMetadataCalls = 0;
let sheetsBatchGetCalls = 0;
setSheetsPortForTests({
  async getSpreadsheet(input) {
    sheetsMetadataCalls += 1;
    assert.equal(input.spreadsheetId, 'retry-pagination-sheet', 'sheets port should receive configured spreadsheet id');
    return {
      ok: true,
      status: 200,
      data: {
      spreadsheetId: 'retry-pagination-sheet',
      properties: { title: 'Utopia Runtime Workbook' },
      sheets: [{ properties: { title: 'Utopia Runtime', gridProperties: { columnCount: 26, rowCount: 32 } } }],
      },
    };
  },
  async batchGetValues(input) {
    sheetsBatchGetCalls += 1;
    assert.equal(input.majorDimension, 'ROWS', 'sheets port should request row-major reads');
    assert.deepEqual(input.ranges, ['Utopia Runtime!A:Z'], 'sheets port should request runtime range');
    return {
      ok: true,
      status: 200,
      data: {
      valueRanges: [{
        range: 'Utopia Runtime!A:Z',
        values: [
          ['id', 'title', 'domain', 'collection', 'properties', 'archived', 'version', 'updated_at', 'source', 'external_id'],
          ['sheet-limit-a', 'Alpha', 'food', 'recipe', '{"ready":true}', 'false', '1', '2026-01-01T00:00:00.000Z', '{}', 'sheet-limit-a'],
          ['sheet-limit-b', 'Beta', 'food', 'recipe', '{"ready":true}', 'false', '1', '2026-01-01T00:00:00.000Z', '{}', 'sheet-limit-b'],
        ],
      }],
      },
    };
  },
  async batchUpdateValues() {
    throw new Error('sheets batchUpdateValues should not run in pagination contract');
  },
});

const limitedSheetsPull = await pullSheetsRecordsLive({ limit: 1 });
assert.equal(limitedSheetsPull.status, 'ready', 'sheets pull should succeed');
assert.equal(limitedSheetsPull.records.length, 1, 'sheets pull should enforce the requested limit');
assert.equal(limitedSheetsPull.source_snapshots.length, 1, 'sheets source snapshots should respect the requested limit');
assert.equal(sheetsMetadataCalls, 1, 'sheets pull should read metadata once');
assert.equal(sheetsBatchGetCalls, 1, 'sheets pull should read values once');

const firstUpsert = upsertProviderCanonicalRecord({
  provider: 'notion',
  id: 'archived-provider-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Archived provider record',
  properties: { synced: true },
  archived: true,
  externalId: 'archived-provider-record',
  observedAt: '2026-01-01T00:00:00.000Z',
});
assert.equal(firstUpsert.applied, true, 'first provider upsert should apply');
assert.equal(firstUpsert.record?.revision, 1, 'first provider upsert should start at revision 1');

const secondUpsert = upsertProviderCanonicalRecord({
  provider: 'notion',
  id: 'archived-provider-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Archived provider record',
  properties: { synced: true },
  archived: true,
  externalId: 'archived-provider-record',
  observedAt: '2026-01-02T00:00:00.000Z',
});
assert.equal(secondUpsert.applied, true, 'second provider upsert should apply');
assert.equal(secondUpsert.record?.revision, 1, 'unchanged refetch should not increment revision');
assert.equal(secondUpsert.record?.archived_at, firstUpsert.record?.archived_at, 'unchanged archived refetch should preserve archive timestamp');

globalThis.fetch = originalFetch;
globalThis.setTimeout = originalSetTimeout;
globalThis.clearTimeout = originalClearTimeout;
setNotionPortForTests(null);
setSheetsPortForTests(null);

if (previousEnv.notionToken === undefined) delete process.env.NOTION_TOKEN; else process.env.NOTION_TOKEN = previousEnv.notionToken;
if (previousEnv.notionSource === undefined) delete process.env.NOTION_DATA_SOURCE_ID; else process.env.NOTION_DATA_SOURCE_ID = previousEnv.notionSource;
if (previousEnv.sheetsToken === undefined) delete process.env.GOOGLE_SHEETS_ACCESS_TOKEN; else process.env.GOOGLE_SHEETS_ACCESS_TOKEN = previousEnv.sheetsToken;
if (previousEnv.sheetsSpreadsheet === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID; else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = previousEnv.sheetsSpreadsheet;
if (previousEnv.sheetsSource === undefined) delete process.env.GOOGLE_SHEETS_DATA_SOURCE_ID; else process.env.GOOGLE_SHEETS_DATA_SOURCE_ID = previousEnv.sheetsSource;
if (previousEnv.authority === undefined) delete process.env.LIFEOS_AUTHORITY_PROVIDER; else process.env.LIFEOS_AUTHORITY_PROVIDER = previousEnv.authority;
if (previousEnv.runtimeState === undefined) delete process.env.WONDER_RUNTIME_STATE_PATH; else process.env.WONDER_RUNTIME_STATE_PATH = previousEnv.runtimeState;

console.log('PASS server/test/provider-retry-pagination-contract.ts');
