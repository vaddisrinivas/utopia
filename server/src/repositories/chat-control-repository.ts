import {
  createChatRuntimeJobRepository,
  type ChatRuntimeJobRepository,
  type PersistedRunState,
  type ScopedIdempotencyReservationResult,
} from './chat-runtime-job-repository';
import { createActionEvent, getActionEvent, runUndo, type ActionEvent } from '../runtime/state';
import type { ChatRunResponse } from '../services/chat-control-service';

export type ChatConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export type ChatConversation = {
  id: string;
  domain: string;
  title: string;
  detail: string;
  messages?: Array<ChatConversationMessage>;
  last_response_id?: string;
};

export type ChatRunState = Pick<PersistedRunState, 'status' | 'conversationId' | 'principalId'>;

export type ChatScopedChatRequest = {
  conversationRunKey: string;
  idempotencyNamespace: string;
  scopedIdempotencyKey: string;
  operationFingerprint: string;
};

export type ChatControlRepository = {
  getRunState: (runId: string) => ChatRunState | null;
  setRunState: (runId: string, state: Omit<ChatRunState, 'status'> & { status: ChatRunState['status'] }) => ChatRunState;
  getRunController: (runId: string) => AbortController | undefined;
  setRunController: (runId: string, controller: AbortController) => void;
  clearRunController: (runId: string) => void;
  getConversation: (conversationId: string, principalId: string) => ChatConversation | null | undefined;
  upsertConversation: (input: {
    id: string;
    domain: string;
    title: string;
    detail: string;
  }, principalId: string) => ChatConversation;
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
  createActionEvent: (input: Parameters<typeof createActionEvent>[0]) => ActionEvent;
  getActionEvent: (actionId: string) => ActionEvent | null;
  runUndo: (actionId: string) => ReturnType<typeof runUndo>;
  completeScopedIdempotencyReservation: ChatRuntimeJobRepository['completeScopedIdempotencyReservation'];
  appendServerMessage: (conversationId: string, message: ChatRunResponse['messages'][number], principalId: string) => void;
  setConversationResponseId: (conversationId: string, responseId: string, principalId: string) => void;
};

export function createChatControlRepository(
  overrides: Partial<ChatControlRepository> & Pick<ChatControlRepository, 'getConversation' | 'upsertConversation' | 'buildScopedChatRequest' | 'resolveStoredPreviousResponseId'>,
): ChatControlRepository {
  const chatRuntimeJobRepository = createChatRuntimeJobRepository();
  return {
    getRunState: chatRuntimeJobRepository.getRunState,
    setRunState: chatRuntimeJobRepository.setRunState,
    getRunController: () => undefined,
    setRunController: () => {},
    clearRunController: () => {},
    reserveScopedIdempotencyRecord: chatRuntimeJobRepository.reserveScopedIdempotencyRecord,
    createActionEvent,
    getActionEvent,
    runUndo,
    completeScopedIdempotencyReservation: chatRuntimeJobRepository.completeScopedIdempotencyReservation,
    appendServerMessage: () => {},
    setConversationResponseId: () => {},
    ...overrides,
  };
}
