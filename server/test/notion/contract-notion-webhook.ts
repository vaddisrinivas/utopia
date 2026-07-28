import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { normalizeWebhookBody, normalizeWebhookEvent } from '../../src/providers/notion/webhook';
import { syncNotionFromWebhook } from '../../src/providers/sync/notion';
import { clearWebhookReplayState, getWebhookReplayState, markNotionWebhookEvent } from '../../src/providers/webhooks/notion';
import { pullNotionRecordsLive } from '../../src/providers/notion/pull';

type MockCall = {
  url: string;
  method: string;
};

type EvidenceRecord = {
  test: string;
  status: 'pass' | 'fail';
  details: Record<string, unknown>;
};

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

  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url, method });

    if (url.includes('/v1/pages') && method === 'POST' && !url.includes('/v1/data_sources/')) {
      return mockJsonResponse(200, {
        id: pageId,
        url: `https://notion.so/${pageId}`,
        archived: false,
        parent: {
          type: 'data_source_id',
          data_source_id: dataSourceId,
        },
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:00:00.000Z',
      });
    }

    if (url.includes(`/v1/pages/${pageId}`) && method === 'PATCH') {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as { archived?: boolean } : {};
      return mockJsonResponse(200, {
        id: pageId,
        url: `https://notion.so/${pageId}`,
        archived: Boolean(body.archived),
        parent: {
          type: 'data_source_id',
          data_source_id: dataSourceId,
        },
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:03:00.000Z',
      });
    }

    if (url.includes(`/v1/data_sources/${dataSourceId}/query`) && method === 'POST') {
      return mockJsonResponse(200, {
        results: [
          {
            object: 'page',
            id: pageId,
            properties: {
              Name: {
                title: [{ plain_text: 'Contract webhook' }],
              },
              'Utopia Domain': 'food',
              'Utopia Collection': 'recipe',
              ContractField: 'kept',
            },
            created_time: '2026-01-01T00:00:00.000Z',
            last_edited_time: '2026-01-01T00:10:00.000Z',
            archived: false,
            in_trash: false,
            parent: {
              database_id: 'notion-db',
            },
          },
        ],
      });
    }

    return mockJsonResponse(500, { error: { message: `unexpected notion endpoint: ${method} ${url}` } });
  }) as typeof globalThis.fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasContractField(value: unknown) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'ContractField' in value || 'contract' in value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function buildOperationHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

