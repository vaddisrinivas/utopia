import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanonicalRecord } from '@/src/domain/runtime';
import type { Operation } from '@/src/ops/operation';
import { planOperation } from '@/src/ops/plan';
import { executeQuery, QueryPredicate, QuerySort } from '../kernel/query';
import {
  notifyOperationCommit,
  type OperationCommitEvent,
} from '../kernel/operation-observer';
import { mutateJsonStateFile, writeJsonStateFileAtomic } from '../providers/json-state';
import type { ProviderUndoInput, ProviderUndoResult } from '../providers/undo';
import { getWorkflowCheckpoint, WorkflowRunCheckpoint } from '../workflows/checkpoint';
import { normalizeRecord, parseRecordManifest } from './state-records';
import { createEmptyStore, isValidStore, loadStore, normalizeStore, RUNTIME_STATE_PATH } from './state-store';
import {
  actorForAction,
  cloneActionEvent,
  nowIso,
  normalizeProviderSourceEquality,
  originForAction,
  provenanceForAction,
  stableStringify,
  toCanonicalRecord,
  toMcpRecord,
  type ActionEvent,
  type ActionRisk,
  type CanonicalRelation,
  type McpRecord,
  type OperationCommitOutboxItem,
  type PersistOptions,
  type PersistedStore,
  type RecordProvider,
  type WorkflowDocument,
} from './state-types';
import { loadCatalogWorkflows } from './workflows';

export type {
  ActionEvent,
  CanonicalRelation,
  McpRecord,
  OperationCommitOutboxItem,
  RecordProvider,
  RecordSource,
  WorkflowDocument,
  WorkflowStep,
} from './state-types';

const ACTION_TTL_MS = 24 * 60 * 60 * 1000;

