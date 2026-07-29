import { canonicalJson, sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import type { CanonicalProvenance, CanonicalRecord, CanonicalSource } from '@/packages/shared/contracts/records';

export const GOOGLE_SHEETS_DATA_HOME = 'google_sheets' as const;

const MANAGED_HEADERS = [
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
] as const;

type NormalizedHeaderMap = Readonly<{
  [key: string]: number;
}>;

export type GoogleSheetsTransportResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export type GoogleSheetsSpreadsheetMetadata = Readonly<{
  spreadsheetId?: string;
  properties?: Readonly<{
    title?: string;
  }>;
  sheets?: Array<{
    properties?: Readonly<{
      title?: string;
      sheetId?: number;
      gridProperties?: Readonly<{
        columnCount?: number;
        rowCount?: number;
      }>;
    }>;
  }>;
}>;

export type GoogleSheetsValuesPayload = Readonly<{
  range?: string;
  values?: unknown[][];
}>;

export type GoogleSheetsDataHomeTransport = Readonly<{
  getSpreadsheet(input: {
    spreadsheetId: string;
    token: string;
    session: string;
  }): Promise<GoogleSheetsTransportResult<GoogleSheetsSpreadsheetMetadata>>;
  getValues(input: {
    spreadsheetId: string;
    sheetName: string;
    range: string;
    token: string;
    session: string;
  }): Promise<GoogleSheetsTransportResult<GoogleSheetsValuesPayload>>;
}>;

export type GoogleSheetsDataHomeConfig = Readonly<{
  dataHome: 'google_sheets' | string;
  installationId: string;
  declaredDataHomes: readonly string[];
  spreadsheetId: string;
  sheetName: string;
  token: string | null | undefined;
  session: string | null | undefined;
  online?: boolean;
}>;

export type GoogleSheetsDataHomePullInput = Readonly<{
  cursor?: string | null;
  limit?: number;
}>;

export type GoogleSheetsDataHomeSnapshot = Readonly<{
  provider: 'google_sheets';
  installationId: string;
  spreadsheetId: string;
  sheetName: string;
  sheetId: number;
  rowNumber: number;
  cursor: string;
  range: string;
  externalId: string;
  revision: number;
  valueDigest: string;
  headers: string[];
  values: string[];
  providerFields: Record<string, string>;
}>;

export type GoogleSheetsDataHomePullSuccess = Readonly<{
  ok: true;
  status: 'ready';
  installationId: string;
  spreadsheetId: string;
  sheetName: string;
  sheetId: number;
  cursor: string | null;
  nextCursor: string | null;
  records: CanonicalRecord[];
  source_snapshots: GoogleSheetsDataHomeSnapshot[];
}>;

export type GoogleSheetsDataHomePullFailure = Readonly<{
  ok: false;
  status: 'blocked' | 'offline' | 'error';
  reason: string;
}>;

export type GoogleSheetsDataHomePullResult = GoogleSheetsDataHomePullSuccess | GoogleSheetsDataHomePullFailure;

export type GoogleSheetsDataHomeOperation = 'create_record' | 'update_record' | 'archive_record' | 'delete_record';

export type GoogleSheetsDataHomeWriteRequest = Readonly<{
  kind: 'values.append' | 'values.update' | 'deleteDimension';
  spreadsheetId: string;
  sheetName: string;
  range: string;
  valueInputOption?: 'RAW';
  insertDataOption?: 'INSERT_ROWS';
  body: Readonly<Record<string, unknown>>;
  description: string;
}>;

export type GoogleSheetsDataHomeWriteSuccess = Readonly<{
  ok: true;
  status: 'ready';
  installationId: string;
  spreadsheetId: string;
  sheetName: string;
  operation: GoogleSheetsDataHomeOperation;
  requestKey: string;
  requests: GoogleSheetsDataHomeWriteRequest[];
  source_snapshot: GoogleSheetsDataHomeSnapshot;
}>;

export type GoogleSheetsDataHomeWriteFailure = Readonly<{
  ok: false;
  status: 'blocked' | 'conflict' | 'error' | 'offline';
  reason: string;
  conflict?: Readonly<{
    kind: 'revision' | 'digest';
    expectedRevision?: number;
    actualRevision?: number;
    expectedDigest?: string;
    actualDigest?: string;
    rowNumber: number;
  }>;
}>;

export type GoogleSheetsDataHomeWriteResult = GoogleSheetsDataHomeWriteSuccess | GoogleSheetsDataHomeWriteFailure;

type ResolvedGoogleSheetsDataHomeConfig = Readonly<{
  dataHome: 'google_sheets';
  installationId: string;
  declaredDataHomes: readonly string[];
  spreadsheetId: string;
  sheetName: string;
  token: string;
  session: string;
  online: boolean;
}>;

export type GoogleSheetsDataHomeAdapter = Readonly<{
  pull(input?: GoogleSheetsDataHomePullInput): Promise<GoogleSheetsDataHomePullResult>;
  planWrite(input: GoogleSheetsDataHomeWriteInput): GoogleSheetsDataHomeWriteResult;
}>;

export type GoogleSheetsDataHomeWriteInput = Readonly<{
  operation: GoogleSheetsDataHomeOperation;
  record: CanonicalRecord;
  current?: GoogleSheetsDataHomeSnapshot | null;
  expectedRevision?: number | null;
  expectedDigest?: string | null;
  allowUnsafeDelete?: boolean;
}>;

export function createGoogleSheetsDataHomeAdapter(
  config: GoogleSheetsDataHomeConfig,
  transport: GoogleSheetsDataHomeTransport,
): GoogleSheetsDataHomeAdapter {
  return {
    pull: (input = {}) => pullGoogleSheetsDataHome(config, transport, input),
    planWrite: (input) => planGoogleSheetsDataHomeWrite(config, input),
  };
}

export async function pullGoogleSheetsDataHome(
  config: GoogleSheetsDataHomeConfig,
  transport: GoogleSheetsDataHomeTransport,
  input: GoogleSheetsDataHomePullInput = {},
): Promise<GoogleSheetsDataHomePullResult> {
  const validated = validateConfig(config);
  if (!validated.ok) return validated;
  if (validated.config.online === false) {
    return offlineFailure('offline');
  }

  const spreadsheetResponse = await transport.getSpreadsheet({
    spreadsheetId: validated.config.spreadsheetId,
    token: validated.config.token,
    session: validated.config.session,
  });
  if (!spreadsheetResponse.ok) {
    return transportFailure(spreadsheetResponse.status, spreadsheetResponse.error);
  }

  const metadata = spreadsheetResponse.data;
  const returnedSpreadsheetId = normalizeText(metadata.spreadsheetId) || validated.config.spreadsheetId;
  if (returnedSpreadsheetId !== validated.config.spreadsheetId) {
    return blocked('spreadsheet_mismatch');
  }

  const selectedSheet = resolveSelectedSheet(metadata, validated.config.sheetName);
  if (!selectedSheet.ok) return blocked(selectedSheet.reason);
  if (selectedSheet.sheet.sheetId < 0 || !Number.isInteger(selectedSheet.sheet.sheetId)) {
    return blocked('invalid_sheet_id');
  }

  const valuesResponse = await transport.getValues({
    spreadsheetId: validated.config.spreadsheetId,
    sheetName: selectedSheet.sheet.title,
    range: `${quoteSheetName(selectedSheet.sheet.title)}!A:N`,
    token: validated.config.token,
    session: validated.config.session,
  });
  if (!valuesResponse.ok) {
    return transportFailure(valuesResponse.status, valuesResponse.error);
  }

  const rows = Array.isArray(valuesResponse.data.values) ? valuesResponse.data.values : [];
  if (!rows.length) {
    return {
      ok: true,
      status: 'ready',
      installationId: validated.config.installationId,
      spreadsheetId: validated.config.spreadsheetId,
      sheetName: validated.config.sheetName,
      sheetId: selectedSheet.sheet.sheetId,
      cursor: parseCursor(input.cursor),
      nextCursor: parseCursor(input.cursor),
      records: [],
      source_snapshots: [],
    };
  }

  const headerResult = validateHeaders(rows[0] ?? []);
  if (!headerResult.ok) return blocked(headerResult.reason);
  const headerMap = headerResult.headerMap;
  const header = headerResult.header;

  const startRow = nextRowFromCursor(input.cursor);
  if (startRow === null) return blocked('invalid_cursor');
  const limit = normalizeLimit(input.limit);
  const sourceSnapshots: GoogleSheetsDataHomeSnapshot[] = [];
  const records: CanonicalRecord[] = [];

  for (let index = Math.max(1, startRow - 1); index < rows.length; index += 1) {
    const rowNumber = index + 1;
    const parsed = parseRow({
      config: validated.config,
      header,
      headerMap,
      sheetId: selectedSheet.sheet.sheetId,
      row: rows[index] ?? [],
      rowNumber,
    });
    if (!parsed.ok) return blocked(parsed.reason);
    sourceSnapshots.push(parsed.snapshot);
    records.push(parsed.record);
    if (records.length >= limit) break;
  }
  const deliveredRows = records.length ? sourceSnapshots[sourceSnapshots.length - 1]?.rowNumber ?? null : parseCursor(input.cursor);

  return {
    ok: true,
    status: 'ready',
      installationId: validated.config.installationId,
      spreadsheetId: validated.config.spreadsheetId,
      sheetName: validated.config.sheetName,
      sheetId: selectedSheet.sheet.sheetId,
      cursor: parseCursor(input.cursor),
      nextCursor: deliveredRows ? `row:${deliveredRows}` : parseCursor(input.cursor),
      records,
    source_snapshots: sourceSnapshots,
  };
}

export function planGoogleSheetsDataHomeWrite(
  config: GoogleSheetsDataHomeConfig,
  input: GoogleSheetsDataHomeWriteInput,
): GoogleSheetsDataHomeWriteResult {
  const validated = validateConfig(config);
  if (!validated.ok) return validated;
  if (validated.config.online === false) {
    return offlineFailure('offline');
  }

  const recordValidation = validateRecordForWrite(validated.config, input.record);
  if (!recordValidation.ok) return blocked(recordValidation.reason);

  if (input.operation === 'delete_record' && !input.allowUnsafeDelete) {
    return blocked('destructive_delete_blocked');
  }

  if ((input.operation === 'update_record' || input.operation === 'archive_record' || input.operation === 'delete_record') && !input.current) {
    return blocked('missing_current_snapshot');
  }

  if (input.current) {
    const scopeCheck = validateSnapshotScope(validated.config, input.current);
    if (!scopeCheck.ok) return blocked(scopeCheck.reason);
  }

  const current = input.current ?? null;
  if ((input.operation === 'update_record' || input.operation === 'archive_record' || input.operation === 'delete_record') && current) {
    if (!Number.isInteger(current.sheetId) || current.sheetId < 0) {
      return blocked('invalid_sheet_id');
    }
    const revision = current.revision;
    const expectedRevision = normalizeOptionalRevision(input.expectedRevision ?? input.record.revision);
    if (expectedRevision !== null && expectedRevision !== revision) {
      return {
        ok: false,
        status: 'conflict',
        reason: 'revision_conflict',
        conflict: {
          kind: 'revision',
          expectedRevision,
          actualRevision: revision,
          expectedDigest: normalizeText(input.expectedDigest) || undefined,
          actualDigest: current.valueDigest,
          rowNumber: current.rowNumber,
        },
      };
    }

    const expectedDigest = normalizeText(input.expectedDigest);
    if (expectedDigest && expectedDigest !== current.valueDigest) {
      return {
        ok: false,
        status: 'conflict',
        reason: 'digest_conflict',
        conflict: {
          kind: 'digest',
          expectedRevision: expectedRevision ?? undefined,
          actualRevision: revision,
          expectedDigest,
          actualDigest: current.valueDigest,
          rowNumber: current.rowNumber,
        },
      };
    }
  }

  let rowValues: string[];
  try {
    rowValues = buildRowValues(validated.config, input.record, input.operation, current);
  } catch (error) {
    return blocked(error instanceof Error ? error.message : 'unsupported_cell_value');
  }
  const requestKey = buildRequestKey(validated.config, input.operation, input.record, current);

  if (input.operation === 'delete_record' && input.allowUnsafeDelete) {
    const currentSnapshot = current;
    const request: GoogleSheetsDataHomeWriteRequest = {
      kind: 'deleteDimension',
      spreadsheetId: validated.config.spreadsheetId,
      sheetName: validated.config.sheetName,
      range: currentSnapshot ? `${quoteSheetName(validated.config.sheetName)}!A${currentSnapshot.rowNumber}:N${currentSnapshot.rowNumber}` : `${quoteSheetName(validated.config.sheetName)}!A1:N1`,
      body: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: currentSnapshot!.sheetId,
                dimension: 'ROWS',
                startIndex: currentSnapshot ? currentSnapshot.rowNumber - 1 : 0,
                endIndex: currentSnapshot ? currentSnapshot.rowNumber : 1,
              },
            },
          },
        ],
      },
      description: `delete row ${currentSnapshot?.rowNumber ?? 1} from ${validated.config.sheetName}`,
    };
    return {
      ok: true,
      status: 'ready',
      installationId: validated.config.installationId,
      spreadsheetId: validated.config.spreadsheetId,
      sheetName: validated.config.sheetName,
      operation: input.operation,
      requestKey,
      requests: [request],
      source_snapshot: current ?? buildSnapshotFromRecord(validated.config, input.record, rowValues, 1),
    };
  }

  const request: GoogleSheetsDataHomeWriteRequest = input.operation === 'create_record'
    ? {
        kind: 'values.append',
        spreadsheetId: validated.config.spreadsheetId,
        sheetName: validated.config.sheetName,
        range: `${quoteSheetName(validated.config.sheetName)}!A:N`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        body: {
          values: [rowValues],
        },
        description: `append record ${safeId(input.record.source.external_id)} to ${validated.config.sheetName}`,
      }
    : {
        kind: 'values.update',
        spreadsheetId: validated.config.spreadsheetId,
        sheetName: validated.config.sheetName,
        range: `${quoteSheetName(validated.config.sheetName)}!A${current?.rowNumber ?? 1}:N${current?.rowNumber ?? 1}`,
        valueInputOption: 'RAW',
        body: {
          values: [rowValues],
        },
        description: `${input.operation === 'archive_record' ? 'archive' : 'update'} row ${current?.rowNumber ?? 1} for ${safeId(input.record.source.external_id)}`,
      };

  return {
    ok: true,
    status: 'ready',
    installationId: validated.config.installationId,
    spreadsheetId: validated.config.spreadsheetId,
    sheetName: validated.config.sheetName,
    operation: input.operation,
    requestKey,
    requests: [request],
    source_snapshot: current ?? buildSnapshotFromRecord(validated.config, input.record, rowValues, 1),
  };
}

