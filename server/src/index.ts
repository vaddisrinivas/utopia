import { createServer } from 'http';
import {
  applyCors,
  badRequest,
  handleBodyReadError,
  ok,
  readBoundedTextBody as readBoundedTextBodyFromHttp,
  readJsonBody as readJsonBodyFromHttp,
  RequestHeaderTooLargeError,
  setJson,
} from './http-utils';
import {
  handleServerChat,
  buildChatOperationFingerprint,
  scopeChatIdempotencyNamespace,
  scopeChatOperationIdempotencyKey,
  resolveStoredPreviousResponseId,
} from './chat';
import { assertServerStartupSecurity, authorizeServerRequest, type RequestAuthorizationResult } from './security/auth';
import { handleHonoReadRoute, isHonoReadRoute } from './hono-read-routes';
import { handleChatRoutes } from './routes/chat-routes';
import { handleChatControlRoutes } from './routes/chat-control-routes';
import { createChatControlRepository } from './repositories/chat-control-repository';
import { createChatControlService } from './services/chat-control-service';
import { handleMcpRoutes } from './routes/mcp-routes';
import { buildNotionWebhookResponse, buildSheetsWebhookResponse } from './provider-webhook-response';
import { discoverNotionDataSources } from './providers/notion/discovery';
import { readNotionConfig } from './providers/notion/client';
import { pullNotionRecords, pullNotionRecordsLive } from './providers/notion/pull';
import {
  normalizeWebhookBody,
  normalizeWebhookEvent,
  verifyNotionWebhookSignature,
} from './providers/notion/webhook';
import { getWebhookReplayState } from './providers/webhooks/notion';
import {
  normalizeSheetsWebhookEvent,
  getWebhookReplayState as getSheetsWebhookReplayState,
} from './providers/webhooks/sheets';
import { handleHealthConnectRoute } from './routes/health-connect';
import { handleProviderRoutes } from './routes/provider-routes';
import { handlePackageRoutes } from './routes/package-routes';
import { readSheetsConfig } from './providers/sheets/client';
import { writeNotionRecord } from './providers/notion/push';
import { checkSheetsHealth } from './providers/sheets/health';
import { writeSheetsRecord } from './providers/sheets/push';
import { pullSheetsRecords, pullSheetsRecordsLive } from './providers/sheets/pull';
import { syncSheetsFromWebhook } from './providers/sync/sheets';
import { syncNotionFromWebhook } from './providers/sync/notion';
import {
  ensureConversation,
  appendServerMessage,
  upsertConversation,
  listConversations,
  getConversation,
  setConversationResponseId,
} from './chat-storage';
import { installReactiveRuntime } from './kernel/install-reactive-runtime';
import { PackageRegistry } from './kernel/package-registry';
import {
  createChatRuntimeJobRepository,
} from './repositories/chat-runtime-job-repository';
const port = Number(process.env.PORT ?? '8787');
const host = process.env.LIFEOS_SERVER_HOST?.trim() || '127.0.0.1';
assertServerStartupSecurity(host);
const chatRuntimeJobRepository = createChatRuntimeJobRepository();
const CHAT_CONTROL_BODY_LIMIT_BYTES = 64 * 1024;
const REQUEST_DEADLINE_MS = Number(process.env.LIFEOS_REQUEST_DEADLINE_MS ?? '15000');
const BODY_CHUNK_TIMEOUT_MS = Number(process.env.LIFEOS_BODY_CHUNK_TIMEOUT_MS ?? '3000');
const HEADER_TIMEOUT_MS = Number(process.env.LIFEOS_HEADER_TIMEOUT_MS ?? '5000');
const MAX_HEADER_COUNT = Number(process.env.LIFEOS_MAX_HEADER_COUNT ?? '64');
const MAX_HEADER_BYTES = Number(process.env.LIFEOS_MAX_HEADER_BYTES ?? '16384');
const DEFAULT_AUTHENTICATED_PRINCIPAL = 'server';
const DEFAULT_LOCAL_DEVELOPMENT_PRINCIPAL = 'local-development';
const packageRegistryPath = process.env.LIFEOS_PACKAGE_REGISTRY_PATH?.trim()
  || `${process.cwd()}/server-data/package-registry.json`;

