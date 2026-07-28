import type { OperationCommitEvent } from './operation-observer';
import type { ReactiveCycleProposal, ReactiveCycleResult } from './reactive-cycle';
import { parseOperationProposalEnvelope, parseOperationTemplate, parseProposalEvent } from './reactive-proposal-schema';
import { createOperationProposalIdempotencyKey } from './rules';
import { canonicalJson } from '@/src/domain/canonical-json';

export const REACTIVE_OUTBOX_SCHEMA_VERSION = 'wonder.reactive-outbox.v1' as const;

export type ReactiveOutboxStatus = 'pending' | 'running' | 'awaiting_review' | 'acked' | 'failed';

export type ReactiveOutboxItem = Readonly<{
  proposalId: string;
  cycleId: string;
  eventId: string;
  actionId: string;
  operationId: string;
  causeId: string;
  domain: string;
  status: ReactiveOutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  proposal: ReactiveCycleProposal;
  lastError?: string;
}>;

export type ReactiveOutboxStore = Readonly<{
  schemaVersion: typeof REACTIVE_OUTBOX_SCHEMA_VERSION;
  items: Readonly<Record<string, ReactiveOutboxItem>>;
}>;

export type ReactiveOutboxExecutionResult = Readonly<
  | { ok: true }
  | { ok: false; error: string }
>;

export type ReactiveOutboxDrainResult = Readonly<{
  store: ReactiveOutboxStore;
  attempted: readonly string[];
  acked: readonly string[];
  queuedForReview: readonly string[];
  failed: readonly { proposalId: string; error: string }[];
}>;

const DEFAULT_RETRY_BASE_DELAY_MS = 60_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 15 * 60_000;

export function createReactiveOutboxStore(): ReactiveOutboxStore {
  return immutable({
    schemaVersion: REACTIVE_OUTBOX_SCHEMA_VERSION,
    items: {},
  });
}

export function enqueueReactiveProposals(
  store: ReactiveOutboxStore,
  input: {
    cycle: ReactiveCycleResult;
    event: OperationCommitEvent;
    proposalIds: readonly string[];
    now?: string;
  },
): ReactiveOutboxStore {
  const now = input.now ?? new Date().toISOString();
  const proposalIds = new Set(input.proposalIds);
  const proposals = new Map(input.cycle.proposals.map((proposal) => [proposal.id, proposal]));
  const items: Record<string, ReactiveOutboxItem> = { ...store.items };

  for (const proposalId of [...proposalIds].sort()) {
    if (items[proposalId]) continue;
    const proposal = proposals.get(proposalId);
    if (!proposal) throw new Error(`Reactive proposal ${proposalId} missing from cycle ${input.cycle.cycleId}.`);
    items[proposalId] = immutable({
      proposalId,
      cycleId: input.cycle.cycleId,
      eventId: proposal.eventId,
      actionId: input.event.actionId,
      operationId: input.event.operationId,
      causeId: input.event.causeId,
      domain: input.event.domain,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
      proposal,
    });
  }

  return immutable({
    schemaVersion: REACTIVE_OUTBOX_SCHEMA_VERSION,
    items: sortRecord(items),
  });
}

export function listRunnableReactiveOutboxItems(store: ReactiveOutboxStore, now = new Date().toISOString()): ReactiveOutboxItem[] {
  const nowMs = Date.parse(now);
  return Object.values(store.items)
    .filter((item) => item.status === 'pending' && Date.parse(item.nextAttemptAt) <= nowMs)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.proposalId.localeCompare(right.proposalId));
}

export function markReactiveOutboxRunning(store: ReactiveOutboxStore, proposalId: string, now = new Date().toISOString()): ReactiveOutboxStore {
  const item = requiredItem(store, proposalId);
  return updateItem(store, proposalId, {
    ...item,
    status: 'running',
    updatedAt: now,
  });
}

export function markReactiveOutboxAcked(store: ReactiveOutboxStore, proposalId: string, now = new Date().toISOString()): ReactiveOutboxStore {
  const item = requiredItem(store, proposalId);
  return updateItem(store, proposalId, {
    ...item,
    status: 'acked',
    updatedAt: now,
  });
}

export function markReactiveOutboxAwaitingReview(
  store: ReactiveOutboxStore,
  proposalId: string,
  input: { now?: string; reason?: string } = {},
): ReactiveOutboxStore {
  const now = input.now ?? new Date().toISOString();
  const item = requiredItem(store, proposalId);
  return updateItem(store, proposalId, {
    ...item,
    status: 'awaiting_review',
    updatedAt: now,
    nextAttemptAt: now,
    ...(input.reason ? { lastError: input.reason } : {}),
  });
}

