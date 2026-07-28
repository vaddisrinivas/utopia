import { readSheetsConfig } from '../sheets/client';
import { pullSheetsRecordsLive, type SheetsPullInput } from '../sheets/pull';
import { inspectSheetsWebhookEvent, normalizeSheetsWebhookEvent, markSheetsWebhookEvent } from '../webhooks/sheets';

type LiveSheetsPullResult = Awaited<ReturnType<typeof pullSheetsRecordsLive>>;

export type SheetsSyncInput = {
  event: unknown;
  domain?: string;
  collection?: string;
  limit?: number;
};

export type SheetsSyncResult = {
  ok: boolean;
  status: 'synced' | 'duplicate' | 'missing_identifiers' | 'not_found' | 'error' | 'authority_blocked';
  message: string;
  eventId: string | null;
  dataSourceId: string | null;
  spreadsheetId: string | null;
  externalId: string | null;
  row: number | null;
  range: string | null;
  sourceSnapshot: Record<string, unknown> | null;
  sourceSnapshots: LiveSheetsPullResult['source_snapshots'];
  records: LiveSheetsPullResult['records'];
  canonicalApplied?: boolean;
  canonicalBlockedReason?: string;
};

function parseEventRow(input: { row?: number; range?: string }) {
  if (typeof input.row === 'number' && Number.isFinite(input.row) && input.row > 0) {
    return input.row;
  }
  if (typeof input.range !== 'string') {
    return null;
  }
  const match = /(?:!?\$?[A-Z]+\$?)([0-9]{1,})/.exec(input.range);
  if (!match) {
    return null;
  }
  const row = Number.parseInt(match[1], 10);
  return Number.isNaN(row) || row <= 0 ? null : row;
}

function findRowIndexFromEvent(
  pull: LiveSheetsPullResult,
  normalized: {
    external_id?: string | null;
    row?: number | null;
    range?: string | null;
  },
) {
  if (normalized.external_id) {
    const recordIndex = pull.records.findIndex((entry) => entry.id === normalized.external_id);
    if (recordIndex !== -1) {
      return recordIndex;
    }
  }

  const rowFromRange = parseEventRow({ row: normalized.row ?? undefined, range: normalized.range ?? undefined });
  if (!rowFromRange || !Array.isArray(pull.source_snapshots) || !pull.source_snapshots.length) {
    return -1;
  }
  const rowMatch = pull.source_snapshots.findIndex((snapshot) => {
    if (typeof snapshot !== 'object' || snapshot === null) {
      return false;
    }
    const value = (snapshot as { row?: unknown }).row;
    return typeof value === 'number' && value === rowFromRange;
  });
  if (rowMatch !== -1) {
    return rowMatch;
  }
  return -1;
}

