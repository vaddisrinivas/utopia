import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), 'utopia-chat-idempotency-concurrency-'));
const statePath = join(tempDir, 'chat-runtime-state.json');
const tsxBinary = join(root, 'server', 'node_modules', '.bin', 'tsx');
const workerPath = join(root, 'server', 'test', 'fixtures', 'chat-idempotency-reservation-worker.ts');

function runWorker(index: number) {
  return new Promise<{ status: string; reservationId: string }>((resolve, reject) => {
    const child = spawn(tsxBinary, [workerPath], {
      cwd: root,
      env: {
        ...process.env,
        CHAT_IDEMPOTENCY_NAMESPACE: 'shared-namespace',
        CHAT_IDEMPOTENCY_STATE_PATH: statePath,
        CHAT_IDEMPOTENCY_WORKER_ID: String(index),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `reservation worker exited ${code}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

try {
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => runWorker(index)));
  assert.equal(results.filter((result) => result.status === 'reserved').length, 1, 'exactly one process must reserve execution');
  assert.equal(results.filter((result) => result.status === 'in_progress').length, 7, 'all losing processes must observe the durable reservation');
  assert.equal(new Set(results.map((result) => result.reservationId)).size, 1, 'every process must observe the same reservation owner');
  console.log('PASS server/test/chat-idempotency-reservation-concurrency.ts');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