function validateConfig(config: GoogleSheetsDataHomeConfig): { ok: true; config: ResolvedGoogleSheetsDataHomeConfig; } | { ok: false; status: 'blocked'; reason: string } {
  const installationId = normalizeText(config.installationId);
  const spreadsheetId = normalizeText(config.spreadsheetId);
  const sheetName = normalizeText(config.sheetName);
  const token = normalizeText(config.token);
  const session = normalizeText(config.session);
  if (normalizeText(config.dataHome) !== GOOGLE_SHEETS_DATA_HOME) {
    return blocked('undeclared_data_home');
  }
  if (!Array.isArray(config.declaredDataHomes) || !config.declaredDataHomes.includes(GOOGLE_SHEETS_DATA_HOME)) {
    return blocked('undeclared_data_home');
  }
  if (!installationId) return blocked('missing_installation_id');
  if (!spreadsheetId) return blocked('missing_spreadsheet_id');
  if (!sheetName) return blocked('missing_sheet_name');
  if (!token) return blocked('missing_token');
  if (!session) return blocked('missing_session');
  return {
    ok: true,
    config: {
      dataHome: GOOGLE_SHEETS_DATA_HOME,
      installationId,
      declaredDataHomes: config.declaredDataHomes,
      spreadsheetId,
      sheetName,
      token,
      session,
      online: config.online ?? true,
    },
  };
}