export function markReactiveOutboxPending(
  store: ReactiveOutboxStore,
  proposalId: string,
  input: { now?: string; retryDelayMs?: number; reason?: string; incrementAttempts?: boolean } = {},
): ReactiveOutboxStore {
  const now = input.now ?? new Date().toISOString();
  const item = requiredItem(store, proposalId);
  const retryDelayMs = Math.max(0, input.retryDelayMs ?? 0);
  return updateItem(store, proposalId, {
    ...item,
    status: 'pending',
    attempts: item.attempts + (input.incrementAttempts ? 1 : 0),
    updatedAt: now,
    nextAttemptAt: new Date(Date.parse(now) + retryDelayMs).toISOString(),
    ...(input.reason ? { lastError: input.reason } : {}),
  });
}

export function markReactiveOutboxFailed(
  store: ReactiveOutboxStore,
  proposalId: string,
  input: { error: string; now?: string; retryDelayMs?: number },
): ReactiveOutboxStore {
  const now = input.now ?? new Date().toISOString();
  const item = requiredItem(store, proposalId);
  const retryDelayMs = input.retryDelayMs ?? nextReactiveOutboxRetryDelayMs(item.attempts + 1);
  return updateItem(store, proposalId, {
    ...item,
    status: 'pending',
    attempts: item.attempts + 1,
    updatedAt: now,
    nextAttemptAt: new Date(Date.parse(now) + retryDelayMs).toISOString(),
    lastError: input.error,
  });
}

