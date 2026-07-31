import { randomUUID } from 'node:crypto';
import {
  badRequest,
  conflict,
  handleBodyReadError,
  ok,
  RequestHeaderTooLargeError,
  PayloadTooLargeError,
  RequestTimeoutError,
} from '../http-utils';
import { type RequestAuthorizationResult } from '../security/auth';
import {
  buildChatOperationFingerprint,
  normalizeChatSendRequest,
  resolveStoredPreviousResponseId,
  scopeChatIdempotencyNamespace,
  scopeChatOperationIdempotencyKey,
  type ChatSendRequest,
  type NormalizedChatSend,
} from '../chat';
import { ChatStreamEvent } from '../responses';
import type { ChatControlService, ChatRunResponse } from '../services/chat-control-service';

type ChatConversationSummary = {
  id: string;
  domain: string;
  title: string;
  detail: string;
};

type ChatConversation = ChatConversationSummary & {
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant';
    text: string;
  }>;
  last_response_id?: string | null;
};

type RunningConversationRun = {
  run: {
    status: string;
  };
  runId: string;
};

type ChatRoutesContext = {
  assertAuth: (req: any, res: any) => RequestAuthorizationResult | null;
  getAuthenticatedPrincipalId: (auth: RequestAuthorizationResult) => string;
  listConversations: (principalId: string) => ChatConversationSummary[];
  findRunningConversationRun: (
    principalId: string,
    conversationId: string,
    runId?: string,
  ) => RunningConversationRun | null;
  getConversation: (threadId: string, principalId: string) => ChatConversation | null | undefined;
  ensureConversation: (
    threadId: string,
    domain: string,
    title: string,
    principalId: string,
  ) => ChatConversation;
  upsertConversation: (
    input: {
      id: string;
      domain: string;
      title: string;
      detail: string;
    },
    principalId: string,
  ) => ChatConversation;
  resolveStoredPreviousResponseId: (input: {
    storedConversationResponseId?: string;
    cachedConversationResponseId?: string;
  }) => string | undefined;
  readJsonBody: (req: any, maxBytes: number) => Promise<Record<string, unknown>>;
  chatControlService: ChatControlService;
  chatSendBodyLimitBytes?: number;
};

