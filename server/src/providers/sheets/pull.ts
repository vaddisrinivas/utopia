import { createHash } from 'node:crypto';
import { toSheetsCanonicalProjection } from './projection';
import { readSheetsConfig } from './client';
import {
  CANONICAL_RUNTIME_TAB_NAME,
  parseWorkBookMetadata,
  WELL_KNOWN_RUNTIME_COLUMNS,
  REQUIRED_RUNTIME_COLUMNS,
} from './workbook';
import { SHEETS_WORKBOOK_DEFAULT_RANGE, SHEETS_WORKBOOK_TAB_PREFIX } from './client';
import { getSheetsPort } from './port';

type SheetsValuesResponse = {
  values?: unknown[];
};

type SheetsMetadataResponse = {
  spreadsheetId?: string;
  properties?: { title?: string; locale?: string };
  spreadsheetUrl?: string;
  sheets?: Array<{ properties?: { title?: string; sheetId?: number; gridProperties?: { columnCount?: number; rowCount?: number } } }>;
};

type ParsedRuntimeResponse = {
  header: string[];
  rows: string[][];
};

type SourceSnapshot = {
  provider: 'google_sheets';
  spreadsheet_id: string;
  data_source_id?: string;
  sheet_name: string;
  range: string;
  address?: string;
  revision: string;
  row: number;
  data: string[];
  header: string[];
  value_digest: string;
  provider_fields: Record<string, unknown>;
};

const DEFAULT_DOMAIN = 'food';
const DEFAULT_COLLECTION = 'recipe';
const RUNTIME_TAB_NAME = `${SHEETS_WORKBOOK_TAB_PREFIX} Runtime`;

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

type LiveSheetsResult = {
  status: 'ready' | 'disabled';
  configured: boolean;
  records: ReturnType<typeof toSheetsCanonicalProjection>[];
  source_snapshots: SourceSnapshot[];
  message: string;
  status_code?: number;
  error?: string | null;
  headers?: string[];
  gridColumns?: number;
};

type LiveSheetsPullInput = {
  domain?: string;
  collection?: string;
  limit?: number;
  signal?: AbortSignal;
};

function nowDigest(values: string[]) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function toText(value: unknown) {
  return String(value ?? '').trim();
}

function asBoolean(value: string) {
  const lowered = value.toLowerCase();
  return lowered === 'true' || lowered === '1' || lowered === 'yes';
}

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

function parseJsonCell(value: string) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : { value };
  } catch {
    return { value };
  }
}

