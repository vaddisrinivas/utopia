import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_CODE = String.raw`
  import { createServer } from 'node:http';

  const notionState = new Map();
  const sheetsRows = [
    ['id', 'title', 'domain', 'collection', 'properties', 'archived', 'version', 'updated_at', 'source', 'external_id'],
    ['sheet-undo-record', 'Sheets undo', 'food', 'recipe', '{"fresh":true}', 'false', '1', '2026-01-01T00:00:00.000Z', '{}', 'sheet-undo-record'],
  ];
  let forceBadNotionReadback = false;
  let notionQueryCalls = 0;
  let notionPatchCalls = 0;
  let sheetsBatchUpdateCalls = 0;

  function json(res, status, body) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const method = (req.method || 'GET').toUpperCase();
    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;
    const body = rawBody ? JSON.parse(rawBody) : {};

    if (method === 'POST' && url.pathname === '/__admin/notion-page') {
      notionState.set(body.pageId, {
        title: body.title,
        archived: Boolean(body.archived),
        properties: body.properties || {},
      });
      json(res, 200, { ok: true });
      return;
    }

    if (method === 'POST' && url.pathname === '/__admin/force-bad-notion') {
      forceBadNotionReadback = Boolean(body.value);
      json(res, 200, { ok: true, value: forceBadNotionReadback });
      return;
    }

    if (method === 'GET' && url.pathname === '/__admin/stats') {
      json(res, 200, {
        notionQueryCalls,
        notionPatchCalls,
        sheetsBatchUpdateCalls,
      });
      return;
    }

    if (method === 'PATCH' && url.pathname.startsWith('/notion/v1/pages/')) {
      notionPatchCalls += 1;
      const pageId = url.pathname.split('/notion/v1/pages/')[1] || '';
      const current = notionState.get(pageId) || { title: pageId, archived: false, properties: {} };
      notionState.set(pageId, {
        title: current.title,
        archived: Boolean(body.archived),
        properties: current.properties,
      });
      json(res, 200, {
        id: pageId,
        archived: Boolean(body.archived),
        parent: { data_source_id: process.env.TEST_NOTION_SOURCE },
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:05:00.000Z',
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/notion/v1/data_sources/undo-authority-notion-source/query') {
      notionQueryCalls += 1;
      const [pageId, current] = [...notionState.entries()][0] || [];
      const title = forceBadNotionReadback ? 'Wrong title' : current?.title || 'Unknown';
      json(res, 200, {
        results: pageId ? [{
          object: 'page',
          id: pageId,
          properties: {
            Name: { title: [{ plain_text: title }] },
            fresh: current?.properties?.fresh ?? true,
            'Utopia Domain': 'food',
            'Utopia Collection': 'recipe',
          },
          created_time: '2026-01-01T00:00:00.000Z',
          last_edited_time: '2026-01-01T00:06:00.000Z',
          archived: forceBadNotionReadback ? false : Boolean(current?.archived),
          in_trash: false,
          parent: { database_id: 'undo-notion-db' },
        }] : [],
        has_more: false,
        next_cursor: null,
      });
      return;
    }

    if (method === 'GET' && /^\/sheets\/v4\/spreadsheets\/undo-authority-sheet\/?$/.test(url.pathname)) {
      json(res, 200, {
        spreadsheetId: process.env.TEST_SHEETS_SPREADSHEET,
        properties: { title: 'Utopia Runtime Workbook' },
        sheets: [{ properties: { title: 'Utopia Runtime', gridProperties: { columnCount: 26, rowCount: 32 } } }],
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/sheets/v4/spreadsheets/undo-authority-sheet/values:batchGet') {
      json(res, 200, {
        valueRanges: [{ range: 'Utopia Runtime!A:Z', values: sheetsRows }],
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/sheets/v4/spreadsheets/undo-authority-sheet/values:batchUpdate') {
      sheetsBatchUpdateCalls += 1;
      const nextRow = Array.isArray(body.data) && body.data[0] && typeof body.data[0] === 'object'
        ? body.data[0].values?.[0]
        : undefined;
      if (nextRow) {
        sheetsRows[1] = nextRow;
      }
      json(res, 200, { responses: [{ updatedRange: 'Utopia Runtime!A2:Z2' }] });
      return;
    }

    json(res, 500, { error: 'unexpected provider endpoint', method, path: url.pathname });
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server address');
    }
    process.stdout.write(JSON.stringify({ port: address.port }) + '\n');
  });
`;

