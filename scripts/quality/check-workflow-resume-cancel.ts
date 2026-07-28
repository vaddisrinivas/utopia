import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentGit } from './evidence-provenance.mjs';
import { execFileSync } from 'node:child_process';

import { MemoryDb } from '../../tests/helpers/memory-db';
import {
  cancelWorkflowRun,
  getWorkflowRunSnapshot,
  getWorkflowReceiptSummary,
  recordWorkflowStep,
  resumeWorkflowRun,
  pauseWorkflowRun,
  proposeWorkflowCompensation,
  startWorkflowRun,
} from '../../src/workflows/runtime';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function persistedRestart(source: MemoryDb) {
  const next = new MemoryDb();
  for (const [id, row] of source.workflowRuns.entries()) {
    next.workflowRuns.set(id, clone(row));
  }
  return next;
}

function canonicalRecord(id: string, revision: number) {
  return {
    id,
    domain: 'food',
    collection: 'meals',
    title: `Meal ${id}`,
    properties: { description: `rev-${revision}` },
    relations: [],
    source: {
      provider: 'sqlite',
      external_id: id,
      url: null,
      observed_at: new Date().toISOString(),
      content_hash: null,
    },
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    revision,
    schema_version: 'food_v1',
    deleted: false,
    privacy: 'personal',
    provenance: null,
  };
}

