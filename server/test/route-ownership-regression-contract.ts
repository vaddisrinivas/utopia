import assert from 'node:assert/strict';

import { handleHealthConnectRoute } from '../src/routes/health-connect';
import { handlePackageRoutes } from '../src/routes/package-routes';
import { handleProviderRoutes } from '../src/routes/provider-routes';
import { handleChatQueryRoutes } from '../src/routes/chat-routes';
import { handleMcpRoutes } from '../src/routes/mcp-routes';
import { handleChatControlRoutes } from '../src/routes/chat-control-routes';

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
    writeHead(status: number, nextHeaders?: Record<string, string>) {
      this.statusCode = status;
      Object.entries(nextHeaders ?? {}).forEach(([name, value]) => headers.set(name.toLowerCase(), value));
    },
    end(chunk?: string | Buffer) {
      body = typeof chunk === 'string' ? chunk : chunk ? Buffer.from(chunk).toString('utf8') : '';
    },
  };
}

function parseJsonResponse(response: ReturnType<typeof createResponse>) {
  return response.body ? (JSON.parse(response.body) as Record<string, unknown>) : {};
}

const allowAuth = () => ({
  ok: true,
  localDevelopment: false,
  statusCode: 200 as const,
  message: '',
  principalId: null,
  mcpScope: null,
});

const providerContext = {
  assertAuth: allowAuth,
  readJsonBody: async () => ({}),
  readRawBody: async () => JSON.stringify({}),
  readNotionConfig: () => ({ dataSourceId: 'notion-source' }),
  discoverNotionDataSources: () => ({ status: 'ok' }),
  pullNotionRecords: () => ({ mode: 'static' }),
  pullNotionRecordsLive: async () => ({ mode: 'live' }),
  writeNotionRecord: async () => ({ ok: true }),
  normalizeWebhookBody: () => ({ verification_token: undefined }),
  normalizeWebhookEvent: (event: unknown) => event,
  verifyNotionWebhookSignature: () => true,
  syncNotionFromWebhook: async () => ({ ok: true }),
  getNotionWebhookReplayState: () => ({ events: [] }),
  buildNotionWebhookResponse: () => ({ status: 'ok' }),
  checkSheetsHealth: () => ({ status: 'blocked', configured: false, checks: [] }),
  readSheetsConfig: () => ({}),
  pullSheetsRecords: () => ({ mode: 'static' }),
  pullSheetsRecordsLive: async () => ({ mode: 'live' }),
  writeSheetsRecord: async () => ({ ok: true }),
  normalizeSheetsWebhookEvent: (event: unknown) => event,
  syncSheetsFromWebhook: async () => ({ ok: true }),
  getSheetsWebhookReplayState: () => ({ events: [] }),
  buildSheetsWebhookResponse: () => ({ status: 'ok' }),
};

const packageContext = {
  assertAuth: allowAuth,
  readJsonBody: async () => ({}),
  packageRegistry: () => ({
    getActive: () => null,
    listAppInstallations: () => [],
    getReceipts: () => [],
  }),
  installReactiveRuntime: () => {},
};

const chatContext = {
  assertAuth: allowAuth,
  getAuthenticatedPrincipalId: () => 'tenant-alpha',
  listConversations: () => [
    {
      id: 'thread-alpha-finance',
      domain: 'finance',
      title: 'Finance',
      detail: 'finance',
    },
    {
      id: 'thread-alpha-work',
      domain: 'work',
      title: 'Work',
      detail: 'work',
    },
  ],
  getConversation: (threadId: string) => {
    if (threadId !== 'thread-alpha-work') return null;
    return {
      id: 'thread-alpha-work',
      domain: 'work',
      title: 'Work',
      detail: 'work',
      updated_at: '2020-01-01T00:00:00.000Z',
      messages: [],
      last_response_id: null,
    };
  },
  findRunningConversationRun: (principalId: string, conversationId: string) => {
    if (principalId !== 'tenant-alpha' || conversationId !== 'active-run') return null;
    return { run: { status: 'running' }, runId: 'run-active' };
  },
};

