import { createServer } from 'http';
import { randomUUID } from 'node:crypto';
import {
  buildChatOperationFingerprint,
  handleServerChat,
  normalizeChatSendRequest,
  resolveStoredPreviousResponseId,
  scopeChatIdempotencyNamespace,
  scopeChatOperationIdempotencyKey,
  type ChatSendRequest,
} from './chat';
import { type NormalizedChatSend } from './chat';
import { assertServerStartupSecurity, authorizeServerRequest, type RequestAuthorizationResult } from './security/auth';
import { handleHonoReadRoute, isHonoReadRoute } from './hono-read-routes';
import { handleMcpRequest } from './mcp/official-server';
import { buildNotionWebhookResponse, buildSheetsWebhookResponse } from './provider-webhook-response';
import { ProviderOperation } from './providers/contracts';
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
import { writeNotionRecord } from './providers/notion/push';
import { checkSheetsHealth } from './providers/sheets/health';
import { readSheetsConfig } from './providers/sheets/client';
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
import { ChatStreamEvent } from './responses';
import { createActionEvent, getActionEvent, runUndo } from './runtime/state';
import { installReactiveRuntime } from './kernel/install-reactive-runtime';
import { PackageRegistry } from './kernel/package-registry';
import {
  findRunningConversationRun,
  completeScopedIdempotencyReservation,
  getRunState,
  reserveScopedIdempotencyRecord,
  setRunState,
} from './chat-runtime-state';
import {
  deleteHealthSnapshot,
  exportHealthSnapshots,
  listHealthSnapshots,
  saveHealthSnapshot,
} from './health/snapshots';

const port = Number(process.env.PORT ?? '8787');
const host = process.env.LIFEOS_SERVER_HOST?.trim() || '127.0.0.1';
assertServerStartupSecurity(host);
const CHAT_SEND_BODY_LIMIT_BYTES = 256 * 1024;
const CHAT_CONTROL_BODY_LIMIT_BYTES = 64 * 1024;
const PROVIDER_BODY_LIMIT_BYTES = 1024 * 1024;
const PACKAGE_BODY_LIMIT_BYTES = 512 * 1024;
const HEALTH_BODY_LIMIT_BYTES = 512 * 1024;
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

function applyCors(req: any, res: any) {
  const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
  if (origin && CORS_ORIGINS.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-allow-methods', 'DELETE, GET, POST, OPTIONS');
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function setJson(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(json(body));
}

function unauthorized(res: any, message: string) {
  setJson(res, 401, { status: 'error', message });
}

function badRequest(res: any, message: string) {
  setJson(res, 400, { status: 'error', message });
}

function conflict(res: any, message: string) {
  setJson(res, 409, { status: 'error', message });
}

function notFound(res: any, message: string) {
  setJson(res, 404, { status: 'error', message });
}

function payloadTooLarge(res: any, message: string) {
  setJson(res, 413, { status: 'error', message });
}

function requestTimeout(res: any, message: string) {
  setJson(res, 408, { status: 'error', message });
}

function requestHeaderTooLarge(res: any, message: string) {
  setJson(res, 431, { status: 'error', message });
}

function ok(res: any, body: unknown) {
  setJson(res, 200, body);
}

class PayloadTooLargeError extends Error {}
class RequestTimeoutError extends Error {}
class RequestHeaderTooLargeError extends Error {}

function handleBodyReadError(res: any, error: unknown) {
  if (error instanceof PayloadTooLargeError) {
    payloadTooLarge(res, error.message);
    return true;
  }
  if (error instanceof RequestTimeoutError) {
    requestTimeout(res, error.message);
    return true;
  }
  if (error instanceof RequestHeaderTooLargeError) {
    requestHeaderTooLarge(res, error.message);
    return true;
  }
  if (error instanceof Error && error.message === 'Invalid Content-Length header') {
    badRequest(res, error.message);
    return true;
  }
  return false;
}

function parseContentLength(req: any): number | null {
  const raw = Array.isArray(req.headers?.['content-length'])
    ? req.headers['content-length'][0]
    : req.headers?.['content-length'];
  if (raw === undefined) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
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

async function readBoundedTextBody(req: any, maxBytes: number): Promise<string> {
  const contentLength = parseContentLength(req);
  if (contentLength !== null) {
    if (!Number.isFinite(contentLength)) {
      throw new Error('Invalid Content-Length header');
    }
    if (contentLength > maxBytes) {
      throw new PayloadTooLargeError(`Request body too large. Limit is ${maxBytes} bytes.`);
    }
  }

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    let chunkTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (chunkTimer) clearTimeout(chunkTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimers();
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      callback();
    };
    const armChunkTimer = () => {
      if (chunkTimer) clearTimeout(chunkTimer);
      chunkTimer = setTimeout(() => {
        req.destroy(new RequestTimeoutError(`Request body timed out after ${BODY_CHUNK_TIMEOUT_MS} ms without progress.`));
      }, BODY_CHUNK_TIMEOUT_MS);
    };
    const onError = (error: unknown) => finish(() => reject(error));
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks).toString('utf-8')));
    const onData = (chunk: Buffer | string) => {
      armChunkTimer();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        req.destroy(new PayloadTooLargeError(`Request body too large. Limit is ${maxBytes} bytes.`));
        return;
      }
      chunks.push(buffer);
    };

    deadlineTimer = setTimeout(() => {
      req.destroy(new RequestTimeoutError(`Request exceeded ${REQUEST_DEADLINE_MS} ms deadline.`));
    }, REQUEST_DEADLINE_MS);
    armChunkTimer();
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

