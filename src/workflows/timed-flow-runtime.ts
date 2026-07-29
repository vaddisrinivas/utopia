import type { SQLiteDatabase } from 'expo-sqlite';

import {
  applyStepFlowEvent,
  startStepFlow,
  type ClockSample,
  type StepFlowDefinition,
  type StepFlowEvent,
  type StepFlowSnapshot,
} from '@/packages/runtime-kernel/timed-flow';
import { updateWorkflowRun } from '@/src/db/workflows';
import {
  getWorkflowRunSnapshot,
  startWorkflowRun,
  type WorkflowRunSnapshot,
} from '@/src/workflows/runtime';

type TimedWorkflowCheckpoint = WorkflowRunSnapshot['checkpoint'] & {
  timed_flow?: StepFlowSnapshot;
};

const PROCESS_MONOTONIC_EPOCH = `process-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function currentFlowClock(): ClockSample {
  return {
    utcMs: Date.now(),
    monotonicMs: typeof performance === 'undefined' ? Date.now() : performance.now(),
    monotonicEpoch: PROCESS_MONOTONIC_EPOCH,
  };
}

export async function startPersistedStepFlow(input: {
  db: SQLiteDatabase;
  runId: string;
  appInstallationId: string;
  domain: string;
  workflowId: string;
  steps: readonly StepFlowDefinition[];
  clock?: ClockSample;
}): Promise<StepFlowSnapshot> {
  const existing = await loadPersistedStepFlow(
    input.db,
    input.runId,
    input.appInstallationId,
  );
  if (existing) return existing;

  const clock = input.clock ?? currentFlowClock();
  const flow = startStepFlow(input.runId, input.steps, clock);
  const run = await startWorkflowRun({
    db: input.db,
    id: input.runId,
    appInstallationId: input.appInstallationId,
    domain: input.domain,
    workflowId: input.workflowId,
    steps: input.steps.map((step) => ({ id: step.id, title: step.title })),
  });
  await persist(input.db, run, input.appInstallationId, flow);
  return flow;
}

export async function loadPersistedStepFlow(
  db: SQLiteDatabase,
  runId: string,
  appInstallationId: string,
): Promise<StepFlowSnapshot | null> {
  const run = await getWorkflowRunSnapshot(db, runId, appInstallationId);
  if (!run) return null;
  return (run.checkpoint as TimedWorkflowCheckpoint).timed_flow ?? null;
}

export async function dispatchPersistedStepFlow(input: {
  db: SQLiteDatabase;
  runId: string;
  appInstallationId: string;
  event: StepFlowEvent;
  clock?: ClockSample;
}): Promise<StepFlowSnapshot> {
  const run = await getWorkflowRunSnapshot(input.db, input.runId, input.appInstallationId);
  if (!run) throw new Error('step_flow_run_missing');
  const current = (run.checkpoint as TimedWorkflowCheckpoint).timed_flow;
  if (!current) throw new Error('step_flow_snapshot_missing');
  const next = applyStepFlowEvent(current, input.event, input.clock ?? currentFlowClock());
  if (next === current) return current;
  await persist(input.db, run, input.appInstallationId, next);
  return next;
}

async function persist(
  db: SQLiteDatabase,
  run: WorkflowRunSnapshot,
  appInstallationId: string,
  flow: StepFlowSnapshot,
): Promise<void> {
  const checkpoint: TimedWorkflowCheckpoint = {
    ...run.checkpoint,
    updated_at: new Date().toISOString(),
    timed_flow: flow,
  };
  await updateWorkflowRun(db, run.row.id, {
    appInstallationId,
    status: flow.status === 'completed'
      ? 'completed'
      : flow.status === 'cancelled'
        ? 'cancelled'
        : 'running',
    payload: checkpoint,
  });
}
