import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readJsonStateFile, writeJsonStateFileAtomic } from '../json-state';

export type SheetsWebhookEvent = {
  event_id?: string;
  spreadsheet_id?: string;
  data_source_id?: string;
  sheet_name?: string;
  range?: string;
  row?: number;
  external_id?: string;
  revision?: string;
  before?: string;
  after?: string;
  timestamp?: string;
};

type SheetsWebhookReplayEntry = {
  event_id: string;
  spreadsheet_id?: string;
  data_source_id?: string;
  sheet_name?: string;
  range?: string;
  row?: number;
  external_id?: string;
  first_seen: string;
  last_seen: string;
  fingerprint: string;
  out_of_order: boolean;
};

type SheetsWebhookReplayState = {
  events: SheetsWebhookReplayEntry[];
};

type SheetsWebhookSequence = {
  before?: string;
  after?: string;
  eventId: string;
  timestamp: number;
};

type SheetsWebhookOrderHint = {
  before?: string;
  after?: string;
};

type SheetsWebhookMarkResult = {
  processed: boolean;
  duplicate: boolean;
  outOfOrder: boolean;
  eventId: string | null;
  spreadsheetId: string | null;
  dataSourceId: string | null;
  sheetName: string | null;
  range: string | null;
  row: number | null;
  externalId: string | null;
};

const DEFAULT_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
const sheetsWebhookSequenceByTarget = new Map<string, SheetsWebhookSequence>();

function normalizeText(raw: unknown) {
  return typeof raw === 'string' ? raw.trim() : '';
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function webhookReplayPath() {
  const override = process.env.SHEETS_WEBHOOK_REPLAY_PATH?.trim();
  if (override?.length) {
    return override;
  }
  return `${process.cwd()}/server-data/sheets-webhook-replay.json`;
}

function stringify(raw: unknown) {
  return JSON.stringify(raw);
}

function readReplayState(path: string): SheetsWebhookReplayState {
  if (!existsSync(path)) {
    return { events: [] };
  }
  const parsed = readJsonStateFile(path, {
    label: 'Sheets webhook replay state',
    validate: (value: unknown): value is SheetsWebhookReplayState =>
      typeof value === 'object'
      && value !== null
      && Array.isArray((value as { events?: unknown }).events),
  });
  if (Array.isArray(parsed.events)) {
    return {
      events: parsed.events.filter((entry) => entry?.event_id).map((entry) => ({ ...entry })),
    };
  }
  return { events: [] };
}

function persistReplayState(path: string, state: SheetsWebhookReplayState) {
  writeJsonStateFileAtomic(path, state);
}

function pruneReplayState(state: SheetsWebhookReplayState, now = Date.now()) {
  const cutoff = now - DEFAULT_REPLAY_TTL_MS;
  state.events = state.events.filter((entry) => {
    const parsed = Date.parse(entry.last_seen);
    return Number.isFinite(parsed) && parsed >= cutoff;
  });
}

function parseSpreadsheetRangeRow(raw?: string) {
  if (!raw) {
    return undefined;
  }
  const match = /^(?:[^!]*!)?\$?[A-Z]{1,3}\$?([0-9]{1,})(?::\$?[A-Z]{1,3}\$?[0-9]{1,})?$/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const row = Number.parseInt(match[1], 10);
  return Number.isNaN(row) || row <= 0 ? undefined : row;
}

function parseEventRowValue(raw: unknown) {
  if (typeof raw === 'number') {
    const row = Number.isFinite(raw) ? Math.trunc(raw) : NaN;
    return Number.isNaN(row) || row <= 0 ? undefined : row;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }
      const explicit = Number.parseInt(trimmed, 10);
      if (!Number.isNaN(explicit) && explicit > 0) {
        return explicit;
      }
      return parseSpreadsheetRangeRow(trimmed);
  }

  return undefined;
}

export function normalizeSheetsWebhookEvent(raw: unknown): SheetsWebhookEvent | null {
  const root = asRecord(raw);
  if (!root) {
    return null;
  }

  const payload = asRecord(root.event) ?? root;
  const eventId = normalizeText(payload.id) || normalizeText(payload.event_id) || normalizeText(payload.dedup_id);
  const spreadsheetId = normalizeText(payload.spreadsheet_id) || normalizeText(payload.spreadsheetId);
  if (!eventId && !spreadsheetId && !payload.range && !payload.external_id) {
    return null;
  }

  const range = normalizeText(payload.range);
  const row = parseEventRowValue(payload.row);

  return {
    event_id: eventId || undefined,
    spreadsheet_id: spreadsheetId || undefined,
    data_source_id: normalizeText(payload.data_source_id),
    sheet_name: normalizeText(payload.sheet_name || payload.table || payload.tab || payload.worksheet),
    range,
    row: row || parseSpreadsheetRangeRow(range),
    external_id: normalizeText(payload.external_id),
    revision: normalizeText(payload.revision),
    before: normalizeText(payload.before),
    after: normalizeText(payload.after),
    timestamp: normalizeText(payload.timestamp),
  };
}

export function hasSheetsWebhookOrderHint(raw: unknown): SheetsWebhookOrderHint {
  const payload = normalizeSheetsWebhookEvent(raw);
  if (!payload) {
    return {};
  }
  return {
    before: payload.before || undefined,
    after: payload.after || undefined,
  };
}