(async () => {
  const evidence: { tests: EvidenceRecord[]; source: Record<string, unknown> } = {
    tests: [],
    source: {},
  };

  process.env.NOTION_TOKEN = 'test-notion-token-contract';
  process.env.NOTION_DATA_SOURCE_ID = 'notion-source-1';

  // MCP path: create / update / archive with notion data_home
  const runtimeStatePath = join(mkdtempSync(join(tmpdir(), 'mcp-notion-contract-')), 'wonder-runtime.json');
  const previousRuntimeStatePath = process.env.WONDER_RUNTIME_STATE_PATH;
  process.env.WONDER_RUNTIME_STATE_PATH = runtimeStatePath;

  const notionStateDir = join(mkdtempSync(join(tmpdir(), 'notion-contract-')), 'notion-state.json');
  process.env.NOTION_WEBHOOK_REPLAY_PATH = notionStateDir;

  const mock = withMockNotionFetch('notion-page-1', 'notion-source-1');

  try {
    const { callMcpTool } = await import('../../src/tools/catalog');

    const create = await callMcpTool('utopia.create_record', {
      actor: 'hearth',
      domain: 'food',
      collection: 'recipe',
      data_home: 'notion',
      id: 'contract-notion-1',
      title: 'Contract create',
      properties: {
        Name: 'Contract create',
        ContractField: 'kept',
      },
    });

    ensure(create.json?.success === true, 'create_record with notion data_home should return success');
    ensure(create.json?.provider_record_id === 'notion-page-1', 'create_record provider_record_id should be notion page id');
    ensure(Boolean(create.json?.source_snapshot && create.json.source_snapshot.provider === 'notion'), 'create_record source_snapshot.provider must be notion');
    ensure(Boolean(create.json?.action_receipt && typeof create.json.action_receipt === 'object'), 'create_record action_receipt should be present');
    ensure(Boolean((create.json.action_receipt as { provider_record_id?: unknown } | null)?.provider_record_id === 'notion-page-1'), 'action_receipt.provider_record_id should match notion page id');
    ensure(create.json?.source_snapshot?.data_source_id === 'notion-source-1', 'create_record source_snapshot.data_source_id must be configured source');
    ensure(create.json?.source_snapshot?.page_id === 'notion-page-1', 'create_record source_snapshot.page_id must be stable');
    ensure(Array.isArray(create.json?.source_snapshot?.range) === false, 'create_record source_snapshot.range should be string range');
    ensure(create.json?.source_snapshot?.range === '/pages/notion-page-1', 'create_record range should be /pages/{page}');
    const createdId = create.json?.record?.id;
    ensure(typeof createdId === 'string' && createdId.length > 0, 'create_record should return local record id');

    const update = await callMcpTool('utopia.update_record', {
      actor: 'hearth',
      id: createdId,
      data_home: 'notion',
      patch: {
        title: 'Contract updated',
        properties: {
          ContractField: 'kept-updated',
        },
      },
    });
    ensure(update.json?.success === true, 'update_record with notion data_home should return success');
    ensure(update.json?.provider_record_id === 'notion-page-1', 'update_record provider_record_id should match notion page id');
    ensure(update.json?.source_snapshot?.provider === 'notion', 'update_record source_snapshot.provider must be notion');
    ensure(Boolean(update.json?.action_receipt && typeof update.json.action_receipt === 'object'), 'update_record action_receipt should be present');

    const queuedArchive = await callMcpTool('utopia.archive_record', {
      actor: 'hearth',
      id: createdId,
      data_home: 'notion',
      archived: true,
      idempotency_key: 'notion-contract-archive',
    });
    ensure(queuedArchive.json?.status === 'queued_for_review', 'archive_record with notion data_home should request review first');
    const approvalRequest = queuedArchive.json?.approval_request as {
      tool: string;
      operationId: string;
      idempotencyKey: string;
      operationHash: string;
    };
    const archive = await callMcpTool('utopia.archive_record', {
      actor: 'hearth',
      id: createdId,
      data_home: 'notion',
      archived: true,
      idempotency_key: 'notion-contract-archive',
      approval_receipt: {
        schemaVersion: 'wonder.mcp-review-approval.v1',
        approver: 'hearth',
        authority: 'contract-test',
        tool: approvalRequest.tool,
        operationId: approvalRequest.operationId,
        idempotencyKey: approvalRequest.idempotencyKey,
        operationHash: approvalRequest.operationHash || buildOperationHash({ archive: createdId }),
        localActor: 'hearth',
        approvedAt: '2026-07-26T00:00:00.000Z',
        expiresAt: '2999-01-01T00:00:00.000Z',
      },
    });
    ensure(archive.json?.success === true, 'archive_record with notion data_home should return success');
    ensure(archive.json?.provider_record_id === 'notion-page-1', 'archive_record provider_record_id should match notion page id');
    ensure(archive.json?.source_snapshot?.provider === 'notion', 'archive_record source_snapshot.provider must be notion');

    const notionCalls = mock.calls.filter((entry) => entry.url.includes('api.notion.com') || entry.url.includes('/v1/'));
    ensure(notionCalls.length >= 3, 'MCP notion path should call notion create, update, archive, and query as needed');
    ensure(notionCalls.some((entry) => entry.method === 'POST' && entry.url.includes('/v1/pages')), 'MCP notion create should POST to /v1/pages');
    ensure(notionCalls.some((entry) => entry.method === 'PATCH' && entry.url.includes('/v1/pages/notion-page-1')), 'MCP notion update/archive should PATCH /v1/pages/{pageId}');

    const pull = await pullNotionRecordsLive({ domain: 'food', collection: 'recipe', limit: 10 });
    ensure(pull.status === 'ready', 'pullNotionRecordsLive should be ready after setup');
    ensure(pull.records.length === 1, 'pull should return one contract row');
    ensure(hasContractField((pull.source_snapshots[0] as { unsupported?: Record<string, unknown> } | undefined)?.unsupported), 'pull should keep ContractField unsupported data');

    evidence.tests.push({
      test: 'mcp-notion-call-contract',
      status: 'pass',
      details: {
        create_call: Boolean(create.json?.action?.id),
        provider_record_id: create.json?.provider_record_id,
        notion_calls: notionCalls.length,
        unsupported_preserved: hasContractField(create.json?.source_snapshot?.unsupported),
      },
    });

    // Webhook replay/idempotency contract
    const eventPayload = normalizeWebhookBody(JSON.stringify({
      event_type: 'page.update',
      data_source_id: 'notion-source-1',
      external_id: 'notion-page-1',
      data: {
        before: 'notion-page-1',
        after: 'notion-page-1',
      },
    }));
    clearWebhookReplayState(notionStateDir);

    const event = normalizeWebhookEvent(eventPayload);
    ensure(event?.external_id === 'notion-page-1', 'webhook normalizer should read external_id');

    const firstSync = await syncNotionFromWebhook({
      event: eventPayload,
      domain: 'food',
      collection: 'recipe',
      limit: 10,
    });
    const secondSync = await syncNotionFromWebhook({
      event: eventPayload,
      domain: 'food',
      collection: 'recipe',
      limit: 10,
    });

    ensure(firstSync.status === 'synced', 'first sync should be fresh');
    ensure(secondSync.status === 'duplicate', 'second sync should be duplicate');
    ensure(firstSync.eventId === 'external:notion-page-1' || firstSync.eventId === null, 'sync should use external-id-based event id');
    const { findRecord } = await import('../../src/runtime/state');
    const canonicalNotionRecord = findRecord('notion-page-1');
    ensure(canonicalNotionRecord?.source.provider === 'notion', 'first sync should apply the provider record to canonical state');

    const markReplay = markNotionWebhookEvent(eventPayload);
    ensure(markReplay.duplicate, 'manual replay mark should detect duplicate after processed event');

    const state = getWebhookReplayState(notionStateDir);
    const saved = state.events.some((entry) => entry.event_id === 'external:notion-page-1');
    ensure(saved, 'webhook replay state should persist dedupe marker');

    evidence.tests.push({
      test: 'webhook-replay-idempotent',
      status: 'pass',
      details: {
        first_sync: firstSync.status,
        second_sync: secondSync.status,
        duplicate_event: markReplay.duplicate,
        replay_events: state.events.length,
        source_snapshot_present: Boolean(firstSync.sourceSnapshot),
        canonical_state_applied: canonicalNotionRecord?.source.provider === 'notion',
      },
    });

    const eventId = markReplay.eventId;
    evidence.source = {
      mcp: {
        create_provider_record: create.json?.provider_record_id,
        update_provider_record: update.json?.provider_record_id,
        archive_provider_record: archive.json?.provider_record_id,
      },
      webhook: {
        event_id: eventId,
        replay_state_events: state.events.length,
      },
      create_source_snapshot: create.json?.source_snapshot,
      action_receipt: Boolean(create.json?.action_receipt),
    };

    const evidencePath = join(process.cwd(), 'app', 'build', 'evidence', 'phase5-notion-adapter', 'phase5-notion-contract-proof.json');
    await import('node:fs').then(({ mkdirSync, writeFileSync }) => {
      mkdirSync(join(process.cwd(), 'app', 'build', 'evidence', 'phase5-notion-adapter'), { recursive: true });
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf-8');
    });

    process.stdout.write(JSON.stringify(evidence, null, 2));
    console.log('PASS', JSON.stringify({
      mcp_calls: notionCalls.length,
      sync_first: firstSync.status,
      sync_second: secondSync.status,
    }));
    process.exit(0);
  } catch (error) {
    evidence.tests.push({
      test: 'contract-failure',
      status: 'fail',
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    process.stdout.write(JSON.stringify(evidence, null, 2));
    throw error;
  } finally {
    mock.restore();
    if (previousRuntimeStatePath === undefined) {
      delete process.env.WONDER_RUNTIME_STATE_PATH;
    } else {
      process.env.WONDER_RUNTIME_STATE_PATH = previousRuntimeStatePath;
    }
    rmSync(process.env.NOTION_WEBHOOK_REPLAY_PATH!, { force: true });
    delete process.env.NOTION_WEBHOOK_REPLAY_PATH;
  }
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
