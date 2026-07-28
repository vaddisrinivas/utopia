import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'phase4-mcp-workflow-replay');
mkdirSync(outDir, { recursive: true });

const stateDir = mkdtempSync(join(tmpdir(), `wf-replay-${randomBytes(4).toString('hex')}-`));
process.env.WONDER_RUNTIME_STATE_PATH = join(stateDir, 'wonder-runtime.json');
process.env.LIFEOS_WORKFLOW_CHECKPOINT_PATH = join(stateDir, 'workflow-runs.json');

type ToolResult = {
  json: unknown;
  reviewOnly: boolean;
  safety: string;
  review_flags?: {
    policy_reviewed: boolean;
    replay_recoverable: boolean;
    cancellation_safe: boolean;
  };
  action?: { id?: string };
};

type WorkflowActionAfter = {
  changed_records?: string[];
  checkpoint_run_id?: string;
};

type WorkflowResult = {
  status?: 'completed' | 'failed';
  action?: {
    id: string;
    after_json?: WorkflowActionAfter | { checkpoint_run_id?: string; changed_records?: string[] };
  };
  checkpoint?: {
    runId?: string;
    compensation?: {
      applied?: number;
      skipped?: number;
      errors?: Array<unknown>;
    };
  };
};

type RunReplayResult = WorkflowResult & { replayed?: boolean };

type UndoResult = {
  status?: 'completed' | 'failed';
  replayed?: boolean;
  action?: {
    status?: 'cancelled' | 'completed' | 'failed';
    id?: string;
  };
  undoResult?: { success?: boolean; message?: string };
};

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

function asWorkflowResult(input: ToolResult['json'], action: string): WorkflowResult {
  if (!input || typeof input !== 'object') {
    fail(`${action} returned non-object payload`);
  }
  return input as WorkflowResult;
}

function asUndoResult(input: ToolResult['json']): UndoResult {
  if (!input || typeof input !== 'object') {
    fail('undo_action returned non-object payload');
  }
  return input as UndoResult;
}

async function callTool(tools: typeof import('../../server/src/tools/catalog'), name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await tools.callMcpTool(name, args)) as ToolResult;
}

function asAfterJson(value: unknown): WorkflowActionAfter | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as WorkflowActionAfter;
}

