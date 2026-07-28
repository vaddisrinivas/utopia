import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

type Receipt = {
  action_id: string;
  status: string;
  tool: string;
  record_ids: string[];
  undo_token: string;
  source_snapshot?: Record<string, unknown>;
};

type ToolResult = {
  json: Record<string, unknown>;
  reviewOnly: boolean;
  safety: string;
  source_snapshot?: Record<string, unknown> | null;
  undo_token?: string;
  review_flags?: {
    policy_reviewed: boolean;
    replay_recoverable: boolean;
    cancellation_safe: boolean;
  };
  receipts?: Receipt[];
};

type EnvelopeShape = {
  allowed?: boolean;
  requiredConfig?: string[];
  source_snapshot?: Record<string, unknown>;
  message?: string;
  provider?: string;
  policy?: {
    reason?: string;
  };
};

type ApprovalRequest = {
  tool: string;
  operationId: string;
  idempotencyKey: string;
  operationHash: string;
};

type WorkflowPayload = EnvelopeShape & {
  action?: {
    id?: string;
    status?: string;
  };
  replayed?: boolean;
  status?: 'completed' | 'failed' | 'cancelled';
  changed_records?: string[];
  checkpoint?: {
    runId?: string;
    compensation?: {
      applied?: number;
      skipped?: number;
      errors?: unknown[];
    };
  };
  details?: unknown;
  checkpoint_run_id?: string;
};

type UndoPayload = EnvelopeShape & {
  action?: {
    id?: string;
    status?: 'completed' | 'failed' | 'cancelled';
  };
  undoResult?: { success?: boolean; message?: string };
  replayed?: boolean;
  status?: 'completed' | 'failed' | 'cancelled';
};

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'phase4-mcp-tool-contract');
mkdirSync(outDir, { recursive: true });

const stateDir = mkdtempSync(join(tmpdir(), `wf-tool-${randomBytes(4).toString('hex')}-`));
process.env.WONDER_RUNTIME_STATE_PATH = join(stateDir, 'wonder-runtime.json');
process.env.LIFEOS_WORKFLOW_CHECKPOINT_PATH = join(stateDir, 'workflow-runs.json');

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function actionId(result: ToolResult): string {
  const action = asRecord(result.json.action);
  const id = action.id;
  return typeof id === 'string' && id.length > 0 ? id : fail('tool response missing action.id');
}

function sourceSnapshot(result: ToolResult): Record<string, unknown> | null {
  const direct = asRecord(result.source_snapshot);
  const nested = asRecord(asRecord(result.json).source_snapshot);
  const chosen = Object.keys(direct).length > 0 ? direct : nested;
  return Object.keys(chosen).length > 0 ? chosen : null;
}

function assertWriteEnvelope(result: ToolResult, label: string) {
  assert(result.reviewOnly === false, `${label} should be executable write path`);
  const action = actionId(result);
  assert(typeof result.undo_token === 'string' && result.undo_token.length > 0, `${label} should expose undo_token`);
  assert(result.undo_token === action, `${label} undo_token should equal action.id`);
  assert(Array.isArray(result.receipts) && result.receipts.length > 0, `${label} should include receipts`);

  const receipt = result.receipts![0];
  assert(receipt.action_id === action, `${label} receipt.action_id should match action.id`);
  assert(Array.isArray(receipt.record_ids), `${label} receipt.record_ids should be array`);
  assert(receipt.undo_token === action, `${label} receipt.undo_token should match action.id`);

  assert(typeof result.review_flags?.policy_reviewed === 'boolean', `${label} should include review_flags.policy_reviewed`);
  assert(typeof result.review_flags?.replay_recoverable === 'boolean', `${label} should include review_flags.replay_recoverable`);
  assert(typeof result.review_flags?.cancellation_safe === 'boolean', `${label} should include review_flags.cancellation_safe`);
  assert(result.review_flags?.cancellation_safe === true, `${label} should be cancellation-safe`);
  assert(result.review_flags?.policy_reviewed === true, `${label} should not require policy review`);

  const snapshot = sourceSnapshot(result);
  if (snapshot !== null) {
    if (Object.prototype.hasOwnProperty.call(snapshot, 'provider') && snapshot.provider !== undefined) {
      assert(
        snapshot.provider === 'sqlite' || snapshot.provider === 'notion' || snapshot.provider === 'google_sheets',
        `${label} source_snapshot.provider should be canonical`,
      );
    }
  }
}

