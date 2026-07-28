import { createHash } from 'node:crypto';
import { nowIsoNow, ProviderOperation, ProviderWriteResult } from '../contracts';
import { readSheetsConfig } from './client';
import { SHEETS_WORKBOOK_DEFAULT_RANGE, SHEETS_WORKBOOK_TAB_PREFIX } from './client';
import { CANONICAL_RUNTIME_TAB_NAME, WELL_KNOWN_RUNTIME_COLUMNS, parseWorkBookMetadata } from './workbook';
import { canonicalJson } from '@/src/domain/canonical-json';
import { getSheetsPort } from './port';

type SheetsRecord = {
  id: string;
  domain: string;
  collection: string;
  title: string;
  properties?: Record<string, unknown>;
  relations?: Array<{ name: string; target_id: string }>;
  archived?: boolean;
  version?: number;
  expectedVersion?: number;
  expectedDigest?: string;
  source?: Record<string, unknown>;
  externalId?: string;
};

type SheetsMetadataResponse = {
  spreadsheetId?: string;
  properties?: { title?: string; locale?: string };
  spreadsheetUrl?: string;
  sheets?: Array<{ properties?: { title?: string; sheetId?: number; gridProperties?: { columnCount?: number; rowCount?: number } } }>;
};

type SheetRuntimeState = {
  spreadsheetId: string;
  tab: string;
  gridColumns: number;
  header: string[];
  dataRows: string[][];
  sourceSnapshots: Array<{
    row: number;
    data: string[];
    header: string[];
    value_digest: string;
    range: string;
  }>;
};

type SourceCellMap = {
  utopiaId: number;
  id: number;
  title: number;
  domain: number;
  collection: number;
  properties: number;
  foodDetail: number;
  relations: number;
  archived: number;
  version: number;
  updatedAt: number;
  source: number;
  externalId: number;
};

type SheetsBatchUpdateResponse = {
  responses?: Array<{ updatedRange?: string; updatedRows?: number; updatedColumns?: number }>;
};

type SheetsBatchGetResponse = {
  valueRanges?: Array<{ range?: string; values?: unknown[] }>;
};

type WriteSourceSnapshot = {
  provider: 'google_sheets';
  operation: ProviderOperation;
  spreadsheet_id: string;
  data_source_id?: string;
  sheet_name: string;
  row: number;
  range: string;
  address: string;
  before?: { id: string; row: string[]; value_digest: string } | null;
  after: { id: string; row: string[]; value_digest: string };
  beforeDigest?: string;
  afterDigest: string;
  revision: string;
  valueDigest: string;
  provider_fields: Record<string, unknown>;
  noChange?: boolean;
};

type WriteRuntimeRowResult = {
  ok: boolean;
  error?: string;
  updatedRange?: string;
  noChange?: boolean;
};

const RUNTIME_TAB_PREFIX = `${SHEETS_WORKBOOK_TAB_PREFIX} Runtime`;
const VALUE_INPUT_OPTION = 'USER_ENTERED';
const VALUE_RANGE_TYPE = 'ROWS';

export type SheetsWriteInput = {
  operation: ProviderOperation;
  record: Omit<SheetsRecord, 'properties'> & { properties?: Record<string, unknown> };
};