function validateHeaders(row: unknown[]): { ok: true; header: string[]; headerMap: NormalizedHeaderMap } | { ok: false; reason: string } {
  const header: string[] = [];
  const headerMap: Record<string, number> = {};
  for (let index = 0; index < row.length; index += 1) {
    const cell = row[index];
    if (cell !== null && cell !== undefined && typeof cell !== 'object' && typeof cell !== 'function') {
      const text = normalizeText(cell);
      if (!text) return { ok: false, reason: 'blank_header' };
      const key = text.toLowerCase();
      if (headerMap[key] !== undefined) return { ok: false, reason: 'duplicate_header' };
      header.push(text);
      headerMap[key] = index;
    } else {
      return { ok: false, reason: 'unsupported_cell_value' };
    }
  }

  const hasIdentity = getHeaderIndex(headerMap, ['id', 'external_id', 'record_id', 'utopia_id']) !== null;
  if (!hasIdentity) return { ok: false, reason: 'missing_identity_header' };
  if (getHeaderIndex(headerMap, ['app_installation_id', 'installation_id']) === null) {
    return { ok: false, reason: 'missing_scope_header' };
  }
  if (getHeaderIndex(headerMap, ['title']) === null) return { ok: false, reason: 'missing_title_header' };
  if (getHeaderIndex(headerMap, ['domain']) === null) return { ok: false, reason: 'missing_domain_header' };
  if (getHeaderIndex(headerMap, ['collection']) === null) return { ok: false, reason: 'missing_collection_header' };
  if (getHeaderIndex(headerMap, ['properties']) === null) return { ok: false, reason: 'missing_properties_header' };
  if (getHeaderIndex(headerMap, ['archived']) === null) return { ok: false, reason: 'missing_archived_header' };
  if (getHeaderIndex(headerMap, ['revision', 'version']) === null) return { ok: false, reason: 'missing_revision_header' };
  if (getHeaderIndex(headerMap, ['updated_at']) === null) return { ok: false, reason: 'missing_updated_at_header' };

  return { ok: true, header, headerMap };
}

