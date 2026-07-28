import { describe, expect, it } from 'vitest';

import {
  cancelWorkflowRun,
  getWorkflowRunSnapshot,
  getWorkflowReceiptSummary,
  recordWorkflowStep,
  pauseWorkflowRun,
  resumeWorkflowRun,
  proposeWorkflowCompensation,
  startWorkflowRun,
} from '@/src/workflows/runtime';
import { MemoryDb } from '../helpers/memory-db';

const steps = [
  { id: 'choose-dinner', title: 'Choose dinner', tool: 'food.plan_dinner' },
  { id: 'reserve-pantry', title: 'Reserve pantry', tool: 'food.reserve_pantry' },
  { id: 'build-shopping', title: 'Build shopping list', tool: 'food.build_shopping_list' },
];

function checkpointControlState(checkpoint: { workflow_control_state?: string } | undefined) {
  return checkpoint?.workflow_control_state;
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

async function seedAppliedOperation(
  db: MemoryDb,
  op: {
    op_id: string;
    kind: string;
    idempotency_key: string | null;
    record: string;
    before: ReturnType<typeof canonicalRecord> | null;
    after: ReturnType<typeof canonicalRecord>;
  },
) {
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

describe('workflow runtime', () => {
  it('cancels a workflow without losing completed receipts', async () => {
    const db = new MemoryDb();
    await startWorkflowRun({
      db: db as any,
      id: 'weekly-food-reset-run',
      domain: 'food',
      workflowId: 'weekly-food-reset',
      inputs: { day: 'Thursday' },
      steps,
    });

    await recordWorkflowStep({
      db: db as any,
      runId: 'weekly-food-reset-run',
      stepId: 'choose-dinner',
      status: 'completed',
      receipt: {
        operation_ids: ['op-plan-green-dal'],
        action_ids: ['action-plan-green-dal'],
        source_ids: ['sqlite:meal-green-dal'],
        record_ids: ['meal-green-dal'],
        message: 'Dinner selected from pantry.',
      },
    });
    await recordWorkflowStep({
      db: db as any,
      runId: 'weekly-food-reset-run',
      stepId: 'reserve-pantry',
      status: 'completed',
      receipt: {
        operation_ids: ['op-reserve-yogurt'],
        action_ids: ['action-reserve-yogurt'],
        source_ids: ['sqlite:pantry-yogurt'],
        record_ids: ['pantry-yogurt'],
        message: 'Use-soon yogurt reserved.',
      },
    });

    const cancelled = await cancelWorkflowRun({
      db: db as any,
      runId: 'weekly-food-reset-run',
      reason: 'User cancelled before shopping write.',
    });
    const summary = await getWorkflowReceiptSummary(db as any, 'weekly-food-reset-run');

    expect(cancelled.row.status).toBe('cancelled');
    expect(cancelled.checkpoint.steps.map((step) => step.status)).toEqual([
      'completed',
      'completed',
      'cancelled',
    ]);
    expect(summary.completed_steps).toBe(2);
    expect(summary.cancelled_steps).toBe(1);
    expect(summary.operation_ids).toEqual(['op-plan-green-dal', 'op-reserve-yogurt']);
    expect(summary.action_ids).toEqual(['action-plan-green-dal', 'action-reserve-yogurt']);
    expect(summary.source_ids).toEqual(['sqlite:meal-green-dal', 'sqlite:pantry-yogurt']);
  });

  it('resumes a cancelled workflow and completes remaining work once', async () => {
    const db = new MemoryDb();
    await startWorkflowRun({
      db: db as any,
      id: 'resume-food-run',
      domain: 'food',
      workflowId: 'meal-plan-to-shopping',
      steps,
    });
    await recordWorkflowStep({
      db: db as any,
      runId: 'resume-food-run',
      stepId: 'choose-dinner',
      status: 'completed',
      receipt: {
        operation_ids: ['op-plan-green-dal'],
        action_ids: ['action-plan-green-dal'],
        record_ids: ['meal-green-dal'],
      },
    });
    await cancelWorkflowRun({
      db: db as any,
      runId: 'resume-food-run',
      reason: 'Pause before shopping.',
    });

    const resumed = await resumeWorkflowRun({ db: db as any, runId: 'resume-food-run' });
    expect(resumed.row.status).toBe('running');
    expect(resumed.checkpoint.resume_count).toBe(1);
    expect(resumed.checkpoint.steps.map((step) => step.status)).toEqual([
      'completed',
      'pending',
      'pending',
    ]);

    await recordWorkflowStep({
      db: db as any,
      runId: 'resume-food-run',
      stepId: 'reserve-pantry',
      status: 'completed',
      receipt: { operation_ids: ['op-reserve-yogurt'], record_ids: ['pantry-yogurt'] },
    });
    const completed = await recordWorkflowStep({
      db: db as any,
      runId: 'resume-food-run',
      stepId: 'build-shopping',
      status: 'completed',
      receipt: { operation_ids: ['op-buy-spinach'], record_ids: ['shopping-spinach'] },
    });
    const summary = await getWorkflowReceiptSummary(db as any, 'resume-food-run');

    expect(completed.row.status).toBe('completed');
    expect(summary.operation_ids).toEqual(['op-plan-green-dal', 'op-reserve-yogurt', 'op-buy-spinach']);
    expect(summary.record_ids).toEqual(['meal-green-dal', 'pantry-yogurt', 'shopping-spinach']);
    expect(new Set(summary.operation_ids).size).toBe(summary.operation_ids.length);
  });

  it('blocks writes after cancel until resume restores pending steps', async () => {
    const db = new MemoryDb();
    await startWorkflowRun({
      db: db as any,
      id: 'blocked-after-cancel-run',
      domain: 'food',
      workflowId: 'meal-plan-to-shopping',
      steps,
    });
    await cancelWorkflowRun({
      db: db as any,
      runId: 'blocked-after-cancel-run',
      reason: 'Stop before writing.',
    });

    await expect(recordWorkflowStep({
      db: db as any,
      runId: 'blocked-after-cancel-run',
      stepId: 'choose-dinner',
      status: 'completed',
      receipt: { operation_ids: ['op-should-not-write'] },
    })).rejects.toThrow('resume before recording');

    const resumed = await resumeWorkflowRun({ db: db as any, runId: 'blocked-after-cancel-run' });
    expect(resumed.row.status).toBe('running');
    const recorded = await recordWorkflowStep({
      db: db as any,
      runId: 'blocked-after-cancel-run',
      stepId: 'choose-dinner',
      status: 'completed',
      receipt: { operation_ids: ['op-after-resume'] },
    });

    expect(recorded.row.status).toBe('running');
    expect(recorded.checkpoint.completed_operation_ids).toEqual(['op-after-resume']);
  });

  it('marks unsafe cancellation failed when a non-cancellable step is active', async () => {
    const db = new MemoryDb();
    await startWorkflowRun({
      db: db as any,
      id: 'unsafe-cancel-run',
      domain: 'food',
      workflowId: 'unsafe-workflow',
      steps: [
        { id: 'write-provider', title: 'Write provider', cancellable: false },
        { id: 'notify', title: 'Notify' },
      ],
    });

    const cancelled = await cancelWorkflowRun({
      db: db as any,
      runId: 'unsafe-cancel-run',
      reason: 'User stopped while provider write is unsafe.',
    });

    expect(cancelled.row.status).toBe('failed');
    expect(cancelled.checkpoint.steps.map((step) => step.status)).toEqual(['failed', 'cancelled']);
    expect(cancelled.checkpoint.steps[0]?.error).toBe('Step is not cancellation safe.');
    const resumed = await resumeWorkflowRun({ db: db as any, runId: 'unsafe-cancel-run' });
    expect(resumed.row.status).toBe('running');
    expect(resumed.checkpoint.steps.map((step) => step.status)).toEqual(['pending', 'pending']);
  });

  it('keeps completed workflows immutable when cancel or resume is requested later', async () => {
    const db = new MemoryDb();
    await startWorkflowRun({
      db: db as any,
      id: 'done-food-run',
      domain: 'food',
      workflowId: 'single-step',
      steps: [{ id: 'done', title: 'Done' }],
    });
    await recordWorkflowStep({
      db: db as any,
      runId: 'done-food-run',
      stepId: 'done',
      status: 'completed',
      receipt: { operation_ids: ['op-done'] },
    });

    const cancelled = await cancelWorkflowRun({
      db: db as any,
      runId: 'done-food-run',
      reason: 'Too late.',
    });
    const resumed = await resumeWorkflowRun({ db: db as any, runId: 'done-food-run' });

    expect(cancelled.row.status).toBe('completed');
    expect(resumed.row.status).toBe('completed');
    expect(resumed.checkpoint.steps[0]?.status).toBe('completed');
  });

  it('pauses and resumes without writing while paused', async () => {
    const db = new MemoryDb();
    await startWorkflowRun({
      db: db as any,
      id: 'pause-food-run',
      domain: 'food',
      workflowId: 'meal-plan-to-shopping',
      steps,
    });

    const paused = await pauseWorkflowRun({ db: db as any, runId: 'pause-food-run' });
    expect(paused.row.status).toBe('running');
    expect((paused.checkpoint as { workflow_control_state?: string }).workflow_control_state).toBe('paused');

    await expect(recordWorkflowStep({
      db: db as any,
      runId: 'pause-food-run',
      stepId: 'choose-dinner',
      status: 'completed',
      receipt: { operation_ids: ['op-paused-write'] },
    })).rejects.toThrow('resume before recording');

    const resumed = await resumeWorkflowRun({ db: db as any, runId: 'pause-food-run' });
    expect(resumed.row.status).toBe('running');
    expect((resumed.checkpoint as { workflow_control_state?: string }).workflow_control_state).toBe('running');
    expect(resumed.checkpoint.resume_count).toBe(1);

    const recorded = await recordWorkflowStep({
      db: db as any,
      runId: 'pause-food-run',
      stepId: 'choose-dinner',
      status: 'completed',
      receipt: { operation_ids: ['op-after-resume'] },
    });
    expect(recorded.row.status).toBe('running');
    expect(recorded.checkpoint.completed_operation_ids).toEqual(['op-after-resume']);
  });

  it('proposes compensation operations in reverse order with undo idempotency keys and no DB mutation', async () => {
    const db = new MemoryDb();
    const runId = 'compensate-workflow-run';
    await startWorkflowRun({
      db: db as any,
      id: runId,
      domain: 'food',
      workflowId: 'meal-plan-to-shopping',
      steps: [
        { id: 'build-shopping', title: 'Build shopping list', tool: 'food.build_shopping_list' },
        { id: 'notify', title: 'Notify', tool: 'food.notify', cancellable: false },
      ],
    });

    const beforeA = canonicalRecord('meal-a', 0);
    const afterA = { ...beforeA, revision: 1, properties: { description: 'rev-1' }, updated_at: new Date().toISOString() };
    const beforeB = canonicalRecord('meal-b', 1);
    const afterB = { ...beforeB, revision: 2, properties: { description: 'rev-2' }, updated_at: new Date().toISOString() };

    await recordWorkflowStep({
      db: db as any,
      runId,
      stepId: 'build-shopping',
      status: 'completed',
      receipt: { operation_ids: ['wf-op-meal-a'] },
    });
    await recordWorkflowStep({
      db: db as any,
      runId,
      stepId: 'notify',
      status: 'failed',
      receipt: { operation_ids: ['wf-op-meal-b'] },
      error: 'notify failed',
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

    const beforeSize = db.operations.size;
    const snapshotBefore = await getWorkflowRunSnapshot(db as any, runId);
    expect(checkpointControlState(snapshotBefore?.checkpoint as { workflow_control_state?: string })).toBe('failed');

    const compensation = await proposeWorkflowCompensation({ db: db as any, runId });
    expect(compensation.control_state).toBe('compensating');
    expect(compensation.proposals).toHaveLength(2);
    expect(compensation.proposals[0]?.idempotency_key).toBe('meal-b-key:undo');
    expect(compensation.proposals[1]?.idempotency_key).toBe('meal-a-key:undo');
    expect((compensation.proposals[0] as { op_id?: string }).op_id).toBe('wf-op-meal-b:undo');
    expect(db.operations.size).toBe(beforeSize);
    expect(db.operations.get('wf-op-meal-a')?.status).toBe('applied');
    expect(db.operations.get('wf-op-meal-b')?.status).toBe('applied');
  });
});
