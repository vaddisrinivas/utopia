import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'utopia-chat-runtime-job-'));
const statePath = join(tempDir, 'chat-runtime-state.json');

try {
  const {
    createChatRuntimeJobRepository,
  } = await import('../src/repositories/chat-runtime-job-repository');

  const repository = createChatRuntimeJobRepository({ chatRuntimeStatePath: statePath });
  const sharedRepository = createChatRuntimeJobRepository({ chatRuntimeStatePath: statePath });

  for (let index = 0; index < 600; index += 1) {
    repository.setScopedIdempotencyRecord(`idem-${index}`, {
      messageId: `assistant-${index}`,
      runId: `run-${index}`,
      conversationId: `thread-${index}`,
      principalId: 'tenant-alpha',
      operationFingerprint: `fingerprint-${index}`,
    });
  }

  for (let index = 0; index < 320; index += 1) {
    repository.setRunState(`run-${index}`, {
      status: index === 319 ? 'running' : 'completed',
      conversationId: `thread-${index}`,
      principalId: 'tenant-alpha',
    });
  }

  const snapshot = repository.getSnapshotForTest();
  assert.equal(Object.keys(snapshot.idempotency).length, 512, 'idempotency retention should stay bounded');
  assert.equal(Object.keys(snapshot.runs).length, 256, 'run retention should stay bounded');
  assert.equal(Boolean(snapshot.idempotency['idem-599']), true, 'latest idempotency entry should survive pruning');
  assert.equal(Boolean(snapshot.idempotency['idem-0']), false, 'oldest idempotency entry should be pruned');
  assert.equal(Boolean(snapshot.runs['run-319']), true, 'latest run should survive pruning');
  assert.equal(Boolean(snapshot.runs['run-0']), false, 'oldest run should be pruned');

  const runState = repository.setRunState('shared-run', {
    status: 'running',
    conversationId: 'shared-thread-state',
    principalId: 'tenant-alpha',
  });
  assert.equal(runState.status, 'running', 'repo setRunState should return running status');

  const foundSharedRun = sharedRepository.findRunningConversationRun('tenant-alpha', 'shared-thread-state', undefined);
  assert.equal(foundSharedRun?.runId, 'shared-run', 'running run should be discoverable from another repository instance');

  const reservationA = repository.reserveScopedIdempotencyRecord('retry-namespace', {
    reservationId: 'reservation-a',
    runId: 'retry-run-a',
    conversationId: 'retry-thread',
    principalId: 'tenant-alpha',
    operationFingerprint: 'retry-op',
  });
  assert.equal(reservationA.status, 'reserved', 'first reservation should be accepted');

  const reservationB = sharedRepository.reserveScopedIdempotencyRecord('retry-namespace', {
    reservationId: 'reservation-b',
    runId: 'retry-run-b',
    conversationId: 'retry-thread',
    principalId: 'tenant-alpha',
    operationFingerprint: 'retry-op',
  });
  assert.equal(reservationB.status, 'in_progress', 'second reservation with same fingerprint should be in progress');

  const completed = repository.completeScopedIdempotencyReservation('retry-namespace', {
    reservationId: 'reservation-a',
    messageId: 'retry-message-id',
  });
  assert.equal(completed.status, 'completed', 'reservation should complete');

  const reservationC = sharedRepository.reserveScopedIdempotencyRecord('retry-namespace', {
    reservationId: 'reservation-c',
    runId: 'retry-run-c',
    conversationId: 'retry-thread',
    principalId: 'tenant-alpha',
    operationFingerprint: 'retry-op',
  });
  assert.equal(reservationC.status, 'completed', 'post-completion reservation should replay completed answer');
  assert.equal(reservationC.record.messageId, 'retry-message-id', 'replayed record should include original message id');

  const terminalRun = repository.setRunState('shared-run', {
    status: 'completed',
    conversationId: 'shared-thread-state',
    principalId: 'tenant-alpha',
  });
  assert.equal(terminalRun.status, 'completed', 'run should transition to completed');
  assert.equal(sharedRepository.findRunningConversationRun('tenant-alpha', 'shared-thread-state', undefined), null, 'completed run should not be discoverable as running');

  console.log('PASS server/test/chat-runtime-job-repository-contract.ts');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