function parseRow(input: {
  config: ResolvedGoogleSheetsDataHomeConfig;
  header: string[];
  headerMap: NormalizedHeaderMap;
  sheetId: number;
  row: unknown[];
  rowNumber: number;
}): { ok: true; record: CanonicalRecord; snapshot: GoogleSheetsDataHomeSnapshot } | { ok: false; reason: string } {
  const headers = input.header;
  const rowResult = normalizeRowCells(input.row);
  if (!rowResult.ok) return rowResult;
  const row = rowResult.row;
  if (row.some((cell) => typeof cell === 'string' && looksLikeFormula(cell))) {
    return { ok: false, reason: 'formula_injection_risk' };
  }

  const scope = readScopedValue(input.headerMap, row, ['app_installation_id', 'installation_id']);
  if (!scope) return { ok: false, reason: 'scope_mismatch' };
  if (scope !== input.config.installationId) return { ok: false, reason: 'scope_mismatch' };

  const externalId = readScopedValue(input.headerMap, row, ['external_id', 'id', 'record_id', 'utopia_id']);
  if (!externalId) return { ok: false, reason: 'missing_identity_value' };

  const title = readScopedValue(input.headerMap, row, ['title']);
  const domain = readScopedValue(input.headerMap, row, ['domain']);
  const collection = readScopedValue(input.headerMap, row, ['collection']);
  if (!title) return { ok: false, reason: 'missing_title_value' };
  if (!domain) return { ok: false, reason: 'missing_domain_value' };
  if (!collection) return { ok: false, reason: 'missing_collection_value' };

  const properties = readJsonObject(input.headerMap, row, ['properties']);
  if (!properties.ok) return properties;
  const relationsResult = readJsonArray(input.headerMap, row, ['relations']);
  if (!relationsResult.ok) return relationsResult;
  const archived = readBooleanValue(input.headerMap, row, ['archived']);
  if (!archived.ok) return archived;
  const revision = readRevisionValue(input.headerMap, row, ['revision', 'version']);
  if (!revision.ok) return revision;
  const createdAt = readOptionalText(input.headerMap, row, ['created_at']) || readOptionalText(input.headerMap, row, ['updated_at']) || new Date().toISOString();
  const updatedAt = readOptionalText(input.headerMap, row, ['updated_at']);
  if (!updatedAt) return { ok: false, reason: 'missing_updated_at_value' };
  const sourceResult = readSourceValue(input, row, externalId);
  if (!sourceResult.ok) return sourceResult;

  const providerFields = collectProviderFields(headers, row);
  const valueDigest = digestRow({
    installationId: input.config.installationId,
    spreadsheetId: input.config.spreadsheetId,
    sheetName: input.config.sheetName,
    rowNumber: input.rowNumber,
    row,
  });
  const snapshot: GoogleSheetsDataHomeSnapshot = {
    provider: GOOGLE_SHEETS_DATA_HOME,
    installationId: input.config.installationId,
    spreadsheetId: input.config.spreadsheetId,
    sheetName: input.config.sheetName,
    sheetId: input.sheetId,
    rowNumber: input.rowNumber,
    cursor: `row:${input.rowNumber}`,
    range: `${quoteSheetName(input.config.sheetName)}!A${input.rowNumber}:N${input.rowNumber}`,
    externalId,
    revision: revision.value,
    valueDigest,
    headers,
    values: row,
    providerFields,
  };

  const provenance: CanonicalProvenance = {
    actor: 'sync',
    confidence: null,
    evidence: [`${input.config.spreadsheetId}/${input.config.sheetName}#row-${input.rowNumber}`],
    reason: 'Pulled from Google Sheets data home.',
  };

  const record: CanonicalRecord = {
    id: externalId,
    domain,
    collection,
    title,
    properties,
    relations: relationsResult.value,
    source: sourceResult.value,
    archived_at: archived.value ? readOptionalText(input.headerMap, row, ['archived_at']) || updatedAt : readOptionalText(input.headerMap, row, ['archived_at']) || null,
    created_at: createdAt,
    updated_at: updatedAt,
    revision: revision.value,
    schema_version: 'utopia.data-home-contract.v1',
    deleted: false,
    privacy: 'personal',
    provenance,
  };

  if (record.source.provider !== GOOGLE_SHEETS_DATA_HOME) {
    return { ok: false, reason: 'scope_mismatch' };
  }
  if (record.source.external_id !== externalId) {
    return { ok: false, reason: 'scope_mismatch' };
  }
  if (record.source.url && !record.source.url.includes(input.config.spreadsheetId)) {
    return { ok: false, reason: 'scope_mismatch' };
  }

  return { ok: true, record, snapshot };
}

