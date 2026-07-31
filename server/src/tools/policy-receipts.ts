import { createHash } from 'node:crypto';
import { evaluateMcpPolicy } from '../security/policy';
import { ActionEvent, createActionEvent } from '../runtime/state';

export type ToolResult = {
  json: {
    action?: { id?: string; [key: string]: unknown };
    replayed?: boolean;
    record?: { id?: string; [key: string]: unknown };
    allowed?: boolean;
    message?: string;
    status?: string;
    checkpoint?: { runId?: string };
    changed_records?: string[];
    action_id?: string;
    reviewOnly?: boolean;
    source_snapshot?: Record<string, unknown>;
    [key: string]: unknown;
  };
  reviewOnly: boolean;
  safety: string;
  source_snapshot?: Record<string, unknown> | null;
  undo_token?: string;
  review_flags?: {
    policy_reviewed: boolean;
    replay_recoverable: boolean;
    cancellation_safe: boolean;
  };
  receipts?: Array<{
    action_id: string;
    status: ActionEvent['status'];
    tool: string;
    record_ids: string[];
    undo_token: string;
    source_snapshot?: Record<string, unknown>;
  }>;
};

type McpReviewApprovalReceipt = Readonly<{
  schemaVersion: 'wonder.mcp-review-approval.v1';
  approver: string;
  authority: string;
  tool: string;
  operationId: string;
  idempotencyKey: string;
  operationHash: string;
  localActor: string;
  approvedAt: string;
  expiresAt?: string;
  revoked?: boolean;
}>;