const PROVIDER_UNDO_WORKER_PATH = fileURLToPath(new URL('../providers/undo-worker.ts', import.meta.url));
const PROVIDER_UNDO_TSX_PATH = join(process.cwd(), 'server', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

let store: PersistedStore = loadStore();
let storeMutationDepth = 0;
let unpersistedStore: PersistedStore | null = null;
const deferredOperationCommitIds: string[] = [];

function nowDeadlineIso(): string {
  return new Date(Date.now() + ACTION_TTL_MS).toISOString();
}

function persistStore() {
  store.updated_at = nowIso();
  if (storeMutationDepth > 0) {
    return;
  }
  writeJsonStateFileAtomic(RUNTIME_STATE_PATH, store);
}

/**
 * Single synchronous authority for canonical mutations. The filesystem lock
 * covers refresh, validation, record/action/outbox mutation, and atomic commit.
 * Nested writer calls share the outer transaction.
 */
function mutateCanonicalStore<T>(mutate: () => T): T {
  if (storeMutationDepth > 0) {
    return mutate();
  }

  let result: T | undefined;
  const pending = unpersistedStore;
  const deliveryStart = deferredOperationCommitIds.length;
  let committed: PersistedStore;
  try {
    committed = mutateJsonStateFile(RUNTIME_STATE_PATH, {
      label: 'Wonder runtime state',
      validate: isValidStore,
      createDefault: createEmptyStore,
      mutate: (current) => {
        const normalized = normalizeStore(current);
        store = pending
          ? {
              ...normalized,
              records: { ...normalized.records, ...pending.records },
              actions: { ...normalized.actions, ...pending.actions },
              operation_commit_outbox: {
                ...normalized.operation_commit_outbox,
                ...pending.operation_commit_outbox,
              },
            }
          : normalized;
        storeMutationDepth += 1;
        try {
          result = mutate();
          store.updated_at = nowIso();
          return store;
        } finally {
          storeMutationDepth -= 1;
        }
      },
    });
  } catch (error) {
    deferredOperationCommitIds.splice(deliveryStart);
    throw error;
  }
  store = normalizeStore(committed);
  unpersistedStore = null;
  const deliveryIds = deferredOperationCommitIds.splice(deliveryStart);
  for (const operationId of deliveryIds) {
    mutateCanonicalStore(() => attemptOperationCommitDelivery(operationId));
  }
  return result as T;
}

function retainUnpersistedStore(): void {
  if (storeMutationDepth === 0) {
    unpersistedStore = store;
  }
}

function enqueueOperationCommit(event: OperationCommitEvent): void {
  if (store.operation_commit_outbox[event.operationId]) return;
  const now = nowIso();
  store.operation_commit_outbox[event.operationId] = {
    event,
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

function attemptOperationCommitDelivery(operationId: string): boolean {
  const item = store.operation_commit_outbox[operationId];
  if (!item) return true;
  const result = notifyOperationCommit(item.event);
  if (result.delivered) {
    delete store.operation_commit_outbox[operationId];
    persistStore();
    return true;
  }
  store.operation_commit_outbox[operationId] = {
    ...item,
    attempts: item.attempts + 1,
    last_error: result.failure?.error.message ?? 'reactive_observer_unavailable',
    updated_at: nowIso(),
  };
  persistStore();
  return false;
}

function drainOperationCommitOutboxMutation(input: { maxItems?: number } = {}) {
  const maxItems = Math.max(1, input.maxItems ?? 32);
  const pending = Object.values(store.operation_commit_outbox)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, maxItems);
  const delivered: string[] = [];
  const retained: string[] = [];
  for (const item of pending) {
    if (attemptOperationCommitDelivery(item.event.operationId)) {
      delivered.push(item.event.operationId);
    } else {
      retained.push(item.event.operationId);
      // Preserve canonical commit order. A later event must not overtake a
      // retained predecessor and observe a causally impossible sequence.
      break;
    }
  }
  return { attempted: pending.length, delivered, retained };
}

export function drainOperationCommitOutbox(input: { maxItems?: number } = {}) {
  return mutateCanonicalStore(() => drainOperationCommitOutboxMutation(input));
}

export function listOperationCommitOutbox(): OperationCommitOutboxItem[] {
  return Object.values(store.operation_commit_outbox)
    .map((item) => ({ ...item, event: { ...item.event } }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function persistCommittedOperation(event: OperationCommitEvent): void {
  enqueueOperationCommit(event);
  persistStore();
  if (storeMutationDepth > 0) {
    deferredOperationCommitIds.push(event.operationId);
    return;
  }
  attemptOperationCommitDelivery(event.operationId);
}

function upsertRecord(record: McpRecord, options: PersistOptions = {}) {
  const next = normalizeRecord(record);
  const exists = store.records[next.id];

  if (exists) {
    const createdAt = exists.created_at;
    store.records[next.id] = {
      ...next,
      id: next.id,
      title: next.title || exists.title,
      created_at: createdAt,
      updated_at: nowIso(),
      revision: (exists.revision ?? 0) + 1,
      archived_at: next.archived_at ?? exists.archived_at,
    };
  } else {
    store.records[next.id] = {
      ...next,
      id: next.id,
      created_at: nowIso(),
      updated_at: nowIso(),
      revision: typeof next.revision === 'number' && next.revision > 0 ? next.revision : 1,
    };
  }

  if (options.persist !== false) {
    persistStore();
  }
  return { ...store.records[next.id] };
}

function deleteRecordMutation(id: string, options: PersistOptions = {}) {
  if (!store.records[id]) {
    return false;
  }
  delete store.records[id];
  if (options.persist !== false) {
    persistStore();
  }
  return true;
}

export function deleteRecord(id: string, options: PersistOptions = {}) {
  if (options.persist === false) {
    const result = deleteRecordMutation(id, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => deleteRecordMutation(id, options));
}

function restoreRecordMutation(record: McpRecord) {
  const normalized = normalizeRecord({
    ...record,
    created_at: record.created_at,
    updated_at: record.updated_at,
  });
  const existing = store.records[normalized.id];
  store.records[normalized.id] = {
    ...normalized,
    id: normalized.id,
    title: normalized.title || (existing ? existing.title : normalized.id),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
  persistStore();
  return { ...store.records[normalized.id] };
}

export function restoreRecord(record: McpRecord) {
  return mutateCanonicalStore(() => restoreRecordMutation(record));
}

export function listRecords(input: {
  domain?: string;
  collection?: string;
  includeArchived?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
  where?: QueryPredicate;
  orderBy?: QuerySort[];
}) {
  const items = Object.values(store.records)
    .filter((record) => {
      if (input.domain && record.domain !== input.domain) {
        return false;
      }
      if (!input.includeArchived && record.archived_at) {
        return false;
      }
      if (input.collection && record.collection !== input.collection) {
        return false;
      }
      return true;
    })
    .filter((record) => {
      const query = (input.query ?? '').trim().toLowerCase();
      if (!query) {
        return true;
      }
      const payload = JSON.stringify({
        id: record.id,
        title: record.title,
        properties: record.properties,
      }).toLowerCase();
      return payload.includes(query);
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const result = executeQuery(items as unknown as Record<string, unknown>[], {
    from: 'records',
    where: input.where,
    orderBy: input.orderBy,
    limit: input.limit,
    offset: input.offset,
    getField: (row, field) => {
      if (field.startsWith('properties.')) return row.properties && typeof row.properties === 'object'
        ? (row.properties as Record<string, unknown>)[field.slice('properties.'.length)]
        : undefined;
      return row[field];
    },
  });
  return result.rows as unknown as McpRecord[];
}

export function findRecord(id: string) {
  const record = store.records[id];
  return record ? { ...record } : null;
}

export type ProviderCanonicalRecordInput = {
  provider: Extract<RecordProvider, 'notion' | 'google_sheets'>;
  id: string;
  domain: string;
  collection: string;
  title: string;
  properties: Record<string, unknown>;
  relations?: CanonicalRelation[];
  archived?: boolean;
  externalId?: string | null;
  url?: string | null;
  observedAt?: string | null;
  contentHash?: string | null;
};

export type ProviderCanonicalApplyResult = {
  applied: boolean;
  record: McpRecord | null;
  reason?: string;
};

/** Apply a provider pull only after the provider adapter has passed its authority checks. */
function upsertProviderCanonicalRecordMutation(input: ProviderCanonicalRecordInput): ProviderCanonicalApplyResult {
  const authority = process.env.LIFEOS_AUTHORITY_PROVIDER?.trim() || 'notion';
  if (authority !== input.provider) {
    return {
      applied: false,
      record: null,
      reason: `${input.provider} is a projection; configured authority is ${authority}.`,
    };
  }

  const now = nowIso();
  const existing = store.records[input.id];
  const archivedAt = input.archived
    ? existing?.archived_at ?? now
    : null;
  const next = normalizeRecord({
    id: input.id,
    domain: input.domain,
    collection: input.collection,
    title: input.title,
    properties: input.properties,
    relations: input.relations ?? [],
    source: {
      provider: input.provider,
      external_id: input.externalId?.trim() || input.id,
      url: input.url ?? null,
      observed_at: input.observedAt?.trim() || existing?.source.observed_at || now,
      content_hash: input.contentHash ?? null,
    },
    archived_at: archivedAt,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });
  if (
    existing
    && existing.domain === next.domain
    && existing.collection === next.collection
    && existing.title === next.title
    && existing.archived_at === next.archived_at
    && stableStringify(existing.properties) === stableStringify(next.properties)
    && stableStringify(existing.relations) === stableStringify(next.relations)
    && stableStringify(normalizeProviderSourceEquality(existing.source)) === stableStringify(normalizeProviderSourceEquality(next.source))
  ) {
    return { applied: true, record: { ...existing } };
  }
  const record = upsertRecord(next);
  return { applied: true, record };
}

export function upsertProviderCanonicalRecord(input: ProviderCanonicalRecordInput): ProviderCanonicalApplyResult {
  return mutateCanonicalStore(() => upsertProviderCanonicalRecordMutation(input));
}

function createRecordMutation(input: Omit<McpRecord, 'created_at' | 'updated_at'> & { now?: string }, options: PersistOptions = {}) {
  const now = input.now ?? nowIso();
  const base = normalizeRecord(input as Omit<McpRecord, 'created_at' | 'updated_at'> & Partial<McpRecord>);
  const next = {
    ...base,
    created_at: now,
    updated_at: now,
  };
  return upsertRecord(next, options);
}

export function createRecord(input: Omit<McpRecord, 'created_at' | 'updated_at'> & { now?: string }, options: PersistOptions = {}) {
  if (options.persist === false) {
    const result = createRecordMutation(input, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => createRecordMutation(input, options));
}

function updateRecordMutation(id: string, patch: Partial<McpRecord>, options: PersistOptions = {}) {
  const existing = store.records[id];
  if (!existing) {
    return null;
  }

  const merged: McpRecord = {
    ...existing,
    ...patch,
    id: existing.id,
    domain: existing.domain,
    updated_at: nowIso(),
  };
  const before = { ...existing };
  const record = upsertRecord(merged, options);
  return {
    before,
    after: record,
  };
}

export function updateRecord(id: string, patch: Partial<McpRecord>, options: PersistOptions = {}) {
  if (options.persist === false) {
    const result = updateRecordMutation(id, patch, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => updateRecordMutation(id, patch, options));
}

function archiveRecordMutation(id: string, options: PersistOptions = {}) {
  const existing = store.records[id];
  if (!existing) {
    return null;
  }

  if (existing.archived_at) {
    return {
      before: { ...existing },
      after: { ...existing },
    };
  }

  const before = { ...existing };
  const archivedAt = nowIso();
  store.records[id] = {
    ...existing,
    archived_at: archivedAt,
    updated_at: archivedAt,
    revision: (existing.revision ?? 0) + 1,
  };
  if (options.persist !== false) {
    persistStore();
  }

  return {
    before,
    after: { ...store.records[id] },
  };
}

export function archiveRecord(id: string, options: PersistOptions = {}) {
  if (options.persist === false) {
    const result = archiveRecordMutation(id, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => archiveRecordMutation(id, options));
}

export type ActionWriteResult = {
  action: ActionEvent;
  record?: McpRecord;
  replayed: boolean;
};

export type LocalUndoReceipt = {
  status: 'undone' | 'undo_failed';
  operation: 'delete_record' | 'restore_after_update' | 'restore_after_archive' | 'restore_record';
  record_id?: string;
  before?: McpRecord | null;
  after?: McpRecord | null;
  message: string;
};

function resolveIdempotencyKey(input?: string) {
  return typeof input === 'string' ? input.trim() : '';
}

function createRecordWithActionMutation(input: {
  actionId: string;
  actor: string;
  domain: string;
  tool: string;
  risk: ActionRisk;
  command: string;
  record: Omit<McpRecord, 'created_at' | 'updated_at'>;
  idempotencyKey?: string;
  sourceIds?: string[];
  conversationId?: string | null;
  before?: unknown;
  undoPayload?: unknown;
  operationId?: string;
  causeId?: string;
  expectedRevision?: number;
}): ActionWriteResult {
  const idempotencyKey = resolveIdempotencyKey(input.idempotencyKey);
  const existing = idempotencyKey ? findActionByIdempotencyKey(idempotencyKey) : null;
  if (existing && existing.status === 'completed') {
    const replayedRecordId = existing.record_ids[0];
    return {
      action: existing,
      record: replayedRecordId ? findRecord(replayedRecordId) ?? undefined : undefined,
      replayed: true,
    };
  }

  const effectiveIdempotencyKey = existing && existing.status !== 'completed' && existing.id !== input.actionId ? undefined : idempotencyKey;
  const normalized = normalizeRecord(input.record);
  const previous = toCanonicalRecord(findRecord(normalized.id));
  const manifest = parseRecordManifest(input.domain);
  const operation: Operation = {
    op_id: input.operationId ?? `${input.actionId}:operation`,
    kind: 'create',
    domain: input.domain,
    collection: normalized.collection,
    record_id: normalized.id,
    record: {
      ...toCanonicalRecord(normalized),
      provenance: provenanceForAction(input),
    } as CanonicalRecord,
    actor: actorForAction(input.actor),
    origin: originForAction(input.tool),
    idempotency_key: effectiveIdempotencyKey,
    reason: input.command,
  };
  const plan = planOperation({ manifest, operation, current: previous });
  if (plan.status !== 'planned') {
    const action = createActionEvent(
      {
        id: input.actionId,
        actor: input.actor,
        domain: input.domain,
        tool: input.tool,
        risk: input.risk,
        recordIds: [normalized.id],
        idempotencyKey: effectiveIdempotencyKey,
        command: input.command,
        before: previous,
        after: null,
        undoPayload: null,
        sourceIds: input.sourceIds,
        conversationId: input.conversationId ?? null,
        operationId: input.operationId,
        causeId: input.causeId,
        expectedRevision: input.expectedRevision,
        status: 'failed',
      },
      { persist: false },
    );
    const failed = markActionFailed(action.id, plan.status === 'rejected' ? plan.reject_reason : 'operation_not_planned', { persist: false }) ?? action;
    persistStore();
    return { action: failed, record: previous ? toMcpRecord(previous) : undefined, replayed: false };
  }
  const record = toMcpRecord(plan.after);
  store.records[record.id] = record;
  const actionSeed = createActionEvent(
    {
      id: input.actionId,
      actor: input.actor,
      domain: input.domain,
      tool: input.tool,
      risk: input.risk,
      recordIds: [record.id],
      idempotencyKey: effectiveIdempotencyKey,
      command: input.command,
      before: input.before,
      after: record,
      undoPayload: input.undoPayload ?? { operation: 'delete_record', record_id: record.id, record },
      sourceIds: input.sourceIds,
      conversationId: input.conversationId ?? null,
      operationId: input.operationId,
      causeId: input.causeId,
      expectedRevision: input.expectedRevision,
    },
    { persist: false },
  );
  const action = markActionCompleted(actionSeed.id, actionSeed.command, { record }, { persist: false }) ?? actionSeed;
  persistCommittedOperation({
    actionId: action.id,
    operationId: action.operation_id,
    causeId: action.cause_id,
    domain: action.domain,
    recordId: record.id,
    before: input.before ?? null,
    after: record,
  });
  return {
    action,
    record,
    replayed: false,
  };
}

export function createRecordWithAction(input: Parameters<typeof createRecordWithActionMutation>[0]): ActionWriteResult {
  return mutateCanonicalStore(() => createRecordWithActionMutation(input));
}

function updateRecordWithActionMutation(input: {
  actionId: string;
  actor: string;
  domain: string;
  tool: string;
  risk: ActionRisk;
  command: string;
  id: string;
  patch: Partial<McpRecord>;
  idempotencyKey?: string;
  sourceIds?: string[];
  conversationId?: string | null;
  source?: McpRecord['source'];
  undoPayload?: Record<string, unknown>;
  expectedRevision?: number;
  operationId?: string;
  causeId?: string;
}): ActionWriteResult {
  const idempotencyKey = resolveIdempotencyKey(input.idempotencyKey);
  const existing = idempotencyKey ? findActionByIdempotencyKey(idempotencyKey) : null;
  if (existing && existing.status === 'completed') {
    const replayedRecordId = existing.record_ids[0];
    return {
      action: existing,
      record: replayedRecordId ? findRecord(replayedRecordId) ?? undefined : undefined,
      replayed: true,
    };
  }

  const effectiveIdempotencyKey = existing && existing.status !== 'completed' && existing.id !== input.actionId ? undefined : idempotencyKey;
  const previous = findRecord(input.id);
  if (!previous) {
    return {
      action: markActionFailed(input.actionId, 'record not found', { persist: false }) ??
        createActionEvent(
          {
            id: input.actionId,
            actor: input.actor,
            domain: input.domain,
            tool: input.tool,
            risk: input.risk,
            recordIds: [input.id],
            idempotencyKey: effectiveIdempotencyKey,
            command: input.command,
            before: null,
            after: null,
            undoPayload: null,
            sourceIds: input.sourceIds,
            conversationId: input.conversationId ?? null,
          },
          { persist: false },
        ),
      replayed: false,
    };
  }

  if (input.expectedRevision !== undefined && (previous.revision ?? 0) !== input.expectedRevision) {
    const action = createActionEvent(
      {
        id: input.actionId,
        actor: input.actor,
        domain: input.domain,
        tool: input.tool,
        risk: input.risk,
        recordIds: [input.id],
        idempotencyKey: effectiveIdempotencyKey,
        command: input.command,
        before: previous,
        after: null,
        undoPayload: null,
        sourceIds: input.sourceIds,
        conversationId: input.conversationId ?? null,
        operationId: input.operationId,
        causeId: input.causeId,
        expectedRevision: input.expectedRevision,
        status: 'failed',
      },
      { persist: false },
    );
    const failed = markActionFailed(action.id, 'revision conflict', { persist: false }) ?? action;
    persistStore();
    return { action: failed, record: previous, replayed: false };
  }

  const manifest = parseRecordManifest(previous.domain);
  const operation: Operation = {
    op_id: input.operationId ?? `${input.actionId}:operation`,
    kind: 'update',
    domain: previous.domain,
    collection: previous.collection,
    record_id: input.id,
    expected_revision: input.expectedRevision,
    record: {
      ...input.patch,
      ...(input.source ? { source: input.source } : {}),
    } as Partial<CanonicalRecord>,
    actor: actorForAction(input.actor),
    origin: originForAction(input.tool),
    idempotency_key: effectiveIdempotencyKey,
    reason: input.command,
  };
  const plan = planOperation({ manifest, operation, current: toCanonicalRecord(previous) });
  if (plan.status !== 'planned') {
    const action = createActionEvent(
      {
        id: input.actionId,
        actor: input.actor,
        domain: input.domain,
        tool: input.tool,
        risk: input.risk,
        recordIds: [input.id],
        idempotencyKey: effectiveIdempotencyKey,
        command: input.command,
        before: previous,
        after: null,
        undoPayload: null,
        sourceIds: input.sourceIds,
        conversationId: input.conversationId ?? null,
        operationId: input.operationId,
        causeId: input.causeId,
        expectedRevision: input.expectedRevision,
        status: 'failed',
      },
      { persist: false },
    );
    const failure = markActionFailed(action.id, plan.status === 'rejected' ? plan.reject_reason : 'record could not be updated', { persist: false }) ?? action;
    persistStore();
    return { action: failure, record: previous, replayed: false };
  }
  const updated = {
    before: previous,
    after: toMcpRecord(plan.after),
  };
  store.records[updated.after.id] = updated.after;

  const undoPayload = input.undoPayload ?? {
    operation: 'restore_after_update',
    before: updated.before,
    record_id: updated.after.id,
  };

  const actionSeed = createActionEvent(
    {
      id: input.actionId,
      actor: input.actor,
      domain: input.domain,
      tool: input.tool,
      risk: input.risk,
      recordIds: [updated.after.id],
      idempotencyKey: effectiveIdempotencyKey,
      command: input.command,
      before: updated.before,
      after: updated.after,
      undoPayload,
      sourceIds: input.sourceIds,
      conversationId: input.conversationId ?? null,
      operationId: input.operationId,
      causeId: input.causeId,
      expectedRevision: input.expectedRevision,
    },
    { persist: false },
  );
  const action = markActionCompleted(actionSeed.id, actionSeed.command, { record: updated.after }, { persist: false }) ?? actionSeed;
  persistCommittedOperation({
    actionId: action.id,
    operationId: action.operation_id,
    causeId: action.cause_id,
    domain: action.domain,
    recordId: updated.after.id,
    before: updated.before,
    after: updated.after,
  });
  return {
    action,
    record: updated.after,
    replayed: false,
  };
}

export function updateRecordWithAction(input: Parameters<typeof updateRecordWithActionMutation>[0]): ActionWriteResult {
  return mutateCanonicalStore(() => updateRecordWithActionMutation(input));
}

function archiveRecordWithActionMutation(input: {
  actionId: string;
  actor: string;
  domain: string;
  tool: string;
  risk: ActionRisk;
  command: string;
  id: string;
  idempotencyKey?: string;
  sourceIds?: string[];
  conversationId?: string | null;
  source?: McpRecord['source'];
  expectedRevision?: number;
  operationId?: string;
  causeId?: string;
  undoPayload?: Record<string, unknown>;
}): ActionWriteResult {
  const idempotencyKey = resolveIdempotencyKey(input.idempotencyKey);
  const existing = idempotencyKey ? findActionByIdempotencyKey(idempotencyKey) : null;
  if (existing && existing.status === 'completed') {
    const replayedRecordId = existing.record_ids[0];
    return {
      action: existing,
      record: replayedRecordId ? findRecord(replayedRecordId) ?? undefined : undefined,
      replayed: true,
    };
  }

  const effectiveIdempotencyKey = existing && existing.status !== 'completed' && existing.id !== input.actionId ? undefined : idempotencyKey;
  const previous = findRecord(input.id);
  if (!previous) {
    const action = createActionEvent(
      {
        id: input.actionId,
        actor: input.actor,
        domain: input.domain,
        tool: input.tool,
        risk: input.risk,
        recordIds: [input.id],
        idempotencyKey: effectiveIdempotencyKey,
        command: input.command,
        before: null,
        after: null,
        undoPayload: null,
        sourceIds: input.sourceIds,
        conversationId: input.conversationId ?? null,
        operationId: input.operationId,
        causeId: input.causeId,
        expectedRevision: input.expectedRevision,
        status: 'failed',
      },
      { persist: false },
    );
    const failure = markActionFailed(action.id, 'record not found', { persist: false }) ?? action;
    persistStore();
    return { action: failure, replayed: false };
  }

  if (input.expectedRevision !== undefined && (previous.revision ?? 0) !== input.expectedRevision) {
    const action = createActionEvent(
      {
        id: input.actionId,
        actor: input.actor,
        domain: input.domain,
        tool: input.tool,
        risk: input.risk,
        recordIds: [input.id],
        idempotencyKey: effectiveIdempotencyKey,
        command: input.command,
        before: previous,
        after: null,
        undoPayload: null,
        sourceIds: input.sourceIds,
        conversationId: input.conversationId ?? null,
        operationId: input.operationId,
        causeId: input.causeId,
        expectedRevision: input.expectedRevision,
        status: 'failed',
      },
      { persist: false },
    );
    const failed = markActionFailed(action.id, 'revision conflict', { persist: false }) ?? action;
    persistStore();
    return { action: failed, record: previous, replayed: false };
  }

  const manifest = parseRecordManifest(previous.domain);
  const operation: Operation = {
    op_id: input.operationId ?? `${input.actionId}:operation`,
    kind: 'archive',
    domain: previous.domain,
    collection: previous.collection,
    record_id: input.id,
    expected_revision: input.expectedRevision,
    record: input.source ? { source: input.source } : undefined,
    actor: actorForAction(input.actor),
    origin: originForAction(input.tool),
    idempotency_key: effectiveIdempotencyKey,
    reason: input.command,
  };
  const plan = planOperation({ manifest, operation, current: toCanonicalRecord(previous) });
  if (plan.status !== 'planned') {
    const action = createActionEvent(
      {
        id: input.actionId,
        actor: input.actor,
        domain: input.domain,
        tool: input.tool,
        risk: input.risk,
        recordIds: [input.id],
        idempotencyKey: effectiveIdempotencyKey,
        command: input.command,
        before: previous,
        after: null,
        undoPayload: null,
        sourceIds: input.sourceIds,
        conversationId: input.conversationId ?? null,
        operationId: input.operationId,
        causeId: input.causeId,
        expectedRevision: input.expectedRevision,
        status: 'failed',
      },
      { persist: false },
    );
    const failed = markActionFailed(action.id, plan.status === 'rejected' ? plan.reject_reason : 'archive precondition violated', { persist: false }) ?? action;
    persistStore();
    return { action: failed, record: previous, replayed: false };
  }
  const resolvedAfter = toMcpRecord(plan.after);
  store.records[resolvedAfter.id] = resolvedAfter;

  const payload = input.undoPayload ?? {
    operation: 'restore_after_archive',
    before: previous,
    record_id: resolvedAfter.id,
  };

  const actionSeed = createActionEvent(
    {
      id: input.actionId,
      actor: input.actor,
      domain: input.domain,
      tool: input.tool,
      risk: input.risk,
      recordIds: [resolvedAfter.id],
      idempotencyKey: effectiveIdempotencyKey,
      command: input.command,
      before: previous,
      after: resolvedAfter,
      undoPayload: payload,
      sourceIds: input.sourceIds,
      conversationId: input.conversationId ?? null,
      operationId: input.operationId,
      causeId: input.causeId,
      expectedRevision: input.expectedRevision,
    },
    { persist: false },
  );

  const action = markActionCompleted(actionSeed.id, actionSeed.command, { record: resolvedAfter }, { persist: false }) ?? actionSeed;
  persistCommittedOperation({
    actionId: action.id,
    operationId: action.operation_id,
    causeId: action.cause_id,
    domain: action.domain,
    recordId: resolvedAfter.id,
    before: previous,
    after: resolvedAfter,
  });

  return {
    action,
    record: resolvedAfter,
    replayed: false,
  };
}

export function archiveRecordWithAction(input: Parameters<typeof archiveRecordWithActionMutation>[0]): ActionWriteResult {
  return mutateCanonicalStore(() => archiveRecordWithActionMutation(input));
}

export function deleteRecordWithAction(input: {
  actionId: string;
  actor: string;
  domain: string;
  tool: string;
  risk: ActionRisk;
  command: string;
  id: string;
  idempotencyKey?: string;
  sourceIds?: string[];
  conversationId?: string | null;
  expectedRevision?: number;
  operationId?: string;
  causeId?: string;
  undoPayload?: Record<string, unknown>;
}): ActionWriteResult {
  return mutateCanonicalStore(() => {
    const idempotencyKey = resolveIdempotencyKey(input.idempotencyKey);
    const replay = idempotencyKey ? findActionByIdempotencyKey(idempotencyKey) : null;
    if (replay?.status === 'completed') {
      return { action: replay, replayed: true };
    }
    const previous = findRecord(input.id);
    if (!previous) {
      const action = createActionEvent({
        id: input.actionId,
        actor: input.actor,
        domain: input.domain,
        tool: input.tool,
        risk: input.risk,
        recordIds: [input.id],
        idempotencyKey,
        command: input.command,
        before: null,
        after: null,
        undoPayload: null,
        sourceIds: input.sourceIds,
        conversationId: input.conversationId ?? null,
        operationId: input.operationId,
        causeId: input.causeId,
        expectedRevision: input.expectedRevision,
        status: 'failed',
      }, { persist: false });
      const failed = markActionFailed(action.id, 'record not found', { persist: false }) ?? action;
      persistStore();
      return { action: failed, replayed: false };
    }
    if (input.expectedRevision !== undefined && (previous.revision ?? 0) !== input.expectedRevision) {
      const action = createActionEvent({
        id: input.actionId,
        actor: input.actor,
        domain: previous.domain,
        tool: input.tool,
        risk: input.risk,
        recordIds: [input.id],
        idempotencyKey,
        command: input.command,
        before: previous,
        after: null,
        undoPayload: null,
        sourceIds: input.sourceIds,
        conversationId: input.conversationId ?? null,
        operationId: input.operationId,
        causeId: input.causeId,
        expectedRevision: input.expectedRevision,
        status: 'failed',
      }, { persist: false });
      const failed = markActionFailed(action.id, 'revision conflict', { persist: false }) ?? action;
      persistStore();
      return { action: failed, record: previous, replayed: false };
    }

    delete store.records[input.id];
    const actionSeed = createActionEvent({
      id: input.actionId,
      actor: input.actor,
      domain: previous.domain,
      tool: input.tool,
      risk: input.risk,
      recordIds: [input.id],
      idempotencyKey,
      command: input.command,
      before: previous,
      after: null,
      undoPayload: input.undoPayload ?? {
        operation: 'restore_record',
        record_id: previous.id,
        record: previous,
      },
      sourceIds: input.sourceIds,
      conversationId: input.conversationId ?? null,
      operationId: input.operationId,
      causeId: input.causeId,
      expectedRevision: input.expectedRevision,
    }, { persist: false });
    const action = markActionCompleted(actionSeed.id, actionSeed.command, { record: null }, { persist: false }) ?? actionSeed;
    persistCommittedOperation({
      actionId: action.id,
      operationId: action.operation_id,
      causeId: action.cause_id,
      domain: action.domain,
      recordId: previous.id,
      before: previous,
      after: null,
    });
    return { action, replayed: false };
  });
}

function readActions(): ActionEvent[] {
  return Object.values(store.actions);
}

export function getActionEvent(id: string) {
  const action = store.actions[id];
  return action ? cloneActionEvent(action) : null;
}

export function findActionByIdempotencyKey(idempotencyKey: string) {
  const events = readActions();
  return events.find((action) => action.idempotency_key && action.idempotency_key === idempotencyKey) || null;
}

function createActionEventMutation(input: {
  id: string;
  actor: string;
  domain: string;
  tool: string;
  risk: ActionRisk;
  recordIds: string[];
  idempotencyKey?: string;
  command: string;
  before?: unknown;
  after?: unknown;
  undoPayload?: unknown;
  status?: ActionEvent['status'];
  sourceIds?: string[];
  conversationId?: string | null;
  operationId?: string;
  causeId?: string;
  expectedRevision?: number;
}, options: PersistOptions = {}): ActionEvent {
  const now = nowIso();
  const idempotencyKey = input.idempotencyKey?.trim() || null;

  if (idempotencyKey) {
    const existing = findActionByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.status !== 'completed' && existing.id === input.id) {
        store.actions[existing.id] = {
          ...store.actions[existing.id],
          actor: input.actor,
          domain: input.domain,
          tool: input.tool,
          risk: input.risk,
          status: input.status ?? existing.status,
          record_ids: input.recordIds,
          before_json: input.before ?? null,
          after_json: input.after ?? null,
          undo_payload_json: input.undoPayload ?? null,
          source_ids: input.sourceIds ?? [],
          conversation_id: input.conversationId ?? null,
          command: input.command,
          operation_id: input.operationId?.trim() || existing.operation_id,
          cause_id: input.causeId?.trim() || existing.cause_id,
          expected_revision: input.expectedRevision ?? null,
          updated_at: now,
        };
        if (options.persist !== false) {
          persistStore();
        }
        return cloneActionEvent(store.actions[existing.id]);
      }
      return existing;
    }
  }

  const event: ActionEvent = {
    schema_version: 'utopia.action-event.v1',
    id: input.id,
    actor: input.actor,
    domain: input.domain,
    tool: input.tool,
    risk: input.risk,
    status: input.status ?? 'queued',
    record_ids: input.recordIds,
    before_json: input.before ?? null,
    after_json: input.after ?? null,
    undo_payload_json: input.undoPayload ?? null,
    idempotency_key: idempotencyKey,
    created_at: now,
    updated_at: now,
    undo_deadline_at: nowDeadlineIso(),
    conversation_id: input.conversationId ?? null,
    source_ids: input.sourceIds ?? [],
    command: input.command,
    operation_id: input.operationId?.trim() || `${input.id}:operation`,
    cause_id: input.causeId?.trim() || input.id,
    expected_revision: input.expectedRevision ?? null,
    verification_json: null,
  };

  store.actions[event.id] = event;
  if (options.persist !== false) {
    persistStore();
  }
  return cloneActionEvent(event);
}

export function createActionEvent(
  input: Parameters<typeof createActionEventMutation>[0],
  options: PersistOptions = {},
): ActionEvent {
  if (options.persist === false) {
    const result = createActionEventMutation(input, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => createActionEventMutation(input, options));
}

function markActionCompletedMutation(id: string, command?: string, after?: unknown, options: PersistOptions = {}) {
  const existing = store.actions[id];
  if (!existing) {
    return null;
  }

  store.actions[id] = {
    ...existing,
    status: 'completed',
    command: command ?? existing.command,
    after_json: after ?? existing.after_json,
    updated_at: nowIso(),
  };
  if (options.persist !== false) {
    persistStore();
  }
  return cloneActionEvent(store.actions[id]);
}

export function markActionCompleted(id: string, command?: string, after?: unknown, options: PersistOptions = {}) {
  if (options.persist === false) {
    const result = markActionCompletedMutation(id, command, after, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => markActionCompletedMutation(id, command, after, options));
}

function attachActionVerificationMutation(id: string, verification: unknown, options: PersistOptions = {}) {
  const existing = store.actions[id];
  if (!existing) {
    return null;
  }
  store.actions[id] = {
    ...existing,
    verification_json: verification,
    updated_at: nowIso(),
  };
  if (options.persist !== false) {
    persistStore();
  }
  return cloneActionEvent(store.actions[id]);
}

export function attachActionVerification(id: string, verification: unknown, options: PersistOptions = {}) {
  if (options.persist === false) {
    const result = attachActionVerificationMutation(id, verification, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => attachActionVerificationMutation(id, verification, options));
}

function markActionFailedMutation(id: string, reason?: string, options: PersistOptions = {}) {
  const existing = store.actions[id];
  if (!existing) {
    return null;
  }

  store.actions[id] = {
    ...existing,
    status: 'failed',
    updated_at: nowIso(),
  };
  if (options.persist !== false) {
    persistStore();
  }
  return { ...cloneActionEvent(store.actions[id]), reason };
}

export function markActionFailed(id: string, reason?: string, options: PersistOptions = {}) {
  if (options.persist === false) {
    const result = markActionFailedMutation(id, reason, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => markActionFailedMutation(id, reason, options));
}

function updateUndoLifecycle(
  id: string,
  status: 'undone' | 'undo_failed',
  verification: unknown,
  options: PersistOptions = {},
) {
  const existing = store.actions[id];
  if (!existing) {
    return null;
  }
  store.actions[id] = {
    ...existing,
    status,
    verification_json: verification,
    updated_at: nowIso(),
  };
  if (options.persist !== false) {
    persistStore();
  }
  return cloneActionEvent(store.actions[id]);
}

export function markActionUndone(id: string, verification: unknown, options: PersistOptions = {}) {
  if (options.persist === false) {
    const result = updateUndoLifecycle(id, 'undone', verification, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => updateUndoLifecycle(id, 'undone', verification, options));
}

export function markActionUndoFailed(id: string, verification: unknown, options: PersistOptions = {}) {
  if (options.persist === false) {
    const result = updateUndoLifecycle(id, 'undo_failed', verification, options);
    retainUnpersistedStore();
    return result;
  }
  return mutateCanonicalStore(() => updateUndoLifecycle(id, 'undo_failed', verification, options));
}

function isUndoWindowOpen(deadlineAt: string | null) {
  if (!deadlineAt) {
    return false;
  }
  return Date.parse(deadlineAt) > Date.now();
}

type WorkflowCheckpointUndoResult = {
  applied: number;
  skipped: number;
  errors: string[];
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function extractActionRecord(value: unknown): McpRecord | null {
  const direct = asRecord(value);
  if (!direct) {
    return null;
  }
  if (typeof direct.id === 'string' && typeof direct.domain === 'string' && typeof direct.collection === 'string') {
    return direct as unknown as McpRecord;
  }
  const nested = asRecord(direct.record) || asRecord(direct.after) || asRecord(direct.before);
  if (nested && typeof nested.id === 'string' && typeof nested.domain === 'string' && typeof nested.collection === 'string') {
    return nested as unknown as McpRecord;
  }
  return null;
}

function extractProviderSnapshot(action: ActionEvent, payload: Record<string, unknown> | null) {
  const candidate =
    asRecord(payload?.provider_snapshot)
    || asRecord(asRecord(action.after_json)?.source_snapshot)
    || asRecord(asRecord(action.before_json)?.source_snapshot)
    || asRecord(asRecord(asRecord(action.after_json)?.record)?.source_snapshot)
    || asRecord(asRecord(asRecord(action.before_json)?.record)?.source_snapshot);
  return candidate;
}

function providerFromUndoContext(input: {
  payload: Record<string, unknown> | null;
  beforeRecord: McpRecord | null;
  afterRecord: McpRecord | null;
  providerSnapshot: Record<string, unknown> | null;
}) {
  const fromSnapshot = asText(input.providerSnapshot?.provider);
  if (fromSnapshot === 'notion' || fromSnapshot === 'google_sheets') {
    return fromSnapshot;
  }
  const fromBefore = input.beforeRecord?.source.provider;
  if (fromBefore === 'notion' || fromBefore === 'google_sheets') {
    return fromBefore;
  }
  const fromAfter = input.afterRecord?.source.provider;
  if (fromAfter === 'notion' || fromAfter === 'google_sheets') {
    return fromAfter;
  }
  const snapshotProvider = asText(input.payload?.provider);
  return snapshotProvider === 'notion' || snapshotProvider === 'google_sheets' ? snapshotProvider : null;
}

export function runProviderUndoSync(input: ProviderUndoInput): ProviderUndoResult {
  try {
    const command = existsSync(PROVIDER_UNDO_TSX_PATH) ? PROVIDER_UNDO_TSX_PATH : process.execPath;
    const hasTsx = existsSync(PROVIDER_UNDO_TSX_PATH);
    const args = hasTsx
      ? ['--tsconfig', 'tsconfig.json', PROVIDER_UNDO_WORKER_PATH, JSON.stringify(input)]
      : ['--experimental-strip-types', PROVIDER_UNDO_WORKER_PATH, JSON.stringify(input)];
    const output = execFileSync(command, args, {
      encoding: 'utf-8',
      env: process.env,
      cwd: dirname(fileURLToPath(new URL('../../../package.json', import.meta.url))),
    }).trim();
    const parsed = JSON.parse(output || '{}') as ProviderUndoResult;
    if (!parsed || typeof parsed !== 'object' || !('ok' in parsed)) {
      return { ok: false, message: 'Provider undo worker returned malformed output.' };
    }
    return parsed;
  } catch (error) {
    const stdout = typeof error === 'object' && error !== null && 'stdout' in error
      ? String((error as { stdout?: unknown }).stdout ?? '').trim()
      : '';
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout) as ProviderUndoResult;
        if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
          return parsed;
        }
      } catch {
        // Fall through to generic error handling below.
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Provider undo worker failed: ${message}` };
  }
}

function undoProviderFromStepResult(input: {
  tool: string;
  result: Record<string, unknown> | null;
}) {
  const beforeRecord = extractActionRecord(input.result?.before);
  const afterRecord = extractActionRecord(input.result?.after) || extractActionRecord(input.result);
  const providerSnapshot = asRecord(input.result?.source_snapshot);
  const provider = providerFromUndoContext({
    payload: input.result,
    beforeRecord,
    afterRecord,
    providerSnapshot,
  });
  if (!provider) {
    return { ok: true } as const;
  }
  const operation = input.tool === 'create_record'
    ? 'delete_record'
    : input.tool === 'archive_record'
      ? 'restore_after_archive'
      : 'restore_after_update';
  return runProviderUndoSync({
    operation,
    provider,
    currentRecord: afterRecord,
    desiredRecord: beforeRecord,
    providerSnapshot,
  });
}

export function applyLocalUndoOperation(input: {
  operation: 'delete_record' | 'restore_after_update' | 'restore_after_archive' | 'restore_record';
  recordId?: string;
  record?: McpRecord | null;
  parentActionId?: string;
  workflowRunId?: string;
  actor?: string;
}): { ok: true; receipt: LocalUndoReceipt } | { ok: false; receipt: LocalUndoReceipt } {
  const mutationScope = (
    input.parentActionId
    || input.workflowRunId
    || `${input.recordId || input.record?.id || 'unknown'}:${input.record?.revision ?? 'current'}`
  ).replace(/[^A-Za-z0-9_.:-]/g, '_');
  const actionId = `canonical-undo:${mutationScope}:${input.operation}`;
  const idempotencyKey = `canonical-undo:${mutationScope}:${input.operation}`;
  const actor = input.actor?.trim() || (input.workflowRunId ? 'workflow' : 'agent');

  if (input.operation === 'delete_record') {
    const recordId = asText(input.recordId);
    const before = recordId ? findRecord(recordId) : null;
    if (!recordId) {
      return {
        ok: false,
        receipt: {
          status: 'undo_failed',
          operation: input.operation,
          message: 'Undo payload missing created record id.',
        },
      };
    }
    const write = deleteRecordWithAction({
      actionId,
      actor,
      domain: before?.domain || input.record?.domain || 'food',
      tool: 'canonical_undo_delete_record',
      risk: 'standard',
      command: `undo create_record ${recordId}`,
      id: recordId,
      idempotencyKey,
      sourceIds: input.parentActionId ? [input.parentActionId] : [],
      expectedRevision: before?.revision,
      causeId: input.parentActionId || input.workflowRunId || actionId,
    });
    if (write.action.status !== 'completed') {
      return {
        ok: false,
        receipt: {
          status: 'undo_failed',
          operation: input.operation,
          record_id: recordId,
          before,
          message: 'Canonical undo delete failed.',
        },
      };
    }
    return {
      ok: true,
      receipt: {
        status: 'undone',
        operation: input.operation,
        record_id: recordId,
        before,
        after: null,
        message: write.replayed ? 'Undo already applied.' : 'Undo applied.',
      },
    };
  }

  const record = input.record ?? null;
  if (!record || typeof record !== 'object') {
    return {
      ok: false,
      receipt: {
        status: 'undo_failed',
        operation: input.operation,
        message: 'Undo payload missing prior record.',
      },
    };
  }

  const before = findRecord(record.id);
  const write = before
    ? updateRecordWithAction({
        actionId,
        actor,
        domain: before.domain,
        tool: 'canonical_undo_restore_record',
        risk: 'standard',
        command: `${input.operation} ${record.id}`,
        id: record.id,
        patch: {
          title: record.title,
          properties: record.properties,
          relations: record.relations,
          source: record.source,
          archived_at: record.archived_at,
        },
        source: record.source,
        idempotencyKey,
        sourceIds: input.parentActionId ? [input.parentActionId] : [],
        expectedRevision: before.revision,
        causeId: input.parentActionId || input.workflowRunId || actionId,
        undoPayload: {
          operation: 'restore_record',
          record_id: before.id,
          record: before,
        },
      })
    : createRecordWithAction({
        actionId,
        actor,
        domain: record.domain,
        tool: 'canonical_undo_restore_record',
        risk: 'standard',
        command: `${input.operation} ${record.id}`,
        record,
        idempotencyKey,
        sourceIds: input.parentActionId ? [input.parentActionId] : [],
        causeId: input.parentActionId || input.workflowRunId || actionId,
      });
  const after = write.record ?? findRecord(record.id);
  if (write.action.status !== 'completed' || !after) {
    return {
      ok: false,
      receipt: {
        status: 'undo_failed',
        operation: input.operation,
        record_id: record.id,
        before,
        after: after ?? null,
        message: 'Canonical undo restore failed.',
      },
    };
  }
  return {
    ok: true,
    receipt: {
      status: 'undone',
      operation: input.operation,
      record_id: record.id,
      before,
      after,
      message: write.replayed ? 'Undo already applied.' : 'Undo applied.',
    },
  };
}

function toWorkflowUndoRecordId(raw: unknown): string {
  if (!raw || typeof raw !== 'object') {
    return '';
  }
  return asText((raw as { id?: unknown }).id);
}

function applyWorkflowCheckpointUndo(checkpoint: WorkflowRunCheckpoint, parentActionId: string): WorkflowCheckpointUndoResult {
  const result: WorkflowCheckpointUndoResult = {
    applied: 0,
    skipped: 0,
    errors: [],
  };
  const visited = new Set<string>();

  for (const step of [...checkpoint.steps].reverse()) {
    const stepResult = step.result && typeof step.result === 'object' ? (step.result as Record<string, unknown>) : null;
    const tool = asText(step.tool);
    if (tool === 'create_record') {
      const providerUndo = undoProviderFromStepResult({ tool, result: stepResult });
      if (!providerUndo.ok) {
        result.errors.push(providerUndo.message);
        continue;
      }
      const recordId = asText(stepResult?.id) || asText(stepResult?.after && (stepResult.after as { id?: unknown }).id) || asText(step.changed_records[0]);
      if (!recordId) {
        result.skipped += 1;
        continue;
      }
      if (visited.has(recordId)) {
        result.skipped += 1;
        continue;
      }
      visited.add(recordId);
      const localUndo = applyLocalUndoOperation({
        operation: 'delete_record',
        recordId,
        parentActionId: `${parentActionId}:${step.id}`,
        workflowRunId: checkpoint.run_id,
        actor: checkpoint.actor,
      });
      if (localUndo.ok) {
        result.applied += 1;
      } else {
        result.errors.push(localUndo.receipt.message);
      }
      continue;
    }

    if (tool === 'update_record' || tool === 'archive_record') {
      const providerUndo = undoProviderFromStepResult({ tool, result: stepResult });
      if (!providerUndo.ok) {
        result.errors.push(providerUndo.message);
        continue;
      }
      const before = stepResult?.before;
      if (!before || typeof before !== 'object') {
        result.skipped += 1;
        continue;
      }
      const record = before as McpRecord;
      const recordId = asText(record.id);
      if (!recordId || visited.has(recordId)) {
        result.skipped += 1;
        continue;
      }
      visited.add(recordId);
      const localUndo = applyLocalUndoOperation({
        operation: tool === 'archive_record' ? 'restore_after_archive' : 'restore_after_update',
        record,
        parentActionId: `${parentActionId}:${step.id}`,
        workflowRunId: checkpoint.run_id,
        actor: checkpoint.actor,
      });
      if (localUndo.ok) {
        result.applied += 1;
      } else {
        result.errors.push(localUndo.receipt.message);
      }
      continue;
    }

    if (tool === 'run_workflow') {
      // Nested workflows should already have emitted concrete child steps into the same checkpoint stream.
      if (Array.isArray(stepResult?.details)) {
        for (const nestedStep of (stepResult.details as unknown[]).slice().reverse()) {
          if (!nestedStep || typeof nestedStep !== 'object') {
            continue;
          }
          const entry = nestedStep as {
            tool?: unknown;
            result?: unknown;
          };
          const nestedTool = asText(entry.tool);
          const nestedResult = entry.result && typeof entry.result === 'object' ? (entry.result as Record<string, unknown>) : null;
          if (nestedTool === 'create_record') {
            const providerUndo = undoProviderFromStepResult({ tool: nestedTool, result: nestedResult });
            if (!providerUndo.ok) {
              result.errors.push(providerUndo.message);
              continue;
            }
            const recordId = asText(nestedResult?.id) || toWorkflowUndoRecordId(nestedResult?.after);
            if (!recordId || visited.has(recordId)) {
              result.skipped += 1;
              continue;
            }
            visited.add(recordId);
            const localUndo = applyLocalUndoOperation({
              operation: 'delete_record',
              recordId,
              parentActionId: `${parentActionId}:${step.id}:${recordId}`,
              workflowRunId: checkpoint.run_id,
              actor: checkpoint.actor,
            });
            if (localUndo.ok) {
              result.applied += 1;
            } else {
              result.errors.push(localUndo.receipt.message);
            }
            continue;
          }
          if (nestedTool === 'update_record' || nestedTool === 'archive_record') {
            const providerUndo = undoProviderFromStepResult({ tool: nestedTool, result: nestedResult });
            if (!providerUndo.ok) {
              result.errors.push(providerUndo.message);
              continue;
            }
            const nestedBefore = nestedResult?.before;
            if (!nestedBefore || typeof nestedBefore !== 'object') {
              result.skipped += 1;
              continue;
            }
            const nestedRecord = nestedBefore as McpRecord;
            const nestedRecordId = asText(nestedRecord.id);
            if (!nestedRecordId || visited.has(nestedRecordId)) {
              result.skipped += 1;
              continue;
            }
            visited.add(nestedRecordId);
            const localUndo = applyLocalUndoOperation({
              operation: nestedTool === 'archive_record' ? 'restore_after_archive' : 'restore_after_update',
              record: nestedRecord,
              parentActionId: `${parentActionId}:${step.id}:${nestedRecordId}`,
              workflowRunId: checkpoint.run_id,
              actor: checkpoint.actor,
            });
            if (localUndo.ok) {
              result.applied += 1;
            } else {
              result.errors.push(localUndo.receipt.message);
            }
            continue;
          }
        }
      }
      continue;
    }

    if (tool !== 'search_records' && tool !== 'read_record' && tool !== '') {
      result.skipped += 1;
    }
  }

  return result;
}

export function listActionIds() {
  return Object.keys(store.actions);
}

export function runUndo(actionId: string): { success: boolean; action?: ActionEvent; message: string } {
  const action = store.actions[actionId];
  if (!action) {
    return {
      success: false,
      message: 'Action not found.',
    };
  }

  if (action.status === 'undone') {
    return {
      success: true,
      action: cloneActionEvent(action),
      message: 'Action already undone.',
    };
  }

  if (action.status !== 'completed' && action.status !== 'undo_failed') {
    return {
      success: false,
      action: cloneActionEvent(action),
      message: `Cannot undo action in status ${action.status}.`,
    };
  }

  const failUndo = (message: string, verification?: Record<string, unknown>) => {
    const failedAction = markActionUndoFailed(actionId, {
      status: 'undo_failed',
      message,
      ...(verification ?? {}),
    }) ?? cloneActionEvent(store.actions[actionId] ?? action);
    return {
      success: false,
      action: failedAction,
      message,
    };
  };

  if (!isUndoWindowOpen(action.undo_deadline_at)) {
    return failUndo('Undo window has expired.');
  }

  const payload = action.undo_payload_json as {
    operation?: string;
    before?: McpRecord | null;
    after?: McpRecord | null;
    record_id?: string;
    record?: McpRecord | null;
    target_id?: string;
    checkpoint_run_id?: unknown;
  } | null;
  if (!payload || typeof payload !== 'object') {
    return failUndo('No reversible payload stored.');
  }

  const record = payload.record || payload.before || payload.after || null;
  const operation = payload.operation?.trim();
  const payloadRecord = asRecord(payload);
  const beforeRecord = extractActionRecord(payload.before) || extractActionRecord(action.before_json);
  const afterRecord = extractActionRecord(payload.after) || extractActionRecord(action.after_json);
  const providerSnapshot = extractProviderSnapshot(action, payloadRecord);
  const provider = providerFromUndoContext({
    payload: payloadRecord,
    beforeRecord,
    afterRecord,
    providerSnapshot,
  });
  let providerVerification: Record<string, unknown> | undefined;

  if (provider) {
    const providerUndo = runProviderUndoSync({
      operation: operation === 'delete_record' || operation === 'restore_after_update' || operation === 'restore_after_archive' || operation === 'restore_record'
        ? operation
        : 'restore_record',
      provider,
      currentRecord: afterRecord,
      desiredRecord: beforeRecord || extractActionRecord(record),
      providerSnapshot,
    });
    if (!providerUndo.ok) {
      return failUndo(providerUndo.message, {
        provider_undo: {
          status: 'undo_failed',
          provider,
          operation: operation ?? 'restore_record',
          message: providerUndo.message,
        },
      });
    }
    providerVerification = {
      provider_undo: {
        status: 'undone',
        provider,
        operation: operation ?? 'restore_record',
        message: providerUndo.message,
        snapshot: providerUndo.snapshot ?? null,
      },
    };
  }

  if (operation === 'undo_workflow_checkpoint') {
    const after = action.after_json && typeof action.after_json === 'object' ? (action.after_json as { checkpoint_run_id?: unknown }) : null;
    const checkpointRunId =
      asText(payload.checkpoint_run_id) ||
      asText((action.before_json as { checkpoint_run_id?: unknown })?.checkpoint_run_id) ||
      asText(after?.checkpoint_run_id);
    if (!checkpointRunId) {
      return failUndo('Undo workflow payload missing checkpoint id.');
    }

    const checkpoint = getWorkflowCheckpoint(checkpointRunId);
    if (!checkpoint) {
      return failUndo(`Workflow checkpoint ${checkpointRunId} not found.`);
    }

    const undoResult = applyWorkflowCheckpointUndo(checkpoint, actionId);
    if (undoResult.errors.length > 0) {
      return failUndo(`Undo workflow checkpoint failed: ${undoResult.errors.join('; ')}`, {
        workflow_undo: {
          status: 'undo_failed',
          workflow_run_id: checkpointRunId,
          applied: undoResult.applied,
          skipped: undoResult.skipped,
          errors: undoResult.errors,
        },
      });
    }

    const undone = markActionUndone(actionId, {
      status: 'undone',
      workflow_undo: {
        status: 'undone',
        workflow_run_id: checkpointRunId,
        applied: undoResult.applied,
        skipped: undoResult.skipped,
        errors: undoResult.errors,
      },
      ...(providerVerification ?? {}),
    }) ?? cloneActionEvent(store.actions[actionId] ?? action);
    return {
      success: true,
      action: undone,
      message: `Undo applied.${undoResult.applied > 0 ? ` ${undoResult.applied} step(s) reverted.` : ''}${undoResult.skipped > 0 ? ` ${undoResult.skipped} step(s) skipped.` : ''}`.trim(),
    };
  }

  if (operation !== 'delete_record'
    && operation !== 'restore_record'
    && operation !== 'restore_after_update'
    && operation !== 'restore_after_archive') {
    return failUndo('Unsupported undo payload.');
  }

  const localUndo = applyLocalUndoOperation({
    operation,
    recordId: payload.record_id || payload.target_id,
    record: record as McpRecord | null,
    parentActionId: actionId,
    actor: action.actor,
  });
  if (!localUndo.ok) {
    return failUndo(localUndo.receipt.message, {
      local_undo: localUndo.receipt,
      ...(providerVerification ?? {}),
    });
  }

  const undone = markActionUndone(actionId, {
    status: 'undone',
    local_undo: localUndo.receipt,
    ...(providerVerification ?? {}),
  }) ?? cloneActionEvent(store.actions[actionId] ?? action);

  return { success: true, action: undone, message: localUndo.receipt.message };
}

export function listWorkflows(): WorkflowDocument[] {
  return loadCatalogWorkflows();
}

export function findWorkflow(id: string) {
  const found = listWorkflows().find((entry) => entry.id === id);
  return found ? { ...found } : null;
}

export function listRecordUris(): string[] {
  return Object.keys(store.records).sort().map((id) => `utopia://record/${encodeURIComponent(id)}`);
}

export function listConversationUris(): string[] {
  return [];
}

export function listActionUris(): string[] {
  return Object.keys(store.actions).sort().map((id) => `utopia://action/${encodeURIComponent(id)}`);
}

export function listActionEvents(): ActionEvent[] {
  return Object.values(store.actions)
    .map(cloneActionEvent)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function touch() {
  mutateCanonicalStore(() => persistStore());
}