function assertQueuedForReviewEnvelope(result: ToolResult, label: string): ApprovalRequest {
  assert(result.reviewOnly === true, `${label} should queue for review`);
  assert(asRecord(result.json).status === 'queued_for_review', `${label} should return queued_for_review`);
  const action = actionId(result);
  assert(typeof result.undo_token === 'string' && result.undo_token.length > 0, `${label} should expose undo_token`);
  assert(result.undo_token === action, `${label} undo_token should equal action.id`);
  assert(Array.isArray(result.receipts) && result.receipts.length > 0, `${label} should include receipts`);

  const receipt = result.receipts![0];
  assert(receipt.action_id === action, `${label} receipt.action_id should match action.id`);
  assert(receipt.status === 'queued', `${label} receipt.status should stay queued until approval-bound execution`);
  assert(receipt.undo_token === action, `${label} receipt.undo_token should match action.id`);

  assert(result.review_flags?.policy_reviewed === false, `${label} should remain unreviewed`);
  assert(result.review_flags?.replay_recoverable === false, `${label} should not claim replay recoverable before execution`);
  assert(result.review_flags?.cancellation_safe === true, `${label} should be cancellation-safe`);

  const approvalRequest = asRecord(asRecord(result.json).approval_request) as Partial<ApprovalRequest>;
  assert(typeof approvalRequest.tool === 'string' && approvalRequest.tool.length > 0, `${label} should include approval_request.tool`);
  assert(typeof approvalRequest.operationId === 'string' && approvalRequest.operationId.length > 0, `${label} should include approval_request.operationId`);
  assert(typeof approvalRequest.idempotencyKey === 'string' && approvalRequest.idempotencyKey.length > 0, `${label} should include approval_request.idempotencyKey`);
  assert(typeof approvalRequest.operationHash === 'string' && approvalRequest.operationHash.length > 0, `${label} should include approval_request.operationHash`);
  return approvalRequest as ApprovalRequest;
}

function buildApprovalReceipt(request: ApprovalRequest, actor: string) {
  return {
    schemaVersion: 'wonder.mcp-review-approval.v1' as const,
    approver: actor,
    authority: 'phase4-contract',
    tool: request.tool,
    operationId: request.operationId,
    idempotencyKey: request.idempotencyKey,
    operationHash: request.operationHash,
    localActor: actor,
    approvedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
  };
}

function assertReplayEnvelope(base: ToolResult, replay: ToolResult, label: string) {
  assert(asRecord(replay.json).replayed === true, `${label} should set replayed=true`);
  assert(actionId(replay) === actionId(base), `${label} action.id should be stable`);
  assert(stableJson(sourceSnapshot(replay)) === stableJson(sourceSnapshot(base)), `${label} source_snapshot should be stable on replay`);
}

function assertQueuedForReviewStable(base: ToolResult, replay: ToolResult, label: string) {
  assert(replay.reviewOnly === true, `${label} should remain queued for review`);
  assert(actionId(replay) === actionId(base), `${label} action.id should stay stable while queued`);
  assert(asRecord(replay.json).status === 'queued_for_review', `${label} should remain queued_for_review`);
  assert(
    stableJson(asRecord(replay.json).approval_request) === stableJson(asRecord(base.json).approval_request),
    `${label} approval_request should stay stable while queued`,
  );
  assert(asRecord(replay.json).replayed !== true, `${label} should not claim replayed before execution`);
}

function assertPolicyBlocked(payload: EnvelopeShape, label: string) {
  assert(payload.allowed === false, `${label} should return allowed=false`);
  const hasPolicyReason = typeof payload.policy?.reason === 'string' && payload.policy.reason.length > 0;
  const hasMessage = typeof payload.message === 'string' && payload.message.length > 0;
  assert(hasPolicyReason || hasMessage, `${label} should include policy reason/message`);
}

