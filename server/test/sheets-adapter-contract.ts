import { createHash } from 'node:crypto';
import { callMcpTool, } from '../src/tools/catalog';
import { pullSheetsRecordsLive } from '../src/providers/sheets/pull';
import { writeSheetsRecord } from '../src/providers/sheets/push';
import { setSheetsPortForTests } from '../src/providers/sheets/port';

type MockCall = {
  kind: 'getSpreadsheet' | 'batchGetValues' | 'batchUpdateValues';
  input: Record<string, unknown>;
};

type LiveSheetsState = {
  spreadsheetId: string;
  sheetName: string;
  rows: string[][];
};

function parseRangeRow(range: string) {
  const match = /!A([0-9]{1,})/.exec(range);
  if (!match) {
    return null;
  }
  const row = Number.parseInt(match[1], 10);
  return Number.isNaN(row) || row <= 0 ? null : row;
}

function createHashDigest(values: string[]) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function withMockSheetsPort(state: LiveSheetsState, onCalls: (calls: MockCall[]) => void) {
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
        sheets: [{ properties: { title: state.sheetName, gridProperties: { columnCount: 26, rowCount: 100 } } }],
        },
      };
    },
    async batchGetValues(input) {
      calls.push({ kind: 'batchGetValues', input: input as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        data: {
        valueRanges: [{ range: `${state.sheetName}!A:Z`, values: state.rows }],
        },
      };
    },
    async batchUpdateValues(input) {
      calls.push({ kind: 'batchUpdateValues', input: input as Record<string, unknown> });
      const updates = Array.isArray(input.data) ? input.data : [];
      for (const update of updates) {
        const range = String(update?.range ?? '');
        const row = parseRangeRow(range);
        if (!row) {
          return { ok: false, status: 400, error: 'invalid range' };
        }
        const values = Array.isArray(update?.values?.[0]) ? update.values[0] : [];
        while (state.rows.length < row) {
          state.rows.push([]);
        }
        state.rows[row - 1] = values;
      }
      const updatedRange = String(updates[0]?.range ?? `${state.sheetName}!A2`);
      return {
        ok: true,
        status: 200,
        data: { responses: [{ updatedRange }] },
      };
    },
  });

  return {
    calls,
    finalize() {
      onCalls(calls);
      setSheetsPortForTests(null);
    },
  };
}

