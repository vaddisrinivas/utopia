import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonStateFile } from '../providers/json-state';
import {
  isObject,
  isOperationCommitOutboxItem,
  nowIso,
  type ActionEvent,
  type McpRecord,
  type OperationCommitOutboxItem,
  type PersistedStore,
} from './state-types';

export const RUNTIME_STATE_PATH =
  process.env.WONDER_RUNTIME_STATE_PATH ?? join(process.cwd(), 'server-data', 'wonder-runtime.json');

export function createEmptyStore(): PersistedStore {
  return {
    version: 1,
    updated_at: nowIso(),
    records: {},
    actions: {},
    operation_commit_outbox: {},
  };
}

export function normalizeOperationCommitOutbox(value: unknown): Record<string, OperationCommitOutboxItem> {
  if (!isObject(value)) return {};
  return value as Record<string, OperationCommitOutboxItem>;
}

export function normalizeStore(parsed: PersistedStore): PersistedStore {
  return {
    version: 1,
    updated_at: String(parsed.updated_at),
    records: parsed.records as Record<string, McpRecord>,
    actions: Object.fromEntries(
      Object.entries(parsed.actions as Record<string, ActionEvent>).map(([id, action]) => [id, {
        ...action,
        operation_id: action.operation_id || `${action.id || id}:operation`,
        cause_id: action.cause_id || action.id || id,
        expected_revision: typeof action.expected_revision === 'number' ? action.expected_revision : null,
        verification_json: action.verification_json ?? null,
      }]),
    ),
    operation_commit_outbox: normalizeOperationCommitOutbox(parsed.operation_commit_outbox),
  };
}

export function isValidStore(value: unknown): value is PersistedStore {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    row.version === 1
    && typeof row.updated_at === 'string'
    && isObject(row.records)
    && isObject(row.actions)
    && (
      row.operation_commit_outbox === undefined
      || (
        isObject(row.operation_commit_outbox)
        && Object.entries(row.operation_commit_outbox).every(([operationId, item]) => (
          isOperationCommitOutboxItem(item)
          && item.event.operationId === operationId
        ))
      )
    )
  );
}

export function loadStore(): PersistedStore {
  if (!existsSync(RUNTIME_STATE_PATH)) {
    return createEmptyStore();
  }
  return normalizeStore(readJsonStateFile(RUNTIME_STATE_PATH, {
    label: 'Wonder runtime state',
    validate: isValidStore,
  }));
}