async function readJsonBody(req: any, maxBytes: number): Promise<Record<string, unknown>> {
  const raw = await readBoundedTextBody(req, maxBytes);
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function packageRegistry() {
  return new PackageRegistry({ path: packageRegistryPath });
}

function packageRegistryState(registry = packageRegistry()) {
  return {
    active: registry.getActive(),
    installations: registry.listAppInstallations(),
    receipts: registry.getReceipts(),
  };
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

function notionWebhooksEnabled() {
  return process.env.LIFEOS_NOTION_WEBHOOKS_ENABLED?.trim().toLowerCase() === 'true';
}

function parseNumber(raw: unknown, fallback: number) {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseBooleanString(raw: unknown, fallback = false) {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parseProviderOperation(raw: unknown): ProviderOperation | null {
  if (typeof raw !== 'string') {
    return null;
  }
  if (raw === 'create_record' || raw === 'update_record' || raw === 'archive_record') {
    return raw;
  }
  return null;
}

async function readRawBody(req: any, maxBytes: number): Promise<string> {
  return readBoundedTextBody(req, maxBytes);
}

function sendStopReply(res: any, id: string, status: 'running' | 'completed' | 'cancelled' | 'failed') {
  const run = getRunState(id);
  if (!run) {
    setJson(res, 404, { status: 'error', message: 'run_id not found' });
    return;
  }
  ok(res, { run_id: id, status, conversation_id: run.conversationId, run_status: run.status });
}

type ChatRunResponse = Awaited<ReturnType<typeof handleServerChat>>;
type StreamToken = (chunk: string) => void;

function sendStreamEvent(res: any, event: ChatStreamEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function parseChatSend(req: any, maxBytes: number): Promise<NormalizedChatSend> {
  let payload: ChatSendRequest;
  try {
    payload = (await readJsonBody(req, maxBytes)) as ChatSendRequest;
  } catch (error) {
    if (
      error instanceof PayloadTooLargeError
      || error instanceof RequestTimeoutError
      || error instanceof RequestHeaderTooLargeError
      || (error instanceof Error && error.message === 'Invalid Content-Length header')
    ) {
      throw error;
    }
    throw new Error('Invalid JSON');
  }
  return normalizeChatSendRequest(payload);
}

function getRunMessageText(
  thread: ReturnType<typeof getConversation>,
  retryOfMessageId: string | undefined,
  fallbackText: string,
) {
  if (!retryOfMessageId || !thread) {
    return fallbackText;
  }

  const target = thread.messages.find((message) => message.id === retryOfMessageId);
  if (!target) {
    return fallbackText;
  }

  return target.text;
}

async function runServerChat(params: {
  principalId: string;
  conversationId: string;
  message: string;
  threadTitle: string;
  detail: string;
  idempotencyKey: string;
  idempotencyNamespace: string;
  reservationId: string;
  operationFingerprint: string;
  domainId: string;
  runId: string;
  previousResponseId?: string;
  retryOfMessageId?: string;
  userMessageId: string;
  appendUserMessage?: boolean;
  stream?: boolean;
  onModelToken?: StreamToken;
  planHint?: string;
  preview?: boolean;
}): Promise<ChatRunResponse> {
  const controller = new AbortController();
  const { conversationId, principalId, runId } = params;
  activeRunControllers.set(runId, controller);
  setRunState(runId, {
    status: 'running',
    conversationId,
    principalId,
  });

  const shouldAppendUser = params.appendUserMessage !== false;
  if (shouldAppendUser) {
    appendServerMessage(conversationId, {
      id: params.userMessageId,
      role: 'user',
      text: params.message,
    }, principalId);
  }

  let response: ChatRunResponse | null = null;

  try {
    response = await handleServerChat({
      conversationId,
      principalId,
      message: params.message,
      threadTitle: params.threadTitle,
      idempotencyKey: params.idempotencyKey,
      domainId: params.domainId,
      runId,
      signal: controller.signal,
      previousResponseId: params.previousResponseId,
      retryOfMessageId: params.retryOfMessageId,
      stream: params.stream,
      planHint: params.planHint,
      onModelToken: params.onModelToken,
      preview: params.preview,
    });
  } catch {
    response = {
      conversation_id: conversationId,
      messages: [
        {
          id: `server-${Date.now()}-asst`,
          role: 'assistant',
          text: 'I could not complete this response.',
          answer: undefined,
        },
      ],
      thread: {
        id: conversationId,
        title: params.threadTitle,
        detail: params.detail,
      },
      warnings: ['Server runtime failed.'],
      run: { id: runId, status: 'failed', needs_retry: true, aborted: false },
    };
  }

  if (!response) {
    response = {
      conversation_id: conversationId,
      messages: [],
      thread: {
        id: conversationId,
        title: params.threadTitle,
        detail: params.detail,
      },
      warnings: ['Server runtime produced no response.'],
      run: { id: runId, status: 'failed', needs_retry: true, aborted: false },
    };
  }

  const terminalRunStatus = response.run?.status
    ? response.run.status === 'canceled'
      ? 'cancelled'
      : response.run.status === 'completed'
        ? 'completed'
        : 'failed'
    : response.messages.length
      ? 'completed'
      : 'failed';

  setRunState(runId, {
    status: terminalRunStatus,
    conversationId,
    principalId,
  });

  for (const message of response.messages) {
    appendServerMessage(conversationId, message, principalId);
  }
  const replayMessage = response.messages.at(-1);
  if (replayMessage) {
    completeScopedIdempotencyReservation(params.idempotencyNamespace, {
      reservationId: params.reservationId,
      messageId: replayMessage.id,
    });
  }

  if (response.run?.previous_response_id) {
    setConversationResponseId(conversationId, response.run.previous_response_id, principalId);
  }

  activeRunControllers.delete(runId);

  response.thread = {
    id: conversationId,
    title: params.threadTitle,
    detail: params.detail,
  };

  return response;
}

const server = createServer({ maxHeaderSize: MAX_HEADER_BYTES }, async (req: any, res: any) => {
  try {
    validateRequestHeaders(req);
  } catch (error) {
    if (handleBodyReadError(res, error)) return;
    throw error;
  }
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const path = getPath(req.url);
  if (path.startsWith('/mcp')) {
    await handleMcpRequest(req, res);
    return;
  }

  if (isHonoReadRoute(req.method, path)) {
    await handleHonoReadRoute(req, res);
    return;
  }

  if (path.startsWith('/health/connect')) {
    if (!assertAuth(req, res)) return;
    if (req.method === 'GET' && path === '/health/connect/snapshots') {
      ok(res, { status: 'ok', provider: 'health_connect', snapshots: listHealthSnapshots() });
      return;
    }
    if (req.method === 'GET' && path === '/health/connect/export') {
      res.setHeader('content-disposition', 'attachment; filename="utopia-health-connect-export.json"');
      ok(res, {
        status: 'ok',
        provider: 'health_connect',
        exported_at: new Date().toISOString(),
        snapshots: exportHealthSnapshots(),
      });
      return;
    }
    if (req.method === 'POST' && path === '/health/connect/snapshot') {
      let payload: Record<string, unknown>;
      try {
        payload = await readJsonBody(req, HEALTH_BODY_LIMIT_BYTES);
      } catch (error) {
        if (handleBodyReadError(res, error)) return;
        badRequest(res, 'Invalid JSON');
        return;
      }
      const result = saveHealthSnapshot(payload as Parameters<typeof saveHealthSnapshot>[0]);
      if (!result.ok) {
        badRequest(res, result.message);
        return;
      }
      ok(res, result);
      return;
    }
    const snapshotMatch = path.match(/^\/health\/connect\/snapshot\/([^/]+)$/);
    if (req.method === 'DELETE' && snapshotMatch) {
      const result = deleteHealthSnapshot(decodeURIComponent(snapshotMatch[1]));
      if (!result.ok && result.status === 'not_found') {
        notFound(res, result.message);
        return;
      }
      if (!result.ok) {
        badRequest(res, result.message);
        return;
      }
      ok(res, result);
      return;
    }
    badRequest(res, 'Route not found');
    return;
  }

  if (path.startsWith('/providers/notion')) {
    if (path === '/providers/notion/webhook') {
      if (!notionWebhooksEnabled()) {
        notFound(res, 'Notion webhooks are disabled; use authenticated pull sync.');
        return;
      }
      if (req.method !== 'POST') {
        badRequest(res, 'Unsupported method');
        return;
      }
      let rawBody = '';
      try {
        rawBody = await readRawBody(req, PROVIDER_BODY_LIMIT_BYTES);
      } catch (error) {
        if (handleBodyReadError(res, error)) return;
        badRequest(res, 'Invalid webhook JSON');
        return;
      }
      const parsed = normalizeWebhookBody(rawBody);
      if (!parsed) {
        badRequest(res, 'Invalid webhook JSON');
        return;
      }

      // Notion sends an unsigned one-time verification payload before event
      // delivery begins. Acknowledge it without echoing or persisting the
      // token; the operator must store it as the signing secret after copying
      // it from the Notion connection settings.
      const verificationToken =
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).verification_token
          : undefined;
      if (typeof verificationToken === 'string' && verificationToken.trim().length > 0) {
        ok(res, {
          status: 'verification_required',
          verification_token_present: true,
          signature_required_for_events: true,
        });
        return;
      }

      const signature = Array.isArray(req.headers['x-notion-signature'])
        ? req.headers['x-notion-signature'][0]
        : req.headers['x-notion-signature'];
      const webhookSignature = typeof signature === 'string' ? signature : undefined;

      if (!verifyNotionWebhookSignature(rawBody, webhookSignature)) {
        unauthorized(res, 'Invalid webhook signature');
        return;
      }

      const normalized = normalizeWebhookEvent(parsed);
      if (!normalized) {
        badRequest(res, 'Malformed webhook event');
        return;
      }

      // Webhooks are change signals, not canonical content. Reconcile by
      // refetching the configured data source before acknowledging ingress.
      const reconciliation = await syncNotionFromWebhook({ event: parsed });
      const replayAfterSync = getWebhookReplayState();
      ok(res, buildNotionWebhookResponse(normalized, reconciliation, replayAfterSync));
      return;
    }

    if (!assertAuth(req, res)) {
      return;
    }

    const query = new URL(`http://127.0.0.1:${port}${req.url}`);
    if (req.method === 'GET' && path === '/providers/notion/discovery') {
      ok(res, discoverNotionDataSources(readNotionConfig() || undefined));
      return;
    }

    if (req.method === 'GET' && path === '/providers/notion/pull') {
      const domain = query.searchParams.get('domain');
      const collection = query.searchParams.get('collection');
      const limit = query.searchParams.get('limit');
      const live = parseBooleanString(query.searchParams.get('live'), false);
      const payload = {
        domain: domain ?? undefined,
        collection: collection ?? undefined,
        limit: limit ? parseNumber(limit, 50) : undefined,
      };
      if (live) {
        const result = await pullNotionRecordsLive(payload);
        ok(res, result);
        return;
      }
      ok(res, pullNotionRecords(payload));
      return;
    }

    if (req.method === 'POST' && path === '/providers/notion/pull') {
      let payload: { domain?: string; collection?: string; limit?: number; live?: boolean };
      try {
        payload = (await readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
      } catch (error) {
        if (handleBodyReadError(res, error)) return;
        badRequest(res, 'Invalid JSON');
        return;
      }
      if (payload.live) {
        const result = await pullNotionRecordsLive(payload);
        ok(res, result);
        return;
      }
      ok(res, pullNotionRecords(payload));
      return;
    }

    if (req.method === 'POST' && path === '/providers/notion/push') {
      let payload: {
        operation?: string;
        recordId?: string;
        pageId?: string;
        domain?: string;
        collection?: string;
        title?: string;
        properties?: Record<string, unknown>;
        archived?: boolean;
        externalId?: string;
      };
      try {
        payload = (await readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
      } catch (error) {
        if (handleBodyReadError(res, error)) return;
        badRequest(res, 'Invalid JSON');
        return;
      }
      const operation = parseProviderOperation(payload?.operation);
      if (!operation) {
        badRequest(res, 'operation must be create_record, update_record, or archive_record');
        return;
      }
      const recordId = typeof payload.recordId === 'string' ? payload.recordId.trim() : '';
      if (!recordId) {
        badRequest(res, 'recordId required');
        return;
      }
      const result = await writeNotionRecord({
        operation,
        recordId,
        pageId: typeof payload.pageId === 'string' && payload.pageId.trim() ? payload.pageId.trim() : undefined,
        domain: payload.domain ?? 'food',
        collection: payload.collection ?? 'recipe',
        title: payload.title,
        properties: payload.properties,
        archived: payload.archived,
        externalId: payload.externalId,
      });
      if (!result.ok) {
        badRequest(res, result.error || 'Notion write failed');
        return;
      }
      ok(res, result);
      return;
    }

    badRequest(res, 'Route not found');
    return;
  }

  if (path.startsWith('/providers/sheets')) {
    if (path === '/providers/sheets/webhook') {
      if (req.method !== 'POST') {
        badRequest(res, 'Unsupported method');
        return;
      }
      // Google Sheets has no native signed webhook envelope in this adapter;
      // require the same bearer boundary as other hosted provider writes.
      if (!assertAuth(req, res)) {
        return;
      }
      let rawBody = '';
      try {
        rawBody = await readRawBody(req, PROVIDER_BODY_LIMIT_BYTES);
      } catch (error) {
        if (handleBodyReadError(res, error)) return;
        badRequest(res, 'Invalid JSON');
        return;
      }
      let webhookPayload: unknown;
      try {
        webhookPayload = JSON.parse(rawBody);
      } catch {
        badRequest(res, 'Invalid JSON');
        return;
      }
      const normalized = normalizeSheetsWebhookEvent(webhookPayload);
      if (!normalized) {
        badRequest(res, 'Malformed webhook event');
        return;
      }
      // Sheets events are also change signals. Pull the authoritative range
      // before returning, while the persisted replay marker makes retries safe.
      const reconciliation = await syncSheetsFromWebhook({ event: normalized });
      const replayStore = getSheetsWebhookReplayState();
      ok(res, buildSheetsWebhookResponse(normalized, reconciliation, replayStore));
      return;
    }

    if (!assertAuth(req, res)) {
      return;
    }

    const query = new URL(`http://127.0.0.1:${port}${req.url}`);
    if (req.method === 'GET' && path === '/providers/sheets/health') {
      ok(res, checkSheetsHealth());
      return;
    }

    if (req.method === 'GET' && path === '/providers/sheets/pull') {
      const domain = query.searchParams.get('domain');
      const collection = query.searchParams.get('collection');
      const live = parseBooleanString(query.searchParams.get('live'), false);
      const payload = {
        domain: domain ?? undefined,
        collection: collection ?? undefined,
      };
      if (live) {
        const result = await pullSheetsRecordsLive(payload);
        ok(res, result);
        return;
      }
      ok(res, pullSheetsRecords(payload));
      return;
    }

    if (req.method === 'POST' && path === '/providers/sheets/pull') {
      let payload: { domain?: string; collection?: string; live?: boolean };
      try {
        payload = (await readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
      } catch (error) {
        if (handleBodyReadError(res, error)) return;
        badRequest(res, 'Invalid JSON');
        return;
      }
      if (payload.live) {
        const result = await pullSheetsRecordsLive(payload);
        ok(res, result);
        return;
      }
      ok(res, pullSheetsRecords(payload));
      return;
    }

    if (req.method === 'POST' && path === '/providers/sheets/push') {
      let payload: {
        operation?: string;
        id?: string;
        recordId?: string;
        domain?: string;
        collection?: string;
        title?: string;
        properties?: Record<string, unknown>;
        archived?: boolean;
        externalId?: string;
        source?: Record<string, unknown>;
        version?: number;
        expected_version?: number;
        expected_digest?: string;
      };
      try {
        payload = (await readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
      } catch (error) {
        if (handleBodyReadError(res, error)) return;
        badRequest(res, 'Invalid JSON');
        return;
      }
      const operation = parseProviderOperation(payload?.operation);
      if (!operation) {
        badRequest(res, 'operation must be create_record, update_record, or archive_record');
        return;
      }
      const recordId = typeof payload.recordId === 'string'
        ? payload.recordId.trim()
        : typeof payload.id === 'string'
          ? payload.id.trim()
          : '';
      if (!recordId) {
        badRequest(res, 'record id required');
        return;
      }
      const result = await writeSheetsRecord({
        operation,
        record: {
          id: recordId,
          domain: payload.domain ?? 'food',
          collection: payload.collection ?? 'recipe',
          title: payload.title ?? recordId,
          properties: payload.properties,
          archived: payload.archived,
          source: payload.source,
          externalId: payload.externalId,
          version: typeof payload.version === 'number' && Number.isFinite(payload.version) ? payload.version : undefined,
          expectedVersion: typeof payload.expected_version === 'number' && Number.isFinite(payload.expected_version)
            ? payload.expected_version
            : undefined,
          expectedDigest: typeof payload.expected_digest === 'string' ? payload.expected_digest : undefined,
        },
      });
      if (!result.ok) {
        if (result.conflict) {
          setJson(res, 409, {
            status: 'conflict',
            message: result.error || 'Sheets write conflict',
            conflict: result.conflict,
          });
          return;
        }
        badRequest(res, result.error || 'Sheets write failed');
        return;
      }
      ok(res, result);
      return;
    }

    if (req.method === 'POST' && path === '/providers/sheets/sync') {
      let payload: {
        event?: unknown;
        domain?: string;
        collection?: string;
        limit?: number;
      };
      try {
        payload = (await readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
      } catch (error) {
        if (handleBodyReadError(res, error)) return;
        badRequest(res, 'Invalid JSON');
        return;
      }
      const event = payload?.event as unknown;
      const sync = await syncSheetsFromWebhook({
        event,
        domain: payload.domain,
        collection: payload.collection,
        limit: payload.limit,
      });
      ok(res, sync);
      return;
    }

    badRequest(res, 'Route not found');
    return;
  }

  if (path === '/chat/threads' && req.method === 'GET') {
    const auth = assertAuth(req, res);
    if (!auth) {
      return;
    }
    const query = new URL(`http://127.0.0.1:${port}${req.url}`);
    const domain = query.searchParams.get('domain');
    const principalId = getAuthenticatedPrincipalId(auth);
    const rows = listConversations(principalId);
    const filtered = domain ? rows.filter((row) => row.domain === domain) : rows;
    ok(res, {
      threads: filtered.map((thread) => ({
        id: thread.id,
        domain: thread.domain,
        title: thread.title,
        detail: thread.detail,
        updated_at: new Date().toISOString(),
      })),
    });
    return;
  }

  if (path === '/chat/run' && req.method === 'GET') {
    const auth = assertAuth(req, res);
    if (!auth) {
      return;
    }
    const query = new URL(`http://127.0.0.1:${port}${req.url}`);
    const conversationId = query.searchParams.get('conversation_id');
    if (!conversationId) {
      badRequest(res, 'conversation_id required');
      return;
    }
    const principalId = getAuthenticatedPrincipalId(auth);
    const activeRun = findRunningConversationRun(principalId, conversationId);
    if (!activeRun) {
      ok(res, {
        conversation_id: conversationId,
        active: false,
        status: 'idle',
        run_id: null,
      });
      return;
    }
    ok(res, {
      conversation_id: conversationId,
      active: true,
      status: activeRun.run.status,
      run_id: activeRun.runId,
    });
    return;
  }

  if (path.startsWith('/chat/threads/') && req.method === 'GET') {
    const auth = assertAuth(req, res);
    if (!auth) {
      return;
    }
    const parts = path.split('/');
    const threadId = parts[parts.length - 1];
    const principalId = getAuthenticatedPrincipalId(auth);
    const thread = getConversation(threadId, principalId);
    if (!thread) {
      badRequest(res, 'thread not found');
      return;
    }
    ok(res, thread);
    return;
  }

  if (req.method === 'GET' && path === '/packages/active') {
    if (!assertAuth(req, res)) {
      return;
    }
    ok(res, {
      status: 'ok',
      ...packageRegistryState(),
    });
    return;
  }

  if (req.method === 'POST' && path === '/packages/preview') {
    if (!assertAuth(req, res)) {
      return;
    }
    let payload: { package?: unknown };
    try {
      payload = await readJsonBody(req, PACKAGE_BODY_LIMIT_BYTES) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return;
      badRequest(res, 'Invalid JSON');
      return;
    }
    const preview = packageRegistry().preview(payload.package);
    ok(res, {
      status: preview.valid ? 'valid' : 'invalid',
      preview,
    });
    return;
  }

  if (req.method === 'POST' && path === '/packages/change/preview') {
    if (!assertAuth(req, res)) {
      return;
    }
    let payload: { request?: unknown };
    try {
      payload = await readJsonBody(req, PACKAGE_BODY_LIMIT_BYTES) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return;
      badRequest(res, 'Invalid JSON');
      return;
    }
    try {
      const preview = packageRegistry().previewChange(payload.request as never);
      ok(res, preview);
    } catch (error) {
      badRequest(res, error instanceof Error ? error.message : 'package_change_invalid');
    }
    return;
  }

  if (req.method === 'POST' && path === '/packages/change/activate') {
    if (!assertAuth(req, res)) {
      return;
    }
    let payload: { request?: unknown; approval?: unknown };
    try {
      payload = await readJsonBody(req, PACKAGE_BODY_LIMIT_BYTES) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return;
      badRequest(res, 'Invalid JSON');
      return;
    }
    try {
      const registry = packageRegistry();
      const active = registry.activateApprovedChange(payload.request as never, payload.approval as never);
      installReactiveRuntime();
      ok(res, {
        status: 'activated',
        active,
        receipt: registry.getReceipts().at(-1),
      });
    } catch (error) {
      badRequest(res, error instanceof Error ? error.message : 'package_change_approval_failed');
    }
    return;
  }

  if (req.method === 'POST' && path === '/packages/activate') {
    if (!assertAuth(req, res)) {
      return;
    }
    badRequest(res, 'Direct package activation is disabled. Use /packages/change/preview then /packages/change/activate with a hash-bound approval receipt.');
    return;
  }

  if (req.method === 'POST' && path === '/packages/rollback') {
    if (!assertAuth(req, res)) {
      return;
    }
    const registry = packageRegistry();
    const active = registry.rollback();
    installReactiveRuntime();
    ok(res, {
      status: active ? 'rolled_back' : 'no_previous_package',
      active,
      receipt: registry.getReceipts().at(-1),
    });
    return;
  }

  if (!path.startsWith('/chat')) {
    badRequest(res, 'Route not found');
    return;
  }

  if (req.method === 'POST' && path === '/chat/send/stream') {
    const auth = assertAuth(req, res);
    if (!auth) {
      return;
    }

    try {
      const principalId = getAuthenticatedPrincipalId(auth);
      const parsed = await parseChatSend(req, CHAT_SEND_BODY_LIMIT_BYTES);
      const conversation = ensureConversation(
        parsed.threadId,
        parsed.domainId,
        parsed.message.text.slice(0, 80),
        principalId,
      );
      upsertConversation({
        id: conversation.id,
        domain: conversation.domain,
        title: conversation.title,
        detail: conversation.detail,
      }, principalId);
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const scopedRequest = buildScopedChatRequest({
        principalId,
        conversationId: conversation.id,
        idempotencyKey: parsed.idempotencyKey,
        message: parsed.message.text,
        domainId: conversation.domain,
        operation: 'stream',
        retryOfMessageId: parsed.retryOfMessageId,
        preview: parsed.preview,
      });
      const previousResponseId = resolveStoredPreviousResponseId({
        storedConversationResponseId: conversation.last_response_id,
      });
      const reservation = reserveScopedIdempotencyRecord(scopedRequest.idempotencyNamespace, {
        reservationId: randomUUID(),
        runId,
        conversationId: conversation.id,
        principalId,
        operationFingerprint: scopedRequest.operationFingerprint,
      });
      if (reservation.status !== 'reserved') {
        const existing = reservation.record;
        if (reservation.status === 'conflict') {
          conflict(res, 'Idempotency key already used for a different chat operation in this conversation.');
          return;
        }
        const prior = existing.messageId
          ? getConversation(existing.conversationId, principalId)?.messages.find((item) => item.id === existing.messageId)
          : null;
        if (reservation.status === 'completed' && prior) {
          const thread = getConversation(conversation.id, principalId);
          const cachedResponse: ChatRunResponse = {
            conversation_id: conversation.id,
            messages: [prior],
            thread: thread
              ? {
                  id: thread.id,
                  title: thread.title,
                  detail: thread.detail,
                }
              : {
                  id: conversation.id,
                  title: conversation.title,
                  detail: conversation.detail,
                },
            run: { id: existing.runId, status: 'completed' as const, needs_retry: false, aborted: false },
            warnings: ['Idempotency key replayed; returned prior answer.'],
          };
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });
          sendStreamEvent(res, {
            type: 'cache',
            conversation_id: conversation.id,
            response: cachedResponse,
          });
          res.end();
          return;
        }
        conflict(res, 'An identical chat operation is already in progress for this conversation.');
        return;
      }

      const existingRun = findRunningConversationRun(principalId, conversation.id, runId);
      if (existingRun) {
        setRunState(runId, {
          status: 'failed',
          conversationId: conversation.id,
          principalId,
        });
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        sendStreamEvent(res, {
          type: 'error',
          conversation_id: conversation.id,
          error: `A run is already active for conversation ${conversation.id}.`,
        });
        res.end();
        return;
      }

      const runMessageText = getRunMessageText(
        getConversation(conversation.id, principalId),
        parsed.retryOfMessageId,
        parsed.message.text,
      );

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      sendStreamEvent(res, {
        type: 'run.start',
        run_id: runId,
        conversation_id: conversation.id,
        thread_id: conversation.id,
      });

      const finalResponse = await runServerChat({
        principalId,
        conversationId: conversation.id,
        message: runMessageText,
        threadTitle: conversation.title,
        detail: conversation.detail,
        idempotencyKey: scopedRequest.scopedIdempotencyKey,
        idempotencyNamespace: scopedRequest.idempotencyNamespace,
        reservationId: reservation.record.reservationId,
        operationFingerprint: scopedRequest.operationFingerprint,
        domainId: conversation.domain,
        runId,
        previousResponseId,
        retryOfMessageId: parsed.retryOfMessageId,
        userMessageId: parsed.userMessageId || `user-${Date.now()}`,
        appendUserMessage: !parsed.retryOfMessageId,
        stream: true,
        onModelToken: (chunk) => {
          if (chunk) {
            sendStreamEvent(res, {
              type: 'token',
              run_id: runId,
              conversation_id: conversation.id,
              delta: chunk,
            });
          }
        },
        planHint: parsed.planHint,
        preview: parsed.preview,
      });

      if (!res.writableEnded) {
        sendStreamEvent(res, {
          type: 'run.end',
          run_id: runId,
          conversation_id: conversation.id,
          response: finalResponse ?? null,
        });
        res.end();
      }
    } catch (error) {
      if (handleBodyReadError(res, error)) return;
      badRequest(
        res,
        error instanceof Error && error.message === 'Invalid JSON'
          ? 'Invalid JSON'
          : error instanceof Error
            ? error.message
            : 'Invalid chat request',
      );
    }
    return;
  }

  if (req.method === 'POST' && path === '/chat/send') {
    const auth = assertAuth(req, res);
    if (!auth) {
      return;
    }

    try {
      const principalId = getAuthenticatedPrincipalId(auth);
      const parsed = await parseChatSend(req, CHAT_SEND_BODY_LIMIT_BYTES);
      const conversation = ensureConversation(
        parsed.threadId,
        parsed.domainId,
        parsed.message.text.slice(0, 80),
        principalId,
      );
      upsertConversation({
        id: conversation.id,
        domain: conversation.domain,
        title: conversation.title,
        detail: conversation.detail,
      }, principalId);
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const scopedRequest = buildScopedChatRequest({
        principalId,
        conversationId: conversation.id,
        idempotencyKey: parsed.idempotencyKey,
        message: parsed.message.text,
        domainId: conversation.domain,
        operation: 'send',
        retryOfMessageId: parsed.retryOfMessageId,
        preview: parsed.preview,
      });
      const previousResponseId = resolveStoredPreviousResponseId({
        storedConversationResponseId: conversation.last_response_id,
      });
      const reservation = reserveScopedIdempotencyRecord(scopedRequest.idempotencyNamespace, {
        reservationId: randomUUID(),
        runId,
        conversationId: conversation.id,
        principalId,
        operationFingerprint: scopedRequest.operationFingerprint,
      });
      if (reservation.status !== 'reserved') {
        const existing = reservation.record;
        if (reservation.status === 'conflict') {
          conflict(res, 'Idempotency key already used for a different chat operation in this conversation.');
          return;
        }
        const prior = existing.messageId
          ? getConversation(existing.conversationId, principalId)?.messages.find((item) => item.id === existing.messageId)
          : null;
        if (reservation.status === 'completed' && prior) {
          const thread = getConversation(conversation.id, principalId);
          const cachedResponse: ChatRunResponse = {
            conversation_id: conversation.id,
            messages: [prior],
            thread: thread
              ? {
                  id: thread.id,
                  title: thread.title,
                  detail: thread.detail,
                }
              : {
                  id: conversation.id,
                  title: conversation.title,
                  detail: conversation.detail,
                },
            run: {
              id: existing.runId,
              status: 'completed' as const,
              needs_retry: false,
              aborted: false,
            },
            warnings: ['Idempotency key replayed; returned prior answer.'],
          };
          ok(res, cachedResponse);
          return;
        }
        conflict(res, 'An identical chat operation is already in progress for this conversation.');
        return;
      }

      const runMessageText = getRunMessageText(
        getConversation(conversation.id, principalId),
        parsed.retryOfMessageId,
        parsed.message.text,
      );

      const response = await runServerChat({
        principalId,
        conversationId: conversation.id,
        message: runMessageText,
        threadTitle: conversation.title,
        detail: conversation.detail,
        idempotencyKey: scopedRequest.scopedIdempotencyKey,
        idempotencyNamespace: scopedRequest.idempotencyNamespace,
        reservationId: reservation.record.reservationId,
        operationFingerprint: scopedRequest.operationFingerprint,
        domainId: conversation.domain,
        runId,
        previousResponseId,
        retryOfMessageId: parsed.retryOfMessageId,
        userMessageId: parsed.userMessageId || `user-${Date.now()}`,
        appendUserMessage: !parsed.retryOfMessageId,
        planHint: parsed.planHint,
        preview: parsed.preview,
      });

      ok(res, response);
    } catch (error) {
      if (handleBodyReadError(res, error)) return;
      badRequest(
        res,
        error instanceof Error && error.message === 'Invalid JSON'
          ? 'Invalid JSON'
          : error instanceof Error
            ? error.message
            : 'Invalid chat request',
      );
    }
    return;
  }

  if (req.method === 'POST' && path === '/chat/stop') {
    const auth = assertAuth(req, res);
    if (!auth) {
      return;
    }

    let payload: { run_id?: string };
    try {
      payload = (await readJsonBody(req, CHAT_CONTROL_BODY_LIMIT_BYTES)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return;
      badRequest(res, 'Invalid JSON');
      return;
    }

    if (!payload.run_id) {
      badRequest(res, 'run_id required');
      return;
    }

    const run = getRunState(payload.run_id);
    if (!run) {
      badRequest(res, 'Unknown run');
      return;
    }
    const principalId = getAuthenticatedPrincipalId(auth);
    if (run.principalId !== principalId) {
      badRequest(res, 'Unknown run');
      return;
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      ok(res, { run_id: payload.run_id, status: run.status });
      return;
    }
    activeRunControllers.get(payload.run_id)?.abort();
    setRunState(payload.run_id, {
      status: 'cancelled',
      conversationId: run.conversationId,
      principalId: run.principalId,
    });
    activeRunControllers.delete(payload.run_id);
    sendStopReply(res, payload.run_id, 'cancelled');
    return;
  }

  if (req.method === 'POST' && path === '/chat/retry') {
    const auth = assertAuth(req, res);
    if (!auth) {
      return;
    }

    let payload: {
      conversation_id?: string;
      user_message_id?: string;
      idempotency_key?: string;
      previous_response_id?: string;
    };
    try {
      payload = await readJsonBody(req, CHAT_CONTROL_BODY_LIMIT_BYTES);
    } catch (error) {
      if (handleBodyReadError(res, error)) return;
      badRequest(res, 'Invalid JSON');
      return;
    }

    if (!payload.conversation_id || !payload.user_message_id) {
      badRequest(res, 'conversation_id and user_message_id required');
      return;
    }

    const conversationId = payload.conversation_id;
    const userMessageId = payload.user_message_id;
    const principalId = getAuthenticatedPrincipalId(auth);
    const thread = getConversation(payload.conversation_id, principalId);
    if (!thread) {
      badRequest(res, 'conversation not found');
      return;
    }
    const target = thread.messages.find((message) => message.id === payload.user_message_id && message.role === 'user') as
      | ({ text: string } & { id: string; role: 'user' | 'assistant' })
      | undefined;
    if (!target) {
      badRequest(res, 'target user message not found');
      return;
    }
    const scopedRequest = buildScopedChatRequest({
      principalId,
      conversationId,
      idempotencyKey: payload.idempotency_key ?? `${conversationId}:${userMessageId}:retry`,
      message: target.text,
      domainId: thread.domain,
      operation: 'retry',
      retryOfMessageId: userMessageId,
      preview: false,
    });
    const retryRunId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reservation = reserveScopedIdempotencyRecord(scopedRequest.idempotencyNamespace, {
      reservationId: randomUUID(),
      runId: retryRunId,
      conversationId,
      principalId,
      operationFingerprint: scopedRequest.operationFingerprint,
    });
    if (reservation.status !== 'reserved') {
      const existing = reservation.record;
      if (reservation.status === 'conflict') {
        conflict(res, 'Idempotency key already used for a different retry operation in this conversation.');
        return;
      }
      const prior = existing.messageId
        ? getConversation(existing.conversationId, principalId)?.messages.find((item) => item.id === existing.messageId)
        : null;
      if (reservation.status === 'completed' && prior) {
        ok(res, {
          conversation_id: conversationId,
          messages: [prior],
          thread: {
            id: thread.id,
            title: thread.title,
            detail: thread.detail,
          },
          run: {
            id: existing.runId,
            status: 'completed' as const,
            needs_retry: false,
            aborted: false,
          },
          warnings: ['Idempotency key replayed; returned prior answer.'],
        } satisfies ChatRunResponse);
        return;
      }
      conflict(res, 'An identical retry operation is already in progress for this conversation.');
      return;
    }
    const previousResponseId = resolveStoredPreviousResponseId({
      storedConversationResponseId: thread.last_response_id,
    });

    const wrapped = await runServerChat({
      principalId,
      conversationId,
      message: target.text,
      threadTitle: thread.title,
      detail: thread.detail,
      idempotencyKey: scopedRequest.scopedIdempotencyKey,
      idempotencyNamespace: scopedRequest.idempotencyNamespace,
      reservationId: reservation.record.reservationId,
      operationFingerprint: scopedRequest.operationFingerprint,
      domainId: thread.domain,
      runId: retryRunId,
      previousResponseId,
      retryOfMessageId: userMessageId,
      userMessageId,
      appendUserMessage: false,
    });

    ok(res, wrapped);
    return;
  }

  if (req.method === 'POST' && path === '/chat/action') {
    const auth = assertAuth(req, res);
    if (!auth) {
      return;
    }

    let payload: { conversation_id?: string; action?: string; value?: string; domain_id?: string; command?: string; tool?: string; payload?: unknown; idempotency_key?: string; actor?: string };
    try {
      payload = await readJsonBody(req, CHAT_CONTROL_BODY_LIMIT_BYTES);
    } catch (error) {
      if (handleBodyReadError(res, error)) return;
      badRequest(res, 'Invalid JSON');
      return;
    }
    const requestedAction = typeof payload.action === 'string' ? payload.action.trim() : '';
    if (!payload?.conversation_id || !requestedAction) {
      badRequest(res, 'conversation_id and action required');
      return;
    }

    const principalId = getAuthenticatedPrincipalId(auth);
    const thread = getConversation(payload.conversation_id, principalId);
    if (!thread) {
      badRequest(res, 'conversation not found');
      return;
    }

    if (requestedAction === 'propose') {
      const command = typeof payload.command === 'string' ? payload.command.trim() : '';
      const tool = typeof payload.tool === 'string' ? payload.tool.trim() : '';
      const normalizedCommand = command || tool;
      if (!normalizedCommand) {
        badRequest(res, 'command or tool required for propose');
        return;
      }

      const actor = typeof payload.actor === 'string' && payload.actor.trim() ? payload.actor.trim() : 'ui-package';
      const actionEvent = createActionEvent({
        id: randomUUID(),
        actor,
        domain: payload.domain_id?.trim() || thread.domain,
        tool: tool || normalizedCommand,
        risk: 'low',
        recordIds: [],
        idempotencyKey: typeof payload.idempotency_key === 'string' ? payload.idempotency_key.trim() : undefined,
        command: normalizedCommand,
        before: payload.payload,
        conversationId: thread.id,
      });

      ok(res, {
        action: requestedAction,
        status: 'ok',
        action_event: actionEvent,
      });
      return;
    }

    const nextTitle =
      requestedAction === 'rename' && typeof payload.value === 'string' && payload.value.trim()
        ? payload.value.slice(0, 80)
        : thread.title;
    const nextDetail =
      requestedAction === 'pin'
        ? `${thread.detail} · pinned`
        : requestedAction === 'archive'
          ? `${thread.detail} · archived`
          : thread.detail;

    const next = upsertConversation({
      id: thread.id,
      domain: payload.domain_id || thread.domain,
      title: nextTitle || thread.title,
      detail: nextDetail,
    }, principalId);

    ok(res, {
      action: requestedAction,
      status: 'ok',
      conversation: { id: next.id, title: next.title, detail: next.detail },
    });
    return;
  }

  if (req.method === 'POST' && path === '/chat/undo') {
    const auth = assertAuth(req, res);
    if (!auth) {
      return;
    }

    let payload: { action_id?: string; idempotency_key?: string; actor?: string };
    try {
      payload = await readJsonBody(req, CHAT_CONTROL_BODY_LIMIT_BYTES);
    } catch (error) {
      if (handleBodyReadError(res, error)) return;
      badRequest(res, 'Invalid JSON');
      return;
    }

    const actionId = typeof payload.action_id === 'string' ? payload.action_id.trim() : '';
    if (!actionId) {
      badRequest(res, 'action_id required');
      return;
    }

    const action = getActionEvent(actionId);
    if (!action) {
      badRequest(res, 'action not found');
      return;
    }
    const principalId = getAuthenticatedPrincipalId(auth);
    if (action.conversation_id && !getConversation(action.conversation_id, principalId)) {
      badRequest(res, 'action not found');
      return;
    }

    if (action.status === 'undone') {
      ok(res, {
        status: 'completed',
        action_id: actionId,
        action,
        undo_result: {
          success: true,
          message: 'Action already undone',
          replayed: true,
          actor: payload.actor?.trim() || 'hearth',
          idempotency_key: typeof payload.idempotency_key === 'string' ? payload.idempotency_key : undefined,
        },
      });
      return;
    }

    const result = runUndo(actionId);
    if (!result.success) {
      badRequest(res, result.message);
      return;
    }

    ok(res, {
      status: 'completed',
      action_id: actionId,
      action: result.action,
      undo_result: {
        success: result.success,
        message: result.message,
        actor: payload.actor?.trim() || 'hearth',
        idempotency_key: typeof payload.idempotency_key === 'string' ? payload.idempotency_key : undefined,
      },
    });
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