function parseRelationsCell(value: string) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((relation) => {
          if (!relation || typeof relation !== 'object') return null;
          const record = relation as Record<string, unknown>;
          const name = typeof record.name === 'string' ? record.name.trim() : '';
          const targetId = typeof record.target_id === 'string' ? record.target_id.trim() : '';
          return name && targetId ? { name, target_id: targetId } : null;
        })
        .filter((relation): relation is { name: string; target_id: string } => relation !== null);
    }
  } catch {
    // fallback below
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((target_id) => ({ name: 'supports', target_id }));
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

function buildSourceFieldSet(header: readonly string[]) {
  return new Set(header.map((name) => toText(name).toLowerCase()));
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

function parseRows(values: unknown): ParsedRuntimeResponse {
  if (!Array.isArray(values) || values.length === 0) {
    return { header: [], rows: [] };
  }

  const rawHeader = Array.isArray(values[0]) ? values[0] : [];
  const header = rawHeader.map(toText);
  const rows = values
    .slice(1)
    .map((entry) => (Array.isArray(entry) ? entry.map(toText) : []))
    .filter((row) => row.some((cell) => cell.length > 0));

  return { header, rows };
}

function validateRuntimeHeader(header: string[]) {
  const lowerHeader = header.map((value) => value.toLowerCase().trim());
  const missing = REQUIRED_RUNTIME_COLUMNS.filter((column) => !lowerHeader.includes(column));
  const extra = header.filter((value) => value && !buildSourceFieldSet(WELL_KNOWN_RUNTIME_COLUMNS).has(value.toLowerCase().trim()));
  return { missing, extra };
}

function collectProviderFields(header: string[], row: string[]) {
  const unsupported: Record<string, unknown> = {};
  const supported = buildSourceFieldSet([...WELL_KNOWN_RUNTIME_COLUMNS]);
  header.forEach((name, index) => {
    const normalized = name.toLowerCase().trim();
    if (!normalized || supported.has(normalized)) {
      return;
    }
    unsupported[name] = row[index] ?? '';
  });
  return unsupported;
}

function normalizeRowValue(indexes: SourceCellMap, row: string[], key: keyof SourceCellMap) {
  const index = indexes[key];
  return index >= 0 && index < row.length ? toText(row[index]) : '';
}

function pickLifeosId(indexes: SourceCellMap, row: string[]) {
  return (
    normalizeRowValue(indexes, row, 'utopiaId') ||
    normalizeRowValue(indexes, row, 'id') ||
    normalizeRowValue(indexes, row, 'externalId') ||
    row[0] ||
    ''
  );
}

function normalizeCellValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseSourceCell(sourceCell: string) {
  const parsed = parseJsonCell(sourceCell);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

export type SheetsPullInput = LiveSheetsPullInput;

export type SheetsPullResult = {
  status: 'ready' | 'disabled';
  configured: boolean;
  records: ReturnType<typeof toSheetsCanonicalProjection>[];
  source_snapshots: unknown[];
  message: string;
};

export function pullSheetsRecords(input: SheetsPullInput = {}): SheetsPullResult {
  const config = readSheetsConfig();
  if (!config) {
    return {
      status: 'disabled',
      configured: false,
      records: [],
      source_snapshots: [],
      message: 'Google Sheets access token is not configured.',
    };
  }

  if (!config.spreadsheetId) {
    return {
      status: 'disabled',
      configured: true,
      records: [],
      source_snapshots: [],
      message: 'GOOGLE_SHEETS_SPREADSHEET_ID is missing.',
    };
  }

  return {
    status: 'ready',
    configured: true,
    records: [],
    source_snapshots: [],
    message: `Sheets pull ready for spreadsheet ${config.spreadsheetId}${input.collection ? ` and collection ${input.collection}` : ''}.`,
  };
}

export async function pullSheetsRecordsLive(input: SheetsPullInput = {}): Promise<LiveSheetsResult> {
  const config = readSheetsConfig();
  if (!config) {
    return {
      status: 'disabled',
      configured: false,
      records: [],
      source_snapshots: [],
      message: 'Google Sheets adapter read is disabled without token.',
      error: 'GOOGLE_SHEETS_ACCESS_TOKEN is not configured.',
      status_code: 0,
    };
  }

  if (!config.spreadsheetId) {
    return {
      status: 'disabled',
      configured: true,
      records: [],
      source_snapshots: [],
      message: 'GOOGLE_SHEETS_SPREADSHEET_ID is missing.',
      error: 'GOOGLE_SHEETS_SPREADSHEET_ID is missing.',
      status_code: 0,
    };
  }

  const port = getSheetsPort(config);
  if (!port) {
    return {
      status: 'disabled',
      configured: true,
      records: [],
      source_snapshots: [],
      message: 'Google Sheets SDK port is unavailable.',
      error: 'Google Sheets SDK port is unavailable.',
      status_code: 0,
    };
  }

  const metadataResponse = await port.getSpreadsheet({
    spreadsheetId: config.spreadsheetId,
    signal: input.signal,
  });
  if (!metadataResponse.ok) {
    return {
      status: 'disabled',
      configured: true,
      records: [],
      source_snapshots: [],
      message: `Sheets pull failed for ${config.spreadsheetId}`,
      error: metadataResponse.error || 'Unable to read workbook metadata.',
      status_code: metadataResponse.status,
    };
  }

  const metadataBody = (metadataResponse.data || {}) as SheetsMetadataResponse;
  const metadata = parseWorkBookMetadata(metadataBody, config.spreadsheetId);
  const runtimeTab =
    metadata.tabs.find((tab) => tab.title === CANONICAL_RUNTIME_TAB_NAME) ||
    metadata.tabs.find((tab) => tab.title === RUNTIME_TAB_NAME) ||
    metadata.tabs[0];
  if (!runtimeTab) {
    return {
      status: 'disabled',
      configured: true,
      records: [],
      source_snapshots: [],
      message: `Utopia Runtime tab missing in spreadsheet ${config.spreadsheetId}`,
      error: 'Missing runtime tab.',
      status_code: metadataResponse.status,
    };
  }

  const range = `${runtimeTab.title}!${SHEETS_WORKBOOK_DEFAULT_RANGE}`;
  const valuesResponse = await port.batchGetValues({
    spreadsheetId: config.spreadsheetId,
    majorDimension: 'ROWS',
    ranges: [range],
    signal: input.signal,
  });
  if (!valuesResponse.ok) {
    return {
      status: 'disabled',
      configured: true,
      records: [],
      source_snapshots: [],
      message: `Sheets data read failed for tab ${runtimeTab.title}`,
      error: valuesResponse.error || 'Unable to read sheet values.',
      status_code: valuesResponse.status,
    };
  }

  const firstValueRange = Array.isArray(valuesResponse.data?.valueRanges)
    ? valuesResponse.data.valueRanges[0]
    : undefined;
  const parsed = parseRows(firstValueRange?.values);
  const { header, rows } = parsed;
  const headerValidation = validateRuntimeHeader(header);

  if (rows.length === 0) {
    return {
      status: 'ready',
      configured: true,
      records: [],
      source_snapshots: [],
      message: `Sheets pull succeeded for ${config.spreadsheetId} with 0 rows.`,
      headers: header,
      gridColumns: runtimeTab.gridColumns,
      status_code: valuesResponse.status,
      error: null,
    };
  }

  const knownHeader = header.map((headerName) => toText(headerName));
  const knownIndexes = buildColumnIndexes(knownHeader);
  const domain = input.domain || DEFAULT_DOMAIN;
  const collection = input.collection || DEFAULT_COLLECTION;

  const rowsWithProjection: Array<{ projection: ReturnType<typeof toSheetsCanonicalProjection>; source: SourceSnapshot }> = [];
  rows.forEach((row, rowIndex) => {
    const candidateId = pickLifeosId(knownIndexes, row);
    if (!candidateId) {
      return;
    }

    const rowDomain = normalizeRowValue(knownIndexes, row, 'domain') || domain;
    const rowCollection = normalizeRowValue(knownIndexes, row, 'collection') || collection;
    if (input.domain && rowDomain !== input.domain) {
      return;
    }
    if (input.collection && rowCollection !== input.collection) {
      return;
    }

    const unsupported = collectProviderFields(knownHeader, row);
    const sourceText = normalizeRowValue(knownIndexes, row, 'source');
    const sourceParsed = parseSourceCell(sourceText);
    const projectionSource = {
      ...(sourceParsed && typeof sourceParsed === 'object' && !Array.isArray(sourceParsed) ? sourceParsed : {}),
      external_id: normalizeRowValue(knownIndexes, row, 'externalId') || candidateId,
      provider_fields: unsupported,
    };
    const width = Math.max(knownHeader.length, row.length, 1);
    const rowNumber = rowIndex + 2;
    const source = {
      provider: 'google_sheets' as const,
      spreadsheet_id: config.spreadsheetId || metadataBody.spreadsheetId || metadata.spreadsheetId || '',
      data_source_id: config.dataSourceId?.trim() || undefined,
      sheet_name: runtimeTab.title,
      range: buildRange(runtimeTab.title, rowNumber, width),
      address: buildRange(runtimeTab.title, rowNumber, width),
      row: rowNumber,
      data: row,
      header: knownHeader,
      revision: nowDigest(row),
      value_digest: nowDigest(row),
      provider_fields: unsupported,
    } satisfies SourceSnapshot;

    const propertiesCell = normalizeRowValue(knownIndexes, row, 'properties');
    const foodDetailCell = normalizeRowValue(knownIndexes, row, 'foodDetail');
    const parsedProperties = normalizeCellValue(propertiesCell)
      ? parseJsonCell(propertiesCell)
      : {};
    const foodDetail = normalizeCellValue(foodDetailCell)
      ? parseJsonCell(foodDetailCell)
      : (parsedProperties as Record<string, unknown>).food_detail;
    const propertiesWithDetail = foodDetail && typeof foodDetail === 'object'
      ? { ...(parsedProperties as Record<string, unknown>), food_detail: foodDetail }
      : parsedProperties;
    const relations = parseRelationsCell(normalizeRowValue(knownIndexes, row, 'relations'));

    const projection = toSheetsCanonicalProjection({
      id: candidateId,
      domain: rowDomain,
      collection: rowCollection,
      title: normalizeRowValue(knownIndexes, row, 'title') || normalizeRowValue(knownIndexes, row, 'id') || candidateId,
      properties: propertiesWithDetail,
      relations,
      archived: asBoolean(normalizeRowValue(knownIndexes, row, 'archived')),
      version: parseNumber(normalizeRowValue(knownIndexes, row, 'version')),
      updatedAt: normalizeRowValue(knownIndexes, row, 'updatedAt'),
      source: projectionSource,
    });

    rowsWithProjection.push({
      projection,
      source,
    });
  });

  const extraInfo =
    headerValidation.missing.length === 0 && headerValidation.extra.length === 0
      ? []
      : [`Missing columns: ${headerValidation.missing.join(',')}`];
  const limit = typeof input.limit === 'number' && input.limit > 0 ? Math.trunc(input.limit) : null;
  const limitedRows = limit ? rowsWithProjection.slice(0, limit) : rowsWithProjection;

  return {
    status: 'ready',
    configured: true,
    records: limitedRows.map((entry) => entry.projection),
    source_snapshots: limitedRows.map((entry) => entry.source),
    message:
      `Sheets pull succeeded for ${config.spreadsheetId} with ${limitedRows.length} rows.` +
      (extraInfo.length > 0 ? ` (${extraInfo.join('; ')})` : ''),
    headers: knownHeader,
    gridColumns: runtimeTab.gridColumns,
    status_code: valuesResponse.status,
    error: null,
  };
}
