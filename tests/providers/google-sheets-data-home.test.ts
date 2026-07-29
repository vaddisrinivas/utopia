import { describe, expect, it } from 'vitest';

import { createGoogleSheetsDataHomeAdapter, type GoogleSheetsDataHomeConfig, type GoogleSheetsDataHomeSnapshot, type GoogleSheetsDataHomeTransport } from '@/src/providers/google-sheets-data-home';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';

const HEADERS = [
  'id',
  'title',
  'domain',
  'collection',
  'properties',
  'relations',
  'archived',
  'revision',
  'created_at',
  'updated_at',
  'source',
  'external_id',
  'app_installation_id',
  'archived_at',
  'legacy_note',
];

function makeConfig(partial: Partial<GoogleSheetsDataHomeConfig> = {}): GoogleSheetsDataHomeConfig {
  return {
    dataHome: 'google_sheets',
    installationId: 'app-a',
    declaredDataHomes: ['sqlite', 'google_sheets'],
    spreadsheetId: 'sheet-1',
    sheetName: 'Utopia Canonical',
    token: 'token-a',
    session: 'session-a',
    online: true,
    ...partial,
  };
}

function makeRecord(input: {
  id: string;
  title?: string;
  revision?: number;
  archived_at?: string | null;
  updated_at?: string;
  created_at?: string;
}): CanonicalRecord {
  const now = input.updated_at ?? '2026-07-29T01:00:00.000Z';
  return {
    id: input.id,
    domain: 'food',
    collection: 'recipe',
    title: input.title ?? input.id,
    properties: { body: input.title ?? input.id },
    relations: [],
    source: {
      provider: 'google_sheets',
      external_id: input.id,
      url: `https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0`,
      observed_at: now,
      content_hash: `sha256:${input.id}`,
    },
    archived_at: input.archived_at ?? null,
    created_at: input.created_at ?? '2026-07-29T00:00:00.000Z',
    updated_at: now,
    revision: input.revision ?? 1,
    schema_version: 'utopia.data-home-contract.v1',
    deleted: false,
    privacy: 'personal',
    provenance: null,
  };
}

function makeTransport(
  rows: unknown[][],
  options: {
    spreadsheetId?: string;
    sheetName?: string;
    sheetId?: number;
    sheets?: Array<{ title: string; sheetId: number }>;
    offline?: boolean;
  } = {},
) {
  const calls: Array<{ kind: 'getSpreadsheet' | 'getValues'; input: Record<string, unknown> }> = [];
  const spreadsheetId = options.spreadsheetId ?? 'sheet-1';
  const sheetName = options.sheetName ?? 'Utopia Canonical';
  const sheets = options.sheets ?? [{ title: sheetName, sheetId: options.sheetId ?? 0 }];
  const transport: GoogleSheetsDataHomeTransport = {
    async getSpreadsheet(input) {
      calls.push({ kind: 'getSpreadsheet', input: input as Record<string, unknown> });
      if (options.offline) {
        return { ok: false, status: 0, error: 'offline' };
      }
      return {
        ok: true,
        status: 200,
        data: {
          spreadsheetId,
          properties: { title: 'Utopia Canonical Workbook' },
          sheets: sheets.map((sheet) => ({
            properties: {
              title: sheet.title,
              sheetId: sheet.sheetId,
              gridProperties: { columnCount: 16, rowCount: rows.length },
            },
          })),
        },
      };
    },
    async getValues(input) {
      calls.push({ kind: 'getValues', input: input as Record<string, unknown> });
      if (options.offline) {
        return { ok: false, status: 0, error: 'offline' };
      }
      return {
        ok: true,
        status: 200,
        data: { range: `${String(input.sheetName)}!A:O`, values: rows },
      };
    },
  };
  return { transport, calls };
}

function makeRows(input: Array<Record<string, string>>) {
  return [
    HEADERS,
    ...input.map((row) => HEADERS.map((header) => row[header] ?? '')),
  ];
}

