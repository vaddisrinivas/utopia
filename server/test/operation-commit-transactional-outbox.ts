import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'utopia-operation-outbox-'));
const statePath = join(dir, 'wonder-runtime.json');
const tsxPath = join(process.cwd(), 'server', 'node_modules', '.bin', 'tsx');
const fixturePath = join(process.cwd(), 'server', 'test', 'fixtures', 'operation-commit-outbox-process.ts');

function runPhase(phase: 'commit' | 'recover' | 'verify-empty') {
  execFileSync(tsxPath, [fixturePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WONDER_RUNTIME_STATE_PATH: statePath,
      LIFEOS_OUTBOX_TEST_PHASE: phase,
    },
    stdio: 'pipe',
  });
}

runPhase('commit');
const committed = JSON.parse(readFileSync(statePath, 'utf8')) as {
  records: Record<string, unknown>;
  actions: Record<string, { status: string }>;
  operation_commit_outbox: Record<string, {
    status: string;
    attempts: number;
    last_error: string | null;
    event: { operationId: string; recordId: string };
  }>;
};
assert.ok(committed.records['restart-outbox-record'], 'record must share the atomic snapshot');
assert.equal(committed.actions['restart-outbox-action']?.status, 'completed');
assert.deepEqual(
  committed.operation_commit_outbox['restart-outbox-action:operation']?.event,
  {
    actionId: 'restart-outbox-action',
    operationId: 'restart-outbox-action:operation',
    causeId: 'restart-outbox-action',
    domain: 'food',
    recordId: 'restart-outbox-record',
    before: null,
    after: committed.records['restart-outbox-record'],
  },
);
assert.equal(committed.operation_commit_outbox['restart-outbox-action:operation']?.status, 'pending');
assert.equal(committed.operation_commit_outbox['restart-outbox-action:operation']?.attempts, 1);
assert.equal(
  committed.operation_commit_outbox['restart-outbox-action:operation']?.last_error,
  'reactive_observer_unavailable',
);

runPhase('recover');
const recovered = JSON.parse(readFileSync(statePath, 'utf8')) as {
  operation_commit_outbox: Record<string, unknown>;
};
assert.deepEqual(recovered.operation_commit_outbox, {});

runPhase('verify-empty');
console.log('operation-commit-transactional-outbox: passed');