(async () => {
  const tools = await import('../../server/src/tools/catalog');
  const state = await import('../../server/src/runtime/state');
  const checkpoints = await import('../../server/src/workflows/checkpoint');

  const workflowId = 'phase4_replay_workflow';
  const actionId = `phase4-replay-${Date.now()}`;
  const idempotencyKey = 'phase4_replay_probe_1';

  const runToolResult = await callTool(tools, 'utopia.run_workflow', {
    actor: 'hearth',
    workflow: workflowId,
    domain: 'food',
    action_id: actionId,
    idempotency_key: idempotencyKey,
  });
  const runPayload = asWorkflowResult(runToolResult.json, 'run_workflow');

  if (runPayload.status !== 'completed') {
    fail(`run_workflow did not complete: ${JSON.stringify(runPayload)}`);
  }
  if (!runPayload.action?.id) {
    fail('run_workflow did not return an action id');
  }
  if (!runToolResult.review_flags?.cancellation_safe) {
    fail('run_workflow should mark action result as cancellation-safe');
  }
  const workflowAction = state.getActionEvent(runPayload.action.id);
  if (!workflowAction || workflowAction.status !== 'completed') {
    fail(`action ${runPayload.action.id} missing or incomplete`);
  }

  const changedRecords = runPayload.action.after_json?.changed_records ?? [];
  if (changedRecords.length < 2) {
    fail(`expected at least 2 workflow-created records, got ${changedRecords.length}`);
  }
  for (const id of changedRecords) {
    if (!state.findRecord(id)) {
      fail(`expected record ${id} to exist before undo`);
    }
  }

  const checkpointRunId = runPayload.checkpoint?.runId
    ?? asAfterJson((workflowAction as { after_json?: unknown }).after_json)?.checkpoint_run_id
    ?? asAfterJson(runPayload.action.after_json)?.checkpoint_run_id;
  if (typeof checkpointRunId !== 'string' || !checkpointRunId.trim()) {
    fail('run_workflow did not return a checkpoint run id');
  }
  const checkpoint = checkpoints.getWorkflowCheckpoint(checkpointRunId);
  if (!checkpoint) {
    fail(`checkpoint ${checkpointRunId} missing`);
  }
  if (checkpoint.status !== 'completed') {
    fail(`checkpoint status expected completed, got ${checkpoint.status}`);
  }
  if (checkpoint.steps.length < 2) {
    fail(`expected checkpoint to contain at least two steps, got ${checkpoint.steps.length}`);
  }
  const stepActionIds = checkpoint.steps
    .map((step) => step.result && typeof step.result === 'object'
      ? String((step.result as { action_id?: unknown }).action_id ?? '')
      : '')
    .filter(Boolean);
  assert(stepActionIds.length === changedRecords.length, 'every workflow mutation must emit a canonical child action');
  for (const childActionId of stepActionIds) {
    assert(state.getActionEvent(childActionId)?.status === 'completed', `workflow child action ${childActionId} must complete`);
  }
  const childOperationIds = new Set(state.listOperationCommitOutbox().map((item) => item.event.operationId));
  for (const childActionId of stepActionIds) {
    assert(childOperationIds.has(`${childActionId}:operation`), `workflow child action ${childActionId} must enqueue a commit event`);
  }

  const runReplayToolResult = await callTool(tools, 'utopia.run_workflow', {
    actor: 'hearth',
    workflow: workflowId,
    domain: 'food',
    action_id: `${actionId}-replay`,
    idempotency_key: idempotencyKey,
  });
  const runReplayPayload = asWorkflowResult(runReplayToolResult.json, 'run_workflow replay') as RunReplayResult;
  assert(runReplayPayload.replayed === true, 'run_workflow replay should return replayed=true');
  assert(runReplayPayload.action?.id === runPayload.action.id, 'run_workflow replay should keep action id stable');

  const undoToolResult = await callTool(tools, 'utopia.undo_action', {
    actor: 'hearth',
    actionId: runPayload.action.id,
    idempotency_key: `${idempotencyKey}-undo`,
  });
  const undoPayload = asUndoResult(undoToolResult.json);
  if (undoPayload.status !== 'completed') {
    fail(`undo_action failed: ${undoPayload.undoResult?.message || undoPayload.action?.status || 'unknown reason'}`);
  }

  const undoReplayResult = await callTool(tools, 'utopia.undo_action', {
    actor: 'hearth',
    actionId: runPayload.action.id,
    idempotency_key: `${idempotencyKey}-undo`,
  });
  const undoReplay = asUndoResult(undoReplayResult.json);
  assert(undoReplay.replayed === true, 'undo_action replay should return replayed=true');

  for (const id of changedRecords) {
    if (state.findRecord(id)) {
      fail(`record ${id} should have been undone`);
    }
  }
  const canonicalUndoActions = state.listActionEvents().filter((action) =>
    action.id.startsWith(`canonical-undo:${runPayload.action?.id}:`)
    || action.source_ids.includes(runPayload.action?.id ?? '')
  );
  assert(canonicalUndoActions.length === changedRecords.length, 'workflow undo must emit one canonical mutation action per record');
  assert(canonicalUndoActions.every((action) => action.status === 'completed'), 'canonical workflow undo actions must complete');

  const failureActionId = `${actionId}-failure`;
  const compensationRun = await callTool(tools, 'utopia.run_workflow', {
    actor: 'hearth',
    workflow: 'phase4_compensation_probe',
    domain: 'food',
    action_id: failureActionId,
    idempotency_key: `${idempotencyKey}-comp-fail`,
  });
  const failurePayload = asWorkflowResult(compensationRun.json, 'failing run_workflow');
  if (failurePayload.status !== 'failed') {
    fail(`compensation probe should fail; got ${String(failurePayload.status)}`);
  }

  const failureRunId = failurePayload.checkpoint?.runId
    ?? failurePayload.action?.after_json?.checkpoint_run_id;
  assert(typeof failureRunId === 'string' && failureRunId.length > 0, 'failing workflow should return checkpoint.runId');
  const failureCheckpoint = checkpoints.getWorkflowCheckpoint(failureRunId);
  if (!failureCheckpoint) {
    fail(`compensation checkpoint ${failureRunId} missing`);
  }
  if (failureCheckpoint.status !== 'compensated') {
    fail(`compensation checkpoint should be compensated, got ${failureCheckpoint.status}`);
  }

  const failureCompensation = failurePayload.checkpoint?.compensation;
  const compensationApplied = typeof failureCompensation?.applied === 'number' ? failureCompensation.applied : undefined;
  assert(compensationApplied !== undefined && compensationApplied > 0, 'compensation should apply at least one operation');

  const failureChangedRecords = failurePayload.action?.after_json?.changed_records ?? [];
  for (const id of failureChangedRecords ?? []) {
    let found = false;
    try {
      await callTool(tools, 'utopia.read_record', { id });
      found = true;
    } catch {
      // expected after compensation
    }
    assert(!found, `failed workflow record ${id} should be removed by compensation`);
  }

  const proof = {
    proof: 'phase4_mcp_workflow_replay',
    evidence: {
      workflow_id: workflowId,
      action_id: workflowAction.id,
      changed_records: changedRecords,
      checkpoint_run_id: checkpointRunId,
      checkpoint_status: checkpoint.status,
      checkpoint_steps: checkpoint.steps.length,
      canonical_step_actions: stepActionIds,
      canonical_undo_actions: canonicalUndoActions.map((action) => action.id),
      run_replayed: runReplayPayload.replayed === true,
      run_action_stable: runReplayPayload.action?.id === runPayload.action.id,
      undo_replayed: undoReplay.replayed === true,
      undo_status: undoPayload.status,
      undo_action_status: undoPayload.action?.status,
      undo_success: undoPayload.undoResult?.success,
      compensation_probe: {
        status: failurePayload.status,
        checkpoint_status: failureCheckpoint.status,
        compensation_applied: failureCompensation?.applied,
        compensation_skipped: failureCompensation?.skipped,
      },
    },
    state_files: {
      runtime_state_path: process.env.WONDER_RUNTIME_STATE_PATH,
      checkpoint_path: process.env.LIFEOS_WORKFLOW_CHECKPOINT_PATH,
    },
    all_passed: true,
  };

  const outPath = join(outDir, 'phase4-mcp-workflow-replay-proof.json');
  writeFileSync(outPath, JSON.stringify(proof, null, 2), 'utf-8');
  console.log(`PASS ${outPath}`);
  console.log(`created_records=${changedRecords.join(',')}`);
  process.stdout.write(JSON.stringify(proof, null, 2));
  rmSync(stateDir, { recursive: true, force: true });
})().catch((error) => {
  rmSync(stateDir, { recursive: true, force: true });
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