type ScopedChatRequest = {
  conversationRunKey: string;
  idempotencyNamespace: string;
  scopedIdempotencyKey: string;
  operationFingerprint: string;
};

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
}): ScopedChatRequest {
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

const CHAT_SEND_BODY_LIMIT_BYTES = 256 * 1024;

function getQuery(req: any) {
  return new URL(req.url ?? '/', 'http://127.0.0.1');
}

function sendStreamEvent(res: any, event: ChatStreamEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function parseChatSend(
  req: any,
  maxBytes: number,
  readBody: ChatRoutesContext['readJsonBody'],
): Promise<NormalizedChatSend> {
  let payload: ChatSendRequest;
  try {
    payload = (await readBody(req, maxBytes)) as ChatSendRequest;
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
  thread: ReturnType<ChatRoutesContext['getConversation']>,
  retryOfMessageId: string | undefined,
  fallbackText: string,
) {
  if (!retryOfMessageId || !thread) {
    return fallbackText;
  }

  const target = thread.messages?.find((message) => message.id === retryOfMessageId);
  if (!target) {
    return fallbackText;
  }

  return target.text;
}

function findCachedMessage(
  getConversation: ChatRoutesContext['getConversation'],
  principalId: string,
  record: {
    conversationId: string;
    messageId: string | null;
  },
): ChatRunResponse['messages'][number] | null {
  if (!record.messageId) {
    return null;
  }
  return getConversation(record.conversationId, principalId)?.messages?.find((item) => item.id === record.messageId) ?? null;
}

function createCachedSendResponse(input: {
  conversationId: string;
  conversation: ChatConversation;
  principalId: string;
  getConversation: ChatRoutesContext['getConversation'];
  existing: {
    runId: string;
    messageId: string;
  };
}): ChatRunResponse {
  const thread = input.getConversation(input.conversationId, input.principalId);
  const priorMessage = thread?.messages?.find((message) => message.id === input.existing.messageId);
  return {
    conversation_id: input.conversationId,
    messages: [
      {
        id: input.existing.messageId,
        role: 'assistant',
        text: priorMessage?.text ?? '',
      },
    ],
    thread: thread
      ? {
          id: thread.id,
          title: thread.title,
          detail: thread.detail,
        }
      : {
          id: input.conversation.id,
          title: input.conversation.title,
          detail: input.conversation.detail,
        },
    run: {
      id: input.existing.runId,
      status: 'completed',
      needs_retry: false,
      aborted: false,
    },
    warnings: ['Idempotency key replayed; returned prior answer.'],
  };
}

async function handleChatSendRoutes(
  req: any,
  res: any,
  path: string,
  context: ChatRoutesContext,
): Promise<boolean> {
  const sendMode = path === '/chat/send/stream' ? 'stream' : path === '/chat/send' ? 'send' : null;
  if (!sendMode || req.method !== 'POST') {
    return false;
  }

  const auth = context.assertAuth(req, res);
  if (!auth) {
    return true;
  }

  const principalId = context.getAuthenticatedPrincipalId(auth);
  try {
    const parsed = await parseChatSend(req, context.chatSendBodyLimitBytes ?? CHAT_SEND_BODY_LIMIT_BYTES, context.readJsonBody);
    const conversation = context.ensureConversation(
      parsed.threadId,
      parsed.domainId,
      parsed.message.text.slice(0, 80),
      principalId,
    );
    context.upsertConversation({
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
      operation: sendMode,
      retryOfMessageId: parsed.retryOfMessageId,
      preview: parsed.preview,
    });

    const previousResponseId = resolveStoredPreviousResponseId({
      storedConversationResponseId: conversation.last_response_id ?? undefined,
    });

    const reservation = context.chatControlService.reserveScopedIdempotencyRecord(scopedRequest.idempotencyNamespace, {
      reservationId: randomUUID(),
      runId,
      conversationId: conversation.id,
      principalId,
      operationFingerprint: scopedRequest.operationFingerprint,
    });

    if (reservation.status !== 'reserved') {
      const prior = findCachedMessage(context.getConversation, principalId, reservation.record);
      if (reservation.status === 'completed' && prior) {
        const cachedResponse = createCachedSendResponse({
          conversationId: conversation.id,
          conversation,
          principalId,
          getConversation: context.getConversation,
          existing: {
            runId: reservation.record.runId,
            messageId: prior.id,
          },
        });
        if (sendMode === 'stream') {
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
          return true;
        }
        ok(res, cachedResponse);
        return true;
      }
      if (reservation.status === 'conflict') {
        conflict(res, 'Idempotency key already used for a different chat operation in this conversation.');
        return true;
      }
      if (sendMode === 'stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        sendStreamEvent(res, {
          type: 'error',
          conversation_id: conversation.id,
          error: 'An identical chat operation is already in progress for this conversation.',
        });
        res.end();
        return true;
      }
      conflict(res, 'An identical chat operation is already in progress for this conversation.');
      return true;
    }

    if (sendMode === 'stream') {
      const existingRun = context.findRunningConversationRun(principalId, conversation.id, runId);
      if (existingRun) {
        context.chatControlService.markRunFailed({ runId, conversationId: conversation.id, principalId });
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
        return true;
      }

      const runMessageText = getRunMessageText(
        context.getConversation(conversation.id, principalId),
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

      const finalResponse = await context.chatControlService.execute({
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
      return true;
    }

    const runMessageText = getRunMessageText(
      context.getConversation(conversation.id, principalId),
      parsed.retryOfMessageId,
      parsed.message.text,
    );

    const response = await context.chatControlService.execute({
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
    return true;
  } catch (error) {
    if (handleBodyReadError(res, error)) {
      return true;
    }
    badRequest(
      res,
      error instanceof Error && error.message === 'Invalid JSON'
        ? 'Invalid JSON'
        : error instanceof Error
          ? error.message
          : 'Invalid chat request',
    );
    return true;
  }
}

export async function handleChatQueryRoutes(
  req: any,
  res: any,
  path: string,
  context: ChatRoutesContext,
): Promise<boolean> {
  if (!path.startsWith('/chat')) {
    return false;
  }

  if (req.method === 'GET' && path === '/chat/threads') {
    const auth = context.assertAuth(req, res);
    if (!auth) {
      return true;
    }
    const query = getQuery(req);
    const domain = query.searchParams.get('domain');
    const principalId = context.getAuthenticatedPrincipalId(auth);
    const rows = context.listConversations(principalId);
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
    return true;
  }

  if (req.method === 'GET' && path === '/chat/run') {
    const auth = context.assertAuth(req, res);
    if (!auth) {
      return true;
    }
    const query = getQuery(req);
    const conversationId = query.searchParams.get('conversation_id');
    if (!conversationId) {
      badRequest(res, 'conversation_id required');
      return true;
    }
    const principalId = context.getAuthenticatedPrincipalId(auth);
    const activeRun = context.findRunningConversationRun(principalId, conversationId);
    if (!activeRun) {
      ok(res, {
        conversation_id: conversationId,
        active: false,
        status: 'idle',
        run_id: null,
      });
      return true;
    }
    ok(res, {
      conversation_id: conversationId,
      active: true,
      status: activeRun.run.status,
      run_id: activeRun.runId,
    });
    return true;
  }

  if (req.method === 'GET' && path.startsWith('/chat/threads/')) {
    const auth = context.assertAuth(req, res);
    if (!auth) {
      return true;
    }
    const parts = path.split('/');
    const threadId = parts[parts.length - 1];
    const principalId = context.getAuthenticatedPrincipalId(auth);
    const thread = context.getConversation(threadId, principalId);
    if (!thread) {
      badRequest(res, 'thread not found');
      return true;
    }
    ok(res, thread);
    return true;
  }

  return false;
}

export async function handleChatRoutes(
  req: any,
  res: any,
  path: string,
  context: ChatRoutesContext,
): Promise<boolean> {
  if (await handleChatSendRoutes(req, res, path, context)) {
    return true;
  }
  if (path.startsWith('/chat')) {
    return handleChatQueryRoutes(req, res, path, context);
  }
  return false;
}