export async function drainReactiveOutbox(input: {
  store: ReactiveOutboxStore;
  executeProposal: (item: ReactiveOutboxItem) => Promise<ReactiveOutboxExecutionResult> | ReactiveOutboxExecutionResult;
  now?: string;
  maxItems?: number;
  retryDelayMs?: number;
  onStoreChange?: (store: ReactiveOutboxStore) => void;
}): Promise<ReactiveOutboxDrainResult> {
  const now = input.now ?? new Date().toISOString();
  const maxItems = input.maxItems ?? 16;
  let store = input.store;
  const attempted: string[] = [];
  const acked: string[] = [];
  const queuedForReview: string[] = [];
  const failed: { proposalId: string; error: string }[] = [];

  for (const item of listRunnableReactiveOutboxItems(store, now).slice(0, maxItems)) {
    attempted.push(item.proposalId);
    store = markReactiveOutboxRunning(store, item.proposalId, now);
    input.onStoreChange?.(store);
    try {
      const result = await input.executeProposal(store.items[item.proposalId]);
      if (shouldAckExecutionResult(result)) {
        store = markReactiveOutboxAcked(store, item.proposalId, new Date().toISOString());
        acked.push(item.proposalId);
      } else if (isQueuedForReviewResult(result)) {
        const reason = executionResultReason(result);
        store = markReactiveOutboxAwaitingReview(store, item.proposalId, {
          now: new Date().toISOString(),
          reason,
        });
        queuedForReview.push(item.proposalId);
      } else {
        const error = executionResultReason(result);
        store = markReactiveOutboxFailed(store, item.proposalId, {
          error,
          retryDelayMs: input.retryDelayMs,
        });
        failed.push({ proposalId: item.proposalId, error });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store = markReactiveOutboxFailed(store, item.proposalId, {
        error: message,
        retryDelayMs: input.retryDelayMs,
      });
      failed.push({ proposalId: item.proposalId, error: message });
    }
    input.onStoreChange?.(store);
  }

  return immutable({ store, attempted, acked, queuedForReview, failed });
}

export function recoverReactiveOutboxStore(
  store: ReactiveOutboxStore,
  input: {
    now?: string;
    retryDelayMs?: number;
    shouldResumeAwaitingReview?: (item: ReactiveOutboxItem) => boolean;
    runningReason?: string;
    awaitingReviewReason?: string;
  } = {},
): ReactiveOutboxStore {
  const now = input.now ?? new Date().toISOString();
  const shouldResumeAwaitingReview = input.shouldResumeAwaitingReview ?? (() => false);
  let next = store;
  for (const item of Object.values(next.items)) {
    if (item.status === 'running') {
      next = markReactiveOutboxPending(next, item.proposalId, {
        now,
        retryDelayMs: input.retryDelayMs ?? 0,
        reason: input.runningReason ?? 'worker_recovery',
      });
      continue;
    }
    if (item.status === 'awaiting_review' && shouldResumeAwaitingReview(item)) {
      next = markReactiveOutboxPending(next, item.proposalId, {
        now,
        retryDelayMs: 0,
        reason: input.awaitingReviewReason ?? 'review_resumed',
      });
    }
  }
  return next;
}

export function mergeReactiveOutboxStores(
  base: ReactiveOutboxStore,
  patch: ReactiveOutboxStore,
): ReactiveOutboxStore {
  return immutable({
    schemaVersion: REACTIVE_OUTBOX_SCHEMA_VERSION,
    items: sortRecord({
      ...base.items,
      ...Object.fromEntries(
        Object.entries(patch.items).map(([proposalId, item]) => [proposalId, immutable({ ...item })]),
      ),
    }),
  });
}

export function serializeReactiveOutboxStore(store: ReactiveOutboxStore): string {
  return JSON.stringify(store);
}

export function parseReactiveOutboxStore(serialized: string): ReactiveOutboxStore {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('Reactive outbox store is not valid JSON.');
  }
  if (!isObject(value) || value.schemaVersion !== REACTIVE_OUTBOX_SCHEMA_VERSION || !isObject(value.items)) {
    throw new Error('Reactive outbox store has an unsupported schema version.');
  }
  const items: Record<string, ReactiveOutboxItem> = {};
  for (const [proposalId, rawItem] of Object.entries(value.items)) {
    if (!isObject(rawItem) || rawItem.proposalId !== proposalId) {
      throw new Error(`Reactive outbox item ${proposalId} is invalid.`);
    }
    const item = rawItem as ReactiveOutboxItem;
    if (!isStatus(item.status) || !Number.isInteger(item.attempts) || item.attempts < 0) {
      throw new Error(`Reactive outbox item ${proposalId} has invalid retry state.`);
    }
    for (const field of ['cycleId', 'eventId', 'actionId', 'operationId', 'causeId', 'domain', 'createdAt', 'updatedAt', 'nextAttemptAt']) {
      if (typeof item[field as keyof ReactiveOutboxItem] !== 'string' || !String(item[field as keyof ReactiveOutboxItem]).trim()) {
        throw new Error(`Reactive outbox item ${proposalId} is missing ${field}.`);
      }
    }
    if (!isObject(item.proposal) || item.proposal.id !== proposalId) {
      throw new Error(`Reactive outbox item ${proposalId} is missing its proposal.`);
    }
    let proposalEvent: ReactiveCycleProposal['event'];
    let proposalTemplate: ReactiveCycleProposal['operationTemplate'];
    let envelope: ReactiveCycleProposal['envelope'];
    try {
      proposalEvent = parseProposalEvent(item.proposal.event);
      proposalTemplate = parseOperationTemplate(item.proposal.operationTemplate);
      envelope = parseOperationProposalEnvelope(item.proposal.envelope);
    } catch {
      throw new Error(`Reactive outbox item ${proposalId} is missing its proposal envelope.`);
    }
    if (
      envelope.proposalId !== proposalId
      || envelope.operation !== item.proposal.operation
      || stableJson(envelope.operationTemplate) !== stableJson(proposalTemplate)
      || envelope.ruleId !== item.proposal.ruleId
      || envelope.eventId !== item.proposal.eventId
      || envelope.eventId !== item.eventId
      || stableJson(envelope.event) !== stableJson(proposalEvent)
      || envelope.causeId !== item.proposal.causeId
      || envelope.causeId !== item.causeId
      || envelope.packageVersion !== item.proposal.packageVersion
      || envelope.mode !== item.proposal.mode
      || envelope.depth !== item.proposal.depth
    ) {
      throw new Error(`Reactive outbox item ${proposalId} has an inconsistent proposal envelope.`);
    }
    if (
      envelope.review.required !== envelope.authorization.reviewRequired
      || envelope.review.policyId !== envelope.authorization.policyId
      || envelope.review.policyVersion !== envelope.authorization.policyVersion
      || (envelope.mode === 'suggest' && envelope.review.reason !== 'suggest_mode')
      || (envelope.mode === 'automatic' && envelope.review.required && envelope.review.reason !== 'policy_required')
      || (envelope.mode === 'automatic' && !envelope.review.required && envelope.review.reason !== 'policy_authorized')
      || envelope.dryRun.ok !== envelope.authorization.allowed
    ) {
      throw new Error(`Reactive outbox item ${proposalId} has an inconsistent policy receipt.`);
    }
    validateEnvelopeEvidence(proposalId, envelope);
    const expectedKey = createOperationProposalIdempotencyKey({
      packageId: envelope.packageId,
      packageVersion: envelope.packageVersion,
      ruleId: envelope.ruleId,
      event: envelope.event,
      causeId: envelope.causeId,
      operationTemplate: envelope.operationTemplate,
      evidence: envelope.evidence.beforeHash && envelope.evidence.afterHash
        ? {
          queryId: envelope.evidence.queryId,
          transition: envelope.evidence.transition,
          beforeHash: envelope.evidence.beforeHash,
          afterHash: envelope.evidence.afterHash,
          querySpecHash: envelope.evidence.querySpecHash,
          packageHash: envelope.evidence.packageHash,
          evaluatorVersion: envelope.evidence.evaluatorVersion,
          targetRecordId: envelope.evidence.targetRecordId,
          targetBeforeRevision: envelope.evidence.targetBeforeRevision,
          targetAfterRevision: envelope.evidence.targetAfterRevision,
          beforeVersionVectorHash: envelope.evidence.beforeVersionVectorHash,
          afterVersionVectorHash: envelope.evidence.afterVersionVectorHash,
          sourceEventId: envelope.evidence.sourceEventId,
        }
        : envelope.evidence,
    });
    if (envelope.idempotencyKey !== expectedKey) {
      throw new Error(`Reactive outbox item ${proposalId} has an invalid idempotency key.`);
    }
    items[proposalId] = immutable({ ...item });
  }
  return immutable({
    schemaVersion: REACTIVE_OUTBOX_SCHEMA_VERSION,
    items: sortRecord(items),
  });
}

