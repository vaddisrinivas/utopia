import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LIFEOS_REACTIVE_WORKER_POLL_INTERVAL_MS = '50';
process.env.LIFEOS_REACTIVE_WORKER_LEASE_TTL_MS = '200';
process.env.LIFEOS_REACTIVE_WORKER_HEARTBEAT_MS = '50';

const dir = mkdtempSync(join(tmpdir(), 'utopia-reactive-worker-'));
const runtimePath = join(dir, 'runtime.json');
const leasePath = `${runtimePath}.lease`;
process.env.LIFEOS_REACTIVE_RUNTIME_PATH = runtimePath;
process.env.WONDER_RUNTIME_STATE_PATH = join(dir, 'wonder-runtime.json');

const {
  createReactiveOutboxStore,
  enqueueReactiveProposals,
  markReactiveOutboxAwaitingReview,
  markReactiveOutboxRunning,
} = await import('../src/kernel/reactive-outbox');
const { createReactiveReceiptStore } = await import('../src/kernel/reactive-receipts');
const {
  startReactiveRuntimeWorker,
  stopReactiveRuntimeWorker,
  wakeReactiveRuntimeWorker,
} = await import('../src/kernel/install-reactive-runtime');
const {
  createActionEvent,
  markActionCompleted,
} = await import('../src/runtime/state');
const { createOperationProposalIdempotencyKey } = await import('../src/kernel/rules');
import type { ReactiveCycleResult } from '../src/kernel/reactive-cycle';
import type { OperationCommitEvent } from '../src/kernel/operation-observer';

const proposalEvent = { kind: 'query_transition' as const, id: 'runtime-query:enter', queryId: 'runtime-query', transition: 'enter' as const };
const operationTemplate = { kind: 'custom' as const, tool: 'request_review' };
const proposalEvidence = { queryId: 'runtime-query', transition: 'enter' as const };
const authorization = {
  policyId: 'wonder.reactive-proposal-policy' as const,
  policyVersion: 'v1' as const,
  allowed: true,
  risk: 'standard' as const,
  reviewRequired: true,
  requiredCapability: 'reactive:propose:custom',
  capabilityPresent: false,
  providerAuthority: {
    targetProvider: 'user',
    authorityProvider: 'notion',
    allowed: true,
    requiredCapability: null,
    capabilityPresent: true,
    reason: 'provider_authority_ok',
  },
  reason: 'suggest_mode_requires_review',
};
const dryRun = {
  ok: true,
  effect: 'queue_review_action' as const,
  executable: false,
  reason: 'proposal_can_be_queued',
};
const proposalIdempotencyKey = createOperationProposalIdempotencyKey({
  packageId: 'runtime-package',
  packageVersion: '1.0.0',
  ruleId: 'runtime-rule',
  event: proposalEvent,
  causeId: 'runtime-cause',
  operationTemplate,
  evidence: proposalEvidence,
});
const event: OperationCommitEvent = {
  actionId: 'runtime-action',
  operationId: 'runtime-operation',
  causeId: 'runtime-cause',
  domain: 'food',
  recordId: 'runtime-record',
  before: null,
  after: { id: 'runtime-record' },
};
const cycle: ReactiveCycleResult = {
  cycleId: 'runtime-cycle',
  transitions: [],
  queryHashes: {},
  proposals: [{
    id: 'runtime-proposal',
    eventId: 'runtime-query:enter',
    event: proposalEvent,
    ruleId: 'runtime-rule',
    operation: 'request_review',
    operationTemplate,
    mode: 'suggest',
    causeId: 'runtime-cause',
    packageVersion: '1.0.0',
    depth: 0,
    envelope: {
      schemaVersion: 'wonder.operation-proposal.v1',
      proposalId: 'runtime-proposal',
      operation: 'request_review',
      operationTemplate,
      mode: 'suggest',
      ruleId: 'runtime-rule',
      packageId: 'runtime-package',
      packageVersion: '1.0.0',
      eventId: 'runtime-query:enter',
      event: proposalEvent,
      causeId: 'runtime-cause',
      depth: 0,
      idempotencyKey: proposalIdempotencyKey,
      review: { required: true, reason: 'suggest_mode', policyId: authorization.policyId, policyVersion: authorization.policyVersion },
      authorization,
      dryRun,
      evidence: proposalEvidence,
    },
  }],
};

function writeRuntime(outbox: unknown) {
  writeFileSync(runtimePath, JSON.stringify({
    schemaVersion: 'wonder.reactive-runtime.v1',
    receipts: createReactiveReceiptStore(),
    outbox,
  }, null, 2));
}

function readRuntime() {
  return JSON.parse(readFileSync(runtimePath, 'utf8')) as {
    outbox: {
      items: Record<string, {
        status: string;
        lastError?: string;
      }>;
    };
  };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for worker condition');
}