function assertProviderRejection(payload: EnvelopeShape, provider: string, label: string) {
  assert(payload.allowed === false, `${label} should return allowed=false`);
  if (Array.isArray(payload.requiredConfig)) {
    assert(payload.requiredConfig.length > 0, `${label} should include requiredConfig entries when provided`);
  }
  if (typeof payload.provider === 'string') {
    assert(payload.provider === provider, `${label} payload provider should be ${provider}`);
  }
  const snapshot = asRecord(payload.source_snapshot);
  if (snapshot.provider !== undefined) {
    assert(snapshot.provider === provider, `${label} source_snapshot.provider should be ${provider}`);
  }
}

function assertWorkflowFailure(payload: WorkflowPayload, checkpointStatus: string, label: string) {
  assert(payload.status === 'failed', `${label} should fail`);
  assert(typeof payload.checkpoint?.runId === 'string' && payload.checkpoint.runId.length > 0, `${label} should include checkpoint run id`);
  const compensation = asRecord(payload.checkpoint?.compensation);
  assert(compensation !== null, `${label} should include compensation payload`);
  assert(payload.checkpoint.compensation !== undefined, `${label} checkpoint compensation missing`);
  assert(typeof payload.checkpoint.compensation === 'object', `${label} checkpoint compensation should be object`);
  const compApplied = (asRecord(payload.checkpoint.compensation).applied as number | undefined);
  assert(typeof compApplied === 'number' && compApplied > 0, `${label} compensation should apply at least one action`);
  assert(checkpointStatus === 'compensated', `${label} checkpoint status should be compensated`);
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tools = await import('../../server/src/tools/catalog');
  return (await tools.callMcpTool(name, args)) as ToolResult;
}

function expectFailure(action: () => Promise<unknown>, label: string) {
  return action().then(
    () => fail(`${label} should fail`),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert(message.length > 0, `${label} failure should have a message`);
    },
  );
}