function readSourceValue(
  input: {
    config: ResolvedGoogleSheetsDataHomeConfig;
    headerMap: NormalizedHeaderMap;
  },
  row: string[],
  externalId: string,
): { ok: true; value: CanonicalSource } | { ok: false; reason: string } {
  const raw = readOptionalText(input.headerMap, row, ['source']);
  if (!raw) {
    return {
      ok: true,
      value: {
        provider: GOOGLE_SHEETS_DATA_HOME,
        external_id: externalId,
        url: `https://docs.google.com/spreadsheets/d/${input.config.spreadsheetId}/edit#gid=0`,
        observed_at: readOptionalText(input.headerMap, row, ['updated_at']) || new Date().toISOString(),
        content_hash: digestRow({
          spreadsheetId: input.config.spreadsheetId,
          sheetName: input.config.sheetName,
          externalId,
          row,
        }),
      },
    };
  }
  if (looksLikeFormula(raw)) return { ok: false, reason: 'formula_injection_risk' };
  const parsed = tryParseJson(raw);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return { ok: false, reason: 'unsupported_cell_value' };
  }
  const source = parsed.value as Record<string, unknown>;
  const provider = typeof source.provider === 'string' ? source.provider.trim() : '';
  const sourceExternalId = typeof source.external_id === 'string' ? source.external_id.trim() : externalId;
  const sourceUrl = typeof source.url === 'string' ? source.url.trim() : `https://docs.google.com/spreadsheets/d/${input.config.spreadsheetId}/edit#gid=0`;
  if (provider !== GOOGLE_SHEETS_DATA_HOME) return { ok: false, reason: 'scope_mismatch' };
  if (sourceExternalId !== externalId) return { ok: false, reason: 'scope_mismatch' };
  if (typeof source.url === 'string' && !sourceUrl.includes(input.config.spreadsheetId)) return { ok: false, reason: 'scope_mismatch' };
  return {
    ok: true,
    value: {
      provider: GOOGLE_SHEETS_DATA_HOME,
      external_id: sourceExternalId,
      url: sourceUrl,
      observed_at: typeof source.observed_at === 'string' && source.observed_at.trim() ? source.observed_at.trim() : (readOptionalText(input.headerMap, row, ['updated_at']) || new Date().toISOString()),
      content_hash: typeof source.content_hash === 'string' ? source.content_hash : digestRow({
        spreadsheetId: input.config.spreadsheetId,
        sheetName: input.config.sheetName,
        externalId: sourceExternalId,
        row,
      }),
    },
  };
}