function nowDigest(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function toText(value: unknown) {
  return String(value ?? '').trim();
}

function parseBool(value: unknown) {
  const normalized = toText(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function buildColumnIndexes(header: string[]): SourceCellMap {
  const normalized = header.map((name) => toText(name).toLowerCase());
  return {
    utopiaId: normalized.indexOf('utopia_id'),
    id: normalized.indexOf('id'),
    title: normalized.indexOf('title'),
    domain: normalized.indexOf('domain'),
    collection: normalized.indexOf('collection'),
    properties: normalized.indexOf('properties'),
    foodDetail: normalized.indexOf('food_detail'),
    relations: normalized.indexOf('relations'),
    archived: normalized.indexOf('archived'),
    version: normalized.indexOf('version'),
    updatedAt: normalized.indexOf('updated_at'),
    source: normalized.indexOf('source'),
    externalId: normalized.indexOf('external_id'),
  };
}

function normalizeCellValue(indexes: SourceCellMap, row: string[], key: keyof SourceCellMap) {
  const idx = indexes[key];
  return idx >= 0 && idx < row.length ? toText(row[idx]) : '';
}

function normalizeManagedVersion(indexes: SourceCellMap, row: string[]) {
  const idx = indexes.version;
  if (idx < 0 || idx >= row.length) {
    return 1;
  }
  const parsed = Number.parseInt(toText(row[idx]), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rowsEqual(left: string[], right: string[]) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (toText(left[index]) !== toText(right[index])) {
      return false;
    }
  }
  return true;
}

function rowDigest(values: string[]) {
  return JSON.stringify(values);
}

function toColumnLetter(column: number) {
  let next = column + 1;
  let out = '';
  while (next > 0) {
    const rem = (next - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    next = Math.floor((next - 1) / 26);
  }
  return out;
}

function buildRange(tab: string, row: number, columns: number) {
  const endColumn = toColumnLetter(Math.max(1, columns));
  return `${tab}!A${row}:${endColumn}${row}`;
}

function collectProviderFields(header: string[], row: string[]) {
  const supported = new Set(WELL_KNOWN_RUNTIME_COLUMNS.map((name) => toText(name).toLowerCase().trim()));
  const fields: Record<string, unknown> = {};
  header.forEach((name, index) => {
    const normalized = name.toLowerCase().trim();
    if (supported.has(normalized)) {
      return;
    }
    fields[name] = row[index] ?? '';
  });
  return fields;
}

function clearNoopMetadata(indexes: SourceCellMap, row: string[], width: number) {
  const next = row.slice(0, Math.max(row.length, width));
  while (next.length < width) {
    next.push('');
  }
  if (indexes.version >= 0 && indexes.version < next.length) {
    next[indexes.version] = '';
  }
  if (indexes.updatedAt >= 0 && indexes.updatedAt < next.length) {
    next[indexes.updatedAt] = '';
  }
  return next;
}

function parseManagedTargetValue(input: {
  row: string[] | null;
  header: string[];
  operation: ProviderOperation;
  record: {
    id: string;
    domain: string;
    collection: string;
    title: string;
    properties: Record<string, unknown>;
    relations?: Array<{ name: string; target_id: string }>;
    archived: boolean;
    source: Record<string, unknown>;
    externalId: string;
    version?: number;
  };
}) {
  const indexes = buildColumnIndexes(input.header);
  const managed: string[] = Array.from(input.row ?? []);
  const width = Math.max(input.header.length, managed.length || 0, 1);
  while (managed.length < width) {
    managed.push('');
  }

  const now = nowIsoNow();
  const currentVersion = input.row && indexes.version >= 0 ? normalizeManagedVersion(indexes, input.row) : 1;
  const targetVersion =
    input.operation === 'create_record'
      ? 1
      : Number.isFinite(input.record.version ?? NaN) ? Math.max(input.record.version || 0, currentVersion + 1) : currentVersion + 1;

  const updates: Record<number, string> = {
    [indexes.utopiaId]: input.record.id,
    [indexes.id]: input.record.id,
    [indexes.title]: input.record.title,
    [indexes.domain]: input.record.domain,
    [indexes.collection]: input.record.collection,
    [indexes.properties]: JSON.stringify(input.record.properties),
    [indexes.foodDetail]: JSON.stringify(input.record.properties.food_detail ?? {}),
    [indexes.relations]: JSON.stringify(input.record.relations ?? []),
    [indexes.archived]: input.record.archived ? 'true' : 'false',
    [indexes.version]: String(targetVersion),
    [indexes.updatedAt]: now,
    [indexes.source]: JSON.stringify(input.record.source),
    [indexes.externalId]: input.record.externalId,
  };

  for (const [rawIndex, value] of Object.entries(updates)) {
    const index = Number(rawIndex);
    if (Number.isNaN(index) || index < 0) {
      continue;
    }
    while (managed.length <= index) {
      managed.push('');
    }
    managed[index] = value;
  }

  return { row: managed, version: targetVersion, valueDigest: nowDigest(managed), digest: rowDigest(managed) };
}

function ensureSpreadsheetConfig() {
  const config = readSheetsConfig();
  if (!config) {
    return { ok: false as const, reason: 'GOOGLE_SHEETS_ACCESS_TOKEN is not configured.' };
  }
  if (!config.spreadsheetId) {
    return { ok: false as const, reason: 'GOOGLE_SHEETS_SPREADSHEET_ID is missing.' };
  }
  return { ok: true as const, config };
}

function resolveSheetsDataSourceId(config?: { dataSourceId?: string } | null) {
  const sourceId = (config ?? readSheetsConfig())?.dataSourceId?.trim();
  return sourceId && sourceId.length > 0 ? sourceId : undefined;
}

function parseRuntimeValues(values: unknown): { header: string[]; rows: string[][] } {
  if (!Array.isArray(values) || values.length === 0) {
    return { header: [], rows: [] };
  }
  const rawHeader = Array.isArray(values[0]) ? values[0] : [];
  const header = rawHeader.map(toText);
  const rows = values
    .slice(1)
    .map((row) => (Array.isArray(row) ? row.map(toText) : []))
    .filter((row) => row.some((cell) => cell.length > 0));
  return { header, rows };
}

async function readRuntimeState(): Promise<SheetRuntimeState | { ok: false; reason: string; status?: number }> {
  const prepared = ensureSpreadsheetConfig();
  if (!prepared.ok) {
    return { ok: false, reason: prepared.reason };
  }

  const spreadsheetId = prepared.config.spreadsheetId;
  if (!spreadsheetId) {
    return { ok: false, reason: 'GOOGLE_SHEETS_SPREADSHEET_ID is missing.' };
  }

  const port = getSheetsPort(prepared.config);
  if (!port) {
    return { ok: false, reason: 'Google Sheets SDK port is unavailable.' };
  }

  const metadataResponse = await port.getSpreadsheet({
    spreadsheetId,
  });
  if (!metadataResponse.ok) {
    return { ok: false, reason: metadataResponse.error || 'Unable to read workbook metadata.', status: metadataResponse.status };
  }

  const metadata = parseWorkBookMetadata(metadataResponse.data || {}, spreadsheetId);
  const runtimeTab =
    metadata.tabs.find((tab) => tab.title === CANONICAL_RUNTIME_TAB_NAME) ||
    metadata.tabs.find((tab) => tab.title === RUNTIME_TAB_PREFIX) ||
    metadata.tabs[0];
  if (!runtimeTab) {
    return { ok: false, reason: 'Utopia Runtime tab missing.' };
  }

  const range = `${runtimeTab.title}!${SHEETS_WORKBOOK_DEFAULT_RANGE}`;
  const valuesResponse = await port.batchGetValues({
    spreadsheetId,
    majorDimension: 'ROWS',
    ranges: [range],
  });
  if (!valuesResponse.ok) {
    return { ok: false, reason: valuesResponse.error || 'Unable to read Utopia Runtime values.', status: valuesResponse.status };
  }

  const first = Array.isArray(valuesResponse.data?.valueRanges) ? valuesResponse.data.valueRanges[0] : undefined;
  const { header, rows } = parseRuntimeValues(first?.values);
  const sourceSnapshots = rows.map((row, index) => ({
    row: index + 2,
    data: row,
    header,
    value_digest: rowDigest(row),
    range: buildRange(runtimeTab.title, index + 2, Math.max(header.length, row.length, 1)),
  }));

  return {
    spreadsheetId,
    tab: runtimeTab.title,
    gridColumns: runtimeTab.gridColumns,
    header,
    dataRows: rows,
    sourceSnapshots,
  };
}

function findRowForRecord(state: SheetRuntimeState, recordId: string) {
  const indexes = buildColumnIndexes(state.header);
  for (let index = 0; index < state.sourceSnapshots.length; index += 1) {
    const entry = state.sourceSnapshots[index];
    const row = entry.data;
    const candidate =
      normalizeCellValue(indexes, row, 'utopiaId') ||
      normalizeCellValue(indexes, row, 'id') ||
      normalizeCellValue(indexes, row, 'externalId') ||
      (row[0] ?? '');
    if (candidate === recordId) {
      return {
        rowNumber: index + 2,
        row,
      };
    }
  }
  return null;
}

function ensureRowExists(state: SheetRuntimeState) {
  return state.dataRows.length + 2;
}

async function writeRuntimeRows(input: {
  state: SheetRuntimeState;
  rowNumber: number;
  values: string[];
}): Promise<WriteRuntimeRowResult> {
  const range = buildRange(input.state.tab, input.rowNumber, Math.max(input.state.header.length, input.values.length, 1));
  const port = getSheetsPort(readSheetsConfig() ?? undefined);
  if (!port) {
    return { ok: false, error: 'Google Sheets SDK port is unavailable.' };
  }

  const response = await port.batchUpdateValues({
    spreadsheetId: input.state.spreadsheetId,
    valueInputOption: VALUE_INPUT_OPTION,
    data: [
      {
        range,
        majorDimension: VALUE_RANGE_TYPE,
        values: [input.values],
      },
    ],
  });

  if (!response.ok) {
    return { ok: false, error: response.error || 'Google Sheets batchUpdate failed.' };
  }
  if (!Array.isArray(response.data?.responses)) {
    return { ok: false, error: 'Google Sheets batchUpdate returned malformed response.' };
  }
  if (response.data?.responses.length !== 1) {
    return { ok: false, error: 'Google Sheets batchUpdate returned partial response for write request.' };
  }
  const updatedRange = response.data.responses[0]?.updatedRange;
  if (!updatedRange) {
    return { ok: false, error: 'Google Sheets batchUpdate returned no updated range.' };
  }
  return { ok: true, updatedRange };
}

export function buildSheetsWriteSource(input: {
  operation: ProviderOperation;
  recordId: string;
  domain: string;
  collection: string;
  title?: string;
  externalId?: string;
}): ProviderWriteResult {
  const prepared = ensureSpreadsheetConfig();
  if (!prepared.ok) {
    return {
      ok: false,
      source: {
        provider: 'google_sheets',
        external_id: '',
        url: null,
        observed_at: nowIsoNow(),
        content_hash: null,
      },
      source_snapshot: {
        provider: 'google_sheets',
        operation: input.operation,
        spreadsheet_id: '',
        data_source_id: resolveSheetsDataSourceId(),
        sheet_name: `${SHEETS_WORKBOOK_TAB_PREFIX} Runtime`,
        row: 0,
        range: `${SHEETS_WORKBOOK_TAB_PREFIX} Runtime!A1`,
        address: `${SHEETS_WORKBOOK_TAB_PREFIX} Runtime!A1`,
        beforeDigest: undefined,
        afterDigest: null,
        revision: '',
        valueDigest: '',
        provider_fields: {},
      },
      operation: input.operation,
      reason: prepared.reason,
      requiredConfig: ['GOOGLE_SHEETS_ACCESS_TOKEN', 'GOOGLE_SHEETS_SPREADSHEET_ID'],
    };
  }

  const stableId = input.externalId?.trim() || `sheet-${input.recordId}`;
  const timestamp = nowIsoNow();
  return {
    ok: true,
    source: {
      provider: 'google_sheets',
      external_id: stableId,
      url: `https://docs.google.com/spreadsheets/d/${prepared.config.spreadsheetId}/edit#gid=0`,
      observed_at: timestamp,
      content_hash: null,
    },
    source_snapshot: {
      provider: 'google_sheets',
      operation: input.operation,
      spreadsheet_id: prepared.config.spreadsheetId,
      data_source_id: resolveSheetsDataSourceId(prepared.config),
      sheet_name: `${SHEETS_WORKBOOK_TAB_PREFIX} Runtime`,
      row: 0,
      range: `${SHEETS_WORKBOOK_TAB_PREFIX} Runtime`,
      address: `${SHEETS_WORKBOOK_TAB_PREFIX} Runtime`,
      before: null,
      after: {
        id: stableId,
        row: [],
        value_digest: '',
      },
      beforeDigest: '',
      afterDigest: '',
      revision: timestamp,
      valueDigest: '',
      provider_fields: {},
    },
    operation: input.operation,
  };
}

export function buildSheetsCreateSource(input: {
  recordId: string;
  domain: string;
  collection: string;
  title?: string;
  externalId?: string;
}) {
  return buildSheetsWriteSource({ ...input, operation: 'create_record' });
}

export function buildSheetsUpdateSource(input: { recordId: string; domain: string; collection: string }) {
  return buildSheetsWriteSource({ ...input, operation: 'update_record' });
}

export function buildSheetsArchiveSource(input: { recordId: string; domain: string; collection: string }) {
  return buildSheetsWriteSource({ ...input, operation: 'archive_record' });
}

export async function writeSheetsRecord(input: {
  operation: ProviderOperation;
  record: Omit<SheetsRecord, 'properties'> & { properties?: Record<string, unknown> };
}): Promise<{
  ok: boolean;
  noChange?: boolean;
  error?: string;
  response?: { updatedRange?: string; row: number };
  source?: {
    provider: 'google_sheets';
    external_id: string;
    url: string | null;
    observed_at: string;
    content_hash: string | null;
  };
  conflict?: {
    kind: 'version' | 'digest';
    expected_version?: number;
    actual_version?: number;
    expected_digest?: string;
    actual_digest?: string;
    row: number;
  };
  source_snapshot?: WriteSourceSnapshot;
}> {
  const state = await readRuntimeState();
  if ('ok' in state && state.ok === false) {
    return { ok: false, error: state.reason };
  }
  const live = state as SheetRuntimeState;
  if (!live.header.length) {
    return { ok: false, error: 'Runtime header is empty; cannot write managed columns.' };
  }

  const id = input.record.id.trim();
  if (!id) {
    return { ok: false, error: 'Record id is required for Sheets writes.' };
  }

  const indexes = buildColumnIndexes(live.header);
  const match = input.operation === 'create_record'
    ? null
    : findRowForRecord(live, id);

  const rowNumber = input.operation === 'create_record'
    ? ensureRowExists(live)
    : match?.rowNumber;
  if (rowNumber === undefined) {
    return { ok: false, error: `Record ${id} not found in runtime tab.` };
  }

  const targetRowNumber = rowNumber;

  const existingRow = match?.row ? [...match.row] : null;
  const currentVersion = existingRow ? normalizeManagedVersion(indexes, existingRow) : null;
  const currentDigest = existingRow ? nowDigest(existingRow) : null;
  const expectedVersion = Number.isFinite(input.record.expectedVersion ?? NaN)
    ? Number(input.record.expectedVersion)
    : undefined;
  const expectedDigest = typeof input.record.expectedDigest === 'string' && input.record.expectedDigest.trim().length > 0
    ? input.record.expectedDigest.trim()
    : undefined;

  if (existingRow && expectedVersion !== undefined && expectedVersion !== currentVersion) {
    return {
      ok: false,
      error: `Sheets conflict for ${id}: expected version ${expectedVersion}, found ${currentVersion}. Refetch before retrying.`,
      conflict: {
        kind: 'version' as const,
        expected_version: expectedVersion,
        actual_version: currentVersion ?? undefined,
        actual_digest: currentDigest ?? undefined,
        row: targetRowNumber,
      },
    };
  }
  if (existingRow && expectedDigest !== undefined && expectedDigest !== currentDigest) {
    return {
      ok: false,
      error: `Sheets conflict for ${id}: the workbook row changed since the source snapshot. Refetch before retrying.`,
      conflict: {
        kind: 'digest' as const,
        expected_digest: expectedDigest,
        actual_version: currentVersion ?? undefined,
        actual_digest: currentDigest ?? undefined,
        row: targetRowNumber,
      },
    };
  }
  const baseRecord = {
    id,
    domain: input.record.domain || 'food',
    collection: input.record.collection || 'recipe',
    title: input.record.title || id,
    properties: input.record.properties ?? {},
    relations: input.record.relations ?? [],
    archived: input.operation === 'archive_record' ? true : parseBool(input.record.archived),
    source: {
      ...(input.record.source ?? {}),
      provider: 'google_sheets',
      external_id: input.record.externalId || id,
    },
    externalId: input.record.externalId || id,
    version: Number.isFinite(input.record.version ?? NaN) ? Number(input.record.version) : undefined,
    expectedVersion,
    expectedDigest,
  };

  const managed = parseManagedTargetValue({
    row: existingRow,
    header: live.header,
    operation: input.operation,
    record: baseRecord,
  });

  const beforeDigest = existingRow ? nowDigest(existingRow) : undefined;
  const compareWidth = Math.max(existingRow?.length || 0, managed.row.length, live.header.length, 1);
  const existingComparable = existingRow ? clearNoopMetadata(indexes, existingRow, compareWidth) : null;
  const managedComparable = clearNoopMetadata(indexes, managed.row, compareWidth);
  if (existingComparable && rowsEqual(existingComparable, managedComparable)) {
    return {
      ok: true,
      noChange: true,
      source: {
        provider: 'google_sheets',
        external_id: id,
        url: `https://docs.google.com/spreadsheets/d/${live.spreadsheetId}/edit#gid=0`,
        observed_at: nowIsoNow(),
        content_hash: beforeDigest || managed.valueDigest,
      },
      source_snapshot: {
        provider: 'google_sheets',
        operation: input.operation,
        spreadsheet_id: live.spreadsheetId,
        data_source_id: resolveSheetsDataSourceId(readSheetsConfig() ?? undefined),
        sheet_name: live.tab,
        row: rowNumber,
        range: buildRange(live.tab, rowNumber, Math.max(live.header.length, managed.row.length, 1)),
        address: buildRange(live.tab, rowNumber, Math.max(live.header.length, managed.row.length, 1)),
        before: {
          id,
          row: existingRow ?? [],
          value_digest: nowDigest(existingRow || []),
        },
        after: {
          id,
          row: managed.row,
          value_digest: nowDigest(managed.row),
        },
        beforeDigest: nowDigest(existingRow || []),
        afterDigest: nowDigest(managed.row),
        revision: managed.valueDigest,
        valueDigest: managed.valueDigest,
        provider_fields: collectProviderFields(live.header, existingRow || managed.row),
        noChange: true,
      },
    };
  }

  const writeResult = await writeRuntimeRows({ state: live, rowNumber: targetRowNumber, values: managed.row });
  if (!writeResult.ok) {
    return { ok: false, error: writeResult.error || 'Unable to write sheet runtime row.' };
  }

  const targetWidth = Math.max(live.header.length, managed.row.length, 1);
  const range = buildRange(live.tab, targetRowNumber, targetWidth);
  const afterDigest = nowDigest(managed.row);

  return {
    ok: true,
    noChange: writeResult.noChange,
    response: {
      updatedRange: writeResult.updatedRange,
      row: targetRowNumber,
    },
    source: {
      provider: 'google_sheets',
      external_id: id,
      url: `https://docs.google.com/spreadsheets/d/${live.spreadsheetId}/edit#gid=0`,
      observed_at: nowIsoNow(),
      content_hash: afterDigest,
    },
    source_snapshot: {
      provider: 'google_sheets',
      operation: input.operation,
      spreadsheet_id: live.spreadsheetId,
      sheet_name: live.tab,
      row: targetRowNumber,
      range,
      address: range,
      before: existingRow
        ? {
            id,
            row: existingRow,
            value_digest: beforeDigest || nowDigest(existingRow),
          }
        : undefined,
      after: {
        id,
        row: managed.row,
        value_digest: afterDigest,
      },
      beforeDigest: existingRow ? beforeDigest : undefined,
      afterDigest,
      revision: managed.valueDigest,
      valueDigest: managed.valueDigest,
      provider_fields: collectProviderFields(live.header, managed.row),
      noChange: writeResult.noChange ?? false,
    },
  };
}

export async function writeSheetsRecordForMigration(input: {
  operation: ProviderOperation;
  record: Omit<SheetsRecord, 'properties'> & { properties?: Record<string, unknown> };
}): Promise<{ ok: boolean; reason?: string }> {
  const response = await writeSheetsRecord(input);
  return {
    ok: response.ok,
    reason: response.error,
  };
}