const chatControlRuns = {
  'run-active': { status: 'running' as const, conversationId: 'thread-alpha-work', principalId: 'tenant-alpha' },
  'run-complete': { status: 'completed' as const, conversationId: 'thread-alpha-work', principalId: 'tenant-alpha' },
  'run-foreign': { status: 'running' as const, conversationId: 'thread-alpha-work', principalId: 'tenant-beta' },
};

const chatControlContext = {
  assertAuth: allowAuth,
  readJsonBody: async () => ({}),
  getAuthenticatedPrincipalId: () => 'tenant-alpha',
  getRunState: (runId: string) => chatControlRuns[runId as keyof typeof chatControlRuns] ?? null,
  setRunState: () => ({
    status: 'cancelled',
    conversationId: 'thread-alpha-work',
    principalId: 'tenant-alpha',
    created_at: '2000-01-01T00:00:00.000Z',
    updated_at: '2000-01-01T00:00:00.000Z',
  } as never),
  getRunController: (runId: string) => (runId === 'run-active' ? new AbortController() : undefined),
  clearRunController: () => {},
  chatControlBodyLimitBytes: 64 * 1024,
};

const chatAuthFailContext = {
  ...chatContext,
  assertAuth: () => null,
};

assert.equal(await handleProviderRoutes({ method: 'GET', url: '/providers/notion' }, createResponse(), '/providers/notion', providerContext), true);
assert.equal(await handleProviderRoutes({ method: 'GET', url: '/providers/notionary' }, createResponse(), '/providers/notionary', providerContext), false);
assert.equal(await handleProviderRoutes({ method: 'GET', url: '/providers/sheetsx' }, createResponse(), '/providers/sheetsx', providerContext), false);
assert.equal(await handleProviderRoutes({ method: 'GET', url: '/chat/threads' }, createResponse(), '/chat/threads', providerContext), false);
assert.equal(await handleMcpRoutes({ method: 'POST', url: '/mcp' }, createResponse(), '/mcp'), true);
assert.equal(await handleMcpRoutes({ method: 'POST', url: '/mcp/' }, createResponse(), '/mcp/'), true);
assert.equal(await handleMcpRoutes({ method: 'POST', url: '/mcp/method' }, createResponse(), '/mcp/method'), true);
assert.equal(await handleMcpRoutes({ method: 'POST', url: '/chat/threads' }, createResponse(), '/chat/threads'), false);
assert.equal(await handleMcpRoutes({ method: 'POST', url: '/mcpx' }, createResponse(), '/mcpx'), false);
assert.equal(await handleMcpRoutes({ method: 'POST', url: '/mcpx/foo' }, createResponse(), '/mcpx/foo'), false);
assert.equal(await handleMcpRoutes({ method: 'POST', url: '/mcp-foo' }, createResponse(), '/mcp-foo'), false);
assert.equal(await handlePackageRoutes({ method: 'GET', url: '/chat/threads' }, createResponse(), '/chat/threads', packageContext as never), false);
assert.equal(await handleHealthConnectRoute({ method: 'GET' }, createResponse(), '/chat/threads', { assertAuth: allowAuth, readJsonBody: async () => ({}) }), false);
assert.equal(await handleChatQueryRoutes({ method: 'GET', url: '/chat/threads' }, createResponse(), '/chat/threads', chatContext as never), true);
assert.equal(await handleChatQueryRoutes({ method: 'GET', url: '/chat/x' }, createResponse(), '/chat/x', chatContext as never), false);
assert.equal(await handleChatQueryRoutes({ method: 'GET', url: '/chat/threads' }, createResponse(), '/chat/threads', chatAuthFailContext as never), true);