const baseOutbox = enqueueReactiveProposals(createReactiveOutboxStore(), {
  cycle,
  event,
  proposalIds: ['runtime-proposal'],
  now: '2026-07-23T00:00:00.000Z',
});

const recoveredRunning = markReactiveOutboxRunning(baseOutbox, 'runtime-proposal', '2026-07-23T00:00:01.000Z');
writeRuntime(recoveredRunning);
const startupSeen: string[] = [];
startReactiveRuntimeWorker({
  path: runtimePath,
  executeProposal: async (item) => {
    startupSeen.push(item.proposalId);
    return { ok: true, receipt: { status: 'queued' } };
  },
});
await waitFor(() => readRuntime().outbox.items['runtime-proposal']?.status === 'awaiting_review');
assert.deepEqual(startupSeen, ['runtime-proposal']);
assert.notEqual(readRuntime().outbox.items['runtime-proposal']?.status, 'running');
stopReactiveRuntimeWorker();

writeRuntime(baseOutbox);
writeFileSync(leasePath, JSON.stringify({
  ownerId: 'other-worker',
  acquiredAt: '2026-07-26T00:00:00.000Z',
  heartbeatAt: '2026-07-26T00:00:00.000Z',
  expiresAt: new Date(Date.now() + 5_000).toISOString(),
}, null, 2));
const leaseSeen: string[] = [];
startReactiveRuntimeWorker({
  path: runtimePath,
  executeProposal: async (item) => {
    leaseSeen.push(item.proposalId);
    return { ok: true };
  },
});
await new Promise((resolve) => setTimeout(resolve, 250));
assert.deepEqual(leaseSeen, [], 'active lease should block a second worker');
writeFileSync(leasePath, JSON.stringify({
  ownerId: 'other-worker',
  acquiredAt: '2026-07-26T00:00:00.000Z',
  heartbeatAt: '2026-07-26T00:00:00.000Z',
  expiresAt: '2026-07-26T00:00:00.000Z',
}, null, 2));
wakeReactiveRuntimeWorker();
await waitFor(() => leaseSeen.length === 1);
assert.deepEqual(leaseSeen, ['runtime-proposal']);
assert.equal(readRuntime().outbox.items['runtime-proposal']?.status, 'acked');
stopReactiveRuntimeWorker();

const awaitingReview = markReactiveOutboxAwaitingReview(baseOutbox, 'runtime-proposal', {
  now: '2026-07-23T00:00:02.000Z',
  reason: 'waiting_on_approval',
});
writeRuntime(awaitingReview);
createActionEvent({
  id: 'reactive-review-completed',
  actor: 'reviewer',
  domain: 'food',
  tool: 'request_review',
  risk: 'standard',
  recordIds: [],
  idempotencyKey: proposalIdempotencyKey,
  command: 'approved',
});
markActionCompleted('reactive-review-completed', 'approved');
const approvalResumeSeen: string[] = [];
startReactiveRuntimeWorker({
  path: runtimePath,
  executeProposal: async (item) => {
    approvalResumeSeen.push(item.proposalId);
    return { ok: true };
  },
});
await waitFor(() => readRuntime().outbox.items['runtime-proposal']?.status === 'acked');
assert.deepEqual(approvalResumeSeen, ['runtime-proposal']);
stopReactiveRuntimeWorker();

writeRuntime(baseOutbox);
try {
  unlinkSync(leasePath);
} catch {
  // No lease is the expected clean starting state.
}
const resultPath = join(dir, 'lease-executions.txt');
const leaseFixturePath = join(process.cwd(), 'server', 'test', 'fixtures', 'reactive-lease-worker-process.ts');
const tsxPath = join(process.cwd(), 'server', 'node_modules', '.bin', 'tsx');
await Promise.all(Array.from({ length: 8 }, (_, worker) => new Promise<void>((resolve, reject) => {
  const child = spawn(tsxPath, [leaseFixturePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_REACTIVE_RUNTIME_PATH: runtimePath,
      LIFEOS_REACTIVE_LEASE_RESULT_PATH: resultPath,
      LIFEOS_REACTIVE_LEASE_WORKER_ID: String(worker),
      LIFEOS_REACTIVE_WORKER_POLL_INTERVAL_MS: '25',
      LIFEOS_REACTIVE_WORKER_LEASE_TTL_MS: '500',
      LIFEOS_REACTIVE_WORKER_HEARTBEAT_MS: '100',
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
    else reject(new Error(`reactive worker ${worker} exited ${code}: ${stderr}`));
  });
})));
const executions = readFileSync(resultPath, 'utf-8').trim().split('\n').filter(Boolean);
assert.equal(executions.length, 1, `exclusive lease must execute once; got ${executions.join(', ')}`);
assert.match(executions[0]!, /^\d:runtime-proposal$/);
assert.equal(readRuntime().outbox.items['runtime-proposal']?.status, 'acked');

console.log('reactive-runtime-worker: passed');