export async function syncSheetsFromWebhook(input: SheetsSyncInput): Promise<SheetsSyncResult> {
  const normalized = normalizeSheetsWebhookEvent(input.event);
  if (!normalized) {
    return {
      ok: false,
      status: 'error',
      message: 'Malformed webhook payload.',
      eventId: null,
      dataSourceId: null,
      spreadsheetId: null,
      externalId: null,
      row: null,
      range: null,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  const config = readSheetsConfig();
  const defaultDataSourceId = config?.dataSourceId?.trim() || null;
  const defaultSpreadsheetId = config?.spreadsheetId?.trim() || null;

  const eventDataSourceId = normalized.data_source_id?.trim() || null;
  const eventSpreadsheetId = normalized.spreadsheet_id?.trim() || null;
  const eventExternalId = normalized.external_id?.trim() || null;
  const resolvedSpreadsheetId = eventSpreadsheetId || defaultSpreadsheetId;
  const resolvedDataSourceId = eventDataSourceId || defaultDataSourceId;

  const mark = inspectSheetsWebhookEvent(normalized);
  if (!mark.processed || mark.duplicate) {
    return {
      ok: true,
      status: 'duplicate',
      message: 'Webhook event already replayed.',
      eventId: mark.eventId,
      dataSourceId: eventDataSourceId || defaultDataSourceId,
      spreadsheetId: eventSpreadsheetId || defaultSpreadsheetId,
      externalId: eventExternalId,
      row: normalized.row ?? null,
      range: normalized.range || null,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  if (!eventSpreadsheetId && !defaultSpreadsheetId) {
    return {
      ok: false,
      status: 'missing_identifiers',
      message: 'Webhook event is missing spreadsheet identifier.',
      eventId: mark.eventId,
      dataSourceId: resolvedDataSourceId,
      spreadsheetId: null,
      externalId: eventExternalId,
      row: normalized.row ?? null,
      range: normalized.range || null,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  if (defaultSpreadsheetId && eventSpreadsheetId && eventSpreadsheetId !== defaultSpreadsheetId) {
    return {
      ok: false,
      status: 'not_found',
      message: `Webhook spreadsheet ${eventSpreadsheetId} does not match configured spreadsheet ${defaultSpreadsheetId}.`,
      eventId: mark.eventId,
      dataSourceId: resolvedDataSourceId,
      spreadsheetId: resolvedSpreadsheetId,
      externalId: eventExternalId,
      row: normalized.row ?? null,
      range: normalized.range || null,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  if (defaultDataSourceId && eventDataSourceId && eventDataSourceId !== defaultDataSourceId) {
    return {
      ok: false,
      status: 'not_found',
      message: `Webhook data source ${eventDataSourceId} does not match configured data source ${defaultDataSourceId}.`,
      eventId: mark.eventId,
      dataSourceId: resolvedDataSourceId,
      spreadsheetId: resolvedSpreadsheetId,
      externalId: eventExternalId,
      row: normalized.row ?? null,
      range: normalized.range || null,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  if (!eventExternalId && !normalized.row && !normalized.range) {
    return {
      ok: false,
      status: 'missing_identifiers',
      message: 'Webhook event is missing external_id or range/row target.',
      eventId: mark.eventId,
      dataSourceId: resolvedDataSourceId,
      spreadsheetId: resolvedSpreadsheetId,
      externalId: null,
      row: null,
      range: normalized.range || null,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  const pullInput: SheetsPullInput = {
    domain: input.domain,
    collection: input.collection,
  };

  const pull = await pullSheetsRecordsLive(pullInput);
  if (pull.status !== 'ready') {
    return {
      ok: false,
      status: 'error',
      message: pull.message,
      eventId: mark.eventId,
      dataSourceId: resolvedDataSourceId,
      spreadsheetId: resolvedSpreadsheetId,
      externalId: eventExternalId,
      row: normalized.row ?? null,
      range: normalized.range || null,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  const rowIndex = findRowIndexFromEvent(pull, {
    external_id: eventExternalId,
    row: normalized.row,
    range: normalized.range,
  });
  if (rowIndex < 0) {
    return {
      ok: false,
      status: 'not_found',
      message: `Record ${eventExternalId || normalized.row || normalized.range || 'target'} not found in spreadsheet ${eventSpreadsheetId || defaultSpreadsheetId}.`,
      eventId: mark.eventId,
      dataSourceId: resolvedDataSourceId,
      spreadsheetId: resolvedSpreadsheetId,
      externalId: eventExternalId,
      row: normalized.row ?? null,
      range: normalized.range || null,
      sourceSnapshot: null,
      sourceSnapshots: pull.source_snapshots,
      records: [],
    };
  }

  const foundRecord = pull.records[rowIndex];
  const foundSnapshot = pull.source_snapshots[rowIndex];
  const { upsertProviderCanonicalRecord } = await import('../../runtime/state');
  const canonical = upsertProviderCanonicalRecord({
    provider: 'google_sheets',
    id: foundRecord.id,
    domain: foundRecord.domain,
    collection: foundRecord.collection,
    title: foundRecord.title,
    properties: foundRecord.properties,
    relations: foundRecord.relations,
    archived: foundRecord.archived,
    externalId: typeof foundRecord.source?.external_id === 'string' && foundRecord.source.external_id.trim().length > 0
      ? foundRecord.source.external_id
      : foundRecord.id,
    observedAt: foundRecord.updated_at,
    contentHash: foundSnapshot && typeof foundSnapshot === 'object' && 'value_digest' in foundSnapshot
      ? String((foundSnapshot as { value_digest?: unknown }).value_digest || '')
      : null,
  });

  if (!canonical.applied) {
    return {
      ok: false,
      status: 'authority_blocked',
      message: canonical.reason || 'Provider is not the configured canonical authority.',
      eventId: mark.eventId,
      dataSourceId: resolvedDataSourceId,
      spreadsheetId: resolvedSpreadsheetId,
      externalId: eventExternalId,
      row: normalized.row || (foundSnapshot && typeof foundSnapshot === 'object' ? (foundSnapshot as { row?: number }).row || null : null),
      range: normalized.range || null,
      sourceSnapshot: foundSnapshot && typeof foundSnapshot === 'object' ? (foundSnapshot as Record<string, unknown>) : null,
      sourceSnapshots: pull.source_snapshots,
      records: [foundRecord],
      canonicalApplied: false,
      canonicalBlockedReason: canonical.reason,
    };
  }

  // Commit replay state only after the pull and canonical write succeed, so a
  // transient Sheets API failure can be retried safely.
  const committed = markSheetsWebhookEvent(normalized);

  return {
    ok: true,
    status: 'synced',
    message: `Webhook row ${
      normalized.row ?? rowIndex + 1
    } synced from spreadsheet ${eventSpreadsheetId || defaultSpreadsheetId}.`,
    eventId: committed.eventId || mark.eventId,
    dataSourceId: eventDataSourceId || defaultDataSourceId,
    spreadsheetId: eventSpreadsheetId || defaultSpreadsheetId,
    externalId: eventExternalId,
    row: normalized.row || (foundSnapshot && typeof foundSnapshot === 'object' ? (foundSnapshot as { row?: number }).row || null : null),
    range: normalized.range || null,
      sourceSnapshot: foundSnapshot && typeof foundSnapshot === 'object' ? (foundSnapshot as Record<string, unknown>) : null,
      sourceSnapshots: pull.source_snapshots,
      records: [foundRecord],
      canonicalApplied: true,
    };
}
