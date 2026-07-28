import type { SQLiteDatabase } from 'expo-sqlite';

import {
  createWorkflowRun,
  getWorkflowRun,
  updateWorkflowRun,
  WorkflowRunRow,
  WorkflowRunStatus,
} from '@/src/db/workflows';
import type {
  WorkflowCheckpointPayload,
  WorkflowCheckpointStep,
  WorkflowReceiptSummary,
  WorkflowStepDefinition,
  WorkflowStepReceipt,
  WorkflowStepStatus,
} from '@/packages/shared/contracts/workflow';
import { computeInverse } from '@/src/ops/inverse';
import type { Operation } from '@/src/ops/operation';
import { transitionWorkflow, WorkflowControlEvent, WorkflowControlState } from '@/server/src/workflows/control-machine';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';

export type WorkflowRunSnapshot = {
  row: WorkflowRunRow;
  checkpoint: WorkflowCheckpointPayload;
};

export type WorkflowCompensationProposal = {
  run_id: string;
  workflow_id: string;
  control_state: WorkflowControlState;
  proposals: Operation[];
};

const VERSION = 'utopia.workflow-run.v1' as const;

type WorkflowOperationRow = {
  op_id: string;
  app_installation_id: string;
  kind: string;
  domain: string;
  collection: string;
  record_id: string;
  expected_revision: number | null;
  actor: string;
  origin: string;
  idempotency_key: string | null;
  changes_json: string | null;
  before_json: string | null;
  after_json: string | null;
  status: string;
};

type RuntimeCheckpoint = WorkflowCheckpointPayload & {
  workflow_control_state?: WorkflowControlState;
};

type RowStatusOptions = 'running' | 'completed' | 'cancelled' | 'failed';

const FAILED_REASONS = {
  NOT_CANCEL_SAFE: 'Step is not cancellation safe.',
};

export async function startWorkflowRun(input: {
  db: SQLiteDatabase;
  id: string;
  appInstallationId?: string | null;
  domain: string;
  workflowId: string;
  inputs?: Record<string, unknown>;
  steps: WorkflowStepDefinition[];
}): Promise<WorkflowRunSnapshot> {
  const now = new Date().toISOString();
  const checkpoint: RuntimeCheckpoint = {
    schema_version: VERSION,
    run_id: input.id,
    domain: input.domain,
    workflow_id: input.workflowId,
    cursor: 0,
    resume_count: 0,
    steps: input.steps.map((step) => ({
      ...step,
      cancellable: step.cancellable ?? true,
      status: 'pending',
      receipts: [],
    })),
    completed_operation_ids: [],
    completed_action_ids: [],
    source_ids: [],
    created_at: now,
    updated_at: now,
    workflow_control_state: 'running',
  };
  const row = await createWorkflowRun(input.db, {
    id: input.id,
    appInstallationId: input.appInstallationId,
    domain: input.domain,
    workflow_id: input.workflowId,
    inputs: input.inputs ?? {},
    status: 'running',
    payload: checkpoint,
  });
  return { row, checkpoint };
}

export async function getWorkflowRunSnapshot(
  db: SQLiteDatabase,
  runId: string,
  appInstallationId?: string | null,
): Promise<WorkflowRunSnapshot | null> {
  const row = await getWorkflowRun(db, runId, appInstallationId ?? undefined);
  if (!row) return null;
  return { row, checkpoint: checkpointFromRow(row) };
}

export async function pauseWorkflowRun(input: {
  db: SQLiteDatabase;
  runId: string;
  appInstallationId?: string | null;
}): Promise<WorkflowRunSnapshot> {
  const snapshot = await requireSnapshot(input.db, input.runId, input.appInstallationId);
  const state = controlStateFromSnapshot(snapshot);
  if (state === 'completed' || state === 'cancelled') return snapshot;
  const nextState = transitionWorkflowSafe(state, 'PAUSE');
  if (!nextState || nextState === state) return snapshot;

  const checkpoint = checkpointWithControlState(snapshot.checkpoint, nextState);
  await updateWorkflowRun(input.db, input.runId, {
    appInstallationId: input.appInstallationId,
    status: toRowStatus(nextState),
    payload: checkpoint,
  });
  return requireSnapshot(input.db, input.runId, input.appInstallationId);
}

