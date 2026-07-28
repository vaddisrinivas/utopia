import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

import {
  clearWebhookReplayState,
  getWebhookReplayState,
  markNotionWebhookEvent,
} from '../../server/src/providers/webhooks/notion';
import {
  normalizeWebhookBody,
  normalizeWebhookEvent,
  verifyNotionWebhookSignature,
} from '../../server/src/providers/notion/webhook';
import { pullNotionRecordsLive } from '../../server/src/providers/notion/pull';
import { writeNotionRecord } from '../../server/src/providers/notion/push';
import { syncNotionFromWebhook } from '../../server/src/providers/sync/notion';

type MockCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

type AdapterEvidence = {
  phase: string;
  pass: boolean;
  blocks: Record<string, unknown>;
};

const evidenceDir = join(process.cwd(), 'app', 'build', 'evidence', 'phase5-notion-adapter');
mkdirSync(evidenceDir, { recursive: true });

function normalizeHeaders(headers: Headers | Record<string, unknown> | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(Array.from(headers.entries()));
  }
  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof key === 'string' && key.length > 0) {
      acc[key.toLowerCase()] = String(value ?? '');
    }
    return acc;
  }, {});
}

function mockJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function withMockNotionFetch(pageId = 'notion-page-1', dataSourceId = 'notion-source-1') {
  const calls: MockCall[] = [];
  const originalFetch = globalThis.fetch;

  const fetchMock = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    const headers = normalizeHeaders(init.headers as Record<string, unknown> | Headers | undefined);
    const body = typeof init.body === 'string' ? init.body : '';

    calls.push({
      url,
      method,
      headers,
      body,
    });

    if (url.includes('/v1/pages') && method === 'POST' && !url.includes('/v1/data_sources/')) {
      return mockJsonResponse(200, {
        id: pageId,
        url: `https://notion.so/${pageId}`,
        archived: false,
        parent: {
          data_source_id: dataSourceId,
          type: 'data_source_id',
        },
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:00:00.000Z',
      });
    }

    if (url.includes(`/v1/pages/${pageId}`) && method === 'PATCH') {
      return mockJsonResponse(200, {
        id: pageId,
        url: `https://notion.so/${pageId}`,
        archived: false,
        parent: {
          data_source_id: dataSourceId,
        },
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:05:00.000Z',
      });
    }

    if (url.includes('/v1/pages/') && url.includes('/v1/data_sources/') === false && method === 'PATCH' && !url.includes(pageId)) {
      return mockJsonResponse(200, {
        id: pageId,
        url: `https://notion.so/${pageId}`,
        archived: false,
        parent: {
          data_source_id: dataSourceId,
        },
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:05:00.000Z',
      });
    }

    if (url.includes('/v1/data_sources/') && method === 'POST') {
      return mockJsonResponse(200, {
        results: [
          {
            object: 'page',
            id: pageId,
            properties: {
              Name: {
                title: [{
                  plain_text: 'Notion round-trip',
                }],
              },
              'Utopia Domain': 'food',
              'Utopia Collection': 'recipe',
              UnsupportedField: 'kept',
              'Food detail': {
                rich_text: [{
                  plain_text: JSON.stringify({
                    nutrition: [['Protein', '~24 g']],
                    ingredients: [{ name: 'Moong dal', amount: '1 cup', state: 'available' }],
                    instructions: ['Simmer dal.'],
                    logs: [['Planned', 'Dinner']],
                    variations: ['Add spinach'],
                  }),
                }],
              },
              Relations: {
                rich_text: [{
                  plain_text: JSON.stringify([{ name: 'plans', target_id: 'shopping-spinach' }]),
                }],
              },
            },
            created_time: '2026-01-01T00:00:00.000Z',
            last_edited_time: '2026-01-01T01:00:00.000Z',
            archived: false,
            in_trash: false,
            parent: {
              database_id: 'notion-parent-db',
            },
          },
        ],
      });
    }

    return mockJsonResponse(500, { error: { message: `unexpected notion endpoint: ${method} ${url}` } });
  }) as typeof globalThis.fetch;

  globalThis.fetch = fetchMock;

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function headerValue(headers: Record<string, string>, key: string) {
  const found = Object.entries(headers).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return found?.[1] ?? '';
}

