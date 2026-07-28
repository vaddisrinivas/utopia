import { createHmac, timingSafeEqual } from 'node:crypto';
import { readNotionConfig } from './client';

type NotionWebhookEvent = {
  id?: string;
  event_type?: string;
  timestamp?: string;
  page_id?: string;
  external_id?: string;
  data_source_id?: string;
  data?: Record<string, unknown>;
  dedup_id?: string;
  event_id?: string;
  created_time?: string;
};

type NotionWebhookSequence = {
  before?: string;
  after?: string;
  eventId: string;
  timestamp: number;
};

const WEBHOOK_EVENT_TTL_MS = 10 * 60 * 1000;
const webhookEventSeen = new Map<string, number>();
const webhookSequenceBySource = new Map<string, NotionWebhookSequence>();

function getSigningSecret() {
  return readNotionConfig()?.webhookSigningSecret;
}

function asRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function extractWebhookEventId(raw: unknown): string {
  const event = normalizeWebhookEvent(raw);
  if (!event) {
    return '';
  }
  if (typeof event.event_id === 'string' && event.event_id.length > 0) {
    return event.event_id;
  }
  if (typeof event.dedup_id === 'string' && event.dedup_id.length > 0) {
    return event.dedup_id;
  }
  if (typeof event.external_id === 'string' && event.external_id.length > 0) {
    return `external:${event.external_id}`;
  }
  if (typeof event.id === 'string' && event.id.length > 0) {
    return event.id;
  }
  if (typeof event.page_id === 'string' && event.page_id.length > 0) {
    return event.page_id;
  }
  return '';
}

export function verifyNotionWebhookSignature(rawBody: string, providedSignature: string | undefined): boolean {
  const secret = getSigningSecret();
  if (!secret || !providedSignature) {
    return false;
  }

  const signature = providedSignature.replace(/^sha256=/i, '');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(signature, 'utf8');
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, providedBytes);
}

export function normalizeWebhookEvent(raw: unknown): NotionWebhookEvent | null {
  if (!asRecord(raw)) {
    return null;
  }

  const root = raw as Record<string, unknown>;
  const payload = asRecord(root.event) ? (root.event as Record<string, unknown>) : root;

  const id = typeof payload.id === 'string' ? payload.id :
    typeof payload.event_id === 'string' ? payload.event_id :
      typeof payload.dedup_id === 'string' ? payload.dedup_id :
        typeof payload.external_id === 'string' ? `external:${payload.external_id}` :
          typeof payload.page_id === 'string' ? payload.page_id :
            undefined;

  const eventType = typeof payload.event_type === 'string' ? payload.event_type : undefined;

  if (!id && !eventType && typeof (payload as { type?: unknown }).type !== 'string') {
    return null;
  }

  const output: NotionWebhookEvent = {
    id,
  };
  if (eventType) {
    output.event_type = eventType;
  }
  if (typeof payload.event_id === 'string') {
    output.event_id = payload.event_id;
  }
  if (typeof payload.dedup_id === 'string') {
    output.dedup_id = payload.dedup_id;
  }
  if (typeof payload.external_id === 'string') {
    output.external_id = payload.external_id;
  }
  if (typeof payload.page_id === 'string') {
    output.page_id = payload.page_id;
  }
  if (typeof payload.data_source_id === 'string') {
    output.data_source_id = payload.data_source_id;
  }
  if (typeof payload.created_time === 'string') {
    output.created_time = payload.created_time;
  }
  if (typeof payload.timestamp === 'string') {
    output.timestamp = payload.timestamp;
  }
  if (asRecord(payload.data)) {
    output.data = payload.data as Record<string, unknown>;
    if (typeof output.data.external_id === 'string' && !output.external_id) {
      output.external_id = output.data.external_id;
    }
    if (typeof output.data.page_id === 'string' && !output.page_id) {
      output.page_id = output.data.page_id;
    }
  }

  return output;
}

export function normalizeWebhookBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function parseWebhookTimestamp(value?: string): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEventId(event: NotionWebhookEvent): string {
  return event.id || event.event_id || event.dedup_id || `${event.page_id || 'page-unknown'}:${event.event_type || 'change'}:${event.timestamp || '0'}`;
}

function pruneWebhookCache(now: number) {
  const cutoff = now - WEBHOOK_EVENT_TTL_MS;
  for (const [key, timestamp] of webhookEventSeen.entries()) {
    if (timestamp < cutoff) {
      webhookEventSeen.delete(key);
    }
  }
  for (const [key, entry] of webhookSequenceBySource.entries()) {
    if (entry.timestamp < cutoff) {
      webhookSequenceBySource.delete(key);
    }
  }
}

function webhookSourceKey(event: NotionWebhookEvent): string {
  return event.data_source_id || event.page_id || event.id || 'notion-global';
}

export function hasWebhookOrderHint(raw: unknown): { before?: string; after?: string } {
  const payload = normalizeWebhookEvent(raw);
  if (!payload || !asRecord(payload.data)) {
    return {};
  }

  const data = payload.data;
  const beforeRaw = typeof data.before === 'string' ? data.before : undefined;
  const afterRaw = typeof data.after === 'string' ? data.after : undefined;

  return {
    before: beforeRaw && beforeRaw.trim().length > 0 ? beforeRaw.trim() : undefined,
    after: afterRaw && afterRaw.trim().length > 0 ? afterRaw.trim() : undefined,
  };
}

export function isDuplicateNotionWebhook(raw: unknown): boolean {
  const payload = normalizeWebhookEvent(raw);
  if (!payload) {
    return false;
  }
  const now = Date.now();
  pruneWebhookCache(now);
  const eventId = extractWebhookEventId(payload);
  if (!eventId) {
    return false;
  }
  return webhookEventSeen.has(eventId);
}

export function markNotionWebhookProcessed(raw: unknown): { processed: boolean; eventId: string | null } {
  const payload = normalizeWebhookEvent(raw);
  if (!payload) {
    return { processed: false, eventId: null };
  }
  const eventId = normalizeEventId(payload);
  const now = Date.now();
  const hasDuplicate = webhookEventSeen.has(eventId);
  pruneWebhookCache(now);
  webhookEventSeen.set(eventId, now);
  const sourceKey = webhookSourceKey(payload);
  const orderHint = hasWebhookOrderHint(payload);
  webhookSequenceBySource.set(sourceKey, {
    before: orderHint.before,
    after: orderHint.after,
    eventId,
    timestamp: now,
  });
  return { processed: !hasDuplicate, eventId };
}

export function webhookOutOfOrder(raw: unknown): boolean {
  const payload = normalizeWebhookEvent(raw);
  if (!payload) {
    return false;
  }
  const sourceKey = webhookSourceKey(payload);
  const existing = webhookSequenceBySource.get(sourceKey);
  if (!existing) {
    return false;
  }
  const hints = hasWebhookOrderHint(payload);
  if (!hints.before) {
    return false;
  }
  if (!existing.after) {
    return false;
  }
  return hints.before !== existing.after;
}
