import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { pullNotionRecordsLive } from '../../src/providers/notion/pull';
import { writeNotionRecord } from '../../src/providers/notion/push';
import { createOfficialNotionClient } from '../../src/providers/notion/client';

type MockCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

type ResultRow = {
  status: string;
  passed: boolean;
  details: Record<string, unknown>;
};

const evidenceDir = join(process.cwd(), 'app', 'build', 'evidence', 'phase5-notion-adapter');
mkdirSync(evidenceDir, { recursive: true });

function toHeaderMap(headers: Headers | Record<string, unknown> | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(Array.from(headers.entries()));
  }
  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key.toLowerCase()] = String(value ?? '');
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

  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method || 'GET').toUpperCase();
    const headers = toHeaderMap(init.headers as Record<string, unknown> | Headers | undefined);
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
          type: 'data_source_id',
          data_source_id: dataSourceId,
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
          type: 'data_source_id',
        },
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:10:00.000Z',
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
                title: [{ plain_text: 'Notion unit check' }],
              },
              'Utopia Domain': 'food',
              'Utopia Collection': 'recipe',
              UnsupportedField: 'kept',
              LegacyField: 'kept',
            },
            created_time: '2026-01-01T00:00:00.000Z',
            last_edited_time: '2026-01-01T00:01:00.000Z',
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

function hasHeader(headers: Record<string, string>, name: string) {
  return Object.entries(headers).some(([key, value]) => key.toLowerCase() === name.toLowerCase() && typeof value === 'string' && value.length > 0);
}

function hasUnsupported(value: unknown) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'UnsupportedField' in value || 'LegacyField' in value;
}