function readJsonObject(
  headerMap: NormalizedHeaderMap,
  row: string[],
  candidates: string[],
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  const raw = readOptionalText(headerMap, row, candidates);
  if (!raw) return { ok: true, value: {} };
  if (looksLikeFormula(raw)) return { ok: false, reason: 'formula_injection_risk' };
  const parsed = tryParseJson(raw);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return { ok: false, reason: 'unsupported_cell_value' };
  }
  return { ok: true, value: parsed.value as Record<string, unknown> };
}

function readJsonArray(
  headerMap: NormalizedHeaderMap,
  row: string[],
  candidates: string[],
): { ok: true; value: CanonicalRecord['relations'] } | { ok: false; reason: string } {
  const raw = readOptionalText(headerMap, row, candidates);
  if (!raw) return { ok: true, value: [] };
  if (looksLikeFormula(raw)) return { ok: false, reason: 'formula_injection_risk' };
  const parsed = tryParseJson(raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) return { ok: false, reason: 'unsupported_cell_value' };
  const relations = parsed.value.map((relation) => {
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return null;
    const value = relation as Record<string, unknown>;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const targetId = typeof value.target_id === 'string' ? value.target_id.trim() : '';
    return name && targetId ? { name, target_id: targetId } : null;
  });
  if (relations.some((relation) => relation === null)) return { ok: false, reason: 'unsupported_cell_value' };
  return { ok: true, value: relations as CanonicalRecord['relations'] };
}

function readBooleanValue(
  headerMap: NormalizedHeaderMap,
  row: string[],
  candidates: string[],
): { ok: true; value: boolean } | { ok: false; reason: string } {
  const raw = readOptionalText(headerMap, row, candidates);
  if (!raw) return { ok: true, value: false };
  const normalized = raw.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return { ok: true, value: true };
  if (['false', '0', 'no'].includes(normalized)) return { ok: true, value: false };
  return { ok: false, reason: 'unsupported_cell_value' };
}

