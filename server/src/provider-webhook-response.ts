import type { NotionSyncResult } from './providers/sync/notion';
import type { SheetsSyncResult } from './providers/sync/sheets';

type NotionWebhookReplayEntry = {
  event_id?: string | null;
  out_of_order?: boolean;
};

type SheetsWebhookReplayEntry = {
  event_id?: string | null;
  out_of_order?: boolean;
};

type NotionReplayState = {
  events: NotionWebhookReplayEntry[];
};

type SheetsReplayState = {
  events: SheetsWebhookReplayEntry[];
};

type NotionNormalizedEvent = {
  event_type?: string | null;
  data_source_id?: string | null;
  page_id?: string | null;
  data?: unknown;
};

type SheetsNormalizedEvent = {
  spreadsheet_id?: string | null;
  data_source_id?: string | null;
  range?: string | null;
  row?: number | null;
  before?: string | null;
  after?: string | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function replayOutOfOrder(replayState: { events: Array<{ event_id?: string | null; out_of_order?: boolean }> }, eventId: string | null) {
  if (!eventId) {
    return false;
  }
  return replayState.events.some((entry) => entry.event_id === eventId && entry.out_of_order);
}

function notionOrderHint(data: unknown) {
  const hints = isObject(data) ? data : null;
  return {
    before: typeof hints?.before === 'string' ? hints.before : undefined,
    after: typeof hints?.after === 'string' ? hints.after : undefined,
  };
}

export function buildNotionWebhookResponse(
  normalized: NotionNormalizedEvent,
  reconciliation: NotionSyncResult,
  replayState: NotionReplayState,
) {
  return {
    status: reconciliation.status === 'duplicate' ? 'duplicate' : 'accepted',
    duplicate: reconciliation.status === 'duplicate',
    event_id: reconciliation.eventId || null,
    event_type: normalized.event_type || null,
    out_of_order: replayOutOfOrder(replayState, reconciliation.eventId),
    replay_queue_size: replayState.events.length,
    duplicate_store: reconciliation.status === 'duplicate',
    data_source_id: reconciliation.dataSourceId || normalized.data_source_id || null,
    page_id: reconciliation.pageId || normalized.page_id || null,
    sync_status: reconciliation.status,
    sync_ok: reconciliation.ok && reconciliation.canonicalApplied !== false,
    sync_message: reconciliation.message,
    records_synced: reconciliation.records.length,
    canonical_applied: reconciliation.canonicalApplied ?? false,
    canonical_blocked_reason: reconciliation.canonicalBlockedReason || null,
    source_snapshot: reconciliation.sourceSnapshot,
    order_hint: notionOrderHint(normalized.data),
  };
}

export function buildSheetsWebhookResponse(
  normalized: SheetsNormalizedEvent,
  reconciliation: SheetsSyncResult,
  replayState: SheetsReplayState,
) {
  return {
    status: reconciliation.status === 'duplicate' ? 'duplicate' : 'accepted',
    duplicate: reconciliation.status === 'duplicate',
    event_id: reconciliation.eventId || null,
    spreadsheet_id: reconciliation.spreadsheetId || normalized.spreadsheet_id || null,
    data_source_id: reconciliation.dataSourceId || normalized.data_source_id || null,
    range: reconciliation.range || normalized.range || null,
    row: reconciliation.row || normalized.row || null,
    out_of_order: replayOutOfOrder(replayState, reconciliation.eventId),
    replay_queue_size: replayState.events.length,
    sync_status: reconciliation.status,
    sync_ok: reconciliation.ok && reconciliation.canonicalApplied !== false,
    sync_message: reconciliation.message,
    records_synced: reconciliation.records.length,
    canonical_applied: reconciliation.canonicalApplied ?? false,
    canonical_blocked_reason: reconciliation.canonicalBlockedReason || null,
    source_snapshot: reconciliation.sourceSnapshot,
    order_hint: {
      before: normalized.before || undefined,
      after: normalized.after || undefined,
    },
  };
}