(async () => {
  const state = await import('../../server/src/runtime/state');
  const checkpoints = await import('../../server/src/workflows/checkpoint');

  const baseKey = `phase4-tool-contract-${Date.now()}`;

  await expectFailure(
    () => callTool('utopia.missing_tool', {}),
    'unknown tool',
  );

  const createActionId = `${baseKey}-create-action`;
  const create = await callTool('utopia.create_record', {
    actor: 'hearth',
    domain: 'food',
    collection: 'recipe',
    data_home: 'local_sqlite',
    title: 'Contract create',
    idempotency_key: `${baseKey}-create`,
    action_id: createActionId,
  });
  assertWriteEnvelope(create, 'create_record');
  assert(actionId(create) === createActionId, 'create_record should honor action_id');
  const createPayload = asRecord(create.json);
  const createRecord = asRecord(createPayload.record);
  const createRecordId = createRecord.id;
  assert(typeof createRecordId === 'string' && createRecordId.length > 0, 'create_record should return record.id');

  const createReplay = await callTool('utopia.create_record', {
    actor: 'hearth',
    domain: 'food',
    collection: 'recipe',
    data_home: 'local_sqlite',
    title: 'Contract create',
    idempotency_key: `${baseKey}-create`,
    action_id: createActionId,
  });
  assertReplayEnvelope(create, createReplay, 'create_record replay');

  const blockedCreate = await callTool('utopia.create_record', {
    actor: 'hearth',
    domain: 'food',
    collection: 'recipe',
    data_home: 'local_sqlite',
    title: 'delete this record',
    idempotency_key: `${baseKey}-policy`,
    action_id: `${baseKey}-policy-action`,
  });
  assert(blockedCreate.reviewOnly === true, 'policy-blocked create should be review-only');
  assertPolicyBlocked(asRecord(blockedCreate.json), 'policy-blocked create');

  const updateActionId = `${baseKey}-update-action`;
  const update = await callTool('utopia.update_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'local_sqlite',
    patch: { title: 'Contract updated' },
    idempotency_key: `${baseKey}-update`,
    action_id: updateActionId,
  });
  assertWriteEnvelope(update, 'update_record');

  const updateReplay = await callTool('utopia.update_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'local_sqlite',
    patch: { title: 'Contract updated' },
    idempotency_key: `${baseKey}-update`,
    action_id: updateActionId,
  });
  assertReplayEnvelope(update, updateReplay, 'update_record replay');

  const archiveActionId = `${baseKey}-archive-action`;
  const archive = await callTool('utopia.archive_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'local_sqlite',
    idempotency_key: `${baseKey}-archive`,
    action_id: archiveActionId,
  });
  const archiveApproval = assertQueuedForReviewEnvelope(archive, 'archive_record');
  assert(archiveApproval.tool === 'utopia.archive_record', 'archive_record approval should bind tool name');
  assert(archiveApproval.idempotencyKey === `${baseKey}-archive`, 'archive_record approval should bind idempotency key');
  assert(archiveApproval.operationHash.startsWith('sha256:'), 'archive_record approval should include hash-bound operation');

  const archiveReplay = await callTool('utopia.archive_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'local_sqlite',
    idempotency_key: `${baseKey}-archive`,
    action_id: archiveActionId,
  });
  assertQueuedForReviewStable(archive, archiveReplay, 'archive_record replay');

  const archiveTampered = await callTool('utopia.archive_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'local_sqlite',
    idempotency_key: `${baseKey}-archive`,
    action_id: archiveActionId,
    approval_receipt: {
      ...buildApprovalReceipt(archiveApproval, 'hearth'),
      operationHash: 'sha256:tampered',
    },
  });
  assertQueuedForReviewEnvelope(archiveTampered, 'archive_record tampered approval');
  assert(asRecord(archiveTampered.json).approval_error === 'review_approval_hash_mismatch', 'archive_record tampered approval should be rejected');

  const archiveApproved = await callTool('utopia.archive_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'local_sqlite',
    idempotency_key: `${baseKey}-archive`,
    action_id: archiveActionId,
    approval_receipt: buildApprovalReceipt(archiveApproval, 'hearth'),
  });
  assertWriteEnvelope(archiveApproved, 'archive_record approved');

  const archiveApprovedReplay = await callTool('utopia.archive_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'local_sqlite',
    idempotency_key: `${baseKey}-archive`,
    action_id: archiveActionId,
    approval_receipt: buildApprovalReceipt(archiveApproval, 'hearth'),
  });
  assertReplayEnvelope(archiveApproved, archiveApprovedReplay, 'archive_record approved replay');

  const notionCreate = await callTool('utopia.create_record', {
    actor: 'hearth',
    domain: 'food',
    collection: 'recipe',
    data_home: 'notion',
    title: 'Contract notion create',
    idempotency_key: `${baseKey}-notion-create`,
    action_id: `${baseKey}-notion-create-action`,
  });
  assertProviderRejection(asRecord(notionCreate.json), 'notion', 'notion provider mismatch');

  const sheetsCreate = await callTool('utopia.create_record', {
    actor: 'hearth',
    domain: 'food',
    collection: 'recipe',
    data_home: 'google_sheets',
    title: 'Contract sheets create',
    idempotency_key: `${baseKey}-sheets-create`,
    action_id: `${baseKey}-sheets-create-action`,
  });
  assertProviderRejection(asRecord(sheetsCreate.json), 'google_sheets', 'sheets provider mismatch');

  const updateNotion = await callTool('utopia.update_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'notion',
    patch: { title: 'Contract notion update' },
    idempotency_key: `${baseKey}-notion-update`,
    action_id: `${baseKey}-notion-update-action`,
  });
  assertProviderRejection(asRecord(updateNotion.json), 'notion', 'notion provider mismatch update');

  const updateSheets = await callTool('utopia.update_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'google_sheets',
    patch: { title: 'Contract sheets update' },
    idempotency_key: `${baseKey}-sheets-update`,
    action_id: `${baseKey}-sheets-update-action`,
  });
  assertProviderRejection(asRecord(updateSheets.json), 'google_sheets', 'sheets provider mismatch update');

  const archiveNotion = await callTool('utopia.archive_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'notion',
    idempotency_key: `${baseKey}-notion-archive`,
    action_id: `${baseKey}-notion-archive-action`,
  });
  assertProviderRejection(asRecord(archiveNotion.json), 'notion', 'notion provider mismatch archive');

  const archiveSheets = await callTool('utopia.archive_record', {
    actor: 'hearth',
    id: createRecordId,
    data_home: 'google_sheets',
    idempotency_key: `${baseKey}-sheets-archive`,
    action_id: `${baseKey}-sheets-archive-action`,
  });
  assertProviderRejection(asRecord(archiveSheets.json), 'google_sheets', 'sheets provider mismatch archive');

  const workflow = await callTool('utopia.run_workflow', {
    actor: 'hearth',
    workflow: 'phase4_replay_workflow',
    domain: 'food',
    action_id: `${baseKey}-workflow-action`,
    idempotency_key: `${baseKey}-workflow`,
  });
  assert(workflow.reviewOnly === false, 'run_workflow should be executable write path');
  const workflowPayload = asRecord(workflow.json) as WorkflowPayload;
  assert(workflowPayload.status === 'completed', 'run_workflow should complete');
  assert(Array.isArray(workflowPayload.changed_records), 'run_workflow should return changed_records');
  assert(workflowPayload.changed_records.length >= 2, 'run_workflow should mutate at least two records');
  const workflowActionId = actionId(workflow);
  assert(workflowPayload.action?.id === workflowActionId, 'run_workflow action.id should be echoed in action');
  assert(workflow.review_flags?.cancellation_safe === true, 'run_workflow should be cancellation-safe');
  const checkpointRunId = workflowPayload.checkpoint?.runId
    || (typeof asRecord(workflowPayload.source_snapshot).workflow_run_id === 'string'
      ? String(asRecord(workflowPayload.source_snapshot).workflow_run_id)
      : undefined)
    || undefined;
  assert(typeof checkpointRunId === 'string' && checkpointRunId.length > 0, 'run_workflow should include checkpoint run id');

  const workflowReplay = await callTool('utopia.run_workflow', {
    actor: 'hearth',
    workflow: 'phase4_replay_workflow',
    domain: 'food',
    action_id: `${baseKey}-workflow-action`,
    idempotency_key: `${baseKey}-workflow`,
  });
  assertReplayEnvelope(workflow, workflowReplay, 'run_workflow replay');

  const writeReviewFlags = asRecord(workflowReplay.review_flags);
  assert(typeof writeReviewFlags.replay_recoverable === 'boolean', 'run_workflow should return replay_recoverable flag');
  assert(typeof writeReviewFlags.policy_reviewed === 'boolean', 'run_workflow should return policy_reviewed flag');

  for (const id of workflowPayload.changed_records as string[]) {
    const readBack = await callTool('utopia.read_record', { id });
    assert(asRecord(readBack.json).record !== undefined, `workflow-created record ${id} should still be readable before undo`);
  }

  const failedWorkflow = await callTool('utopia.run_workflow', {
    actor: 'hearth',
    workflow: 'phase4_compensation_probe',
    domain: 'food',
    action_id: `${baseKey}-comp-action`,
    idempotency_key: `${baseKey}-compensation`,
  });
  const failedPayload = asRecord(failedWorkflow.json) as WorkflowPayload;
  const failedCheckpointStatus = failedPayload.checkpoint?.runId
    ? checkpoints.getWorkflowCheckpoint(failedPayload.checkpoint.runId)?.status
    : undefined;
  assertWorkflowFailure(failedPayload, failedCheckpointStatus ?? 'failed', 'compensated workflow');
  const failedCheckpoint = failedPayload.checkpoint?.runId ? checkpoints.getWorkflowCheckpoint(failedPayload.checkpoint.runId) : null;
  assert(failedCheckpoint?.status === 'compensated', 'workflow failure should produce compensated checkpoint');
  const failedIds = failedPayload.changed_records ?? [];
  for (const id of failedIds) {
    let missing = false;
    try {
      await callTool('utopia.read_record', { id });
    } catch {
      missing = true;
    }
    assert(missing, `record ${id} should be removed by workflow compensation`);
  }

  const undo = await callTool('utopia.undo_action', {
    actor: 'hearth',
    actionId: workflowActionId,
    idempotency_key: `${baseKey}-workflow-undo`,
  });
  const undoPayload = asRecord(undo.json) as UndoPayload;
  assert(undoPayload.status === 'completed', 'undo_action should complete');
  assert(undoPayload.undoResult?.success === true, 'undo_action should report success');
  assertWriteEnvelope(undo, 'undo_action');

  const undoReplay = await callTool('utopia.undo_action', {
    actor: 'hearth',
    actionId: workflowActionId,
    idempotency_key: `${baseKey}-workflow-undo`,
  });
  const undoReplayPayload = asRecord(undoReplay.json) as UndoPayload;
  assert(undoReplayPayload.replayed === true, 'undo_action replay should return replayed=true');

  for (const id of workflowPayload.changed_records as string[]) {
    let missing = false;
    try {
      await callTool('utopia.read_record', { id });
    } catch {
      missing = true;
    }
    assert(missing, `workflow record ${id} should be removed after undo`);
  }

  const actionLog = state.getActionEvent(archiveActionId);
  assert(actionLog !== undefined, 'action events should persist in mcp action log');

  const proof = {
    proof: 'phase4_mcp_tool_contract',
    evidence: {
      create_replayed: createReplay.json.replayed === true,
      create_id_stable: actionId(createReplay) === actionId(create),
      update_replayed: updateReplay.json.replayed === true,
      update_id_stable: actionId(updateReplay) === actionId(update),
      archive_queue_stable: actionId(archiveReplay) === actionId(archive),
      archive_queued_for_review: asRecord(archive.json).status === 'queued_for_review',
      archive_tampered_rejected: asRecord(archiveTampered.json).approval_error === 'review_approval_hash_mismatch',
      archive_approval_hash_bound: asRecord(asRecord(archive.json).approval_request).operationHash === archiveApproval.operationHash,
      archive_approved_replayed: asRecord(archiveApprovedReplay.json).replayed === true,
      workflow_replayed: asRecord(workflowReplay.json).replayed === true,
      workflow_id_stable: actionId(workflowReplay) === workflowActionId,
      undo_replayed: undoReplayPayload.replayed === true,
      review_only_actioned: actionId(create) !== actionId(update),
      provider_rejections: {
        notion: asRecord(notionCreate.json).allowed === false,
        notion_update: asRecord(updateNotion.json).allowed === false,
        notion_archive: asRecord(archiveNotion.json).allowed === false,
        sheets: asRecord(sheetsCreate.json).allowed === false,
        sheets_update: asRecord(updateSheets.json).allowed === false,
        sheets_archive: asRecord(archiveSheets.json).allowed === false,
      },
      policy_rejected: asRecord(blockedCreate.json).allowed === false,
      checkpoint_status: failedCheckpoint?.status,
      checkpoint_changed_records: failedCheckpoint?.changed_records,
      compensation_applied: asRecord(failedPayload.checkpoint?.compensation).applied,
      action_log_found: !!actionLog,
    },
    state_files: {
      runtime_state_path: process.env.WONDER_RUNTIME_STATE_PATH,
      checkpoint_path: process.env.LIFEOS_WORKFLOW_CHECKPOINT_PATH,
    },
    all_passed: true,
  };

  const outPath = join(outDir, 'phase4-mcp-tool-contract-proof.json');
  writeFileSync(outPath, JSON.stringify(proof, null, 2), 'utf-8');
  console.log(`PASS ${outPath}`);
  process.stdout.write(JSON.stringify(proof, null, 2));
})().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
}).finally(() => {
  rmSync(stateDir, { recursive: true, force: true });
});