function readRevisionValue(
  headerMap: NormalizedHeaderMap,
  row: string[],
  candidates: string[],
): { ok: true; value: number } | { ok: false; reason: string } {
  const raw = readOptionalText(headerMap, row, candidates);
  if (!raw) return { ok: false, reason: 'missing_revision_value' };
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, reason: 'unsupported_cell_value' };
  }
  return { ok: true, value: parsed };
}

function readScopedValue(
  headerMap: NormalizedHeaderMap,
  row: string[],
  candidates: string[],
): string {
  return readOptionalText(headerMap, row, candidates);
}

function readOptionalText(
  headerMap: NormalizedHeaderMap,
  row: string[],
  candidates: string[],
): string {
  const index = getHeaderIndex(headerMap, candidates);
  if (index === null || index < 0 || index >= row.length) return '';
  const raw = row[index];
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') return String(raw).trim();
  return raw.trim();
}

function validateRecordForWrite(
  config: ResolvedGoogleSheetsDataHomeConfig,
  record: CanonicalRecord,
): { ok: true } | { ok: false; reason: string } {
  if (!record || typeof record !== 'object') return { ok: false, reason: 'invalid_record' };
  if (record.source.provider !== GOOGLE_SHEETS_DATA_HOME) return { ok: false, reason: 'scope_mismatch' };
  if (record.source.external_id.trim() === '') return { ok: false, reason: 'missing_identity_value' };
  if (record.source.external_id !== record.id) return { ok: false, reason: 'scope_mismatch' };
  if (record.source.url && !record.source.url.includes(config.spreadsheetId)) return { ok: false, reason: 'scope_mismatch' };
  if (record.source.content_hash && looksLikeFormula(record.source.content_hash)) return { ok: false, reason: 'formula_injection_risk' };
  if (looksLikeFormula(record.id) || looksLikeFormula(record.title) || looksLikeFormula(record.domain) || looksLikeFormula(record.collection)) {
    return { ok: false, reason: 'formula_injection_risk' };
  }
  return { ok: true };
}

function validateSnapshotScope(
  config: ResolvedGoogleSheetsDataHomeConfig,
  snapshot: GoogleSheetsDataHomeSnapshot,
): { ok: true } | { ok: false; reason: string } {
  if (snapshot.installationId !== config.installationId) return { ok: false, reason: 'scope_mismatch' };
  if (snapshot.spreadsheetId !== config.spreadsheetId) return { ok: false, reason: 'scope_mismatch' };
  if (snapshot.sheetName !== config.sheetName) return { ok: false, reason: 'scope_mismatch' };
  return { ok: true };
}

function buildRowValues(
  config: ResolvedGoogleSheetsDataHomeConfig,
  record: CanonicalRecord,
  operation: GoogleSheetsDataHomeOperation,
  current: GoogleSheetsDataHomeSnapshot | null,
): string[] {
  const values = [
    safeCell(record.id),
    safeCell(record.title),
    safeCell(record.domain),
    safeCell(record.collection),
    stringifyJsonCell(record.properties),
    stringifyJsonCell(record.relations),
    operation === 'archive_record' ? 'true' : record.archived_at ? 'true' : 'false',
    String(normalizeOptionalRevision(record.revision) ?? 1),
    safeCell(record.created_at),
    safeCell(record.updated_at),
    stringifyJsonCell(record.source),
    safeCell(record.source.external_id),
    safeCell(config.installationId),
    operation === 'archive_record' ? safeCell(record.archived_at ?? record.updated_at) : safeCell(record.archived_at ?? ''),
  ];
  if (current && current.values.length > values.length) {
    return values.concat(Array.from({ length: current.values.length - values.length }, () => ''));
  }
  return values;
}

function buildSnapshotFromRecord(
  config: ResolvedGoogleSheetsDataHomeConfig,
  record: CanonicalRecord,
  values: string[],
  rowNumber: number,
  sheetId = -1,
): GoogleSheetsDataHomeSnapshot {
  return {
    provider: GOOGLE_SHEETS_DATA_HOME,
    installationId: config.installationId,
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName,
    sheetId,
    rowNumber,
    cursor: `row:${rowNumber}`,
    range: `${quoteSheetName(config.sheetName)}!A${rowNumber}:N${rowNumber}`,
    externalId: record.source.external_id,
    revision: normalizeOptionalRevision(record.revision) ?? 1,
    valueDigest: digestRow({
      installationId: config.installationId,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      rowNumber,
      values,
    }),
    headers: [...MANAGED_HEADERS],
    values,
    providerFields: {},
  };
}