const activeRunControllers = new Map<string, AbortController>();

installReactiveRuntime();
const CORS_ORIGINS = new Set(
  (process.env.LIFEOS_CORS_ORIGINS ?? 'http://localhost:8094,http://127.0.0.1:8094,http://localhost:8093,http://127.0.0.1:8093')
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean),
);
const BODY_READ_LIMITS = {
  bodyDeadlineMs: REQUEST_DEADLINE_MS,
  bodyChunkTimeoutMs: BODY_CHUNK_TIMEOUT_MS,
};

async function readBoundedTextBody(req: any, maxBytes: number): Promise<string> {
  return readBoundedTextBodyFromHttp(req, maxBytes, BODY_READ_LIMITS);
}

async function readJsonBody(req: any, maxBytes: number): Promise<Record<string, unknown>> {
  return readJsonBodyFromHttp(req, maxBytes, BODY_READ_LIMITS);
}

function validateRequestHeaders(req: any) {
  const rawHeaders: string[] = Array.isArray(req.rawHeaders) ? req.rawHeaders.map((value: unknown) => String(value)) : [];
  const headerCount = Math.floor(rawHeaders.length / 2);
  if (headerCount > MAX_HEADER_COUNT) {
    throw new RequestHeaderTooLargeError(`Request has too many headers. Limit is ${MAX_HEADER_COUNT}.`);
  }
  const totalHeaderBytes = rawHeaders.reduce(
    (sum, value) => sum + Buffer.byteLength(String(value), 'utf-8'),
    0,
  );
  if (totalHeaderBytes > MAX_HEADER_BYTES) {
    throw new RequestHeaderTooLargeError(`Request headers too large. Limit is ${MAX_HEADER_BYTES} bytes.`);
  }
}

function getPath(rawUrl: string | undefined) {
  if (!rawUrl) return '/';
  return rawUrl.split('?')[0];
}

function assertAuth(req: any, res: any): RequestAuthorizationResult | null {
  const auth = authorizeServerRequest(req.headers ?? {});
  if (auth.ok) {
    return auth;
  }
  setJson(res, auth.statusCode, { status: 'error', message: auth.message });
  return null;
}

