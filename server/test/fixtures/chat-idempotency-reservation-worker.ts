const namespace = process.env.CHAT_IDEMPOTENCY_NAMESPACE!;
const workerId = process.env.CHAT_IDEMPOTENCY_WORKER_ID!;
process.env.LIFEOS_CHAT_RUNTIME_STATE_PATH = process.env.CHAT_IDEMPOTENCY_STATE_PATH!;

const { reserveScopedIdempotencyRecord } = await import('../../src/chat-runtime-state');
const result = reserveScopedIdempotencyRecord(namespace, {
  reservationId: `reservation-${workerId}`,
  runId: `run-${workerId}`,
  conversationId: 'concurrent-thread',
  principalId: 'tenant-alpha',
  operationFingerprint: 'same-logical-operation',
});
if (result.status === 'reserved') {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
process.stdout.write(JSON.stringify({
  status: result.status,
  reservationId: result.record.reservationId,
}));
