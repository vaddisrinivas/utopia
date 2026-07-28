import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'utopia-chat-runtime-state-'));
process.env.LIFEOS_CHAT_RUNTIME_STATE_PATH = join(tempDir, 'chat-runtime-state.json');

try {
  const {
    getChatRuntimeStateSnapshotForTest,
    setRunState,
    setScopedIdempotencyRecord,
  } = await import('../src/chat-runtime-state');

  for (let index = 0; index < 600; index += 1) {
    setScopedIdempotencyRecord(`idem-${index}`, {
      messageId: `assistant-${index}`,
      runId: `run-${index}`,
      conversationId: `thread-${index}`,
      principalId: 'tenant-alpha',
      operationFingerprint: `fingerprint-${index}`,
    });
  }

  for (let index = 0; index < 320; index += 1) {
    setRunState(`run-${index}`, {
      status: index === 319 ? 'running' : 'completed',
      conversationId: `thread-${index}`,
      principalId: 'tenant-alpha',
    });
  }

  const snapshot = getChatRuntimeStateSnapshotForTest();
  assert.equal(Object.keys(snapshot.idempotency).length, 512, 'idempotency retention should stay bounded');
  assert.equal(Object.keys(snapshot.runs).length, 256, 'run retention should stay bounded');
  assert.equal(Boolean(snapshot.idempotency['idem-599']), true, 'newest idempotency entry should survive pruning');
  assert.equal(Boolean(snapshot.idempotency['idem-0']), false, 'oldest idempotency entry should be pruned');
  assert.equal(Boolean(snapshot.runs['run-319']), true, 'newest run should survive pruning');
  assert.equal(Boolean(snapshot.runs['run-0']), false, 'oldest run should be pruned');

  console.log('PASS server/test/chat-runtime-state-contract.ts');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