export async function recordWorkflowStep(input: {
  db: SQLiteDatabase;
  runId: string;
  appInstallationId?: string | null;
  stepId: string;
  status: Exclude<WorkflowStepStatus, 'pending'>;
  receipt?: WorkflowStepReceipt;
  error?: string;
}): Promise<WorkflowRunSnapshot> {
  const snapshot = await requireSnapshot(input.db, input.runId, input.appInstallationId);
  const controlState = controlStateFromSnapshot(snapshot);
  if (snapshot.row.status === 'completed' || snapshot.row.status === 'cancelled' || snapshot.row.status === 'failed' || controlState === 'paused') {
    throw new Error(`Workflow run is ${snapshot.row.status}; resume before recording more steps.`);
  }
  const checkpoint = cloneCheckpoint(snapshot.checkpoint);
  const step = checkpoint.steps.find((item) => item.id === input.stepId);
  if (!step) {
    throw new Error(`Unknown workflow step: ${input.stepId}`);
  }

  const now = new Date().toISOString();
  if (!step.started_at) step.started_at = now;
  step.status = input.status;
  if (input.receipt) {
    step.receipts.push(input.receipt);
    mergeUnique(checkpoint.completed_operation_ids, input.receipt.operation_ids);
    mergeUnique(checkpoint.completed_action_ids, input.receipt.action_ids);
    mergeUnique(checkpoint.source_ids, input.receipt.source_ids);
  }
  if (input.status === 'completed') step.completed_at = now;
  if (input.status === 'cancelled') step.cancelled_at = now;
  if (input.status === 'failed') {
    step.failed_at = now;
    step.error = input.error ?? input.receipt?.message ?? 'Workflow step failed.';
    checkpoint.failure_reason = step.error;
  }

  checkpoint.cursor = nextCursor(checkpoint.steps);
  checkpoint.updated_at = now;

  const status = workflowStatus(checkpoint.steps, input.status);
  const event = nextControlEventFromStepStatus(input.status, status);
  const nextControlState = event ? transitionWorkflowSafe(controlState, event) : null;
  const nextStatus = nextControlState ? toRowStatus(nextControlState) : status;
  const nextCheckpoint = checkpointWithControlState(checkpoint, nextControlState ?? controlState);
  await updateWorkflowRun(input.db, input.runId, { appInstallationId: input.appInstallationId, status: nextStatus, payload: nextCheckpoint });
  return requireSnapshot(input.db, input.runId, input.appInstallationId);
}

export async function proposeWorkflowCompensation(input: {
  db: SQLiteDatabase;
  runId: string;
  appInstallationId?: string | null;
}): Promise<WorkflowCompensationProposal> {
  const snapshot = await requireSnapshot(input.db, input.runId, input.appInstallationId);
  const controlState = controlStateFromSnapshot(snapshot);

  if (controlState === 'running' || controlState === 'paused' || controlState === 'cancelled') {
    throw new Error(`Cannot propose compensation for workflow in ${controlState} state.`);
  }

  let nextState = controlState;
  if (controlState === 'failed') {
    nextState = 'compensating';
  } else if (controlState !== 'compensating' && controlState !== 'compensated') {
    const compensatedState = transitionWorkflowSafe(controlState, 'COMPENSATE');
    if (!compensatedState) {
      throw new Error(`Cannot propose compensation for workflow in ${controlState} state.`);
    }
    if (compensatedState === 'running' || compensatedState === 'paused' || compensatedState === 'cancelled') {
      throw new Error(`Cannot propose compensation for workflow in ${controlState} state.`);
    }
    nextState = compensatedState;
  }

  if (nextState !== controlState) {
    const controlCheckpoint = checkpointWithControlState(snapshot.checkpoint, nextState);
    await updateWorkflowRun(input.db, input.runId, {
      appInstallationId: input.appInstallationId,
      status: toRowStatus(nextState),
      payload: controlCheckpoint,
    });
  }

  const refreshed = await requireSnapshot(input.db, input.runId, input.appInstallationId);
  const proposals = await buildCompensationProposals(input.db, refreshed.row.app_installation_id, refreshed.checkpoint);
  const finalState = controlStateFromSnapshot(refreshed);
  return {
    run_id: refreshed.row.id,
    workflow_id: refreshed.row.workflow_id,
    control_state: finalState,
    proposals,
  };
}

