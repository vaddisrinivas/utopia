import { existsSync } from 'node:fs';
import { readJsonStateFile, writeJsonStateFileAtomic } from '../json-state';
import {
  extractWebhookEventId,
  hasWebhookOrderHint,
  isDuplicateNotionWebhook,
  markNotionWebhookProcessed,
  normalizeWebhookEvent,
  webhookOutOfOrder,
} from '../notion/webhook';

type NotionWebhookReplayEntry = {
  event_id: string;
  page_id?: string;
  external_id?: string;
  data_source_id?: string;
  first_seen: string;
  last_seen: string;
  fingerprint: string;
  out_of_order: boolean;
};

type NotionWebhookReplayState = {
  events: NotionWebhookReplayEntry[];
};

type NotionWebhookMarkResult = {
  processed: boolean;
  duplicate: boolean;
  outOfOrder: boolean;
  eventId: string | null;
  pageId: string | null;
  externalId: string | null;
  dataSourceId: string | null;
};

const DEFAULT_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

function webhookReplayPath() {
  const override = process.env.NOTION_WEBHOOK_REPLAY_PATH?.trim();
  if (override?.length) {
    return override;
  }
  return `${process.cwd()}/server-data/notion-webhook-replay.json`;
}

function normalizeText(raw: unknown) {
  return typeof raw === 'string' ? raw.trim() : '';
}

function stableHash(raw: unknown) {
  return JSON.stringify(raw);
}

function readReplayState(path: string): NotionWebhookReplayState {
  if (!existsSync(path)) {
    return { events: [] };
  }
  const parsed = readJsonStateFile(path, {
    label: 'Notion webhook replay state',
    validate: (value: unknown): value is NotionWebhookReplayState =>
      typeof value === 'object'
      && value !== null
      && Array.isArray((value as { events?: unknown }).events),
  });
  if (Array.isArray(parsed.events)) {
    return { events: parsed.events.filter((entry) => entry?.event_id) };
  }
  return { events: [] };
}

function pruneReplayState(state: NotionWebhookReplayState, now = Date.now()) {
  const cutoff = now - DEFAULT_REPLAY_TTL_MS;
  state.events = state.events.filter((entry) => {
    const parsed = Date.parse(entry.last_seen);
    return Number.isFinite(parsed) && parsed >= cutoff;
  });
}

function persistReplayState(path: string, state: NotionWebhookReplayState) {
  writeJsonStateFileAtomic(path, state);
}

function fingerprintEvent(event: ReturnType<typeof normalizeWebhookEvent>) {
  if (!event) {
    return '';
  }
  return stableHash({
    external_id: event.external_id,
    page_id: event.page_id,
    event_type: event.event_type,
    data_source_id: event.data_source_id,
    before: event.data?.before,
    after: event.data?.after,
    timestamp: event.timestamp,
  });
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
  const event = normalizeWebhookEvent(raw);
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

/** Inspect replay state without committing an event. Sync commits only after
 * provider refetch and canonical application succeed. */
export function inspectNotionWebhookEvent(raw: unknown): NotionWebhookMarkResult {
  const event = normalizeWebhookEvent(raw);
  if (!event) {
    return {
      processed: false,
      duplicate: false,
      outOfOrder: false,
      eventId: null,
      pageId: null,
      externalId: null,
      dataSourceId: null,
    };
  }

  const eventId = extractWebhookEventId(event);
  const pageId = normalizeText(event.page_id);
  const externalId = normalizeText(event.external_id);
  const dataSourceId = normalizeText(event.data_source_id);
  const state = buildPathState(webhookReplayPath());
  const duplicate = Boolean(
    (eventId && state.events.some((entry) => entry.event_id === eventId)) || isDuplicateNotionWebhook(event),
  );
  return {
    processed: !duplicate,
    duplicate,
    outOfOrder: webhookOutOfOrder(event),
    eventId: eventId || null,
    pageId: pageId || null,
    externalId: externalId || null,
    dataSourceId: dataSourceId || null,
  };
}

export function markNotionWebhookEvent(raw: unknown): NotionWebhookMarkResult {
  const event = normalizeWebhookEvent(raw);
  if (!event) {
    return {
      processed: false,
      duplicate: false,
      outOfOrder: false,
      eventId: null,
      pageId: null,
      externalId: null,
      dataSourceId: null,
    };
  }

  const eventId = extractWebhookEventId(event);
  const pageId = normalizeText(event.page_id);
  const externalId = normalizeText(event.external_id);
  const dataSourceId = normalizeText(event.data_source_id);
  const path = webhookReplayPath();
  const state = buildPathState(path);

  const inMemoryDuplicate = isDuplicateNotionWebhook(event);
  const inStoreDuplicate = eventId ? state.events.some((entry) => entry.event_id === eventId) : false;
  if (inStoreDuplicate || inMemoryDuplicate) {
    return {
      processed: false,
      duplicate: true,
      outOfOrder: webhookOutOfOrder(event),
      eventId: eventId || null,
      pageId: pageId || null,
      externalId: externalId || null,
      dataSourceId: dataSourceId || null,
    };
  }

  const result = markNotionWebhookProcessed(event);
  if (!result.processed) {
    return {
      processed: false,
      duplicate: true,
      outOfOrder: webhookOutOfOrder(event),
      eventId: eventId || null,
      pageId: pageId || null,
      externalId: externalId || null,
      dataSourceId: dataSourceId || null,
    };
  }

  const order = hasWebhookOrderHint(event);
  const fingerprint = fingerprintEvent(event);
  const now = new Date().toISOString();

  state.events.push({
    event_id: eventId || `${pageId || 'notion'}:${now}`,
    page_id: pageId || undefined,
    external_id: externalId || undefined,
    data_source_id: dataSourceId || undefined,
    first_seen: now,
    last_seen: now,
    fingerprint,
    out_of_order: Boolean(order.before || order.after),
  });
  state.events.sort((a, b) => Date.parse(a.last_seen) - Date.parse(b.last_seen));
  persistReplayState(path, state);

  return {
    processed: true,
    duplicate: false,
    outOfOrder: webhookOutOfOrder(event),
    eventId: eventId || null,
    pageId: pageId || null,
    externalId: externalId || null,
    dataSourceId: dataSourceId || null,
  };
}