function webhookTargetKey(event: SheetsWebhookEvent) {
  return event.data_source_id || event.spreadsheet_id || event.sheet_name || 'sheets-global';
}

function webhookEventFingerprint(event: SheetsWebhookEvent) {
  return createHash('sha256').update(stringify(event)).digest('hex');
}

function webhookOutOfOrder(event: SheetsWebhookEvent) {
  const sourceKey = webhookTargetKey(event);
  const existing = sheetsWebhookSequenceByTarget.get(sourceKey);
  if (!existing) {
    return false;
  }
  const hints = hasSheetsWebhookOrderHint(event);
  if (!hints.before) {
    return false;
  }
  if (!existing.after) {
    return false;
  }
  return hints.before !== existing.after;
}

function buildPathState(path: string) {
  const state = readReplayState(path);
  pruneReplayState(state);
  return state;
}

export function clearWebhookReplayState(path = webhookReplayPath()) {
  persistReplayState(path, { events: [] });
}

export function getWebhookReplayState(path = webhookReplayPath()) {
  return buildPathState(path);
}

export function isWebhookReplayDuplicate(raw: unknown): boolean {
  const event = normalizeSheetsWebhookEvent(raw);
  if (!event) {
    return false;
  }
  const eventId = extractWebhookEventId(event);
  if (!eventId) {
    return false;
  }
  const state = buildPathState(webhookReplayPath());
  return state.events.some((entry) => entry.event_id === eventId);
}

/** Inspect replay state without committing. The sync layer commits only after
 * a successful provider pull and canonical application. */
export function inspectSheetsWebhookEvent(raw: unknown): SheetsWebhookMarkResult {
  const event = normalizeSheetsWebhookEvent(raw);
  if (!event) {
    return {
      processed: false,
      duplicate: false,
      outOfOrder: false,
      eventId: null,
      spreadsheetId: null,
      dataSourceId: null,
      sheetName: null,
      range: null,
      row: null,
      externalId: null,
    };
  }
  const eventId = event.event_id || `${event.spreadsheet_id || 'sheets'}:${event.range || 'range'}:${event.row ?? ''}:${event.timestamp || '0'}`;
  const state = buildPathState(webhookReplayPath());
  const duplicate = state.events.some((entry) => entry.event_id === eventId);
  return {
    processed: !duplicate,
    duplicate,
    outOfOrder: webhookOutOfOrder(event),
    eventId,
    spreadsheetId: event.spreadsheet_id || null,
    dataSourceId: event.data_source_id || null,
    sheetName: event.sheet_name || null,
    range: event.range || null,
    row: event.row || null,
    externalId: event.external_id || null,
  };
}

export function extractWebhookEventId(raw: unknown): string {
  const event = normalizeSheetsWebhookEvent(raw);
  return event?.event_id || '';
}

export function markSheetsWebhookEvent(raw: unknown): SheetsWebhookMarkResult {
  const event = normalizeSheetsWebhookEvent(raw);
  if (!event) {
    return {
      processed: false,
      duplicate: false,
      outOfOrder: false,
      eventId: null,
      spreadsheetId: null,
      dataSourceId: null,
      sheetName: null,
      range: null,
      row: null,
      externalId: null,
    };
  }

  const eventId = event.event_id || `${event.spreadsheet_id || 'sheets'}:${event.range || 'range'}:${event.row ?? ''}:${event.timestamp || '0'}`;
  const path = webhookReplayPath();
  const state = buildPathState(path);
  const inStoreDuplicate = state.events.some((entry) => entry.event_id === eventId);
  const outOfOrder = webhookOutOfOrder(event);

  if (inStoreDuplicate) {
    return {
      processed: false,
      duplicate: true,
      outOfOrder,
      eventId: eventId || null,
      spreadsheetId: event.spreadsheet_id || null,
      dataSourceId: event.data_source_id || null,
      sheetName: event.sheet_name || null,
      range: event.range || null,
      row: event.row || null,
      externalId: event.external_id || null,
    };
  }

  const now = new Date().toISOString();
  state.events.push({
    event_id: eventId,
    spreadsheet_id: event.spreadsheet_id,
    data_source_id: event.data_source_id,
    sheet_name: event.sheet_name,
    range: event.range,
    row: event.row,
    external_id: event.external_id,
    first_seen: now,
    last_seen: now,
    fingerprint: webhookEventFingerprint(event),
    out_of_order: outOfOrder,
  });

  state.events.sort((a, b) => Date.parse(a.last_seen) - Date.parse(b.last_seen));
  persistReplayState(path, state);

  const sourceKey = webhookTargetKey(event);
  const orderHint = hasSheetsWebhookOrderHint(event);
  sheetsWebhookSequenceByTarget.set(sourceKey, {
    before: orderHint.before,
    after: orderHint.after,
    eventId,
    timestamp: Date.now(),
  });

  return {
    processed: true,
    duplicate: false,
    outOfOrder,
    eventId,
    spreadsheetId: event.spreadsheet_id || null,
    dataSourceId: event.data_source_id || null,
    sheetName: event.sheet_name || null,
    range: event.range || null,
    row: event.row || null,
    externalId: event.external_id || null,
  };
}