export async function cancelWorkflowRun(input: {
  db: SQLiteDatabase;
  runId: string;
  appInstallationId?: string | null;
  reason: string;
}): Promise<WorkflowRunSnapshot> {
  const snapshot = await requireSnapshot(input.db, input.runId, input.appInstallationId);
  if (snapshot.row.status === 'completed') return snapshot;
  const controlState = controlStateFromSnapshot(snapshot);

  const checkpoint = cloneCheckpoint(snapshot.checkpoint);
  const now = new Date().toISOString();
  let hasUnsafeStep = false;
  for (const step of checkpoint.steps) {
    if (step.status === 'pending' || step.status === 'running') {
      step.status = step.cancellable === false ? 'failed' : 'cancelled';
      if (step.status === 'cancelled') step.cancelled_at = now;
      if (step.status === 'failed') {
        hasUnsafeStep = true;
        step.failed_at = now;
        step.error = FAILED_REASONS.NOT_CANCEL_SAFE;
      }
    }
  }
  checkpoint.cancelled_at = now;
  checkpoint.cancel_reason = input.reason;
  checkpoint.updated_at = now;
  checkpoint.cursor = nextCursor(checkpoint.steps);

  const nextState = transitionWorkflowSafe(controlState, hasUnsafeStep ? 'FAIL' : 'CANCEL') ?? controlState;

  await updateWorkflowRun(input.db, input.runId, {
    appInstallationId: input.appInstallationId,
    status: toRowStatus(nextState),
    payload: checkpointWithControlState(checkpoint, nextState),
  });
  return requireSnapshot(input.db, input.runId, input.appInstallationId);
}

export async function resumeWorkflowRun(input: {
  db: SQLiteDatabase;
  runId: string;
  appInstallationId?: string | null;
}): Promise<WorkflowRunSnapshot> {
  const snapshot = await requireSnapshot(input.db, input.runId, input.appInstallationId);
  if (snapshot.row.status === 'completed') return snapshot;
  const controlState = controlStateFromSnapshot(snapshot);
  const baseControlState = controlState === 'cancelled' ? 'paused' : controlState;

  const checkpoint = cloneCheckpoint(snapshot.checkpoint);
  const now = new Date().toISOString();
  for (const step of checkpoint.steps) {
    if (step.status === 'cancelled' || step.status === 'failed' || step.status === 'running') {
      step.status = 'pending';
      delete step.cancelled_at;
      delete step.failed_at;
      delete step.error;
    }
  }
  checkpoint.resume_count += 1;
  checkpoint.resumed_at = now;
  checkpoint.updated_at = now;
  checkpoint.cursor = nextCursor(checkpoint.steps);
  delete checkpoint.cancelled_at;
  delete checkpoint.cancel_reason;
  delete checkpoint.failure_reason;

  const nextControlState =
    baseControlState === 'failed'
      ? 'running'
      : transitionWorkflowSafe(baseControlState, 'RESUME') ?? baseControlState;

  await updateWorkflowRun(input.db, input.runId, {
    appInstallationId: input.appInstallationId,
    status: toRowStatus(nextControlState),
    payload: checkpointWithControlState(checkpoint, nextControlState),
  });
  return requireSnapshot(input.db, input.runId, input.appInstallationId);
}

export async function getWorkflowReceiptSummary(
  db: SQLiteDatabase,
  runId: string,
  appInstallationId?: string | null,
): Promise<WorkflowReceiptSummary> {
  const snapshot = await requireSnapshot(db, runId, appInstallationId);
  const receipts = snapshot.checkpoint.steps.flatMap((step) => step.receipts);
  return {
    run_id: runId,
    workflow_id: snapshot.row.workflow_id,
    status: snapshot.row.status,
    completed_steps: snapshot.checkpoint.steps.filter((step) => step.status === 'completed').length,
    cancelled_steps: snapshot.checkpoint.steps.filter((step) => step.status === 'cancelled').length,
    failed_steps: snapshot.checkpoint.steps.filter((step) => step.status === 'failed').length,
    operation_ids: unique(receipts.flatMap((receipt) => receipt.operation_ids ?? [])),
    action_ids: unique(receipts.flatMap((receipt) => receipt.action_ids ?? [])),
    source_ids: unique(receipts.flatMap((receipt) => receipt.source_ids ?? [])),
    record_ids: unique(receipts.flatMap((receipt) => receipt.record_ids ?? [])),
    receipts,
  };
}

async function requireSnapshot(db: SQLiteDatabase, runId: string, appInstallationId?: string | null): Promise<WorkflowRunSnapshot> {
  const snapshot = await getWorkflowRunSnapshot(db, runId, appInstallationId);
  if (!snapshot) {
    throw new Error(`Unknown workflow run: ${runId}`);
  }
  return snapshot;
}

function checkpointFromRow(row: WorkflowRunRow): WorkflowCheckpointPayload {
  const parsed = row.payload_json ? safeParseJson(row.payload_json) : null;
  if (isCheckpointPayload(parsed)) {
    return parsed;
  }
  const now = row.updated_at || new Date().toISOString();
  return {
    schema_version: VERSION,
    run_id: row.id,
    domain: row.domain,
    workflow_id: row.workflow_id,
    cursor: 0,
    resume_count: 0,
    steps: [],
    completed_operation_ids: [],
    completed_action_ids: [],
    source_ids: [],
    created_at: row.created_at || now,
    updated_at: now,
  };
}