(async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'notion-unit-'));
  const evidencePath = join(evidenceDir, 'phase5-notion-unit-proof.json');
  const replay: ResultRow[] = [];

  process.env.NOTION_TOKEN = 'test-notion-token-unit';
  process.env.NOTION_DATA_SOURCE_ID = 'notion-source-1';
  if (!createOfficialNotionClient()) {
    throw new Error('Expected official Notion SDK client');
  }

  const mock = withMockNotionFetch('notion-page-1', 'notion-source-1');

  try {
    const create = await writeNotionRecord({
      operation: 'create_record',
      recordId: 'unit-notion-create',
      domain: 'food',
      collection: 'recipe',
      title: 'Unit create',
      properties: {
        Name: 'Unit create',
        UnsupportedField: 'keep-this',
      },
    });

    ensure(create.ok && create.success, 'create_record should return ok/success');
    ensure(create.source_snapshot?.provider === 'notion', 'create source snapshot provider must be notion');
    ensure(create.source_snapshot?.data_source_id === 'notion-source-1', 'create must use configured data_source_id');
    ensure(create.source_snapshot?.dataSourceId === 'notion-source-1', 'create source snapshot dataSourceId must match');
    ensure(create.provider_record_id === 'notion-page-1', 'create provider_record_id must be notion page id');
    ensure(
      Boolean(create.action_receipt && create.action_receipt.provider_record_id === 'notion-page-1'),
      'action_receipt provider_record_id must match create result',
    );
    ensure(create.source_snapshot?.range === '/pages/notion-page-1', 'create source_snapshot.range should be immutable page range');
    ensure(hasUnsupported(create.source_snapshot?.unsupported), 'create source_snapshot must preserve unsupported fields');

    const createCall = mock.calls.find((entry) => entry.url.includes('/v1/pages') && entry.method === 'POST');
    ensure(Boolean(createCall), 'create endpoint must be called');
    ensure(Boolean(createCall && hasHeader(createCall.headers, 'notion-version')), 'request must include Notion-Version header');
    ensure((createCall && createCall.headers['notion-version']) === '2026-03-11', 'Notion-Version header must be 2026-03-11');
    const createBody = createCall && typeof createCall.body === 'string' ? JSON.parse(createCall.body) : null;
    ensure(createBody?.parent?.type === 'data_source_id', 'create payload parent.type should be data_source_id');

    const update = await writeNotionRecord({
      operation: 'update_record',
      recordId: 'unit-notion-create',
      pageId: 'notion-page-1',
      domain: 'food',
      collection: 'recipe',
      title: 'Unit update',
      properties: {
        Name: 'Unit update',
        LegacyField: 'kept-update',
      },
    });

    ensure(update.ok && update.success, 'update_record should return ok/success');
    ensure(update.source_snapshot?.operation === 'update_record', 'update snapshot operation should be update_record');
    ensure(update.source_snapshot?.page_id === 'notion-page-1', 'update snapshot page_id should stay stable');
    ensure(update.source_snapshot?.pageId === 'notion-page-1', 'update snapshot pageId should stay stable');
    ensure(hasUnsupported(update.source_snapshot?.unsupported), 'update source_snapshot must preserve unsupported fields');

    const archive = await writeNotionRecord({
      operation: 'archive_record',
      recordId: 'unit-notion-create',
      pageId: 'notion-page-1',
      domain: 'food',
      collection: 'recipe',
      archived: true,
    });

    ensure(archive.ok && archive.success, 'archive_record should return ok/success');
    ensure(archive.source_snapshot?.operation === 'archive_record', 'archive snapshot operation should be archive_record');
    ensure(archive.source_snapshot?.page_id === 'notion-page-1', 'archive snapshot page_id should stay stable');

    const pull = await pullNotionRecordsLive({ domain: 'food', collection: 'recipe', limit: 10 });
    ensure(pull.status === 'ready', 'pull should be ready with mock data source query');
    ensure(pull.records.length === 1, 'pull should return one record');
    ensure(Array.isArray(pull.source_snapshots) && pull.source_snapshots.length === 1, 'pull source_snapshots should match records');
    const pulledUnsupported = (pull.source_snapshots[0] as { unsupported?: Record<string, unknown> } | undefined)?.unsupported || {};
    ensure(hasUnsupported(pulledUnsupported), 'pull should preserve unsupported fields in source snapshot');

    const patchCalls = mock.calls.filter((entry) => entry.url.includes('/v1/pages/notion-page-1') && entry.method === 'PATCH');
    ensure(patchCalls.length >= 2, 'update and archive should both PATCH notion page');

    const queryCalls = mock.calls.filter((entry) => entry.url.includes('/v1/data_sources/notion-source-1/query'));
    ensure(queryCalls.length >= 1, 'pull must query data source endpoint');

    replay.push({
      status: 'passed',
      passed: true,
      details: {
        create_result: {
          provider_record_id: create.provider_record_id,
          source_snapshot: create.source_snapshot,
          has_unsupported: hasUnsupported(create.source_snapshot?.unsupported),
        },
        update_result: {
          page_id: update.source_snapshot?.page_id,
          has_unsupported: hasUnsupported(update.source_snapshot?.unsupported),
        },
        archive_result: {
          success: archive.success,
          page_id: archive.source_snapshot?.page_id,
        },
        pull_unsupported: hasUnsupported(pulledUnsupported),
        call_counts: {
          create: mock.calls.filter((entry) => entry.url.includes('/v1/pages') && entry.method === 'POST').length,
          patch: patchCalls.length,
          query: queryCalls.length,
        },
      },
    });

    const notionVersionHeader = createCall?.headers?.['notion-version'] || createCall?.headers?.notionversion || '';

    writeFileSync(
      evidencePath,
      JSON.stringify(
        {
          phase: 'phase5-notion',
          status: 'pass',
          tests: replay,
          blocks: {
            notion_version_header: notionVersionHeader,
            create_calls: mock.calls.filter((entry) => entry.method === 'POST').length,
            patch_calls: patchCalls.length,
            query_calls: queryCalls.length,
          },
          source: {
            provider: create.source_snapshot?.provider,
            data_source_id: create.source_snapshot?.data_source_id,
            page_id: create.source_snapshot?.page_id,
            range: create.source_snapshot?.range,
            block_id: create.source_snapshot?.block_id,
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    console.log(`PASS ${evidencePath}`);
    console.log(`unit_pass=true`);
    process.stdout.write(JSON.stringify({ status: 'pass', results: replay }, null, 2));
    process.exit(0);
  } catch (error) {
    writeFileSync(
      evidencePath,
      JSON.stringify(
        {
          phase: 'phase5-notion',
          status: 'fail',
          error: error instanceof Error ? error.message : String(error),
          tests: replay,
        },
        null,
        2,
      ),
      'utf-8',
    );

    throw error;
  } finally {
    mock.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