async function startProviderServer() {
  const child = spawn(process.execPath, ['--input-type=module', '-e', SERVER_CODE], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TEST_NOTION_SOURCE: 'undo-authority-notion-source',
      TEST_SHEETS_SPREADSHEET: 'undo-authority-sheet',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const port = await new Promise<number>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const newline = stdout.indexOf('\n');
      if (newline === -1) return;
      try {
        const payload = JSON.parse(stdout.slice(0, newline)) as { port?: unknown };
        if (typeof payload.port === 'number') {
          resolve(payload.port);
        } else {
          reject(new Error(`Provider server missing port: ${stdout}`));
        }
      } catch (error) {
        reject(error);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('exit', (code) => {
      reject(new Error(`Provider server exited early with code ${code}: ${stderr}`));
    });
  });

  return {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, `Expected POST ${url} to succeed`);
  return response.json();
}

async function readStats(baseUrl: string) {
  const response = await fetch(`${baseUrl}/__admin/stats`);
  assert.equal(response.ok, true, 'Expected provider stats endpoint to succeed');
  return response.json() as Promise<{
    notionQueryCalls: number;
    notionPatchCalls: number;
    sheetsBatchUpdateCalls: number;
  }>;
}

const previousEnv = {
  notionToken: process.env.NOTION_TOKEN,
  notionSource: process.env.NOTION_DATA_SOURCE_ID,
  notionBase: process.env.NOTION_BASE_URL,
  sheetsToken: process.env.GOOGLE_SHEETS_ACCESS_TOKEN,
  sheetsSpreadsheet: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  sheetsSource: process.env.GOOGLE_SHEETS_DATA_SOURCE_ID,
  sheetsBase: process.env.GOOGLE_SHEETS_API_BASE_URL,
  authority: process.env.LIFEOS_AUTHORITY_PROVIDER,
  runtimeState: process.env.WONDER_RUNTIME_STATE_PATH,
};

process.env.NOTION_TOKEN = 'undo-authority-notion-token';
process.env.NOTION_DATA_SOURCE_ID = 'undo-authority-notion-source';
process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'undo-authority-sheets-token';
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'undo-authority-sheet';
process.env.GOOGLE_SHEETS_DATA_SOURCE_ID = 'undo-authority-data-source';
process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-provider-undo-')), 'wonder-runtime.json');

const providerServer = await startProviderServer();
process.env.NOTION_BASE_URL = `${providerServer.baseUrl}/notion/v1`;
process.env.GOOGLE_SHEETS_API_BASE_URL = `${providerServer.baseUrl}/sheets/v4`;