function ensure(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasUnsupportedField(value: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(value, 'UnsupportedField') || Object.prototype.hasOwnProperty.call(value, 'Unsupported');
}

(async () => {
  const sourceRecordId = randomUUID();
  process.env.NOTION_TOKEN = `test-notion-token-${sourceRecordId}`;
  process.env.NOTION_DATA_SOURCE_ID = 'notion-source-1';
  process.env.NOTION_WEBHOOK_SIGNING_SECRET = 'phase5-webhook-secret';

  const replayPath = join(mkdtempSync(join(tmpdir(), 'notion-webhook-phase5-')), 'notion-webhook-state.json');
  const previousReplayPath = process.env.NOTION_WEBHOOK_REPLAY_PATH;
  process.env.NOTION_WEBHOOK_REPLAY_PATH = replayPath;

  const webhookSignaturePayload = JSON.stringify({
    event_type: 'page.update',
    external_id: 'notion-page-1',
    data_source_id: 'notion-source-1',
  });
  const webhookSignature = `sha256=${createHmac('sha256', process.env.NOTION_WEBHOOK_SIGNING_SECRET!).update(webhookSignaturePayload).digest('hex')}`;

  const webhookPayload = normalizeWebhookBody(webhookSignaturePayload);
  const webhookEvent = normalizeWebhookEvent(webhookPayload);
  const webhookSignatureOk = webhookPayload && verifyNotionWebhookSignature(webhookSignaturePayload, webhookSignature);

  clearWebhookReplayState(replayPath);

  const mock = withMockNotionFetch('notion-page-1', 'notion-source-1');

  const createResult = await writeNotionRecord({
    operation: 'create_record',
    recordId: `record-${sourceRecordId.slice(0, 8)}`,
    domain: 'food',
    collection: 'recipe',
    title: 'Notion phase5 check',
    properties: {
      Name: 'Notion phase5 check',
      Unsupported: 'pass-through',
      Domain: 'food',
    },
  });

  const updateResult = await writeNotionRecord({
    operation: 'update_record',
    recordId: `record-${sourceRecordId.slice(0, 8)}`,
    pageId: createResult.provider_record_id || 'notion-page-1',
    domain: 'food',
    collection: 'recipe',
    title: 'Notion phase5 check updated',
    properties: {
      NotionRoundTrip: 'updated',
      LegacyField: 'still-supported',
    },
  });

  const archiveResult = await writeNotionRecord({
    operation: 'archive_record',
    recordId: `record-${sourceRecordId.slice(0, 8)}`,
    pageId: 'notion-page-1',
    domain: 'food',
    collection: 'recipe',
    archived: true,
  });

  const pullResult = await pullNotionRecordsLive({
    domain: 'food',
    collection: 'recipe',
    limit: 10,
  });

  const syncEventPayload = normalizeWebhookBody(JSON.stringify({
    event_type: 'page.update',
    data_source_id: 'notion-source-1',
    external_id: 'notion-page-1',
    data: {
      before: 'notion-page-1',
      after: 'notion-page-1',
    },
  }));

  const syncResult = await syncNotionFromWebhook({
    event: syncEventPayload,
    domain: 'food',
    collection: 'recipe',
    limit: 10,
  });

  const syncDuplicateResult = await syncNotionFromWebhook({
    event: syncEventPayload,
    domain: 'food',
    collection: 'recipe',
    limit: 10,
  });

  const replay = markNotionWebhookEvent(syncEventPayload);
  const noIdPayload = syncEventPayload ? normalizeWebhookBody(JSON.stringify({
    event_type: 'page.update',
    data_source_id: 'notion-source-1',
    external_id: 'notion-page-1',
  })) : null;
  const replayForExternalId = noIdPayload ? markNotionWebhookEvent(noIdPayload) : { duplicate: true, processed: false };

  const replayState = getWebhookReplayState();

  if (previousReplayPath === undefined) {
    delete process.env.NOTION_WEBHOOK_REPLAY_PATH;
  } else {
    process.env.NOTION_WEBHOOK_REPLAY_PATH = previousReplayPath;
  }

  const createCall = mock.calls.find((entry) => entry.url.includes('/v1/pages') && entry.method === 'POST');
  const updateCall = mock.calls.find((entry) => entry.url.includes('/v1/pages/notion-page-1') && entry.method === 'PATCH');
  const queryCall = mock.calls.find((entry) => entry.url.includes('/v1/data_sources/notion-source-1/query') && entry.method === 'POST');

  let createPayload: Record<string, unknown> | null = null;
  let createParent: Record<string, unknown> | null = null;
  let createParentType: string | null = null;
  try {
    createPayload = createCall && typeof createCall.body === 'string' ? JSON.parse(createCall.body) : null;
  } catch {
    createPayload = null;
  }
  createParent = createPayload?.parent && typeof createPayload.parent === 'object' && !Array.isArray(createPayload.parent)
    ? (createPayload.parent as Record<string, unknown>)
    : null;
  createParentType = createParent && typeof createParent.type === 'string' ? createParent.type : null;

  const unsupportedFromPull = (pullResult.source_snapshots?.[0] as { unsupported?: Record<string, unknown> } | undefined)?.unsupported ?? {};
  const pulledRecord = pullResult.records[0] as { properties?: Record<string, unknown>; relations?: Array<{ name: string; target_id: string }> } | undefined;
  const pulledFoodDetail = pulledRecord?.properties?.food_detail as { nutrition?: unknown[] } | undefined;
  const createHeader = createCall ? headerValue(createCall.headers, 'notion-version') : '';

  const evidence: AdapterEvidence = {
    phase: 'phase5',
    pass: true,
    blocks: {
      notion_version_header: createHeader,
      notion_parent_type: createParentType,
      notion_parent_data_source: createParent?.data_source_id,
      create_ok: createResult.ok,
      create_success: createResult.success,
      create_action_receipt_present: Boolean(createResult.action_receipt),
      create_source_snapshot_has_provider: createResult.source_snapshot?.provider,
      create_source_snapshot_data_source_id: createResult.source_snapshot?.data_source_id,
      create_source_snapshot_page_id: createResult.source_snapshot?.page_id,
      create_unsupported_passthrough: Boolean(createResult.source_snapshot?.unsupported && hasUnsupportedField(createResult.source_snapshot.unsupported as Record<string, unknown>)),
      update_success: updateResult.success,
      update_unsupported_passthrough: Boolean(updateResult.source_snapshot?.unsupported && hasUnsupportedField(updateResult.source_snapshot.unsupported as Record<string, unknown>)),
      archive_success: archiveResult.success,
      pull_status: pullResult.status,
      pull_records: pullResult.records.length,
      pull_unsupported_preserved: hasUnsupportedField(unsupportedFromPull || {}),
      pull_food_detail_preserved: Array.isArray(pulledFoodDetail?.nutrition),
      pull_relations_preserved: pulledRecord?.relations?.[0]?.target_id,
      sync_status: syncResult.status,
      sync_duplicate_status: syncDuplicateResult.status,
      sync_replay_duplicate: replay.duplicate,
      sync_replay_duplicate_for_external_id: replayForExternalId.duplicate,
      replay_events: replayState.events.length,
      webhook_signature_ok: webhookSignatureOk,
      webhook_event_normalized: webhookEvent?.external_id,
      source_snapshot_provider: syncResult.sourceSnapshot && typeof syncResult.sourceSnapshot === 'object' ? (syncResult.sourceSnapshot as { provider?: unknown }).provider : null,
      update_call_seen: Boolean(updateCall),
    },
  };

  ensure(createResult.ok, 'Create must succeed with mock notion API');
  ensure(createResult.success, 'Create must report success');
  ensure(createResult.source_snapshot?.provider === 'notion', 'Create source snapshot provider must be notion');
  ensure(createResult.source_snapshot?.data_source_id === 'notion-source-1', 'Create source snapshot must include data_source_id');
  ensure(createResult.source_snapshot?.page_id === 'notion-page-1', 'Create source snapshot must include page_id');
  ensure(createResult.source_snapshot?.block_id === null, 'Create source snapshot block_id must be null');
  ensure(
    Boolean(createResult.action_receipt && createResult.action_receipt.provider_record_id === 'notion-page-1'),
    'Create action receipt must include provider record id',
  );
  ensure(
    Boolean(createResult.source_snapshot?.unsupported && hasUnsupportedField(createResult.source_snapshot.unsupported as Record<string, unknown>)),
    'Create should preserve unsupported fields in provider snapshot',
  );
  ensure(Boolean(createPayload?.parent && typeof createPayload.parent === 'object'), 'Create payload must include parent block');
  ensure(createParentType === 'data_source_id', 'Create must use parent type data_source_id');
  ensure(createParent?.data_source_id === 'notion-source-1', 'Create must use configured data source id');
  ensure(createHeader === '2026-03-11', 'Notion-Version header must be 2026-03-11');

  ensure(updateResult.ok && updateResult.success, 'Update must succeed with mock notion API');
  ensure(updateResult.source_snapshot?.operation === 'update_record', 'Update source snapshot should be update_record');
  ensure(updateResult.source_snapshot?.page_id === 'notion-page-1', 'Update source snapshot should include page id');

  ensure(archiveResult.ok && archiveResult.success, 'Archive must succeed with mock notion API');
  ensure(archiveResult.source_snapshot?.operation === 'archive_record', 'Archive source snapshot should be archive_record');
  ensure(Boolean(updateCall), 'Update endpoint must be called for update/patch operations');

  ensure(Boolean(queryCall), 'Pull API path should be called');
  ensure(pullResult.status === 'ready', 'Pull must succeed in adapter check');
  ensure(pullResult.records.length === 1, 'Pull should return one record in check path');
  ensure(hasUnsupportedField(unsupportedFromPull), 'Pull should preserve unsupported fields');
  ensure(Array.isArray(pulledFoodDetail?.nutrition), 'Pull should parse Food detail JSON into food_detail');
  ensure(pulledRecord?.relations?.[0]?.target_id === 'shopping-spinach', 'Pull should parse Relations into canonical relations');

  ensure(syncResult.status === 'synced', 'Sync should return synced for first webhook event');
  ensure(syncDuplicateResult.status === 'duplicate', 'Sync should de-duplicate duplicate webhook event');
  ensure(replay.duplicate === true, 'Replay mark should be duplicate after sync');
  ensure(replayForExternalId.duplicate === true, 'Second mark by external id should be duplicate');
  ensure(Boolean(webhookSignatureOk), 'Webhook signature must verify using provided webhook secret');
  ensure(Boolean(webhookEvent?.external_id === 'notion-page-1'), 'Webhook normalizer should keep external_id');
  ensure(Boolean(syncResult.sourceSnapshot), 'Sync result should include source snapshot');
  ensure(replayState.events.length >= 1, 'Replay state should contain events');

  const outPath = join(evidenceDir, 'phase5-notion-adapter-proof.json');
  writeFileSync(outPath, JSON.stringify(evidence, null, 2), 'utf-8');
  mock.restore();
  rmSync(replayPath, { force: true });

  console.log(`PASS ${outPath}`);
  process.stdout.write(JSON.stringify(evidence, null, 2));
  process.exit(0);
})().catch((error) => {
  console.error('FAIL', error);
  process.exit(1);
});