describe('google sheets data home adapter', () => {
  it('pulls canonical records and preserves provider fields', async () => {
    const rows = makeRows([
      {
        id: 'app-a-row-1',
        title: 'Alpha',
        domain: 'food',
        collection: 'recipe',
        properties: '{"body":"Alpha"}',
        relations: '[]',
        archived: 'false',
        revision: '2',
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T01:00:00.000Z',
        source: JSON.stringify({
          provider: 'google_sheets',
          external_id: 'app-a-row-1',
          url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
          observed_at: '2026-07-29T01:00:00.000Z',
          content_hash: 'sha256:app-a-row-1',
        }),
        external_id: 'app-a-row-1',
        app_installation_id: 'app-a',
        archived_at: '',
        legacy_note: 'legacy',
      },
    ]);
    const { transport, calls } = makeTransport(rows, {
      sheets: [
        { title: 'Archive', sheetId: 7 },
        { title: 'Utopia Canonical', sheetId: 42 },
      ],
    });
    const adapter = createGoogleSheetsDataHomeAdapter(makeConfig(), transport);

    const result = await adapter.pull();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: 'app-a-row-1',
      title: 'Alpha',
      domain: 'food',
      collection: 'recipe',
      revision: 2,
      source: {
        provider: 'google_sheets',
        external_id: 'app-a-row-1',
      },
    });
    expect(result.source_snapshots[0]).toMatchObject({
      provider: 'google_sheets',
      installationId: 'app-a',
      spreadsheetId: 'sheet-1',
      sheetName: 'Utopia Canonical',
      sheetId: 42,
      rowNumber: 2,
      externalId: 'app-a-row-1',
      revision: 2,
    });
    expect(result.source_snapshots[0]?.providerFields).toEqual({ legacy_note: 'legacy' });
    expect(result.source_snapshots[0]?.valueDigest).toBe(
      sha256Canonical({
        installationId: 'app-a',
        spreadsheetId: 'sheet-1',
        sheetName: 'Utopia Canonical',
        rowNumber: 2,
        row: rows[1],
      }),
    );
    expect(calls[1]?.input).toMatchObject({
      sheetName: 'Utopia Canonical',
      range: "'Utopia Canonical'!A:N",
    });
    expect(calls.map((call) => call.kind)).toEqual(['getSpreadsheet', 'getValues']);
  });

  it('respects cursors and stays idempotent for repeated pulls', async () => {
    const rows = makeRows([
      {
        id: 'app-a-row-1',
        title: 'Alpha',
        domain: 'food',
        collection: 'recipe',
        properties: '{"body":"Alpha"}',
        relations: '[]',
        archived: 'false',
        revision: '1',
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T01:00:00.000Z',
        source: JSON.stringify({
          provider: 'google_sheets',
          external_id: 'app-a-row-1',
          url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
          observed_at: '2026-07-29T01:00:00.000Z',
          content_hash: 'sha256:app-a-row-1',
        }),
        external_id: 'app-a-row-1',
        app_installation_id: 'app-a',
      },
      {
        id: 'app-a-row-2',
        title: 'Beta',
        domain: 'food',
        collection: 'recipe',
        properties: '{"body":"Beta"}',
        relations: '[]',
        archived: 'false',
        revision: '2',
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T02:00:00.000Z',
        source: JSON.stringify({
          provider: 'google_sheets',
          external_id: 'app-a-row-2',
          url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
          observed_at: '2026-07-29T02:00:00.000Z',
          content_hash: 'sha256:app-a-row-2',
        }),
        external_id: 'app-a-row-2',
        app_installation_id: 'app-a',
      },
    ]);
    const { transport } = makeTransport(rows);
    const adapter = createGoogleSheetsDataHomeAdapter(makeConfig(), transport);

    const first = await adapter.pull({ cursor: 'row:2', limit: 1 });
    const second = await adapter.pull({ cursor: 'row:2', limit: 1 });

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.records[0].id).toBe('app-a-row-2');
    expect(first.nextCursor).toBe('row:3');
  });

  it('plans create, update, and archive writes deterministically', async () => {
    const rows = makeRows([
      {
        id: 'app-a-row-1',
        title: 'Alpha',
        domain: 'food',
        collection: 'recipe',
        properties: '{"body":"Alpha"}',
        relations: '[]',
        archived: 'false',
        revision: '2',
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T01:00:00.000Z',
        source: JSON.stringify({
          provider: 'google_sheets',
          external_id: 'app-a-row-1',
          url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
          observed_at: '2026-07-29T01:00:00.000Z',
          content_hash: 'sha256:app-a-row-1',
        }),
        external_id: 'app-a-row-1',
        app_installation_id: 'app-a',
      },
    ]);
    const { transport } = makeTransport(rows, {
      sheets: [
        { title: 'Archive', sheetId: 7 },
        { title: 'Utopia Canonical', sheetId: 42 },
      ],
    });
    const adapter = createGoogleSheetsDataHomeAdapter(makeConfig(), transport);
    const pull = await adapter.pull();
    expect(pull.ok).toBe(true);
    if (!pull.ok) return;
    const current = pull.source_snapshots[0];
    const updateRecord = makeRecord({ id: 'app-a-row-1', title: 'Alpha Updated', revision: 2 });

    const createPlan = adapter.planWrite({
      operation: 'create_record',
      record: makeRecord({ id: 'app-a-row-2', title: 'Bravo', revision: 1 }),
    });
    expect(createPlan).toMatchObject({
      ok: true,
      status: 'ready',
      operation: 'create_record',
    });
    if (!createPlan.ok) return;
    expect(createPlan.requests[0]).toMatchObject({
      kind: 'values.append',
      range: "'Utopia Canonical'!A:N",
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
    });
    const createRow = (createPlan.requests[0].body as { values: string[][] }).values[0];
    expect(createRow).toEqual([
      'app-a-row-2',
      'Bravo',
      'food',
      'recipe',
      '{"body":"Bravo"}',
      '[]',
      'false',
      '1',
      '2026-07-29T00:00:00.000Z',
      '2026-07-29T01:00:00.000Z',
      expect.any(String),
      'app-a-row-2',
      'app-a',
      '',
    ]);
    expect(JSON.parse(createRow[10])).toMatchObject({
      provider: 'google_sheets',
      external_id: 'app-a-row-2',
      observed_at: '2026-07-29T01:00:00.000Z',
      content_hash: 'sha256:app-a-row-2',
      url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
    });

    const updatePlan = adapter.planWrite({
      operation: 'update_record',
      record: updateRecord,
      current,
      expectedRevision: 2,
      expectedDigest: current.valueDigest,
    });
    expect(updatePlan).toMatchObject({
      ok: true,
      status: 'ready',
      operation: 'update_record',
    });
    if (!updatePlan.ok) return;
    expect(updatePlan.requests[0]).toMatchObject({
      kind: 'values.update',
      range: "'Utopia Canonical'!A2:N2",
      valueInputOption: 'RAW',
    });
    const updateRow = (updatePlan.requests[0].body as { values: string[][] }).values[0];
    expect(updateRow).toEqual([
      'app-a-row-1',
      'Alpha Updated',
      'food',
      'recipe',
      '{"body":"Alpha Updated"}',
      '[]',
      'false',
      '2',
      '2026-07-29T00:00:00.000Z',
      '2026-07-29T01:00:00.000Z',
      expect.any(String),
      'app-a-row-1',
      'app-a',
      '',
      '',
    ]);
    expect(JSON.parse(updateRow[10])).toMatchObject({
      provider: 'google_sheets',
      external_id: 'app-a-row-1',
      observed_at: '2026-07-29T01:00:00.000Z',
      content_hash: 'sha256:app-a-row-1',
      url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
    });

    const archivePlan = adapter.planWrite({
      operation: 'archive_record',
      record: { ...updateRecord, archived_at: '2026-07-29T03:00:00.000Z' },
      current,
      expectedRevision: 2,
    });
    expect(archivePlan).toMatchObject({
      ok: true,
      status: 'ready',
      operation: 'archive_record',
    });
    if (!archivePlan.ok) return;
    expect(archivePlan.requests[0]).toMatchObject({
      kind: 'values.update',
      range: "'Utopia Canonical'!A2:N2",
    });
    const archiveRow = (archivePlan.requests[0].body as { values: string[][] }).values[0];
    expect(archiveRow).toEqual([
      'app-a-row-1',
      'Alpha Updated',
      'food',
      'recipe',
      '{"body":"Alpha Updated"}',
      '[]',
      'true',
      '2',
      '2026-07-29T00:00:00.000Z',
      '2026-07-29T01:00:00.000Z',
      expect.any(String),
      'app-a-row-1',
      'app-a',
      '2026-07-29T03:00:00.000Z',
      '',
    ]);
    expect(JSON.parse(archiveRow[10])).toMatchObject({
      provider: 'google_sheets',
      external_id: 'app-a-row-1',
      observed_at: '2026-07-29T01:00:00.000Z',
      content_hash: 'sha256:app-a-row-1',
      url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
    });

    const blockedDelete = adapter.planWrite({
      operation: 'delete_record',
      record: updateRecord,
      current,
      expectedRevision: 2,
    });
    expect(blockedDelete).toMatchObject({
      ok: false,
      status: 'blocked',
      reason: 'destructive_delete_blocked',
    });

    const unsafeDelete = adapter.planWrite({
      operation: 'delete_record',
      record: updateRecord,
      current,
      expectedRevision: 2,
      allowUnsafeDelete: true,
    });
    expect(unsafeDelete).toMatchObject({
      ok: true,
      status: 'ready',
      operation: 'delete_record',
    });
    if (!unsafeDelete.ok) return;
    expect(unsafeDelete.requests[0]).toMatchObject({
      kind: 'deleteDimension',
      body: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: 42,
                dimension: 'ROWS',
                startIndex: 1,
                endIndex: 2,
              },
            },
          },
        ],
      },
    });
  });

  it('fails closed on an invalid selected sheet id', async () => {
    const rows = makeRows([
      {
        id: 'app-a-row-1',
        title: 'Alpha',
        domain: 'food',
        collection: 'recipe',
        properties: '{"body":"Alpha"}',
        relations: '[]',
        archived: 'false',
        revision: '1',
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T01:00:00.000Z',
        source: JSON.stringify({
          provider: 'google_sheets',
          external_id: 'app-a-row-1',
          url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
          observed_at: '2026-07-29T01:00:00.000Z',
          content_hash: 'sha256:app-a-row-1',
        }),
        external_id: 'app-a-row-1',
        app_installation_id: 'app-a',
      },
    ]);
    const adapter = createGoogleSheetsDataHomeAdapter(
      makeConfig(),
      makeTransport(rows, {
        sheets: [
          { title: 'Archive', sheetId: 7 },
          { title: 'Utopia Canonical', sheetId: Number.NaN },
        ],
      }).transport,
    );

    const result = await adapter.pull();
    expect(result).toMatchObject({
      ok: false,
      status: 'blocked',
      reason: 'invalid_sheet_id',
    });
  });

  it('keeps installation scope isolated across adapters', async () => {
    const rowsA = makeRows([
      {
        id: 'app-a-row-1',
        title: 'Alpha',
        domain: 'food',
        collection: 'recipe',
        properties: '{"body":"Alpha"}',
        relations: '[]',
        archived: 'false',
        revision: '1',
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T01:00:00.000Z',
        source: JSON.stringify({
          provider: 'google_sheets',
          external_id: 'app-a-row-1',
          url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
          observed_at: '2026-07-29T01:00:00.000Z',
          content_hash: 'sha256:app-a-row-1',
        }),
        external_id: 'app-a-row-1',
        app_installation_id: 'app-a',
      },
    ]);
    const rowsB = makeRows([
      {
        id: 'app-b-row-1',
        title: 'Beta',
        domain: 'food',
        collection: 'recipe',
        properties: '{"body":"Beta"}',
        relations: '[]',
        archived: 'false',
        revision: '1',
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T01:00:00.000Z',
        source: JSON.stringify({
          provider: 'google_sheets',
          external_id: 'app-b-row-1',
          url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
          observed_at: '2026-07-29T01:00:00.000Z',
          content_hash: 'sha256:app-b-row-1',
        }),
        external_id: 'app-b-row-1',
        app_installation_id: 'app-b',
      },
    ]);

    const adapterA = createGoogleSheetsDataHomeAdapter(makeConfig({ installationId: 'app-a' }), makeTransport(rowsA).transport);
    const adapterB = createGoogleSheetsDataHomeAdapter(makeConfig({ installationId: 'app-b' }), makeTransport(rowsB).transport);

    const pullA = await adapterA.pull();
    const pullB = await adapterB.pull();
    expect(pullA.ok).toBe(true);
    expect(pullB.ok).toBe(true);
    if (!pullA.ok || !pullB.ok) return;

    const planA = adapterA.planWrite({
      operation: 'update_record',
      record: makeRecord({ id: 'app-a-row-1', title: 'Alpha', revision: 1 }),
      current: pullA.source_snapshots[0],
      expectedRevision: 1,
    });
    const planB = adapterB.planWrite({
      operation: 'update_record',
      record: makeRecord({ id: 'app-b-row-1', title: 'Beta', revision: 1 }),
      current: pullB.source_snapshots[0],
      expectedRevision: 1,
    });

    expect(planA.ok).toBe(true);
    expect(planB.ok).toBe(true);
    if (!planA.ok || !planB.ok) return;
    expect(planA.requestKey).not.toBe(planB.requestKey);
    expect(planA.source_snapshot.installationId).toBe('app-a');
    expect(planB.source_snapshot.installationId).toBe('app-b');
  });

  it('blocks offline states and missing auth', async () => {
    const offlineAdapter = createGoogleSheetsDataHomeAdapter(
      makeConfig({ online: false }),
      makeTransport([], { offline: true }).transport,
    );
    const offlineResult = await offlineAdapter.pull();
    expect(offlineResult).toMatchObject({
      ok: false,
      status: 'offline',
      reason: 'offline',
    });

    const missingTokenAdapter = createGoogleSheetsDataHomeAdapter(
      makeConfig({ token: null }),
      makeTransport([]).transport,
    );
    const missingTokenResult = await missingTokenAdapter.pull();
    expect(missingTokenResult).toMatchObject({
      ok: false,
      status: 'blocked',
      reason: 'missing_token',
    });

    const missingSessionAdapter = createGoogleSheetsDataHomeAdapter(
      makeConfig({ session: null }),
      makeTransport([]).transport,
    );
    const missingSessionResult = await missingSessionAdapter.planWrite({
      operation: 'create_record',
      record: makeRecord({ id: 'app-a-row-2', title: 'Bravo', revision: 1 }),
    });
    expect(missingSessionResult).toMatchObject({
      ok: false,
      status: 'blocked',
      reason: 'missing_session',
    });
  });

  it('fails closed on hostile formula cells and revision conflicts', async () => {
    const formulaRows = makeRows([
      {
        id: 'app-a-row-1',
        title: '=HYPERLINK("https://evil.example","click")',
        domain: 'food',
        collection: 'recipe',
        properties: '{"body":"Alpha"}',
        relations: '[]',
        archived: 'false',
        revision: '1',
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T01:00:00.000Z',
        source: JSON.stringify({
          provider: 'google_sheets',
          external_id: 'app-a-row-1',
          url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
          observed_at: '2026-07-29T01:00:00.000Z',
          content_hash: 'sha256:app-a-row-1',
        }),
        external_id: 'app-a-row-1',
        app_installation_id: 'app-a',
      },
    ]);
    const formulaAdapter = createGoogleSheetsDataHomeAdapter(makeConfig(), makeTransport(formulaRows).transport);
    const formulaResult = await formulaAdapter.pull();
    expect(formulaResult).toMatchObject({
      ok: false,
      status: 'blocked',
      reason: 'formula_injection_risk',
    });

    const rows = makeRows([
      {
        id: 'app-a-row-1',
        title: 'Alpha',
        domain: 'food',
        collection: 'recipe',
        properties: '{"body":"Alpha"}',
        relations: '[]',
        archived: 'false',
        revision: '2',
        created_at: '2026-07-29T00:00:00.000Z',
        updated_at: '2026-07-29T01:00:00.000Z',
        source: JSON.stringify({
          provider: 'google_sheets',
          external_id: 'app-a-row-1',
          url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
          observed_at: '2026-07-29T01:00:00.000Z',
          content_hash: 'sha256:app-a-row-1',
        }),
        external_id: 'app-a-row-1',
        app_installation_id: 'app-a',
      },
    ]);
    const adapter = createGoogleSheetsDataHomeAdapter(makeConfig(), makeTransport(rows).transport);
    const pull = await adapter.pull();
    expect(pull.ok).toBe(true);
    if (!pull.ok) return;

    const conflict = adapter.planWrite({
      operation: 'update_record',
      record: makeRecord({ id: 'app-a-row-1', title: 'Alpha', revision: 2 }),
      current: pull.source_snapshots[0],
      expectedRevision: 1,
    });
    expect(conflict).toMatchObject({
      ok: false,
      status: 'conflict',
      reason: 'revision_conflict',
    });
  });
});
