import type { CanonicalRecord, CanonicalProvenance } from '@/src/domain/runtime';
import { canonicalJson } from '@/src/domain/canonical-json';
import type { OperationActor, OperationOrigin } from '@/src/ops/operation';
import type { OperationCommitEvent } from '../kernel/operation-observer';

export type ActionRisk = 'low' | 'standard' | 'sensitive' | 'irreversible' | 'restricted';

export type RecordProvider = 'notion' | 'google_sheets' | 'sqlite' | 'postgres' | 'web' | 'user';

export type RecordSource = {
  provider: RecordProvider;
  external_id: string;
  url: string | null;
  observed_at: string;
  content_hash: string | null;
};

export type CanonicalRelation = {
  name: string;
  target_id: string;
};

export type McpRecord = {
  id: string;
  domain: string;
  collection: string;
  title: string;
  properties: Record<string, unknown>;
  relations: CanonicalRelation[];
  source: RecordSource;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  revision?: number;
};

export type ActionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'undone'
  | 'undo_failed';

export type ActionEvent = {
  schema_version: 'utopia.action-event.v1';
  id: string;
  actor: string;
  domain: string;
  tool: string;
  risk: ActionRisk;
  status: ActionStatus;
  record_ids: string[];
  before_json: unknown | null;
  after_json: unknown | null;
  undo_payload_json: unknown | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
  undo_deadline_at: string | null;
  conversation_id: string | null;
  source_ids: string[];
  command: string;
  operation_id: string;
  cause_id: string;
  expected_revision: number | null;
  verification_json?: unknown | null;
};

export type OperationCommitOutboxItem = {
  event: OperationCommitEvent;
  status: 'pending';
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PersistedStore = {
  version: 1;
  updated_at: string;
  records: Record<string, McpRecord>;
  actions: Record<string, ActionEvent>;
  operation_commit_outbox: Record<string, OperationCommitOutboxItem>;
};

export type PersistOptions = {
  persist?: boolean;
};

export type WorkflowStep = {
  id: string;
  action?: string;
  tool?: string;
  skill?: string;
  input?: Record<string, unknown>;
  input_from?: string[];
  output?: string;
  required?: boolean;
  [key: string]: unknown;
};

export type WorkflowDocument = {
  schema_version: 'utopia.workflow.v1';
  id: string;
  domain: string;
  label: string;
  trigger?: Record<string, unknown>;
  steps: WorkflowStep[];
  write_policy: string;
  [key: string]: unknown;
};

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function actorForAction(actor: string): OperationActor {
  return actor === 'user' || actor === 'ai' || actor === 'import' || actor === 'sync' || actor === 'agent' || actor === 'api' || actor === 'workflow'
    ? actor
    : 'agent';
}

export function originForAction(tool: string): OperationOrigin {
  if (tool.includes('workflow')) return 'workflow';
  if (tool.includes('import')) return 'import';
  if (tool.includes('sync')) return 'sync';
  return 'chat';
}

export function provenanceForAction(input: { actor: string; command: string }): CanonicalProvenance {
  return {
    actor: actorForAction(input.actor),
    confidence: null,
    evidence: [],
    reason: input.command || null,
  };
}

export function toCanonicalRecord(record: McpRecord | null): CanonicalRecord | null {
  if (!record) return null;
  return {
    ...record,
    revision: record.revision ?? 1,
    schema_version: '1.0.0',
    deleted: false,
    privacy: 'personal',
    provenance: null,
  };
}

export function toMcpRecord(record: CanonicalRecord): McpRecord {
  return {
    id: record.id,
    domain: record.domain,
    collection: record.collection,
    title: record.title,
    properties: record.properties,
    relations: record.relations,
    source: record.source,
    archived_at: record.archived_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
    revision: record.revision,
  };
}

export function isOperationCommitOutboxItem(value: unknown): value is OperationCommitOutboxItem {
  if (!isObject(value) || !isObject(value.event)) return false;
  const event = value.event;
  return (
    value.status === 'pending'
    && Number.isInteger(value.attempts)
    && Number(value.attempts) >= 0
    && (value.last_error === null || typeof value.last_error === 'string')
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && typeof event.actionId === 'string'
    && typeof event.operationId === 'string'
    && typeof event.causeId === 'string'
    && typeof event.domain === 'string'
    && typeof event.recordId === 'string'
    && Object.hasOwn(event, 'before')
    && Object.hasOwn(event, 'after')
  );
}

export function stableStringify(value: unknown): string {
  return canonicalJson(value);
}

export function normalizeProviderSourceEquality(source: RecordSource) {
  return {
    provider: source.provider,
    external_id: source.external_id,
    url: source.url,
    content_hash: source.content_hash,
  };
}

export function cloneActionEvent(action: ActionEvent): ActionEvent {
  return {
    ...action,
    operation_id: action.operation_id || `${action.id}:operation`,
    cause_id: action.cause_id || action.id,
    expected_revision: typeof action.expected_revision === 'number' ? action.expected_revision : null,
    verification_json: action.verification_json ?? null,
    record_ids: [...action.record_ids],
    source_ids: [...action.source_ids],
  };
}