function buildRequestKey(
  config: ResolvedGoogleSheetsDataHomeConfig,
  operation: GoogleSheetsDataHomeOperation,
  record: CanonicalRecord,
  current: GoogleSheetsDataHomeSnapshot | null,
): string {
  return canonicalJson({
    dataHome: GOOGLE_SHEETS_DATA_HOME,
    installationId: config.installationId,
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName,
    operation,
    recordId: record.id,
    externalId: record.source.external_id,
    revision: normalizeOptionalRevision(record.revision) ?? null,
    sheetId: current?.sheetId ?? null,
    rowNumber: current?.rowNumber ?? null,
  });
}

function normalizeRowCells(row: unknown[]): { ok: true; row: string[] } | { ok: false; reason: string } {
  try {
    return {
      ok: true,
      row: row.map((cell) => {
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'string') return cell.trim();
        if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
        throw new Error('unsupported_cell_value');
      }),
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unsupported_cell_value' };
  }
}

function safeCell(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (looksLikeFormula(normalized)) {
    throw new Error('formula_injection_risk');
  }
  return normalized;
}

function stringifyJsonCell(value: unknown): string {
  const encoded = canonicalJson(value);
  if (looksLikeFormula(encoded)) {
    throw new Error('formula_injection_risk');
  }
  return encoded;
}

function getHeaderIndex(headerMap: NormalizedHeaderMap, candidates: string[]): number | null {
  for (const candidate of candidates) {
    const index = headerMap[candidate.toLowerCase()];
    if (typeof index === 'number') return index;
  }
  return null;
}

function collectProviderFields(headers: string[], row: string[]): Record<string, string> {
  const managed = new Set(MANAGED_HEADERS.map((header) => header.toLowerCase()));
  const fields: Record<string, string> = {};
  headers.forEach((header, index) => {
    const normalized = header.toLowerCase();
    if (managed.has(normalized)) return;
    const value = row[index] ?? '';
    fields[header] = value;
  });
  return fields;
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit ?? NaN)) return 100;
  return Math.max(1, Math.min(Math.floor(limit ?? 100), 500));
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function safeId(value: string): string {
  const normalized = normalizeText(value);
  return normalized.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 180);
}

function normalizeOptionalRevision(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) return null;
  const parsed = Math.floor(Number(value));
  return parsed > 0 ? parsed : null;
}

function parseCursor(cursor?: string | null): string | null {
  const normalized = normalizeText(cursor);
  return normalized || null;
}

function nextRowFromCursor(cursor?: string | null): number | null {
  const normalized = normalizeText(cursor);
  if (!normalized) return 2;
  const match = /^row:(\d+)$/.exec(normalized);
  if (!match) return null;
  const rowNumber = Number.parseInt(match[1], 10);
  if (!Number.isFinite(rowNumber) || rowNumber < 1) return null;
  return rowNumber + 1;
}

function quoteSheetName(sheetName: string): string {
  return /[^\w]/.test(sheetName) ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
}

function looksLikeFormula(value: string): boolean {
  const normalized = value.trimStart();
  return normalized.startsWith('=') || normalized.startsWith('+') || normalized.startsWith('-') || normalized.startsWith('@');
}

function digestRow(value: unknown): string {
  return sha256Canonical(value);
}

function tryParseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function resolveSelectedSheet(
  metadata: GoogleSheetsSpreadsheetMetadata,
  sheetName: string,
): { ok: true; sheet: Readonly<{ title: string; sheetId: number }> } | { ok: false; reason: string } {
  const sheets = Array.isArray(metadata.sheets) ? metadata.sheets : [];
  const sheet = sheets.find((entry) => normalizeText(entry.properties?.title) === sheetName) ?? null;
  if (!sheet) return { ok: false, reason: 'sheet_not_found' };
  const title = normalizeText(sheet.properties?.title);
  const sheetId = sheet.properties?.sheetId;
  if (!title) return { ok: false, reason: 'sheet_not_found' };
  if (typeof sheetId !== 'number' || !Number.isInteger(sheetId)) return { ok: false, reason: 'invalid_sheet_id' };
  return { ok: true, sheet: { title, sheetId } };
}

function blocked(reason: string): { ok: false; status: 'blocked'; reason: string } {
  return { ok: false, status: 'blocked', reason };
}

function offlineFailure(reason: string): GoogleSheetsDataHomePullFailure {
  return { ok: false, status: 'offline', reason };
}

function transportFailure(status: number, error: string): GoogleSheetsDataHomePullFailure {
  if (status === 0 || /offline/i.test(error)) {
    return { ok: false, status: 'offline', reason: 'offline' };
  }
  return { ok: false, status: 'error', reason: normalizeText(error) || `transport_error:${status}` };
}
