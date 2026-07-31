export {
  type ChatRuntimeJobRepository,
  type ChatRuntimeStateSnapshot,
  type PersistedRunState,
  type PersistedScopedIdempotencyRecord,
  type ScopedIdempotencyReservationResult,
} from './repositories/chat-runtime-job-repository';

import type {
  PersistedRunState,
  PersistedScopedIdempotencyRecord,
  ScopedIdempotencyReservationResult,
} from './repositories/chat-runtime-job-repository';

import { createChatRuntimeJobRepository } from './repositories/chat-runtime-job-repository';

const repository = createChatRuntimeJobRepository();

export { createChatRuntimeJobRepository };

export function getScopedIdempotencyRecord(namespace: string): PersistedScopedIdempotencyRecord | null {
  return repository.getScopedIdempotencyRecord(namespace);
}

export function setScopedIdempotencyRecord(
  namespace: string,
  record: Omit<PersistedScopedIdempotencyRecord, 'status' | 'reservationId' | 'created_at' | 'updated_at'>,
): PersistedScopedIdempotencyRecord {
  return repository.setScopedIdempotencyRecord(namespace, record);
}

export function reserveScopedIdempotencyRecord(
  namespace: string,
  input: {
    reservationId: string;
    runId: string;
    conversationId: string;
    principalId: string;
    operationFingerprint: string;
  },
): ScopedIdempotencyReservationResult {
  return repository.reserveScopedIdempotencyRecord(namespace, input);
}

export function completeScopedIdempotencyReservation(
  namespace: string,
  input: {
    reservationId: string;
    messageId: string;
  },
): PersistedScopedIdempotencyRecord {
  return repository.completeScopedIdempotencyReservation(namespace, input);
}

export function getRunState(runId: string): PersistedRunState | null {
  return repository.getRunState(runId);
}

export function setRunState(
  runId: string,
  input: Omit<PersistedRunState, 'created_at' | 'updated_at'>,
): PersistedRunState {
  return repository.setRunState(runId, input);
}

export function findRunningConversationRun(
  principalId: string,
  conversationId: string,
  excludeRunId?: string,
): {
  runId: string;
  run: PersistedRunState;
} | null {
  return repository.findRunningConversationRun(principalId, conversationId, excludeRunId);
}

export function getChatRuntimeStateSnapshotForTest() {
  return repository.getSnapshotForTest();
}