function requiredItem(store: ReactiveOutboxStore, proposalId: string): ReactiveOutboxItem {
  const item = store.items[proposalId];
  if (!item) throw new Error(`Reactive outbox item ${proposalId} was not found.`);
  return item;
}

function updateItem(store: ReactiveOutboxStore, proposalId: string, item: ReactiveOutboxItem): ReactiveOutboxStore {
  return immutable({
    schemaVersion: REACTIVE_OUTBOX_SCHEMA_VERSION,
    items: sortRecord({
      ...store.items,
      [proposalId]: immutable(item),
    }),
  });
}

function isStatus(value: unknown): value is ReactiveOutboxStatus {
  return value === 'pending' || value === 'running' || value === 'awaiting_review' || value === 'acked' || value === 'failed';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateEnvelopeEvidence(proposalId: string, envelope: ReactiveCycleProposal['envelope']): void {
  if (!isObject(envelope.evidence)) throw new Error(`Reactive outbox item ${proposalId} has invalid evidence.`);
  if (envelope.event.kind === 'query_transition') {
    if (envelope.evidence.queryId !== envelope.event.queryId || envelope.evidence.transition !== envelope.event.transition) {
      throw new Error(`Reactive outbox item ${proposalId} has inconsistent query evidence.`);
    }
  } else if (envelope.evidence.queryId !== undefined || envelope.evidence.transition !== undefined) {
    throw new Error(`Reactive outbox item ${proposalId} has unexpected query evidence.`);
  }
  for (const field of ['beforeHash', 'afterHash']) {
    const value = envelope.evidence[field as 'beforeHash' | 'afterHash'];
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
      throw new Error(`Reactive outbox item ${proposalId} has invalid evidence hash.`);
    }
  }
  if ((envelope.evidence.beforeHash === undefined) !== (envelope.evidence.afterHash === undefined)) {
    throw new Error(`Reactive outbox item ${proposalId} has incomplete evidence hashes.`);
  }
  const hasResultHashes = envelope.evidence.beforeHash !== undefined && envelope.evidence.afterHash !== undefined;
  for (const field of ['querySpecHash', 'packageHash', 'evaluatorVersion']) {
    const value = envelope.evidence[field as 'querySpecHash' | 'packageHash' | 'evaluatorVersion'];
    if (hasResultHashes && (typeof value !== 'string' || !value.trim())) {
      throw new Error(`Reactive outbox item ${proposalId} has incomplete evidence context.`);
    }
    if (!hasResultHashes && value !== undefined) {
      throw new Error(`Reactive outbox item ${proposalId} has unexpected evidence context.`);
    }
  }
}

function stableJson(value: unknown): string {
  return canonicalJson(value);
}

function shouldAckExecutionResult(result: ReactiveOutboxExecutionResult): boolean {
  if (!result.ok) return false;
  const receipt = (result as { receipt?: { status?: unknown; verification?: { ok?: unknown } } }).receipt;
  if (!receipt) return true;
  return receipt.status === 'completed' && receipt.verification?.ok === true;
}

function isQueuedForReviewResult(result: ReactiveOutboxExecutionResult): boolean {
  if (!result.ok) return false;
  return (result as { receipt?: { status?: unknown } }).receipt?.status === 'queued';
}

function executionResultReason(result: ReactiveOutboxExecutionResult): string {
  if (!result.ok) return result.error;
  const verificationReason = (result as { receipt?: { verification?: { reason?: unknown } } }).receipt?.verification?.reason;
  if (typeof verificationReason === 'string' && verificationReason.trim()) {
    return verificationReason;
  }
  const status = (result as { receipt?: { status?: unknown } }).receipt?.status;
  return typeof status === 'string' && status.trim() ? status : 'execution_result_unverified';
}

export function nextReactiveOutboxRetryDelayMs(attempts: number): number {
  const normalizedAttempts = Math.max(1, Math.trunc(attempts));
  return Math.min(DEFAULT_RETRY_BASE_DELAY_MS * 2 ** (normalizedAttempts - 1), DEFAULT_RETRY_MAX_DELAY_MS);
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function immutable<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
  return Object.freeze(value);
}