type Policy = ReturnType<typeof evaluateMcpPolicy>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyForHash(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stringifyForHash(entry)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stringifyForHash((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deterministicHash(value: unknown): string {
  return createHash('sha256').update(stringifyForHash(value)).digest('hex');
}

function hashValue(value: unknown): string {
  return `sha256:${deterministicHash(value)}`;
}

function makeActionId(prefix: string, seed: unknown): string {
  return `${prefix}:${deterministicHash(seed === undefined ? `${prefix}-missing-seed` : seed).slice(0, 20)}`;
}

export function actionToolPolicy(input: { tool: string; domain: string; command: string; actor: string }) {
  return evaluateMcpPolicy(input);
}

export function policyBlocksExecution(policy: Policy) {
  return policy.decision === 'deny' || policy.decision === 'clarify';
}

export function policyNeedsReview(policy: Policy) {
  return policy.decision === 'review';
}

export function makeActionEvent(input: {
  tool: string;
  domain: string;
  actor: string;
  recordIds: string[];
  command: string;
  risk: 'low' | 'standard' | 'sensitive' | 'irreversible' | 'restricted';
  idempotencyKey?: string;
  sourceIds?: string[];
  conversationId?: string | null;
  before?: unknown;
  after?: unknown;
  undoPayload?: unknown;
  actionId?: string;
}) {
  const actionId = input.actionId || makeActionId(input.tool, {
    actor: input.actor,
    tool: input.tool,
    domain: input.domain,
    command: input.command,
    recordIds: input.recordIds,
    before: input.before,
    after: input.after,
    undoPayload: input.undoPayload,
  });
  return {
    id: actionId,
    event: createActionEvent({
      id: actionId,
      actor: input.actor,
      domain: input.domain,
      tool: input.tool,
      risk: input.risk,
      recordIds: input.recordIds,
      idempotencyKey: input.idempotencyKey,
      command: input.command,
      before: input.before,
      after: input.after,
      undoPayload: input.undoPayload,
      sourceIds: input.sourceIds,
      conversationId: input.conversationId,
    }),
  };
}

function makeReviewFlags(input: {
  policyReviewRequired: boolean;
  action?: ActionEvent;
  cancellationSafe: boolean;
  idempotencyAware: boolean;
}) {
  const actionStatus = input.action?.status;
  const replayRecoverable = actionStatus === 'completed' && !input.policyReviewRequired && input.idempotencyAware;
  return {
    policy_reviewed: !input.policyReviewRequired || actionStatus === 'completed',
    replay_recoverable: replayRecoverable,
    cancellation_safe: input.cancellationSafe,
  };
}

function makeReceipt(action: ActionEvent | undefined, sourceSnapshot?: Record<string, unknown>) {
  if (!action) return [];
  return [{
    action_id: action.id,
    status: action.status,
    tool: action.tool,
    record_ids: action.record_ids,
    undo_token: action.id,
    ...(sourceSnapshot ? { source_snapshot: sourceSnapshot } : {}),
  }];
}

export function getOrCreateActionFromPolicy(input: {
  tool: string;
  domain: string;
  actor: string;
  command: string;
  conversationId?: string | null;
  policy: Policy;
  idempotencyKey?: string;
  actionId?: string;
  recordIds: string[];
  after?: unknown;
  before?: unknown;
  undoPayload?: unknown;
}): ToolResult {
  if (input.policy.decision === 'deny') {
    return { reviewOnly: true, safety: input.policy.safety, json: { allowed: false, policy: input.policy } };
  }
  if (input.policy.decision === 'clarify') {
    return {
      reviewOnly: true,
      safety: input.policy.safety,
      json: {
        allowed: false,
        requiresClarification: true,
        clarifyingQuestion: input.policy.clarifyingQuestion,
        policy: input.policy,
      },
    };
  }
  if (input.policy.decision === 'review') {
    return { reviewOnly: true, safety: input.policy.safety, json: { allowed: false, status: 'queued_for_review', policy: input.policy } };
  }

  const { event } = makeActionEvent({
    tool: input.tool,
    domain: input.domain,
    actor: input.actor,
    risk: input.policy.risk,
    recordIds: input.recordIds,
    actionId: input.actionId,
    command: input.command,
    idempotencyKey: input.idempotencyKey,
    before: input.before,
    after: input.after,
    undoPayload: input.undoPayload,
    conversationId: input.conversationId,
  });
  return {
    reviewOnly: false,
    safety: input.policy.safety,
    review_flags: makeReviewFlags({ policyReviewRequired: false, action: event, cancellationSafe: true, idempotencyAware: Boolean(input.idempotencyKey) }),
    undo_token: event.id,
    receipts: makeReceipt(event),
    json: { action: event },
  };
}

export function requireDurableReviewApproval(input: {
  approval: unknown;
  tool: string;
  domain: string;
  actor: string;
  policy: Policy;
  command: string;
  idempotencyKey: string;
  actionId: string;
  recordIds: string[];
  conversationId?: string | null;
  before?: unknown;
  requestedOperation: Record<string, unknown>;
  existingAction?: ActionEvent | null;
}): { ok: true; action: ActionEvent; approval: McpReviewApprovalReceipt } | { ok: false; result: ToolResult } {
  const computedApprovalRequest = buildApprovalRequest({
    tool: input.tool,
    domain: input.domain,
    actionId: input.existingAction?.id ?? input.actionId,
    operationId: input.existingAction?.operation_id ?? `${input.actionId}:operation`,
    idempotencyKey: input.idempotencyKey,
    recordIds: input.recordIds,
    requestedOperation: input.requestedOperation,
  });
  const storedApprovalRequest = asRecord(asRecord(input.existingAction?.after_json).approval_request);
  const approvalRequest = storedApprovalRequest
    && storedApprovalRequest.tool === computedApprovalRequest.tool
    && storedApprovalRequest.operationId === computedApprovalRequest.operationId
    && storedApprovalRequest.idempotencyKey === computedApprovalRequest.idempotencyKey
    && storedApprovalRequest.operationHash === computedApprovalRequest.operationHash
    && typeof storedApprovalRequest.requestedAt === 'string'
    ? { ...computedApprovalRequest, requestedAt: storedApprovalRequest.requestedAt }
    : computedApprovalRequest;
  const action = createActionEvent({
    id: input.existingAction?.id ?? input.actionId,
    actor: input.actor,
    domain: input.domain,
    tool: input.tool,
    risk: input.policy.risk,
    status: 'queued',
    recordIds: input.recordIds,
    idempotencyKey: input.idempotencyKey,
    command: input.command,
    before: input.before,
    after: { status: 'queued_for_review', approval_required: true, approval_request: approvalRequest, requested_operation: input.requestedOperation, policy: input.policy },
    conversationId: input.conversationId,
    operationId: input.existingAction?.operation_id ?? `${input.actionId}:operation`,
    causeId: input.existingAction?.cause_id ?? input.actionId,
  });

  const parsedApproval = parseApprovalReceipt(input.approval);
  const approvalError = validateApprovalReceipt(parsedApproval, {
    actor: input.actor,
    tool: input.tool,
    action,
    idempotencyKey: input.idempotencyKey,
    requestedOperation: input.requestedOperation,
  });
  if (approvalError) {
    return {
      ok: false,
      result: resolveToolResult({ allowed: false, status: 'queued_for_review', action, approval_error: approvalError, approval_request: approvalRequest, policy: input.policy }, true, input.policy.safety, {
        action,
        reviewFlags: { policy_reviewed: false, replay_recoverable: false, cancellation_safe: true },
      }),
    };
  }
  return { ok: true, action, approval: parsedApproval as McpReviewApprovalReceipt };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function buildApprovalRequest(input: { tool: string; domain: string; actionId: string; operationId: string; idempotencyKey: string; recordIds: string[]; requestedOperation: Record<string, unknown> }) {
  return {
    schemaVersion: 'wonder.mcp-review-approval-request.v1',
    tool: input.tool,
    domain: input.domain,
    actionId: input.actionId,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    operationHash: hashValue(input.requestedOperation),
    recordIds: [...input.recordIds],
    requestedAt: new Date().toISOString(),
  };
}

function parseApprovalReceipt(raw: unknown): McpReviewApprovalReceipt | null {
  if (!isObject(raw)) return null;
  const approval = raw as Record<string, unknown>;
  if (approval.schemaVersion !== 'wonder.mcp-review-approval.v1' || typeof approval.approver !== 'string' || typeof approval.authority !== 'string' || typeof approval.tool !== 'string' || typeof approval.operationId !== 'string' || typeof approval.idempotencyKey !== 'string' || typeof approval.operationHash !== 'string' || typeof approval.localActor !== 'string' || typeof approval.approvedAt !== 'string') return null;
  return approval as unknown as McpReviewApprovalReceipt;
}

function validateApprovalReceipt(approval: McpReviewApprovalReceipt | null, input: { actor: string; tool: string; action: ActionEvent; idempotencyKey: string; requestedOperation: Record<string, unknown> }): string | null {
  if (!approval) return 'review_approval_required';
  if (approval.revoked === true) return 'review_approval_revoked';
  if (!approval.approver.trim() || !approval.authority.trim() || !approval.localActor.trim()) return 'review_approval_invalid';
  if (approval.localActor !== input.actor || approval.approver !== input.actor) return 'review_approval_actor_mismatch';
  if (approval.tool !== input.tool) return 'review_approval_tool_mismatch';
  if (approval.operationId !== input.action.operation_id) return 'review_approval_operation_mismatch';
  if (approval.idempotencyKey !== input.idempotencyKey) return 'review_approval_idempotency_mismatch';
  if (approval.operationHash !== hashValue(input.requestedOperation)) return 'review_approval_hash_mismatch';
  if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now()) return 'review_approval_expired';
  return null;
}

export function resolveToolResult(result: unknown, reviewOnly = false, safety = 'read-only', options?: { action?: ActionEvent; sourceSnapshot?: Record<string, unknown>; reviewFlags?: ToolResult['review_flags']; cancellationSafe?: boolean; policyReviewRequired?: boolean; idempotencyAware?: boolean }): ToolResult {
  const safeResult = isObject(result) ? result : { value: result };
  const action = options?.action;
  const source = options?.sourceSnapshot ?? (isObject(safeResult.source_snapshot) ? safeResult.source_snapshot : undefined);
  const reviewFlags = options?.reviewFlags || (action ? makeReviewFlags({ policyReviewRequired: Boolean(options?.policyReviewRequired), action, cancellationSafe: options?.cancellationSafe ?? true, idempotencyAware: options?.idempotencyAware ?? Boolean(action.idempotency_key) }) : undefined);
  const payload: ToolResult = { reviewOnly, safety, source_snapshot: source ?? undefined, json: safeResult };
  if (action) {
    payload.undo_token = action.id;
    payload.receipts = makeReceipt(action, source);
  }
  if (reviewFlags) payload.review_flags = reviewFlags;
  return payload;
}

export function resolveWriteResult(payload: Record<string, unknown>, action: ActionEvent | undefined) {
  return resolveToolResult(withUndoEnvelope(payload, action), false, 'write', {
    action,
    policyReviewRequired: false,
    cancellationSafe: true,
    idempotencyAware: Boolean(action?.idempotency_key),
    sourceSnapshot: isObject(payload.source_snapshot) ? payload.source_snapshot : undefined,
  });
}

function withUndoEnvelope(payload: Record<string, unknown>, action?: ActionEvent) {
  if (!action) return payload;
  return { ...payload, inverse_action: action.undo_payload_json, undo_state: { action_id: action.id, action_status: action.status, undo_deadline_at: action.undo_deadline_at } };
}