try {
  const stateModule = await import('../src/runtime/state');
  const { executeCommand } = await import('../src/agents/executor');
  const { runWorkflowCompensation } = await import('../src/workflows/compensation');

  const {
    createRecord,
    createRecordWithAction,
    findRecord,
    runUndo,
  } = stateModule;

  await postJson(`${providerServer.baseUrl}/__admin/notion-page`, {
    pageId: 'notion-undo-page',
    title: 'Notion undo',
    archived: false,
    properties: { fresh: true },
  });

  const notionUndoAction = createRecordWithAction({
    actionId: 'undo-notion-success',
    actor: 'agent',
    domain: 'food',
    tool: 'utopia.create_record',
    risk: 'standard',
    command: 'create provider-backed notion record',
    record: {
      id: 'notion-undo-record',
      domain: 'food',
      collection: 'recipe',
      title: 'Notion undo',
      properties: { fresh: true },
      relations: [],
      source: {
        provider: 'notion',
        external_id: 'notion-undo-page',
        url: null,
        observed_at: '2026-01-01T00:00:00.000Z',
        content_hash: null,
      },
      archived_at: null,
    },
    undoPayload: {
      operation: 'delete_record',
      record_id: 'notion-undo-record',
      provider_snapshot: {
        provider: 'notion',
        page_id: 'notion-undo-page',
      },
    },
  });
  const notionUndoResult = runUndo(notionUndoAction.action.id);
  assert.equal(notionUndoResult.success, true, notionUndoResult.message);
  assert.equal(findRecord('notion-undo-record'), null, 'local success should wait for provider verification before delete');
  const notionStats = await readStats(providerServer.baseUrl);
  assert.equal(notionStats.notionPatchCalls >= 1, true, 'notion undo should write back to provider');
  assert.equal(notionStats.notionQueryCalls >= 1, true, 'notion undo should verify provider readback');

  await postJson(`${providerServer.baseUrl}/__admin/notion-page`, {
    pageId: 'notion-undo-fail-page',
    title: 'Notion undo fail',
    archived: false,
    properties: { fresh: true },
  });
  await postJson(`${providerServer.baseUrl}/__admin/force-bad-notion`, { value: true });

  const notionUndoFailAction = createRecordWithAction({
    actionId: 'undo-notion-fail',
    actor: 'agent',
    domain: 'food',
    tool: 'utopia.create_record',
    risk: 'standard',
    command: 'create provider-backed notion record that fails verification',
    record: {
      id: 'notion-undo-fail-record',
      domain: 'food',
      collection: 'recipe',
      title: 'Notion undo fail',
      properties: { fresh: true },
      relations: [],
      source: {
        provider: 'notion',
        external_id: 'notion-undo-fail-page',
        url: null,
        observed_at: '2026-01-01T00:00:00.000Z',
        content_hash: null,
      },
      archived_at: null,
    },
    undoPayload: {
      operation: 'delete_record',
      record_id: 'notion-undo-fail-record',
      provider_snapshot: {
        provider: 'notion',
        page_id: 'notion-undo-fail-page',
      },
    },
  });
  const notionUndoFailResult = runUndo(notionUndoFailAction.action.id);
  assert.equal(notionUndoFailResult.success, false, 'notion undo should fail when provider readback disagrees');
  assert.notEqual(findRecord('notion-undo-fail-record'), null, 'failed provider undo should not delete local record');

  const compensationResult = runWorkflowCompensation({
    workflowRunId: 'wf-provider-compensation',
    workflowId: 'wf-provider-compensation',
    actions: [{
      action: 'restore_record',
      workflowRunId: 'wf-provider-compensation',
      recordId: 'notion-compensation-record',
      record: {
        id: 'notion-compensation-record',
        domain: 'food',
        collection: 'recipe',
        title: 'Compensation target',
        properties: { fresh: true },
        relations: [],
        source: {
          provider: 'notion',
          external_id: 'notion-undo-fail-page',
          url: null,
          observed_at: '2026-01-01T00:00:00.000Z',
          content_hash: null,
        },
        archived_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        revision: 1,
      },
      providerSnapshot: {
        provider: 'notion',
        page_id: 'notion-undo-fail-page',
      },
    }],
  });
  assert.equal(compensationResult.errors.length, 1, 'provider compensation should surface verification failures');
  assert.equal(findRecord('notion-compensation-record'), null, 'failed provider compensation should not restore local record');
  await postJson(`${providerServer.baseUrl}/__admin/force-bad-notion`, { value: false });

  const sheetsUndoAction = createRecordWithAction({
    actionId: 'undo-sheets-success',
    actor: 'agent',
    domain: 'food',
    tool: 'utopia.create_record',
    risk: 'standard',
    command: 'create provider-backed sheets record',
    record: {
      id: 'sheet-undo-record',
      domain: 'food',
      collection: 'recipe',
      title: 'Sheets undo',
      properties: { fresh: true },
      relations: [],
      source: {
        provider: 'google_sheets',
        external_id: 'sheet-undo-record',
        url: null,
        observed_at: '2026-01-01T00:00:00.000Z',
        content_hash: null,
      },
      archived_at: null,
    },
    undoPayload: {
      operation: 'delete_record',
      record_id: 'sheet-undo-record',
      provider_snapshot: {
        provider: 'google_sheets',
        external_id: 'sheet-undo-record',
      },
    },
  });
  const sheetsUndoResult = runUndo(sheetsUndoAction.action.id);
  assert.equal(sheetsUndoResult.success, true, sheetsUndoResult.message);
  assert.equal(findRecord('sheet-undo-record'), null, 'successful sheets provider undo should delete local record after verification');
  const sheetsStats = await readStats(providerServer.baseUrl);
  assert.equal(sheetsStats.sheetsBatchUpdateCalls >= 1, true, 'sheets provider undo should write back to provider');

  process.env.LIFEOS_AUTHORITY_PROVIDER = 'notion';
  delete process.env.NOTION_TOKEN;
  delete process.env.NOTION_DATA_SOURCE_ID;
  const blockedCreate = await executeCommand({
    actionId: 'authority-create-blocked',
    actor: 'agent',
    domain: 'food',
    tool: 'chat_local_executor',
    commandText: 'create recipe Authority blocked',
    record_ids: [],
  });
  assert.equal(blockedCreate.state, 'failed', 'create should fail when provider authority is unconfigured');
  assert.equal(findRecord(blockedCreate.receipt.record_ids[0] || 'missing'), null, 'blocked create should not write a local record');

  createRecord({
    id: 'local-only-authority-record',
    domain: 'food',
    collection: 'recipe',
    title: 'Local only record',
    properties: {},
    relations: [],
    source: {
      provider: 'user',
      external_id: 'local-only-authority-record',
      url: null,
      observed_at: '2026-01-01T00:00:00.000Z',
      content_hash: null,
    },
    archived_at: null,
  });
  const blockedUpdate = await executeCommand({
    actionId: 'authority-update-blocked',
    actor: 'agent',
    domain: 'food',
    tool: 'chat_local_executor',
    commandText: 'update recipe Local only record to Provider authority',
    record_ids: ['local-only-authority-record'],
  });
  assert.equal(blockedUpdate.state, 'failed', 'local executor should not mutate a local-only record under provider authority');
  assert.equal(findRecord('local-only-authority-record')?.title, 'Local only record', 'blocked authority update should leave the local record unchanged');
} finally {
  providerServer.child.kill('SIGTERM');
  if (previousEnv.notionToken === undefined) delete process.env.NOTION_TOKEN; else process.env.NOTION_TOKEN = previousEnv.notionToken;
  if (previousEnv.notionSource === undefined) delete process.env.NOTION_DATA_SOURCE_ID; else process.env.NOTION_DATA_SOURCE_ID = previousEnv.notionSource;
  if (previousEnv.notionBase === undefined) delete process.env.NOTION_BASE_URL; else process.env.NOTION_BASE_URL = previousEnv.notionBase;
  if (previousEnv.sheetsToken === undefined) delete process.env.GOOGLE_SHEETS_ACCESS_TOKEN; else process.env.GOOGLE_SHEETS_ACCESS_TOKEN = previousEnv.sheetsToken;
  if (previousEnv.sheetsSpreadsheet === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID; else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = previousEnv.sheetsSpreadsheet;
  if (previousEnv.sheetsSource === undefined) delete process.env.GOOGLE_SHEETS_DATA_SOURCE_ID; else process.env.GOOGLE_SHEETS_DATA_SOURCE_ID = previousEnv.sheetsSource;
  if (previousEnv.sheetsBase === undefined) delete process.env.GOOGLE_SHEETS_API_BASE_URL; else process.env.GOOGLE_SHEETS_API_BASE_URL = previousEnv.sheetsBase;
  if (previousEnv.authority === undefined) delete process.env.LIFEOS_AUTHORITY_PROVIDER; else process.env.LIFEOS_AUTHORITY_PROVIDER = previousEnv.authority;
  if (previousEnv.runtimeState === undefined) delete process.env.WONDER_RUNTIME_STATE_PATH; else process.env.WONDER_RUNTIME_STATE_PATH = previousEnv.runtimeState;
}

console.log('PASS server/test/provider-undo-authority-contract.ts');