function normalizePrincipalId(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function getAuthenticatedPrincipalId(auth: RequestAuthorizationResult) {
  return normalizePrincipalId(
    auth.principalId ?? undefined,
    auth.localDevelopment ? DEFAULT_LOCAL_DEVELOPMENT_PRINCIPAL : DEFAULT_AUTHENTICATED_PRINCIPAL,
  );
}

async function readRawBody(req: any, maxBytes: number): Promise<string> {
  return readBoundedTextBodyFromHttp(req, maxBytes, BODY_READ_LIMITS);
}

function conversationScopeKey(principalId: string, conversationId: string) {
  return `${principalId}\u0000${conversationId}`;
}

function buildScopedChatRequest(input: {
  principalId: string;
  conversationId: string;
  idempotencyKey: string;
  message: string;
  domainId: string;
  operation: 'send' | 'stream' | 'retry';
  retryOfMessageId?: string;
  preview: boolean;
}) {
  const operationFingerprint = buildChatOperationFingerprint({
    operation: input.operation,
    message: input.message,
    domainId: input.domainId,
    retryOfMessageId: input.retryOfMessageId,
    preview: input.preview,
  });
  return {
    conversationRunKey: conversationScopeKey(input.principalId, input.conversationId),
    idempotencyNamespace: scopeChatIdempotencyNamespace({
      principalId: input.principalId,
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
    }),
    scopedIdempotencyKey: scopeChatOperationIdempotencyKey({
      principalId: input.principalId,
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      operationFingerprint,
    }),
    operationFingerprint,
  };
}

const chatControlService = createChatControlService({
  repository: createChatControlRepository({
    getRunState: chatRuntimeJobRepository.getRunState,
    setRunState: chatRuntimeJobRepository.setRunState,
    getRunController: (runId) => activeRunControllers.get(runId),
    setRunController: (runId, controller) => activeRunControllers.set(runId, controller),
    clearRunController: (runId) => activeRunControllers.delete(runId),
    reserveScopedIdempotencyRecord: chatRuntimeJobRepository.reserveScopedIdempotencyRecord,
    completeScopedIdempotencyReservation: chatRuntimeJobRepository.completeScopedIdempotencyReservation,
    getConversation,
    upsertConversation,
    buildScopedChatRequest,
    resolveStoredPreviousResponseId,
    appendServerMessage,
    setConversationResponseId,
  }),
  handleServerChat,
});

const server = createServer({ maxHeaderSize: MAX_HEADER_BYTES }, async (req: any, res: any) => {
  try {
    validateRequestHeaders(req);
  } catch (error) {
    if (handleBodyReadError(res, error)) return;
    throw error;
  }
  applyCors(req, res, CORS_ORIGINS);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const path = getPath(req.url);
  if (await handleMcpRoutes(req, res, path)) {
    return;
  }

  if (isHonoReadRoute(req.method, path)) {
    await handleHonoReadRoute(req, res);
    return;
  }

  if (path.startsWith('/health/connect')) {
    if (await handleHealthConnectRoute(req, res, path, {
      assertAuth,
      readJsonBody,
    })) {
      return;
    }
    return;
  }

  if (await handlePackageRoutes(req, res, path, {
    assertAuth,
    readJsonBody,
    packageRegistry: () => new PackageRegistry({ path: packageRegistryPath }),
    installReactiveRuntime,
  })) {
    return;
  }

  if (await handleProviderRoutes(req, res, path, {
    assertAuth,
    readJsonBody,
    readRawBody,
    readNotionConfig: () => readNotionConfig(),
    discoverNotionDataSources,
    pullNotionRecords,
    pullNotionRecordsLive,
    writeNotionRecord,
    normalizeWebhookBody,
    normalizeWebhookEvent,
    verifyNotionWebhookSignature,
    syncNotionFromWebhook,
    getNotionWebhookReplayState: () => getWebhookReplayState(),
    buildNotionWebhookResponse,
    checkSheetsHealth,
    readSheetsConfig: () => readSheetsConfig(),
    pullSheetsRecords,
    pullSheetsRecordsLive,
    writeSheetsRecord,
    normalizeSheetsWebhookEvent,
    syncSheetsFromWebhook,
    getSheetsWebhookReplayState: () => getSheetsWebhookReplayState(),
    buildSheetsWebhookResponse,
  })) {
    return;
  }

  if (await handleChatRoutes(req, res, path, {
    assertAuth,
    getAuthenticatedPrincipalId,
    listConversations,
    getConversation,
    findRunningConversationRun: chatRuntimeJobRepository.findRunningConversationRun,
    ensureConversation,
    upsertConversation,
    resolveStoredPreviousResponseId,
    readJsonBody,
    chatControlService,
    chatSendBodyLimitBytes: 256 * 1024,
  })) {
    return;
  }

  if (await handleChatControlRoutes(req, res, path, {
    assertAuth,
    readJsonBody,
    getAuthenticatedPrincipalId,
    chatControlBodyLimitBytes: CHAT_CONTROL_BODY_LIMIT_BYTES,
    chatControlService,
  })) {
    return;
  }

  badRequest(res, 'Unsupported method');
});

server.headersTimeout = HEADER_TIMEOUT_MS;
server.requestTimeout = REQUEST_DEADLINE_MS;

server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`[server] listening on http://${displayHost}:${port}`);
});

export { server };