function isCheckpointPayload(value: unknown): value is WorkflowCheckpointPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkflowCheckpointPayload>;
  return candidate.schema_version === VERSION
    && typeof candidate.run_id === 'string'
    && Array.isArray(candidate.steps)
    && Array.isArray(candidate.completed_operation_ids)
    && Array.isArray(candidate.completed_action_ids)
    && Array.isArray(candidate.source_ids);
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function cloneCheckpoint(checkpoint: WorkflowCheckpointPayload): WorkflowCheckpointPayload {
  return JSON.parse(JSON.stringify(checkpoint)) as WorkflowCheckpointPayload;
}

function workflowStatus(
  steps: WorkflowCheckpointStep[],
  latestStatus: WorkflowStepStatus,
): WorkflowRunStatus {
  if (latestStatus === 'failed') return 'failed';
  if (latestStatus === 'cancelled') return 'cancelled';
  return steps.length > 0 && steps.every((step) => step.status === 'completed') ? 'completed' : 'running';
}

function nextCursor(steps: WorkflowCheckpointStep[]) {
  const index = steps.findIndex((step) => step.status !== 'completed');
  return index === -1 ? steps.length : index;
}

function controlStateFromSnapshot(snapshot: WorkflowRunSnapshot): WorkflowControlState {
  const checkpoint = snapshot.checkpoint as RuntimeCheckpoint;
  if (checkpoint.workflow_control_state && isWorkflowControlState(checkpoint.workflow_control_state)) {
    return checkpoint.workflow_control_state;
  }

  return mapRowStatusToControlState(snapshot.row.status);
}

function checkpointWithControlState(
  checkpoint: WorkflowCheckpointPayload,
  state: WorkflowControlState,
): WorkflowCheckpointPayload {
  const withState = cloneCheckpoint(checkpoint);
  (withState as RuntimeCheckpoint).workflow_control_state = state;
  return withState;
}

function isWorkflowControlState(value: unknown): value is WorkflowControlState {
  return typeof value === 'string' && [
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled',
    'compensating',
    'compensated',
  ].includes(value);
}

function mapRowStatusToControlState(status: RowStatusOptions): WorkflowControlState {
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'running';
}

function toRowStatus(state: WorkflowControlState): RowStatusOptions {
  if (state === 'completed') return 'completed';
  if (state === 'cancelled') return 'cancelled';
  return state === 'failed' || state === 'compensating' || state === 'compensated' ? 'failed' : 'running';
}

function transitionWorkflowSafe(state: WorkflowControlState, event: WorkflowControlEvent): WorkflowControlState | null {
  try {
    const next = transitionWorkflow(state, event);
    return next;
  } catch {
    return null;
  }
}

async function buildCompensationProposals(
  db: SQLiteDatabase,
  appInstallationId: string,
  checkpoint: WorkflowCheckpointPayload,
): Promise<Operation[]> {
  const operationIds = Array.from(new Set(checkpoint.completed_operation_ids)).reverse();
  const proposals: Operation[] = [];

  for (const operationId of operationIds) {
    const operation = await loadOperationById(db, appInstallationId, operationId);
    if (!operation) continue;

    const row = operation;
    if (row.status !== 'applied') continue;

    const before = safeParse<CanonicalRecord>(row.before_json);
    const after = safeParse<CanonicalRecord>(row.after_json);
    const original = safeParse<Operation>(row.changes_json);
    if (!original || !after) continue;

    proposals.push(computeInverse(before, original, after));
  }

  return proposals;
}

async function loadOperationById(
  db: SQLiteDatabase,
  appInstallationId: string,
  opId: string,
): Promise<WorkflowOperationRow | null> {
  return db.getFirstAsync<WorkflowOperationRow>(
    'SELECT * FROM operations WHERE app_installation_id = ? AND op_id = ?',
    [appInstallationId, opId],
  );
}

function nextControlEventFromStepStatus(
  stepStatus: WorkflowStepStatus,
  checkpointStatus: WorkflowRunStatus,
): WorkflowControlEvent | null {
  if (stepStatus === 'completed' && checkpointStatus === 'completed') return 'COMPLETE';
  if (stepStatus === 'failed') return 'FAIL';
  if (stepStatus === 'cancelled') return 'CANCEL';
  return null;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function mergeUnique(target: string[], values?: string[]) {
  for (const value of values ?? []) {
    if (!target.includes(value)) target.push(value);
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
