import { randomUUID } from 'node:crypto';
import { handleServerChat, type ServerChatResponse } from '../chat';
import type { ScopedIdempotencyReservationResult } from '../chat-runtime-state';
import {
  type ChatControlRepository,
  type ChatConversation,
  type ChatRunState,
} from '../repositories/chat-control-repository';

export type ChatExecutionInput = {
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
  onModelToken?: (chunk: string) => void;
  planHint?: string;
  preview?: boolean;
};

export type RunServerChat = (input: ChatExecutionInput) => Promise<ServerChatResponse>;

export type ChatRunResponse = Awaited<ReturnType<typeof handleServerChat>>;

export type ChatControlService = ReturnType<typeof createChatControlService>;

function newRunId() {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createChatControlService(input: {
  repository: ChatControlRepository;
  runServerChat?: RunServerChat;
  handleServerChat?: typeof handleServerChat;
}) {
  const { repository } = input;

  const executeChat: RunServerChat = input.runServerChat ?? (async (params) => {
    const controller = new AbortController();
    repository.setRunController(params.runId, controller);
    repository.setRunState(params.runId, {
      status: 'running',
      conversationId: params.conversationId,
      principalId: params.principalId,
    });

    if (params.appendUserMessage !== false) {
      repository.appendServerMessage(params.conversationId, {
        id: params.userMessageId,
        role: 'user',
        text: params.message,
      }, params.principalId);
    }

    let response: ChatRunResponse | null = null;
    try {
      response = await (input.handleServerChat ?? handleServerChat)({
        conversationId: params.conversationId,
        principalId: params.principalId,
        message: params.message,
        threadTitle: params.threadTitle,
        idempotencyKey: params.idempotencyKey,
        domainId: params.domainId,
        runId: params.runId,
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
        conversation_id: params.conversationId,
        messages: [{ id: `server-${Date.now()}-asst`, role: 'assistant', text: 'I could not complete this response.', answer: undefined }],
        thread: { id: params.conversationId, title: params.threadTitle, detail: params.detail },
        warnings: ['Server runtime failed.'],
        run: { id: params.runId, status: 'failed', needs_retry: true, aborted: false },
      };
    }

    if (!response) {
      response = {
        conversation_id: params.conversationId,
        messages: [],
        thread: { id: params.conversationId, title: params.threadTitle, detail: params.detail },
        warnings: ['Server runtime produced no response.'],
        run: { id: params.runId, status: 'failed', needs_retry: true, aborted: false },
      };
    }

    const terminalRunStatus = response.run?.status
      ? response.run.status === 'canceled'
        ? 'cancelled'
        : response.run.status === 'completed' ? 'completed' : 'failed'
      : response.messages.length ? 'completed' : 'failed';
    repository.setRunState(params.runId, {
      status: terminalRunStatus,
      conversationId: params.conversationId,
      principalId: params.principalId,
    });
    for (const message of response.messages) {
      repository.appendServerMessage(params.conversationId, message, params.principalId);
    }
    const replayMessage = response.messages.at(-1);
    if (replayMessage) {
      repository.completeScopedIdempotencyReservation(params.idempotencyNamespace, {
        reservationId: params.reservationId,
        messageId: replayMessage.id,
      });
    }
    if (response.run?.previous_response_id) {
      repository.setConversationResponseId(params.conversationId, response.run.previous_response_id, params.principalId);
    }
    repository.clearRunController(params.runId);
    response.thread = { id: params.conversationId, title: params.threadTitle, detail: params.detail };
    return response;
  });

  async function retry(input: {
    principalId: string;
    conversationId: string;
    userMessageId: string;
    idempotencyKey?: string;
  }): Promise<
    | { kind: 'bad_request'; message: string }
    | { kind: 'conflict'; message: string }
    | { kind: 'ok'; response: ServerChatResponse }
  > {
    const thread = repository.getConversation(input.conversationId, input.principalId);
    if (!thread) {
      return { kind: 'bad_request', message: 'conversation not found' };
    }
    const target = thread.messages?.find((message) => message.id === input.userMessageId && message.role === 'user');
    if (!target) {
      return { kind: 'bad_request', message: 'target user message not found' };
    }

    const scopedRequest = repository.buildScopedChatRequest({
      principalId: input.principalId,
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey ?? `${input.conversationId}:${input.userMessageId}:retry`,
      message: target.text,
      domainId: thread.domain,
      operation: 'retry',
      retryOfMessageId: input.userMessageId,
      preview: false,
    });
    const retryRunId = newRunId();
    const reservation = repository.reserveScopedIdempotencyRecord(scopedRequest.idempotencyNamespace, {
      reservationId: randomUUID(),
      runId: retryRunId,
      conversationId: input.conversationId,
      principalId: input.principalId,
      operationFingerprint: scopedRequest.operationFingerprint,
    });

    if (reservation.status !== 'reserved') {
      const existing = reservation.record;
      if (reservation.status === 'conflict') {
        return { kind: 'conflict', message: 'Idempotency key already used for a different retry operation in this conversation.' };
      }
      const prior = existing.messageId
        ? (repository.getConversation(existing.conversationId, input.principalId)?.messages ?? [])
            .find((message) => message.id === existing.messageId)
        : null;
      if (reservation.status === 'completed' && prior) {
        return {
          kind: 'ok',
          response: {
            conversation_id: input.conversationId,
            messages: [prior],
            thread: { id: thread.id, title: thread.title, detail: thread.detail },
            run: { id: existing.runId, status: 'completed', needs_retry: false, aborted: false },
            warnings: ['Idempotency key replayed; returned prior answer.'],
          },
        };
      }
      return { kind: 'conflict', message: 'An identical retry operation is already in progress for this conversation.' };
    }

    const response = await executeChat({
      principalId: input.principalId,
      conversationId: input.conversationId,
      message: target.text,
      threadTitle: thread.title,
      detail: thread.detail,
      idempotencyKey: scopedRequest.scopedIdempotencyKey,
      idempotencyNamespace: scopedRequest.idempotencyNamespace,
      reservationId: reservation.record.reservationId,
      operationFingerprint: scopedRequest.operationFingerprint,
      domainId: thread.domain,
      runId: retryRunId,
      previousResponseId: repository.resolveStoredPreviousResponseId({
        storedConversationResponseId: thread.last_response_id,
      }),
      retryOfMessageId: input.userMessageId,
      userMessageId: input.userMessageId,
      appendUserMessage: false,
    });
    return { kind: 'ok', response };
  }

  function stop(input: { principalId: string; runId: string }):
    | { kind: 'bad_request'; message: 'Unknown run' }
    | { kind: 'already_terminal'; status: ChatRunState['status'] }
    | { kind: 'cancelled'; run: ChatRunState } {
    const run = repository.getRunState(input.runId);
    if (!run || run.principalId !== input.principalId) {
      return { kind: 'bad_request', message: 'Unknown run' };
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return { kind: 'already_terminal', status: run.status };
    }
    repository.getRunController(input.runId)?.abort();
    const cancelled = repository.setRunState(input.runId, {
      status: 'cancelled',
      conversationId: run.conversationId,
      principalId: run.principalId,
    });
    repository.clearRunController(input.runId);
    return { kind: 'cancelled', run: cancelled };
  }

  function markRunFailed(input: { runId: string; conversationId: string; principalId: string }) {
    return repository.setRunState(input.runId, {
      status: 'failed',
      conversationId: input.conversationId,
      principalId: input.principalId,
    });
  }

  function reserveScopedIdempotencyRecord(
    namespace: string,
    reservation: Parameters<ChatControlRepository['reserveScopedIdempotencyRecord']>[1],
  ): ScopedIdempotencyReservationResult {
    return repository.reserveScopedIdempotencyRecord(namespace, reservation);
  }

  function action(input: {
    principalId: string;
    conversationId: string;
    requestedAction: string;
    command?: string;
    tool?: string;
    actor?: string;
    idempotencyKey?: string;
    domainId?: string;
    payload?: unknown;
    value?: string;
  }):
    | { kind: 'bad_request'; message: string }
    | { kind: 'ok'; body: Record<string, unknown> } {
    const thread = repository.getConversation(input.conversationId, input.principalId);
    if (!thread) return { kind: 'bad_request', message: 'conversation not found' };

    if (input.requestedAction === 'propose') {
      const normalizedCommand = input.command?.trim() || input.tool?.trim();
      if (!normalizedCommand) return { kind: 'bad_request', message: 'command or tool required for propose' };
      const actor = input.actor?.trim() || 'ui-package';
      const actionEvent = repository.createActionEvent({
        id: randomUUID(),
        actor,
        domain: input.domainId?.trim() || thread.domain,
        tool: input.tool?.trim() || normalizedCommand,
        risk: 'low',
        recordIds: [],
        idempotencyKey: input.idempotencyKey,
        command: normalizedCommand,
        before: input.payload,
        conversationId: thread.id,
      });
      return { kind: 'ok', body: { action: input.requestedAction, status: 'ok', action_event: actionEvent } };
    }

    const next = repository.upsertConversation({
      id: thread.id,
      domain: input.domainId?.trim() || thread.domain,
      title: input.requestedAction === 'rename' && input.value?.trim() ? input.value.slice(0, 80) : thread.title,
      detail: input.requestedAction === 'pin'
        ? `${thread.detail} · pinned`
        : input.requestedAction === 'archive'
          ? `${thread.detail} · archived`
          : thread.detail,
    }, input.principalId);
    return {
      kind: 'ok',
      body: {
        action: input.requestedAction,
        status: 'ok',
        conversation: { id: next.id, title: next.title, detail: next.detail },
      },
    };
  }

  function undo(input: { principalId: string; actionId: string; actor?: string; idempotencyKey?: string }):
    | { kind: 'bad_request'; message: string }
    | { kind: 'ok'; body: Record<string, unknown> } {
    const action = repository.getActionEvent(input.actionId);
    if (!action) return { kind: 'bad_request', message: 'action not found' };
    if (action.conversation_id && !repository.getConversation(action.conversation_id, input.principalId)) {
      return { kind: 'bad_request', message: 'action not found' };
    }
    const actor = input.actor?.trim() || 'hearth';
    if (action.status === 'undone') {
      return {
        kind: 'ok',
        body: {
          status: 'completed',
          action_id: input.actionId,
          action,
          undo_result: { success: true, message: 'Action already undone', replayed: true, actor, idempotency_key: input.idempotencyKey },
        },
      };
    }
    const result = repository.runUndo(input.actionId);
    if (!result.success) return { kind: 'bad_request', message: result.message };
    return {
      kind: 'ok',
      body: {
        status: 'completed',
        action_id: input.actionId,
        action: result.action,
        undo_result: { success: true, message: result.message, actor, idempotency_key: input.idempotencyKey },
      },
    };
  }

  return { execute: executeChat, retry, stop, action, undo, markRunFailed, reserveScopedIdempotencyRecord };
}
