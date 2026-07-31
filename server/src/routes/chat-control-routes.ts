import { badRequest, conflict, handleBodyReadError, ok } from '../http-utils';
import { type RequestAuthorizationResult } from '../security/auth';
import { createChatControlRepository, type ChatControlRepository } from '../repositories/chat-control-repository';
import { createChatControlService, type ChatControlService, type RunServerChat } from '../services/chat-control-service';

type LegacyContext = {
  getRunState: ChatControlRepository['getRunState'];
  setRunState: ChatControlRepository['setRunState'];
  getRunController: ChatControlRepository['getRunController'];
  clearRunController: ChatControlRepository['clearRunController'];
  getConversation: ChatControlRepository['getConversation'];
  upsertConversation: ChatControlRepository['upsertConversation'];
  buildScopedChatRequest: ChatControlRepository['buildScopedChatRequest'];
  reserveScopedIdempotencyRecord: ChatControlRepository['reserveScopedIdempotencyRecord'];
  resolveStoredPreviousResponseId: ChatControlRepository['resolveStoredPreviousResponseId'];
  runServerChat: RunServerChat;
};

export type ChatControlRoutesContext = {
  assertAuth: (req: any, res: any) => RequestAuthorizationResult | null;
  readJsonBody: (req: any, maxBytes: number) => Promise<Record<string, unknown>>;
  getAuthenticatedPrincipalId: (auth: RequestAuthorizationResult) => string;
  chatControlBodyLimitBytes: number;
  chatControlService?: ChatControlService;
} & Partial<LegacyContext>;

function getService(context: ChatControlRoutesContext): ChatControlService {
  if (context.chatControlService) return context.chatControlService;
  const legacy = context as ChatControlRoutesContext & Partial<LegacyContext>;
  if (
    !legacy.getRunState
    || !legacy.setRunState
    || !legacy.getRunController
    || !legacy.clearRunController
    || !legacy.getConversation
    || !legacy.upsertConversation
    || !legacy.buildScopedChatRequest
    || !legacy.reserveScopedIdempotencyRecord
    || !legacy.resolveStoredPreviousResponseId
    || !legacy.runServerChat
  ) {
    throw new Error('chat-control service is not configured');
  }
  return createChatControlService({
    repository: createChatControlRepository({
      getRunState: legacy.getRunState,
      setRunState: legacy.setRunState,
      getRunController: legacy.getRunController,
      clearRunController: legacy.clearRunController,
      getConversation: legacy.getConversation,
      upsertConversation: legacy.upsertConversation,
      buildScopedChatRequest: legacy.buildScopedChatRequest,
      reserveScopedIdempotencyRecord: legacy.reserveScopedIdempotencyRecord,
      resolveStoredPreviousResponseId: legacy.resolveStoredPreviousResponseId,
    }),
    runServerChat: legacy.runServerChat,
  });
}

async function readControlBody(
  req: any,
  res: any,
  context: ChatControlRoutesContext,
): Promise<Record<string, unknown> | null> {
  try {
    return await context.readJsonBody(req, context.chatControlBodyLimitBytes);
  } catch (error) {
    if (handleBodyReadError(res, error)) return null;
    badRequest(res, 'Invalid JSON');
    return null;
  }
}

export async function handleChatControlRoutes(
  req: any,
  res: any,
  path: string,
  context: ChatControlRoutesContext,
): Promise<boolean> {
  if (req.method !== 'POST' || !['/chat/stop', '/chat/retry', '/chat/action', '/chat/undo'].includes(path)) {
    return false;
  }

  const auth = context.assertAuth(req, res);
  if (!auth) return true;
  const principalId = context.getAuthenticatedPrincipalId(auth);
  const service = getService(context);
  const payload = await readControlBody(req, res, context);
  if (!payload) return true;

  if (path === '/chat/stop') {
    const runId = typeof payload.run_id === 'string' ? payload.run_id.trim() : '';
    if (!runId) {
      badRequest(res, 'run_id required');
      return true;
    }
    const result = service.stop({ principalId, runId });
    if (result.kind === 'bad_request') {
      badRequest(res, result.message);
      return true;
    }
    if (result.kind === 'already_terminal') {
      ok(res, { run_id: runId, status: result.status });
      return true;
    }
    ok(res, {
      run_id: runId,
      status: 'cancelled',
      conversation_id: result.run.conversationId,
      run_status: 'cancelled',
    });
    return true;
  }

  if (path === '/chat/retry') {
    const conversationId = typeof payload.conversation_id === 'string' ? payload.conversation_id.trim() : '';
    const userMessageId = typeof payload.user_message_id === 'string' ? payload.user_message_id.trim() : '';
    if (!conversationId || !userMessageId) {
      badRequest(res, 'conversation_id and user_message_id required');
      return true;
    }
    const result = await service.retry({
      principalId,
      conversationId,
      userMessageId,
      idempotencyKey: typeof payload.idempotency_key === 'string' ? payload.idempotency_key : undefined,
    });
    if (result.kind === 'bad_request') {
      badRequest(res, result.message);
      return true;
    }
    if (result.kind === 'conflict') {
      conflict(res, result.message);
      return true;
    }
    ok(res, result.response);
    return true;
  }

  if (path === '/chat/action') {
    const conversationId = typeof payload.conversation_id === 'string' ? payload.conversation_id.trim() : '';
    const requestedAction = typeof payload.action === 'string' ? payload.action.trim() : '';
    if (!conversationId || !requestedAction) {
      badRequest(res, 'conversation_id and action required');
      return true;
    }
    const result = service.action({
      principalId,
      conversationId,
      requestedAction,
      command: typeof payload.command === 'string' ? payload.command : undefined,
      tool: typeof payload.tool === 'string' ? payload.tool : undefined,
      actor: typeof payload.actor === 'string' ? payload.actor : undefined,
      idempotencyKey: typeof payload.idempotency_key === 'string' ? payload.idempotency_key : undefined,
      domainId: typeof payload.domain_id === 'string' ? payload.domain_id : undefined,
      payload: payload.payload,
      value: typeof payload.value === 'string' ? payload.value : undefined,
    });
    if (result.kind === 'bad_request') {
      badRequest(res, result.message);
      return true;
    }
    ok(res, result.body);
    return true;
  }

  const actionId = typeof payload.action_id === 'string' ? payload.action_id.trim() : '';
  if (!actionId) {
    badRequest(res, 'action_id required');
    return true;
  }
  const result = service.undo({
    principalId,
    actionId,
    actor: typeof payload.actor === 'string' ? payload.actor : undefined,
    idempotencyKey: typeof payload.idempotency_key === 'string' ? payload.idempotency_key : undefined,
  });
  if (result.kind === 'bad_request') {
    badRequest(res, result.message);
    return true;
  }
  ok(res, result.body);
  return true;
}
