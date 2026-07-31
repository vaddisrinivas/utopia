import assert from 'node:assert/strict';
import { createChatControlService } from '../src/services/chat-control-service';
import type { ChatControlRepository, ChatRunState } from '../src/repositories/chat-control-repository';

const conversation = {
  id: 'thread-1',
  domain: 'food',
  title: 'Food',
  detail: 'Food thread',
  last_response_id: 'response-1',
  messages: [{ id: 'user-1', role: 'user' as const, text: 'Find milk' }],
};

let run: ChatRunState = {
  status: 'running',
  conversationId: conversation.id,
  principalId: 'principal-1',
};
let aborted = false;
let cleared = false;
let actionInput: Record<string, unknown> | null = null;
let undoCalls = 0;

const repository: ChatControlRepository = {
  getRunState: (runId) => runId === 'run-1' ? run : null,
  setRunState: (_runId, next) => {
    run = next;
    return run;
  },
  getRunController: (runId) => runId === 'run-1' ? { abort: () => { aborted = true; } } as AbortController : undefined,
  setRunController: () => {},
  clearRunController: () => { cleared = true; },
  getConversation: (conversationId, principalId) => conversationId === conversation.id && principalId === 'principal-1' ? conversation : null,
  upsertConversation: (next) => ({ ...conversation, ...next }),
  buildScopedChatRequest: (input) => ({
    conversationRunKey: `${input.principalId}:${input.conversationId}`,
    idempotencyNamespace: 'principal-1:thread-1:retry-key',
    scopedIdempotencyKey: 'scoped-retry-key',
    operationFingerprint: `retry:${input.retryOfMessageId}`,
  }),
  reserveScopedIdempotencyRecord: (_namespace, input) => ({
    status: 'reserved' as const,
    record: {
      status: 'reserved' as const,
      reservationId: input.reservationId,
      messageId: null,
      runId: input.runId,
      conversationId: input.conversationId,
      principalId: input.principalId,
      operationFingerprint: input.operationFingerprint,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  }),
  resolveStoredPreviousResponseId: ({ storedConversationResponseId }) => storedConversationResponseId,
  createActionEvent: (input) => {
    actionInput = input as unknown as Record<string, unknown>;
    return { id: 'action-1', status: 'proposed', conversation_id: conversation.id } as never;
  },
  getActionEvent: () => ({ id: 'action-1', status: 'proposed', conversation_id: conversation.id } as never),
  runUndo: () => {
    undoCalls += 1;
    return { success: true, message: 'undone', action: { id: 'action-1', status: 'undone' } as never };
  },
  completeScopedIdempotencyReservation: (() => { throw new Error('not used by control service'); }) as never,
  appendServerMessage: () => {},
  setConversationResponseId: () => {},
};

let chatInput: Record<string, unknown> | null = null;
const service = createChatControlService({
  repository,
  runServerChat: async (input) => {
    chatInput = input as unknown as Record<string, unknown>;
    return {
      conversation_id: input.conversationId,
      messages: [{ id: 'assistant-1', role: 'assistant', text: 'Done' }],
      thread: { id: conversation.id, title: conversation.title, detail: conversation.detail },
      run: { id: input.runId, status: 'completed', needs_retry: false, aborted: false },
    };
  },
});

const stop = service.stop({ principalId: 'principal-1', runId: 'run-1' });
assert.equal(stop.kind, 'cancelled');
assert.equal(aborted, true);
assert.equal(cleared, true);
assert.equal(run.status, 'cancelled');
assert.equal(service.stop({ principalId: 'other-principal', runId: 'run-1' }).kind, 'bad_request');

run = { status: 'running', conversationId: conversation.id, principalId: 'principal-1' };
const retry = await service.retry({
  principalId: 'principal-1',
  conversationId: conversation.id,
  userMessageId: 'user-1',
  idempotencyKey: 'retry-key',
});
assert.equal(retry.kind, 'ok');
const observedChatInput = (chatInput ?? {}) as Record<string, unknown>;
assert.equal(observedChatInput.previousResponseId, 'response-1');
assert.equal(observedChatInput.appendUserMessage, false);
assert.equal(observedChatInput.retryOfMessageId, 'user-1');

const proposed = service.action({
  principalId: 'principal-1',
  conversationId: conversation.id,
  requestedAction: 'propose',
  command: 'create milk record',
  idempotencyKey: 'action-key',
});
assert.equal(proposed.kind, 'ok');
assert.equal(((actionInput ?? {}) as Record<string, unknown>).idempotencyKey, 'action-key');

const undone = service.undo({ principalId: 'principal-1', actionId: 'action-1', idempotencyKey: 'undo-key' });
assert.equal(undone.kind, 'ok');
assert.equal(undoCalls, 1);
assert.equal((undone as unknown as { body: { undo_result: { idempotency_key: string } } }).body.undo_result.idempotency_key, 'undo-key');

console.log('PASS server/test/chat-control-service-contract.ts');