function ensure(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'test-token';
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet-test-1';
  process.env.GOOGLE_SHEETS_DATA_SOURCE_ID = 'phase6-data-source';

  const state: LiveSheetsState = {
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    sheetName: 'Utopia Runtime',
    rows: [
      ['id', 'title', 'domain', 'collection', 'properties', 'archived', 'version', 'updated_at', 'source', 'external_id', 'legacy_note'],
      ['sheet-phase6-adapter', 'Phase 6 Contract', 'food', 'recipe', '{"legacy":"preserved"}', 'false', '1', '2026-01-01T00:00:00.000Z', '', 'sheet-phase6-adapter', 'legacy'],
    ],
  };

  const contract = withMockSheetsPort(state, () => {});
  const pullResult = await pullSheetsRecordsLive();
  ensure(pullResult.status === 'ready', 'Expected pull to be ready');
  ensure(Array.isArray(pullResult.source_snapshots), 'Expected source_snapshots to exist');
  ensure(pullResult.source_snapshots[0]?.provider_fields?.legacy_note === 'legacy', 'Expected provider-owned unsupported fields to pass through');

  const firstSnapshot = pullResult.source_snapshots[0];
  const expectedDigest = createHashDigest(state.rows[1]);
  ensure(firstSnapshot.value_digest === expectedDigest, 'Expected canonical value digest hash to match row digest');
  ensure((firstSnapshot as { data_source_id?: string }).data_source_id === process.env.GOOGLE_SHEETS_DATA_SOURCE_ID, 'Expected pull source snapshot to include data_source_id');

  const batchGetCalls = contract.calls.filter((entry) => entry.kind === 'batchGetValues').length;
  ensure(batchGetCalls === 1, `Expected one batchGet call, got ${batchGetCalls}`);

  const writeResult = await writeSheetsRecord({
    operation: 'update_record',
    record: {
      id: 'sheet-phase6-adapter',
      domain: 'food',
      collection: 'recipe',
      title: 'Phase 6 Updated',
      properties: { legacy: 'preserved' },
      archived: false,
      externalId: 'sheet-phase6-adapter',
    },
  });
  ensure(writeResult.ok, `Expected write to succeed: ${writeResult.error}`);
  ensure(writeResult.source_snapshot?.provider_fields?.legacy_note === 'legacy', 'Expected update write to preserve unsupported fields');
  ensure(typeof writeResult.source_snapshot?.range === 'string' && writeResult.source_snapshot.range.includes('!A'), 'Expected update write source snapshot range');
  ensure(!writeResult.noChange, 'Expected write to detect mutation');
  const batchUpdateCalls = contract.calls.filter((entry) => entry.kind === 'batchUpdateValues').length;
  ensure(batchUpdateCalls === 1, `Expected one batchUpdate call, got ${batchUpdateCalls}`);

  const staleDigestResult = await writeSheetsRecord({
    operation: 'update_record',
    record: {
      id: 'sheet-phase6-adapter',
      domain: 'food',
      collection: 'recipe',
      title: 'Stale digest update',
      properties: { legacy: 'preserved' },
      archived: false,
      externalId: 'sheet-phase6-adapter',
      expectedDigest,
    },
  });
  ensure(!staleDigestResult.ok, 'Expected stale digest write to fail');
  ensure(staleDigestResult.conflict?.kind === 'digest', 'Expected digest conflict metadata');

  const staleVersionResult = await writeSheetsRecord({
    operation: 'update_record',
    record: {
      id: 'sheet-phase6-adapter',
      domain: 'food',
      collection: 'recipe',
      title: 'Stale version update',
      properties: { legacy: 'preserved' },
      archived: false,
      externalId: 'sheet-phase6-adapter',
      expectedVersion: 1,
    },
  });
  ensure(!staleVersionResult.ok, 'Expected stale version write to fail');
  ensure(staleVersionResult.conflict?.kind === 'version', 'Expected version conflict metadata');
  const conflictBatchUpdates = contract.calls.filter((entry) => entry.kind === 'batchUpdateValues').length;
  ensure(conflictBatchUpdates === 1, `Expected conflicts to avoid batchUpdate, got ${conflictBatchUpdates}`);

  const batchUpdateBeforeNoChange = contract.calls.filter((entry) => entry.kind === 'batchUpdateValues').length;
  const noChangeState = await writeSheetsRecord({
    operation: 'update_record',
    record: {
      id: 'sheet-phase6-adapter',
      domain: 'food',
      collection: 'recipe',
      title: 'Phase 6 Updated',
      properties: { legacy: 'preserved' },
      archived: false,
      externalId: 'sheet-phase6-adapter',
    },
  });
  ensure(noChangeState.ok, `Expected no-change write to succeed: ${noChangeState.error}`);
  ensure(noChangeState.noChange === true, 'Expected no-change write branch');
  ensure(noChangeState.source_snapshot?.noChange === true, 'Expected no-change source snapshot marker');
  const noChangeBatchUpdate = contract.calls.filter((entry) => entry.kind === 'batchUpdateValues').length;
  ensure(noChangeBatchUpdate === batchUpdateBeforeNoChange, `Expected no batchUpdate on no-change write, got delta ${noChangeBatchUpdate - batchUpdateBeforeNoChange}`);

  const pullContractIdem = await pullSheetsRecordsLive();
  const rowDigestAfter = createHashDigest(state.rows[1]);
  ensure(
    pullContractIdem.source_snapshots[0]?.revision === rowDigestAfter,
    'Expected pull revision to match persisted row hash for parity',
  );

  const canonicalResult = await pullSheetsRecordsLive();
  ensure(
    canonicalResult.source_snapshots[0]?.value_digest === canonicalResult.source_snapshots[0]?.revision,
    'Expected revision and value digest parity in source snapshot',
  );

  const createMcpResult = await callMcpTool('utopia.create_record', {
    actor: 'hearth',
    domain: 'food',
    collection: 'recipe',
    data_home: 'google_sheets',
    id: 'sheet-phase6-nochange',
    title: 'MCP no-change guard',
    properties: { legacy: 'guard' },
  });
  const createdId = (createMcpResult.json?.record as { id?: string })?.id;
  ensure(typeof createdId === 'string' && createdId.length > 0, 'Expected MCP create_record to return new record');

  const mcpUpdateNoChange = await callMcpTool('utopia.update_record', {
    actor: 'hearth',
    id: createdId,
    data_home: 'google_sheets',
    patch: {
      title: 'MCP no-change guard',
      properties: { legacy: 'guard' },
    },
  });
  ensure(!('undo_token' in mcpUpdateNoChange), 'Expected no undo token on no-change MCP update');
  ensure(!mcpUpdateNoChange.receipts, 'Expected no undo receipts on no-change MCP update');

  contract.finalize();
  console.log('PASS server/test/sheets-adapter-contract.ts');
  return;
})().catch((error) => {
  process.exitCode = 1;
  throw error;
});