const threadFilterResponse = createResponse();
assert.equal(await handleChatQueryRoutes({ method: 'GET', url: '/chat/threads?domain=work' }, threadFilterResponse, '/chat/threads', chatContext as never), true);
assert.equal(threadFilterResponse.statusCode, 200);
const threadFilterBody = parseJsonResponse(threadFilterResponse) as { threads?: Array<{ id?: string; domain?: string }> };
assert.equal(Array.isArray(threadFilterBody.threads), true);
assert.equal(threadFilterBody.threads?.length, 1);
assert.equal(threadFilterBody.threads?.[0]?.id, 'thread-alpha-work');
assert.equal(threadFilterBody.threads?.[0]?.domain, 'work');

const missingConversationResponse = createResponse();
assert.equal(await handleChatQueryRoutes({ method: 'GET', url: '/chat/run' }, missingConversationResponse, '/chat/run', chatContext as never), true);
assert.equal(missingConversationResponse.statusCode, 400);
assert.equal(parseJsonResponse(missingConversationResponse).message, 'conversation_id required');

const unknownThreadResponse = createResponse();
assert.equal(await handleChatQueryRoutes({ method: 'GET', url: '/chat/threads/missing-thread' }, unknownThreadResponse, '/chat/threads/missing-thread', chatContext as never), true);
assert.equal(unknownThreadResponse.statusCode, 400);
assert.equal(parseJsonResponse(unknownThreadResponse).message, 'thread not found');

const idleRunResponse = createResponse();
assert.equal(await handleChatQueryRoutes({ method: 'GET', url: '/chat/run?conversation_id=idle-thread' }, idleRunResponse, '/chat/run', chatContext as never), true);
assert.equal(idleRunResponse.statusCode, 200);
assert.deepEqual(parseJsonResponse(idleRunResponse), {
  conversation_id: 'idle-thread',
  active: false,
  status: 'idle',
  run_id: null,
});

assert.equal(
  await handleChatControlRoutes({ method: 'POST', url: '/chat/stop' }, createResponse(), '/chat/threads', chatControlContext as never),
  false,
);

const chatStopHandledResponse = createResponse();
assert.equal(
  await handleChatControlRoutes(
    { method: 'POST', url: '/chat/stop' },
    chatStopHandledResponse,
    '/chat/stop',
    {
      ...chatControlContext,
      readJsonBody: async () => ({ run_id: 'run-active' }),
    } as never,
  ),
  true,
);
assert.equal(chatStopHandledResponse.statusCode, 200);
assert.deepEqual(parseJsonResponse(chatStopHandledResponse), {
  run_id: 'run-active',
  status: 'cancelled',
  conversation_id: 'thread-alpha-work',
  run_status: 'cancelled',
});

const chatStopUnknownRunResponse = createResponse();
assert.equal(
  await handleChatControlRoutes(
    { method: 'POST', url: '/chat/stop' },
    chatStopUnknownRunResponse,
    '/chat/stop',
    {
      ...chatControlContext,
      readJsonBody: async () => ({ run_id: 'run-unknown' }),
    } as never,
  ),
  true,
);
assert.equal(chatStopUnknownRunResponse.statusCode, 400);
assert.equal(parseJsonResponse(chatStopUnknownRunResponse).message, 'Unknown run');

const chatStopAuthFailureResponse = createResponse();
assert.equal(
  await handleChatControlRoutes(
    { method: 'POST', url: '/chat/stop' },
    chatStopAuthFailureResponse,
    '/chat/stop',
    {
      ...chatControlContext,
      assertAuth: () => {
        chatStopAuthFailureResponse.statusCode = 401;
        return null;
      },
    } as never,
  ),
  true,
);
assert.equal(chatStopAuthFailureResponse.statusCode, 401);

assert.equal(await handlePackageRoutes({ method: 'GET', url: '/packages/active' }, createResponse(), '/packages/active', packageContext as never), true);
assert.equal(await handleHealthConnectRoute({ method: 'GET' }, createResponse(), '/health/connect/snapshots', { assertAuth: allowAuth, readJsonBody: async () => ({}) }), true);
assert.equal(await handlePackageRoutes({ method: 'GET', url: '/packagesx' }, createResponse(), '/packagesx', packageContext as never), false);

console.log('PASS server/test/route-ownership-regression-contract.ts');