async function seedAppliedOperation(db: MemoryDb, op: {
  op_id: string;
  kind: string;
  idempotency_key: string | null;
  record: string;
  before: ReturnType<typeof canonicalRecord> | null;
  after: ReturnType<typeof canonicalRecord>;
}) {
  await db.runAsync(
    `INSERT INTO operations (
      op_id, kind, domain, collection, record_id, expected_revision, result_revision,
      actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id,
      status, reject_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      op.op_id,
      op.kind,
      'food',
      'meals',
      op.record,
      op.before?.revision ?? null,
      op.after.revision,
      'agent',
      'workflow',
      op.idempotency_key,
      JSON.stringify({
        op_id: op.op_id,
        kind: op.kind,
        domain: 'food',
        collection: 'meals',
        record_id: op.record,
        expected_revision: op.before?.revision,
        changes: { description: `changed-${op.after.revision}` },
        actor: 'agent',
        origin: 'workflow',
        idempotency_key: op.idempotency_key ?? undefined,
      }),
      op.before ? JSON.stringify(op.before) : null,
      JSON.stringify(op.after),
      null,
      'applied',
      null,
      new Date().toISOString(),
    ],
  );
}

(async () => {
  const db = new MemoryDb();
  const runId = 'phase7-workflow-resume-cancel-proof';
  await startWorkflowRun({
    db: db as never,
    id: runId,
    domain: 'food',
    workflowId: 'weekly-food-reset',
    inputs: { date: '2026-07-23' },
    steps: [
      { id: 'choose-dinner', title: 'Choose dinner', tool: 'food.plan_dinner' },
      { id: 'reserve-pantry', title: 'Reserve pantry', tool: 'food.reserve_pantry' },
      { id: 'build-shopping', title: 'Build shopping', tool: 'food.build_shopping_list' },
    ],
  });
  await recordWorkflowStep({
    db: db as never,
    runId,
    stepId: 'choose-dinner',
    status: 'completed',
    receipt: {
      operation_ids: ['wf-op-plan-green-dal'],
      action_ids: ['wf-action-plan-green-dal'],
      source_ids: ['sqlite:meal-green-dal'],
      record_ids: ['meal-green-dal'],
      message: 'Dinner selected before cancellation.',
    },
  });
  await cancelWorkflowRun({
    db: db as never,
    runId,
    reason: 'User paused before provider-visible writes.',
  });

  await recordWorkflowStep({
    db: db as never,
    runId,
    stepId: 'reserve-pantry',
    status: 'completed',
    receipt: { operation_ids: ['wf-op-illegal-after-cancel'] },
  }).then(
    () => {
      throw new Error('Cancelled workflow accepted a step before resume.');
    },
    (error) => {
      assert(String(error instanceof Error ? error.message : error).includes('resume before recording'), 'cancel guard produced wrong error.');
    },
  );

  const restarted = persistedRestart(db);
  const restoredBeforeResume = await getWorkflowRunSnapshot(restarted as never, runId);
  assert(restoredBeforeResume?.row.status === 'cancelled', 'cancelled status did not survive restart.');
  assert(restoredBeforeResume.checkpoint.steps[0]?.status === 'completed', 'completed step did not survive restart.');
  assert(restoredBeforeResume.checkpoint.steps[1]?.status === 'cancelled', 'cancelled step did not survive restart.');
  const statusAfterCancelRestart = restoredBeforeResume.row.status;
  const stepStatusesAfterCancelRestart = restoredBeforeResume.checkpoint.steps.map((step) => step.status);

  const resumed = await resumeWorkflowRun({ db: restarted as never, runId });
  assert(resumed.row.status === 'running', 'resume did not return workflow to running.');
  assert(resumed.checkpoint.resume_count === 1, 'resume count not incremented.');
  assert(resumed.checkpoint.steps.map((step) => step.status).join(',') === 'completed,pending,pending', 'resume did not preserve completed step and reset remaining steps.');
  assert(!resumed.checkpoint.cancelled_at && !resumed.checkpoint.cancel_reason, 'resume left cancellation markers in checkpoint.');
  const statusAfterResume = resumed.row.status;
  const stepStatusesAfterResume = resumed.checkpoint.steps.map((step) => step.status);
  const resumeCount = resumed.checkpoint.resume_count;

  await recordWorkflowStep({
    db: restarted as never,
    runId,
    stepId: 'reserve-pantry',
    status: 'completed',
    receipt: {
      operation_ids: ['wf-op-reserve-yogurt'],
      action_ids: ['wf-action-reserve-yogurt'],
      source_ids: ['sqlite:pantry-yogurt'],
      record_ids: ['pantry-yogurt'],
    },
  });
  const completed = await recordWorkflowStep({
    db: restarted as never,
    runId,
    stepId: 'build-shopping',
    status: 'completed',
    receipt: {
      operation_ids: ['wf-op-buy-spinach'],
      action_ids: ['wf-action-buy-spinach'],
      source_ids: ['sqlite:shopping-spinach'],
      record_ids: ['shopping-spinach'],
    },
  });
  assert(completed.row.status === 'completed', 'workflow did not complete after resume.');
  const statusAfterCompletion = completed.row.status;
  const completedStepsAfterResume = completed.checkpoint.steps.filter((step) => step.status === 'completed').length;

  const pausedRunId = 'phase7-workflow-pause-proof';
  await startWorkflowRun({
    db: db as never,
    id: pausedRunId,
    domain: 'food',
    workflowId: 'meal-plan-to-shopping',
    steps: [
      { id: 'choose-dinner', title: 'Choose dinner', tool: 'food.plan_dinner' },
      { id: 'reserve-pantry', title: 'Reserve pantry', tool: 'food.reserve_pantry' },
    ],
  });
  const paused = await pauseWorkflowRun({ db: db as never, runId: pausedRunId });
  assert(paused.row.status === 'running', 'paused workflow should keep persistent row status running.');
  assert(((paused.checkpoint as { workflow_control_state?: string }).workflow_control_state === 'paused'), 'pause should store control state.');
  await recordWorkflowStep({
    db: db as never,
    runId: pausedRunId,
    stepId: 'choose-dinner',
    status: 'completed',
    receipt: { operation_ids: ['wf-op-disallowed-pause'] },
  }).then(
    () => {
      throw new Error('paused workflow accepted step writes.');
    },
    (error) => {
      assert(String(error instanceof Error ? error.message : error).includes('resume before recording'), 'pause guard produced wrong error.');
    },
  );
  const resumedFromPause = await resumeWorkflowRun({ db: db as never, runId: pausedRunId });
  assert(resumedFromPause.checkpoint.resume_count === 1, 'pause->resume should increment resume_count.');
  assert(((resumedFromPause.checkpoint as { workflow_control_state?: string }).workflow_control_state === 'running'), 'resume should restore running control state.');

  const summary = await getWorkflowReceiptSummary(restarted as never, runId);
  assert(summary.operation_ids.join(',') === 'wf-op-plan-green-dal,wf-op-reserve-yogurt,wf-op-buy-spinach', 'operation receipt order/dedupe failed.');
  assert(summary.record_ids.join(',') === 'meal-green-dal,pantry-yogurt,shopping-spinach', 'record receipts missing after resume.');

  const unsafeDb = new MemoryDb();
  await startWorkflowRun({
    db: unsafeDb as never,
    id: 'phase7-unsafe-cancel-proof',
    domain: 'food',
    workflowId: 'provider-write',
    steps: [
      { id: 'provider-write', title: 'Provider write', cancellable: false },
      { id: 'finish', title: 'Finish' },
    ],
  });
  const unsafeCancel = await cancelWorkflowRun({
    db: unsafeDb as never,
    runId: 'phase7-unsafe-cancel-proof',
    reason: 'Stop during unsafe provider write.',
  });
  assert(unsafeCancel.row.status === 'failed', 'unsafe cancellation should fail, not silently cancel.');
  assert(unsafeCancel.checkpoint.steps[0]?.status === 'failed', 'non-cancellable step was not marked failed.');

  const compensationRunId = 'phase7-workflow-compensation-proof';
  await startWorkflowRun({
    db: db as never,
    id: compensationRunId,
    domain: 'food',
    workflowId: 'meal-plan-to-shopping',
    steps: [
      { id: 'build-shopping', title: 'Build shopping list', tool: 'food.build_shopping_list' },
      { id: 'notify', title: 'Notify provider', tool: 'food.notify', cancellable: false },
    ],
  });
  const beforeA = canonicalRecord('meal-a', 0);
  const afterA = { ...beforeA, revision: 1, properties: { description: 'rev-1' }, updated_at: new Date().toISOString() };
  const beforeB = canonicalRecord('meal-b', 1);
  const afterB = { ...beforeB, revision: 2, properties: { description: 'rev-2' }, updated_at: new Date().toISOString() };
  await recordWorkflowStep({
    db: db as never,
    runId: compensationRunId,
    stepId: 'build-shopping',
    status: 'completed',
    receipt: { operation_ids: ['wf-op-meal-a'] },
  });
  await recordWorkflowStep({
    db: db as never,
    runId: compensationRunId,
    stepId: 'notify',
    status: 'failed',
    receipt: { operation_ids: ['wf-op-meal-b'] },
    error: 'provider error',
  });

  await seedAppliedOperation(db, {
    op_id: 'wf-op-meal-a',
    kind: 'update',
    record: 'meal-a',
    idempotency_key: 'meal-a-key',
    before: beforeA,
    after: afterA,
  });
  await seedAppliedOperation(db, {
    op_id: 'wf-op-meal-b',
    kind: 'update',
    record: 'meal-b',
    idempotency_key: 'meal-b-key',
    before: beforeB,
    after: afterB,
  });

  const beforeOpCount = db.operations.size;
  const beforeCompSnapshot = await getWorkflowRunSnapshot(db as never, compensationRunId);
  assert(((beforeCompSnapshot?.checkpoint as { workflow_control_state?: string })?.workflow_control_state ?? 'failed') === 'failed', 'workflow must be failed before compensation proposal.');
  const compensation = await proposeWorkflowCompensation({ db: db as never, runId: compensationRunId });
  assert(compensation.control_state === 'compensating', 'compensation proposal should move workflow into compensating state.');
  assert(compensation.proposals.length === 2, 'compensation must produce one inverse for each completed workflow operation.');
  assert(compensation.proposals[0]?.idempotency_key === 'meal-b-key:undo', 'latest operation inverse must preserve idempotency continuity.');
  assert(compensation.proposals[1]?.idempotency_key === 'meal-a-key:undo', 'inverse ordering must be reverse-chronological.');
  assert(db.operations.size === beforeOpCount, 'compensation proposal should not write new operations.');
  assert(db.operations.get('wf-op-meal-a')?.status === 'applied', 'existing operation status should remain applied.');
  assert(db.operations.get('wf-op-meal-b')?.status === 'applied', 'existing operation status should remain applied.');

  const outDir = join(process.cwd(), 'app', 'build', 'evidence', 'workflow');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'workflow-resume-cancel-proof.json');
  writeFileSync(outPath, JSON.stringify({
    proof: 'workflow_resume_cancel',
    checked_at: new Date().toISOString(),
    git: currentGit(process.cwd()),
    run_id: runId,
    restarted_from_persisted_row: true,
    cancel_guard_rejected_step_before_resume: true,
    status_after_cancel_restart: statusAfterCancelRestart,
    step_statuses_after_cancel_restart: stepStatusesAfterCancelRestart,
    status_after_resume: statusAfterResume,
    step_statuses_after_resume: stepStatusesAfterResume,
    status_after_completion: statusAfterCompletion,
    resume_count: resumeCount,
    completed_steps_after_resume: completedStepsAfterResume,
    operation_ids: summary.operation_ids,
    action_ids: summary.action_ids,
    source_ids: summary.source_ids,
    record_ids: summary.record_ids,
    unsafe_cancel_status: unsafeCancel.row.status,
    unsafe_step_status: unsafeCancel.checkpoint.steps[0]?.status,
    pause_control_state: (paused.checkpoint as { workflow_control_state?: string }).workflow_control_state,
    compensation_control_state: compensation.control_state,
    compensation_operations: compensation.proposals.map((op) => ({
      op_id: op.op_id,
      idempotency_key: op.idempotency_key,
    })),
    compensation_op_count_unchanged: beforeOpCount,
    all_passed: true,
  }, null, 2));
  console.log(`PASS ${outPath}`);
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
