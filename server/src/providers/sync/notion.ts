import { readNotionConfig, notionDataSourceId } from '../notion/client';
import { normalizeWebhookEvent } from '../notion/webhook';
import { inspectNotionWebhookEvent, markNotionWebhookEvent } from '../webhooks/notion';
import { pullNotionRecordsLive } from '../notion/pull';

export type NotionSyncInput = {
  event: unknown;
  domain?: string;
  collection?: string;
  limit?: number;
};

type NotionLivePullResult = Awaited<ReturnType<typeof pullNotionRecordsLive>>;

export type NotionSyncResult = {
  ok: boolean;
  status:
    | 'synced'
    | 'duplicate'
    | 'missing_identifiers'
    | 'not_found'
    | 'error'
    | 'authority_blocked';
  message: string;
  eventId: string | null;
  dataSourceId: string | null;
  pageId: string | null;
  externalId: string | null;
  sourceSnapshot: Record<string, unknown> | null;
  sourceSnapshots: NotionLivePullResult['source_snapshots'];
  records: NotionLivePullResult['records'];
  canonicalApplied?: boolean;
  canonicalBlockedReason?: string;
};

export async function syncNotionFromWebhook(input: NotionSyncInput): Promise<NotionSyncResult> {
  const normalized = normalizeWebhookEvent(input.event);
  if (!normalized) {
    return {
      ok: false,
      status: 'error',
      message: 'Malformed webhook payload.',
      eventId: null,
      dataSourceId: null,
      pageId: null,
      externalId: null,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  const pageId = normalized.page_id || normalized.external_id || null;
  const externalId = normalized.external_id || null;
  const config = readNotionConfig();
  const dataSourceId = normalized.data_source_id || notionDataSourceId(config ?? undefined) || null;

  const mark = inspectNotionWebhookEvent(normalized);
  if (mark.duplicate || !mark.processed) {
    return {
      ok: true,
      status: 'duplicate',
      message: 'Webhook event already replayed.',
      eventId: mark.eventId,
      dataSourceId,
      pageId,
      externalId,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  if (!pageId || !dataSourceId) {
    return {
      ok: false,
      status: 'missing_identifiers',
      message: 'Webhook event is missing page/external id or data_source_id.',
      eventId: mark.eventId,
      dataSourceId,
      pageId,
      externalId,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  const pull = await pullNotionRecordsLive({
    domain: input.domain,
    collection: input.collection,
    limit: input.limit,
    pageId: pageId || undefined,
    externalId: externalId || undefined,
  });

  if (pull.status !== 'ready') {
    return {
      ok: false,
      status: 'error',
      message: pull.message,
      eventId: mark.eventId,
      dataSourceId,
      pageId,
      externalId,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  const index = pull.records.findIndex((entry) => entry.id === pageId);
  if (index === -1) {
    return {
      ok: false,
      status: 'not_found',
      message: `Page ${pageId} not found in data source ${dataSourceId}.`,
      eventId: mark.eventId,
      dataSourceId,
      pageId,
      externalId,
      sourceSnapshot: null,
      sourceSnapshots: [],
      records: [],
    };
  }

  const source = pull.source_snapshots[index] as Record<string, unknown> | undefined;
  const { upsertProviderCanonicalRecord } = await import('../../runtime/state');
  const canonical = upsertProviderCanonicalRecord({
    provider: 'notion',
    id: pull.records[index].id,
    domain: pull.records[index].domain,
    collection: pull.records[index].collection,
    title: pull.records[index].title,
    properties: pull.records[index].properties,
    relations: pull.records[index].relations,
    archived: Boolean(source?.archived),
    externalId: typeof source?.page_id === 'string' ? source.page_id : pageId,
    url: typeof source?.url === 'string' ? source.url : null,
    observedAt: typeof source?.lastEditedTime === 'string' ? source.lastEditedTime : null,
  });

  if (!canonical.applied) {
    return {
      ok: false,
      status: 'authority_blocked',
      message: canonical.reason || 'Provider is not the configured canonical authority.',
      eventId: mark.eventId,
      dataSourceId,
      pageId,
      externalId,
      sourceSnapshot: source || null,
      sourceSnapshots: pull.source_snapshots,
      records: [pull.records[index]],
      canonicalApplied: false,
      canonicalBlockedReason: canonical.reason,
    };
  }

  // Commit replay state only after the provider refetch and canonical write
  // both succeed. Failed pulls remain retryable with the same event id.
  const committed = markNotionWebhookEvent(normalized);

  return {
    ok: true,
    status: 'synced',
    message: `Webhook page ${pageId} synced from data source ${dataSourceId}.`,
    eventId: committed.eventId || mark.eventId,
    dataSourceId,
    pageId,
    externalId,
    sourceSnapshot: pull.source_snapshots[index] as Record<string, unknown>,
    sourceSnapshots: pull.source_snapshots,
    records: [pull.records[index]],
    canonicalApplied: true,
  };
}
