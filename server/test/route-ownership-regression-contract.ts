import assert from 'node:assert/strict';

import { handleHealthConnectRoute } from '../src/routes/health-connect';
import { handlePackageRoutes } from '../src/routes/package-routes';
import { handleProviderRoutes } from '../src/routes/provider-routes';
import { handleChatQueryRoutes, handleChatRoutes } from '../src/routes/chat-routes';
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
  getConversation: (threadId: string, _principalId: string) => {
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

const chatSendHandlingContext: Parameters<typeof handleChatRoutes>[3] = {
  ...chatContext,
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
  listConversations: () => chatContext.listConversations(),
  ensureConversation: (threadId: string, domainId: string, title: string, _principalId: string) => ({
    id: threadId,
    domain: domainId,
    title,
    detail: 'work',
    messages: [],
    last_response_id: null,
  }),
  upsertConversation: (input) => ({
    id: input.id,
    domain: input.domain,
    title: input.title,
    detail: input.detail,
    messages: [],
  }),
  resolveStoredPreviousResponseId: ({ storedConversationResponseId }) => storedConversationResponseId,
  readJsonBody: async () => ({
    thread_id: 'thread-alpha-work',
    message: 'How is rice?',
  }),
  chatControlService: {
    reserveScopedIdempotencyRecord: () => ({
      status: 'reserved',
      record: {
        status: 'reserved',
        reservationId: 'reservation-id',
        messageId: null,
        runId: 'run-1',
        conversationId: 'thread-alpha-work',
        principalId: 'tenant-alpha',
        operationFingerprint: 'operation-fp',
        created_at: '2000-01-01T00:00:00.000Z',
        updated_at: '2000-01-01T00:00:00.000Z',
      },
    }),
    execute: async () => ({
      conversation_id: 'thread-alpha-work',
      messages: [{ id: 'asst-1', role: 'assistant', text: 'reply' }],
      thread: { id: 'thread-alpha-work', title: 'Work', detail: 'work' },
      run: { id: 'run-1', status: 'completed', needs_retry: false, aborted: false },
      warnings: [],
    }),
    markRunFailed: () => ({ status: 'cancelled', conversationId: 'thread-alpha-work', principalId: 'tenant-alpha' } as never),
  } as never,
};

const chatControlRuns = {
  'run-active': { status: 'running' as const, conversationId: 'thread-alpha-work', principalId: 'tenant-alpha' },
  'run-complete': { status: 'completed' as const, conversationId: 'thread-alpha-work', principalId: 'tenant-alpha' },
  'run-foreign': { status: 'running' as const, conversationId: 'thread-alpha-work', principalId: 'tenant-beta' },
};

const retryThread = {
  id: 'thread-alpha-work',
  domain: 'work',
  title: 'Work',
  detail: 'work',
  last_response_id: 'resp-1',
  messages: [{ id: 'msg-user', role: 'user' as const, text: 'Where is milk?' }],
};

const chatControlContext: Parameters<typeof handleChatControlRoutes>[3] = {
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
  getConversation: () => retryThread,
  buildScopedChatRequest: ({ principalId, conversationId, idempotencyKey, message, domainId, retryOfMessageId }) => ({
    conversationRunKey: `${principalId}\u0000${conversationId}`,
    idempotencyNamespace: `${principalId}:${conversationId}:${idempotencyKey}`,
    scopedIdempotencyKey: `${principalId}:${conversationId}:${idempotencyKey}:${message.length.toString()}:${domainId}:retry`,
    operationFingerprint: `retry:${retryOfMessageId ?? ''}`,
  }),
  reserveScopedIdempotencyRecord: (_namespace, input) => ({
    status: 'reserved' as const,
    record: {
      status: 'reserved',
      reservationId: input.reservationId,
      messageId: null,
      runId: input.runId,
      conversationId: input.conversationId,
      principalId: input.principalId,
      operationFingerprint: input.operationFingerprint,
      created_at: '2000-01-01T00:00:00.000Z',
      updated_at: '2000-01-01T00:00:00.000Z',
    },
  }),
  resolveStoredPreviousResponseId: ({ storedConversationResponseId }) => storedConversationResponseId,
  runServerChat: async (input) => ({
    conversation_id: input.conversationId,
    messages: [{ id: 'asst-retry', role: 'assistant', text: 'retry handled' }],
    thread: {
      id: input.conversationId,
      title: retryThread.title,
      detail: retryThread.detail,
    },
    run: {
      id: input.runId,
      status: 'completed' as const,
      needs_retry: false,
      aborted: false,
    },
  }),
  upsertConversation: (input) => ({
    ...retryThread,
    ...input,
    updated_at: '2000-01-01T00:00:00.000Z',
  }),
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
const chatSendOwnershipResponse = createResponse();
assert.equal(
  await handleChatRoutes({ method: 'POST', url: '/chat/send' }, chatSendOwnershipResponse, '/chat/send', chatSendHandlingContext),
  true,
);
assert.equal(chatSendOwnershipResponse.statusCode, 200);
assert.equal(parseJsonResponse(chatSendOwnershipResponse).conversation_id, 'thread-alpha-work');

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

assert.equal(
  await handleChatControlRoutes(
    { method: 'POST', url: '/chat/retry' },
    createResponse(),
    '/chat/threads',
    chatControlContext as never,
  ),
  false,
);

const chatRetryMissingPayloadResponse = createResponse();
assert.equal(
  await handleChatControlRoutes(
    { method: 'POST', url: '/chat/retry' },
    chatRetryMissingPayloadResponse,
    '/chat/retry',
    chatControlContext as never,
  ),
  true,
);
assert.equal(chatRetryMissingPayloadResponse.statusCode, 400);
assert.equal(parseJsonResponse(chatRetryMissingPayloadResponse).message, 'conversation_id and user_message_id required');

const chatRetryHandledResponse = createResponse();
assert.equal(
  await handleChatControlRoutes(
    { method: 'POST', url: '/chat/retry' },
    chatRetryHandledResponse,
    '/chat/retry',
    {
      ...chatControlContext,
      readJsonBody: async () => ({ conversation_id: 'thread-alpha-work', user_message_id: 'msg-user' }),
    } as never,
  ),
  true,
);
assert.equal(chatRetryHandledResponse.statusCode, 200);
const chatRetryPayload = parseJsonResponse(chatRetryHandledResponse) as {
  conversation_id?: string;
  messages?: Array<{ id: string; role: string; text: string }>;
  thread?: { id: string; title: string; detail: string };
  run?: { id: string; status: string; needs_retry: boolean; aborted: boolean };
};
assert.equal(chatRetryPayload.conversation_id, 'thread-alpha-work');
assert.equal(chatRetryPayload.run?.status, 'completed');
assert.equal(chatRetryPayload.run?.needs_retry, false);
assert.equal(chatRetryPayload.thread?.id, 'thread-alpha-work');

const chatActionMissingPayloadResponse = createResponse();
assert.equal(
  await handleChatControlRoutes(
    { method: 'POST', url: '/chat/action' },
    chatActionMissingPayloadResponse,
    '/chat/action',
    chatControlContext as never,
  ),
  true,
);
assert.equal(chatActionMissingPayloadResponse.statusCode, 400);
assert.equal(parseJsonResponse(chatActionMissingPayloadResponse).message, 'conversation_id and action required');

const chatUndoMissingActionResponse = createResponse();
assert.equal(
  await handleChatControlRoutes(
    { method: 'POST', url: '/chat/undo' },
    chatUndoMissingActionResponse,
    '/chat/undo',
    {
      ...chatControlContext,
      readJsonBody: async () => ({ action_id: 'missing-action' }),
    } as never,
  ),
  true,
);
assert.equal(chatUndoMissingActionResponse.statusCode, 400);
assert.equal(parseJsonResponse(chatUndoMissingActionResponse).message, 'action not found');

assert.equal(await handlePackageRoutes({ method: 'GET', url: '/packages/active' }, createResponse(), '/packages/active', packageContext as never), true);
assert.equal(await handleHealthConnectRoute({ method: 'GET' }, createResponse(), '/health/connect/snapshots', { assertAuth: allowAuth, readJsonBody: async () => ({}) }), true);
assert.equal(await handlePackageRoutes({ method: 'GET', url: '/packagesx' }, createResponse(), '/packagesx', packageContext as never), false);

console.log('PASS server/test/route-ownership-regression-contract.ts');
