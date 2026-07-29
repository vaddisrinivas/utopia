import assert from 'node:assert/strict';

import { handleProviderRoutes } from '../src/routes/provider-routes';

function createResponse() {
  const headers = new Map<string, string>();
  let body = '';
  return {
    statusCode: 0,
    headers,
    get body() {
      return body;
    },
    set body(value: string) {
      body = value;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(chunk?: string | Buffer) {
      body = typeof chunk === 'string' ? chunk : chunk ? Buffer.from(chunk).toString('utf8') : '';
    },
  };
}

function parseBody(response: ReturnType<typeof createResponse>) {
  return response.body ? JSON.parse(response.body) as Record<string, unknown> : {};
}

let nextJsonBody: Record<string, unknown> = {};
const calls = {
  discover: 0,
  sheetsHealth: 0,
  sheetsLivePull: 0,
  sheetsWrite: 0,
};

const context: any = {
  assertAuth: () => ({
    ok: true,
    localDevelopment: false,
    statusCode: 200,
    message: '',
    principalId: null,
    mcpScope: null,
  }),
  readJsonBody: async () => nextJsonBody,
  readRawBody: async () => JSON.stringify({}),
  readNotionConfig: () => ({ dataSourceId: 'notion-source' }),
  discoverNotionDataSources: (config?: unknown) => {
    calls.discover += 1;
    return { status: 'ok', provider: 'notion', config };
  },
  pullNotionRecords: (input?: Record<string, unknown>) => ({ mode: 'static', input }),
  pullNotionRecordsLive: async (input?: Record<string, unknown>) => ({ mode: 'live', input }),
  writeNotionRecord: async () => ({ ok: true, status: 'ok' }),
  normalizeWebhookBody: () => ({ verification_token: undefined }),
  normalizeWebhookEvent: (event: unknown) => event,
  verifyNotionWebhookSignature: () => true,
  syncNotionFromWebhook: async () => ({ ok: true, status: 'synced' }),
  getNotionWebhookReplayState: () => ({ events: [] }),
  buildNotionWebhookResponse: (normalized: unknown, reconciliation: unknown, replayState: unknown) => ({
    status: 'ok',
    normalized,
    reconciliation,
    replayState,
  }),
  checkSheetsHealth: () => {
    calls.sheetsHealth += 1;
    return { status: 'ok', configured: true, checks: [] };
  },
  readSheetsConfig: () => ({ spreadsheetId: 'sheet-id' }),
  pullSheetsRecords: (input?: Record<string, unknown>) => ({ mode: 'static', input }),
  pullSheetsRecordsLive: async (input?: Record<string, unknown>) => {
    calls.sheetsLivePull += 1;
    return { mode: 'live', input };
  },
  writeSheetsRecord: async () => {
    calls.sheetsWrite += 1;
    return { ok: false, conflict: { id: 'sheet-1' }, error: 'Sheets write conflict' };
  },
  normalizeSheetsWebhookEvent: (event: unknown) => event,
  syncSheetsFromWebhook: async (input: { event: unknown; domain?: string; collection?: string; limit?: number }) => ({
    ok: true,
    status: 'synced',
    input,
  }),
  getSheetsWebhookReplayState: () => ({ events: [] }),
  buildSheetsWebhookResponse: (normalized: unknown, reconciliation: unknown, replayState: unknown) => ({
    status: 'ok',
    normalized,
    reconciliation,
    replayState,
  }),
};

async function invoke(rawUrl: string, method: string, body?: Record<string, unknown>) {
  const response = createResponse();
  nextJsonBody = body ?? {};
  const path = rawUrl.split('?')[0];
  const handled = await handleProviderRoutes(
    { method, url: rawUrl, headers: { authorization: 'Bearer test' } },
    response,
    path,
    context,
  );
  return { handled, response };
}

assert.equal(
  await handleProviderRoutes(
    { method: 'GET', url: '/providers/notionary', headers: {} },
    createResponse(),
    '/providers/notionary',
    context,
  ),
  false,
);
assert.equal(
  await handleProviderRoutes(
    { method: 'GET', url: '/providers/sheetsx', headers: {} },
    createResponse(),
    '/providers/sheetsx',
    context,
  ),
  false,
);

const discovery = await invoke('/providers/notion/discovery', 'GET');
assert.equal(discovery.handled, true);
assert.equal(discovery.response.statusCode, 200);
assert.equal(parseBody(discovery.response).provider, 'notion');
assert.equal((parseBody(discovery.response).config as { dataSourceId?: string }).dataSourceId, 'notion-source');
assert.equal(calls.discover, 1);

const health = await invoke('/providers/sheets/health', 'GET');
assert.equal(health.response.statusCode, 200);
assert.equal(parseBody(health.response).status, 'ok');
assert.equal(calls.sheetsHealth, 1);

const livePull = await invoke('/providers/sheets/pull?domain=food&collection=recipe&live=true', 'GET');
assert.equal(livePull.response.statusCode, 200);
assert.equal((parseBody(livePull.response).mode as string), 'live');
assert.equal(calls.sheetsLivePull, 1);

const conflict = await invoke('/providers/sheets/push', 'POST', {
  operation: 'update_record',
  recordId: 'sheet-1',
});
assert.equal(conflict.response.statusCode, 409);
assert.equal(String(parseBody(conflict.response).message), 'Sheets write conflict');
assert.equal(calls.sheetsWrite, 1);

console.log('PASS server/test/provider-routes-contract.ts');
