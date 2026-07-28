import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const writerCount = 8;
const dir = mkdtempSync(join(tmpdir(), 'utopia-canonical-writers-'));
const statePath = join(dir, 'wonder-runtime.json');
const tsxPath = join(process.cwd(), 'server', 'node_modules', '.bin', 'tsx');
const fixturePath = join(process.cwd(), 'server', 'test', 'fixtures', 'canonical-writer-process.ts');

await Promise.all(Array.from({ length: writerCount }, (_, writer) => new Promise<void>((resolve, reject) => {
  const child = spawn(tsxPath, [fixturePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WONDER_RUNTIME_STATE_PATH: statePath,
      LIFEOS_CANONICAL_WRITER_INDEX: String(writer),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.once('error', reject);
  child.once('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`writer ${writer} exited ${code}: ${stderr}`));
  });
})));

const persisted = JSON.parse(readFileSync(statePath, 'utf-8')) as {
  records: Record<string, unknown>;
  actions: Record<string, { status?: string; operation_id?: string }>;
  operation_commit_outbox: Record<string, { event?: { actionId?: string; recordId?: string } }>;
};

for (let writer = 0; writer < writerCount; writer += 1) {
  const recordId = `concurrent-record-${writer}`;
  const actionId = `concurrent-action-${writer}`;
  assert.ok(persisted.records[recordId], `record ${writer} must survive concurrent commits`);
  assert.equal(persisted.actions[actionId]?.status, 'completed');
  assert.equal(persisted.actions[actionId]?.operation_id, `${actionId}:operation`);
  assert.deepEqual(persisted.operation_commit_outbox[`${actionId}:operation`]?.event, {
    actionId,
    operationId: `${actionId}:operation`,
    causeId: actionId,
    domain: 'food',
    recordId,
    before: null,
    after: persisted.records[recordId],
  });
}
assert.equal(Object.keys(persisted.records).length, writerCount);
assert.equal(Object.keys(persisted.actions).length, writerCount);
assert.equal(Object.keys(persisted.operation_commit_outbox).length, writerCount);

console.log('canonical-writer-concurrency: passed');
