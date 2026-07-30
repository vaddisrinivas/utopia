import { randomUUID } from 'node:crypto';
import { badRequest, conflict, handleBodyReadError, ok } from '../http-utils';
import { type RequestAuthorizationResult } from '../security/auth';
import { type ServerChatResponse } from '../chat';
import { type ScopedIdempotencyReservationResult } from '../chat-runtime-state';

type ChatConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type ChatConversation = {
  id: string;
  domain: string;
  title: string;
  detail: string;
  messages?: Array<ChatConversationMessage>;
  last_response_id?: string;
};

type ChatRunState = {
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  conversationId: string;
  principalId: string;
};

type ChatScopedChatRequest = {
  conversationRunKey: string;
  idempotencyNamespace: string;
  scopedIdempotencyKey: string;
  operationFingerprint: string;
};

type ChatControlRoutesContext = {
  assertAuth: (req: any, res: any) => RequestAuthorizationResult | null;
  readJsonBody: (req: any, maxBytes: number) => Promise<Record<string, unknown>>;
  getAuthenticatedPrincipalId: (auth: RequestAuthorizationResult) => string;
  getRunState: (runId: string) => ChatRunState | null;
  setRunState: (
    runId: string,
    state: { status: ChatRunState['status']; conversationId: string; principalId: string },
  ) => ChatRunState;
  getRunController: (runId: string) => AbortController | undefined;
  clearRunController: (runId: string) => void;
  chatControlBodyLimitBytes: number;
  getConversation: (conversationId: string, principalId: string) => ChatConversation | null | undefined;
  buildScopedChatRequest: (input: {
    principalId: string;
    conversationId: string;
    idempotencyKey: string;
    message: string;
    domainId: string;
    operation: 'retry';
    retryOfMessageId?: string;
    preview: boolean;
  }) => ChatScopedChatRequest;
  reserveScopedIdempotencyRecord: (
    namespace: string,
    input: {
      reservationId: string;
      runId: string;
      conversationId: string;
      principalId: string;
      operationFingerprint: string;
    },
  ) => ScopedIdempotencyReservationResult;
  resolveStoredPreviousResponseId: (input: {
    storedConversationResponseId?: string;
    cachedConversationResponseId?: string;
  }) => string | undefined;
  runServerChat: (input: {
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
    appendUserMessage: boolean;
  }) => Promise<ServerChatResponse>;
};

function sendStopReply(res: any, runId: string, run: ChatRunState) {
  ok(res, {
    run_id: runId,
    status: 'cancelled',
    conversation_id: run.conversationId,
    run_status: 'cancelled',
  });
}

async function handleChatRetryRoute(req: any, res: any, context: ChatControlRoutesContext, principalId: string) {
  let payload: {
    conversation_id?: string;
    user_message_id?: string;
    idempotency_key?: string;
    previous_response_id?: string;
  };

  try {
    payload = (await context.readJsonBody(req, context.chatControlBodyLimitBytes)) as typeof payload;
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
  const thread = context.getConversation(conversationId, principalId);
  if (!thread) {
    badRequest(res, 'conversation not found');
    return;
  }

  const target = thread.messages?.find((message) => message.id === payload.user_message_id && message.role === 'user');
  if (!target) {
    badRequest(res, 'target user message not found');
    return;
  }

  const scopedRequest = context.buildScopedChatRequest({
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
  const reservation = context.reserveScopedIdempotencyRecord(scopedRequest.idempotencyNamespace, {
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
      ? (context.getConversation(existing.conversationId, principalId)?.messages ?? []).find((item) => item.id === existing.messageId)
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
      } satisfies ServerChatResponse);
      return;
    }
    conflict(res, 'An identical retry operation is already in progress for this conversation.');
    return;
  }

  const previousResponseId = context.resolveStoredPreviousResponseId({
    storedConversationResponseId: thread.last_response_id,
  });

  const wrapped = await context.runServerChat({
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
}

export async function handleChatControlRoutes(
  req: any,
  res: any,
  path: string,
  context: ChatControlRoutesContext,
): Promise<boolean> {
  if (req.method !== 'POST') {
    return false;
  }

  if (path === '/chat/stop') {
    const auth = context.assertAuth(req, res);
    if (!auth) {
      return true;
    }

    let payload: { run_id?: string };
    try {
      payload = (await context.readJsonBody(req, context.chatControlBodyLimitBytes)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }

    if (!payload.run_id) {
      badRequest(res, 'run_id required');
      return true;
    }

    const run = context.getRunState(payload.run_id);
    if (!run) {
      badRequest(res, 'Unknown run');
      return true;
    }

    const principalId = context.getAuthenticatedPrincipalId(auth);
    if (run.principalId !== principalId) {
      badRequest(res, 'Unknown run');
      return true;
    }

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      ok(res, { run_id: payload.run_id, status: run.status });
      return true;
    }

    context.getRunController(payload.run_id)?.abort();
    context.setRunState(payload.run_id, {
      status: 'cancelled',
      conversationId: run.conversationId,
      principalId: run.principalId,
    });
    context.clearRunController(payload.run_id);
    sendStopReply(res, payload.run_id, run);
    return true;
  }

  if (path !== '/chat/retry') {
    return false;
  }

  const auth = context.assertAuth(req, res);
  if (!auth) {
    return true;
  }

  const principalId = context.getAuthenticatedPrincipalId(auth);
  await handleChatRetryRoute(req, res, context, principalId);
  return true;
}
