import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { clearWebhookReplayState, getWebhookReplayState } from '../src/providers/webhooks/sheets';
import { syncSheetsFromWebhook } from '../src/providers/sync/sheets';
import { createOfficialDriveClient, createOfficialSheetsClient, readSheetsConfig, sheetsEndpoint } from '../src/providers/sheets/client';
import { pullSheetsRecordsLive } from '../src/providers/sheets/pull';
import { setSheetsPortForTests } from '../src/providers/sheets/port';

type MockCall = {
  kind: 'getSpreadsheet' | 'batchGetValues';
  input: Record<string, unknown>;
};

function ensure(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function setupMockSheetsFetch() {
  const state = {
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
    sheetName: 'Utopia Runtime',
    rows: [
      ['id', 'title', 'domain', 'collection', 'properties', 'archived', 'version', 'updated_at', 'source', 'external_id', 'legacy'],
      ['sheet-sync-a', 'Sync Alpha', 'food', 'recipe', '{"ready":true}', 'false', '1', '2026-01-01T00:00:00.000Z', '{}', 'sheet-sync-a', 'legacy'],
      ['sheet-sync-b', 'Sync Beta', 'food', 'recipe', '{"ready":true}', 'false', '1', '2026-01-01T00:00:00.000Z', '{}', 'sheet-sync-b', 'legacy'],
    ],
  };
  const calls: MockCall[] = [];
  setSheetsPortForTests({
    async getSpreadsheet(input) {
      calls.push({ kind: 'getSpreadsheet', input: input as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        data: {
          spreadsheetId: state.spreadsheetId,
          properties: { title: 'Utopia Runtime Workbook' },
          sheets: [{ properties: { title: state.sheetName, gridProperties: { columnCount: 26, rowCount: 128 } } }],
        },
      };
    },
    async batchGetValues(input) {
      calls.push({ kind: 'batchGetValues', input: input as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        data: { valueRanges: [{ range: `${state.sheetName}!A:Z`, values: state.rows }] },
      };
    },
    async batchUpdateValues() {
      return {
        ok: true,
        status: 200,
        data: { responses: [{ updatedRange: `${state.sheetName}!A3` }] },
      };
    },
  });

  return {
    calls,
    restore() {
      setSheetsPortForTests(null);
    },
    getStateRows() {
      return state.rows;
    },
  };
}

(async () => {
  process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'test-token';
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet-sync-test';
  process.env.GOOGLE_SHEETS_DATA_SOURCE_ID = 'phase6-data-source';
  ensure(createOfficialSheetsClient() !== null, 'Expected official Sheets SDK client');
  ensure(createOfficialDriveClient() !== null, 'Expected official Drive SDK client');
  const previousAuthority = process.env.LIFEOS_AUTHORITY_PROVIDER;
  process.env.LIFEOS_AUTHORITY_PROVIDER = 'google_sheets';

  const replayPath = join(mkdtempSync(join(tmpdir(), 'sheets-webhook-sync-')), 'sheets-webhook-state.json');
  const canonicalPath = join(mkdtempSync(join(tmpdir(), 'sheets-canonical-sync-')), 'wonder-runtime.json');
  const previousCanonicalPath = process.env.WONDER_RUNTIME_STATE_PATH;
  process.env.WONDER_RUNTIME_STATE_PATH = canonicalPath;
  const originalReplayPath = process.env.SHEETS_WEBHOOK_REPLAY_PATH;
  process.env.SHEETS_WEBHOOK_REPLAY_PATH = replayPath;
  writeFileSync(replayPath, JSON.stringify({ events: [] }, null, 2), 'utf-8');
  clearWebhookReplayState(replayPath);

  const mock = setupMockSheetsFetch();
  const liveState = await pullSheetsRecordsLive();
  ensure(liveState.status === 'ready', 'Expected sheets live pull for sync tests');
  ensure(liveState.records.length >= 2, 'Expected at least two rows for sync tests');

  const syncPayload = {
    event: {
      spreadsheet_id: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      data_source_id: process.env.GOOGLE_SHEETS_DATA_SOURCE_ID,
      external_id: 'sheet-sync-b',
      range: 'Utopia Runtime!A3:C3',
      row: 3,
    },
    domain: 'food',
    collection: 'recipe',
    limit: 10,
  };
  const first = await syncSheetsFromWebhook(syncPayload);
  ensure(first.ok, `Expected first sync to succeed: ${first.message}`);
  ensure(first.status === 'synced', 'Expected first sync status to be synced');
  ensure(Boolean(first.sourceSnapshot && first.sourceSnapshot['row'] === 3), 'Expected row 3 source snapshot on synced result');
  ensure(Array.isArray(first.records) && first.records.length === 1, 'Expected one canonical record from sync result');
  const { findRecord } = await import('../src/runtime/state');
  ensure(findRecord('sheet-sync-b')?.source.provider === 'google_sheets', 'Expected provider sync to apply the row to canonical state');

  const replayStateBefore = getWebhookReplayState(replayPath);
  ensure(replayStateBefore.events.length === 1, 'Expected one replay event after first sync');

  process.env.LIFEOS_AUTHORITY_PROVIDER = 'notion';
  const blockedByAuthority = await syncSheetsFromWebhook({
    event: {
      event_id: 'blocked-by-notion-authority',
      spreadsheet_id: 'sheet-sync-test',
      data_source_id: 'phase6-data-source',
      external_id: 'sheet-sync-a',
      row: 2,
    },
    domain: 'food',
    collection: 'recipe',
    limit: 10,
  });
  ensure(blockedByAuthority.status === 'authority_blocked', 'Sheets must not overwrite a Notion-authoritative canonical state');
  ensure(blockedByAuthority.canonicalApplied === false, 'Authority-blocked Sheets sync must report no canonical mutation');
  process.env.LIFEOS_AUTHORITY_PROVIDER = 'google_sheets';

  const duplicate = await syncSheetsFromWebhook(syncPayload);
  ensure(duplicate.ok && duplicate.status === 'duplicate', 'Expected duplicate sync to be idempotent');
  ensure(duplicate.sourceSnapshot === null, 'Expected duplicate sync to avoid reprocessing source snapshot');

  const missingIdentified = await syncSheetsFromWebhook({
    event: {
      event_id: 'missing-phase6',
      spreadsheet_id: 'sheet-sync-test',
    },
    domain: 'food',
    collection: 'recipe',
  });
  ensure(!missingIdentified.ok && missingIdentified.status === 'missing_identifiers', 'Expected missing identifiers when external_id/row are absent');

  const notFound = await syncSheetsFromWebhook({
    event: {
      event_id: 'not-found-phase6',
      spreadsheet_id: 'sheet-sync-test',
      external_id: 'sheet-does-not-exist',
      range: 'Utopia Runtime!A999:C999',
      row: 999,
    },
    domain: 'food',
    collection: 'recipe',
  });
  ensure(!notFound.ok && notFound.status === 'not_found', 'Expected not_found for missing record');

  const mismatchSpreadsheet = await syncSheetsFromWebhook({
    event: {
      event_id: 'mismatch-spreadsheet-phase6',
      spreadsheet_id: 'other-spreadsheet',
      data_source_id: process.env.GOOGLE_SHEETS_DATA_SOURCE_ID,
      external_id: 'sheet-sync-b',
      row: 3,
    },
    domain: 'food',
    collection: 'recipe',
  });
  ensure(!mismatchSpreadsheet.ok && mismatchSpreadsheet.status === 'not_found', 'Expected not_found when event spreadsheet mismatches configured spreadsheet');

  const mismatchDataSource = await syncSheetsFromWebhook({
    event: {
      event_id: 'mismatch-source-phase6',
      spreadsheet_id: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      data_source_id: 'other-data-source',
      row: 3,
      external_id: 'sheet-sync-b',
    },
    domain: 'food',
    collection: 'recipe',
  });
  ensure(!mismatchDataSource.ok && mismatchDataSource.status === 'not_found', 'Expected not_found when event data source mismatches configured data source');

  const invalidRow = await syncSheetsFromWebhook({
    event: {
      event_id: 'invalid-row-phase6',
      spreadsheet_id: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      data_source_id: process.env.GOOGLE_SHEETS_DATA_SOURCE_ID,
      row: 0,
    },
    domain: 'food',
    collection: 'recipe',
  });
  ensure(!invalidRow.ok && invalidRow.status === 'missing_identifiers', 'Expected missing_identifiers for non-positive row value');

  mock.restore();
  process.env.SHEETS_WEBHOOK_REPLAY_PATH = originalReplayPath;
  clearWebhookReplayState(replayPath);
  rmSync(replayPath);
  if (previousCanonicalPath === undefined) {
    delete process.env.WONDER_RUNTIME_STATE_PATH;
  } else {
    process.env.WONDER_RUNTIME_STATE_PATH = previousCanonicalPath;
  }
  rmSync(canonicalPath, { force: true });
  if (previousAuthority === undefined) {
    delete process.env.LIFEOS_AUTHORITY_PROVIDER;
  } else {
    process.env.LIFEOS_AUTHORITY_PROVIDER = previousAuthority;
  }

  console.log('PASS server/test/provider-sync-sheets.ts');
})().catch((error) => {
  process.exitCode = 1;
  throw error;
});
