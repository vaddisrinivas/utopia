import jsonLogic from 'json-logic-js';
import { canonicalize } from 'json-canonicalize';
import { z } from 'zod';

import type { AppAction, AppPackage } from './schema';
import { applyQueryPagination, matchesWhere, normalizeQueryOptions, sortByFields, type QueryOptions } from './query';

export const JsonRecordSchema = z.object({
  id: z.string().min(1),
  collection: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().nonnegative().optional(),
  deletedAt: z.string().optional(),
  values: z.record(z.string(), z.unknown()),
});
export const ReceiptSchema = z.object({
  id: z.string(),
  operation: z.string(),
  status: z.enum(['completed', 'unavailable']),
  at: z.string(),
  recordId: z.string().optional(),
});
export const AppStateSchema = z.object({
  records: z.array(JsonRecordSchema),
  undo: z.array(z.array(JsonRecordSchema)).optional(),
  receipts: z.array(ReceiptSchema).optional(),
  tombstones: z.array(JsonRecordSchema).optional(),
  applied: z.array(z.string()).optional(),
  workflows: z.record(z.string(), z.object({
    schemaVersion: z.literal('workflow.snapshot.v3'),
    state: z.string(),
    control: z.enum(['running', 'paused', 'completed', 'failed', 'cancelled', 'compensating', 'compensated']),
    revision: z.number().int().nonnegative(),
    updatedAt: z.string(),
    checkpoint: z.record(z.string(), z.unknown()),
  })).optional(),
  timers: z.record(z.string(), z.object({
    durationMs: z.number().nonnegative(), elapsedMs: z.number().nonnegative(),
    status: z.enum(['idle', 'running', 'paused', 'completed', 'review']), updatedAt: z.string(),
  })).optional(),
});
export type JsonRecord = z.infer<typeof JsonRecordSchema>;
export type AppState = z.infer<typeof AppStateSchema>;

export const emptyState: AppState = { records: [] };

export function routeScreen(target: string, screens: string[]): string | undefined {
  const query = target.includes('?') ? new URLSearchParams(target.slice(target.indexOf('?') + 1)).get('screen') : undefined;
  const id = query ?? target.replace(/^\//, '').split(/[/?#]/)[0];
  return screens.includes(id) ? id : undefined;
}

export function queryRecords(
  state: AppState,
  collections: string[] = [],
  match = '',
  limit = 50,
  options: QueryOptions = {},
): JsonRecord[] {
  const needle = match.trim().toLowerCase();
  const query = normalizeQueryOptions({ ...options, limit });
  const rows = state.records
    .filter((record) => !record.deletedAt)
    .filter((record) => !collections.length || collections.includes(record.collection))
    .filter((record) => !needle || JSON.stringify(record.values).toLowerCase().includes(needle))
    .map((record) => ({
      record,
      queryValues: {
        ...record.values,
        id: record.id,
        collection: record.collection,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    }))
    .filter((entry) => matchesWhere(query.where, entry.queryValues, query.savedFilters))
    .map((entry) => ({ ...entry.record, ...entry.queryValues })) as Record<string, unknown>[];

  return applyQueryPagination(sortByFields(rows, query.orderBy), query)
    .map((record) => record as JsonRecord);
}

export { matchesWhere };

export function applyAction(state: AppState, action: AppAction): AppState {
  const key = typeof action.payload?.idempotencyKey === 'string' ? action.payload.idempotencyKey : undefined;
  const fingerprint = key ? actionFingerprint(action) : undefined;
  const effectiveKey = key && fingerprint ? `${key}::${fingerprint}` : key;
  if (effectiveKey && state.applied?.includes(effectiveKey)) return state;
  const next = mutate(state, action);
  return effectiveKey && next !== state ? { ...next, applied: [...(state.applied ?? []).slice(-99), effectiveKey] } : next;
}

function actionFingerprint(action: AppAction): string {
  const payload = action.payload ? { ...action.payload } : action.payload;
  if (payload) delete payload.idempotencyKey;
  return canonicalize({ ...action, payload });
}

function mutate(state: AppState, action: AppAction): AppState {
  const now = new Date().toISOString();
  const uuid = (globalThis as typeof globalThis & { crypto?: { randomUUID?(): string } }).crypto?.randomUUID?.();

  if (action.kind === 'undo') {
    const previous = state.undo?.at(-1);
    if (!previous) return state;
    const tombstones = state.tombstones?.filter((item) => !previous.some((record) => record.id === item.id));
    const next = { ...state, records: previous, undo: state.undo?.slice(0, -1) };
    if (tombstones?.length) next.tombstones = tombstones;
    else delete next.tombstones;
    return next;
  }

  const commit = (records: JsonRecord[], tombstones = state.tombstones): AppState => {
    const next = { ...state, records, undo: [...(state.undo ?? []).slice(-9), state.records] };
    if (tombstones?.length) next.tombstones = tombstones;
    else delete next.tombstones;
    return next;
  };
  const addReceipt = (next: AppState, operation: string, status: z.infer<typeof ReceiptSchema>['status'], recordId?: string) => ({
    ...next,
    receipts: [...(next.receipts ?? []).slice(-49), { id: uuid ?? `${Date.now()}`, operation, status, at: now, recordId }],
  });

  if (action.kind === 'create' && action.collection) {
    const id = action.recordId ?? uuid ?? `${Date.now()}`;
    const existing = state.records.find((record) => record.id === id);
    const revision = (existing?.revision ?? state.tombstones?.find((item) => item.id === id)?.revision ?? 0) + 1;
    const record: JsonRecord = existing
      ? { ...existing, collection: action.collection, updatedAt: now, revision, values: { ...existing.values, ...action.values } }
      : { id, collection: action.collection, createdAt: now, updatedAt: now, revision, values: action.values ?? {} };
    return commit(existing ? state.records.map((item) => item.id === id ? record : item) : [...state.records, record], state.tombstones?.filter((item) => item.id !== id));
  }

  if (action.kind === 'update' && action.recordId) {
    const target = state.records.find((record) => record.id === action.recordId);
    if (!target || (typeof action.payload?.expectedRevision === 'number' && action.payload.expectedRevision !== (target.revision ?? 0))) return state;
    return commit(state.records.map((record) => record.id === action.recordId
      ? { ...target, updatedAt: now, revision: (target.revision ?? 0) + 1, values: { ...target.values, ...action.values } }
      : record));
  }

  if (action.kind === 'delete' && action.recordId) {
    const target = state.records.find((record) => record.id === action.recordId);
    if (!target || (typeof action.payload?.expectedRevision === 'number' && action.payload.expectedRevision !== (target.revision ?? 0))) return state;
    const tombstone = { ...target, revision: (target.revision ?? 0) + 1, deletedAt: now, updatedAt: now };
    return commit(state.records.filter((record) => record.id !== action.recordId), [...(state.tombstones ?? []).filter((item) => item.id !== target.id), tombstone]);
  }

  if (action.kind === 'toggle' && action.recordId) {
    const field = String(action.payload?.field ?? 'completed');
    const target = state.records.find((record) => record.id === action.recordId);
    if (!target || (typeof action.payload?.expectedRevision === 'number' && action.payload.expectedRevision !== (target.revision ?? 0))) return state;
    return commit(state.records.map((record) => record.id === action.recordId
      ? { ...record, updatedAt: now, revision: (record.revision ?? 0) + 1, values: { ...record.values, [field]: !record.values[field] } }
      : record));
  }

  if (action.kind === 'propose' && action.payload?.confirmed === true && action.operation) {
    const operation = String(action.operation);
    const collection = action.collection ?? String(action.payload.collection ?? '');
    const recordId = action.recordId ?? String(action.payload.recordId ?? '');

    if (operation === 'create') {
      if (!collection) return addReceipt(state, operation, 'unavailable');
      const next = applyAction(state, { kind: 'create', collection, values: action.values });
      return addReceipt(next, operation, next === state ? 'unavailable' : 'completed', next.records.at(-1)?.id);
    }

    if (operation === 'update') {
      if (!recordId) return addReceipt(state, operation, 'unavailable');
      const next = applyAction(state, { kind: 'update', recordId, values: action.values, payload: action.payload });
      return addReceipt(next, operation, next === state ? 'unavailable' : 'completed', recordId);
    }

    if (operation === 'delete') {
      if (!recordId) return addReceipt(state, operation, 'unavailable');
      const next = applyAction(state, { kind: 'delete', recordId, payload: action.payload });
      return addReceipt(next, operation, next === state ? 'unavailable' : 'completed', recordId);
    }

    if (operation === 'archive') {
      if (!recordId) return addReceipt(state, operation, 'unavailable');
      if (!state.records.some((record) => record.id === recordId)) return addReceipt(state, operation, 'unavailable', recordId);
      const next = applyAction(state, { kind: 'update', recordId, values: { archived: true } });
      return addReceipt(next, operation, next === state ? 'unavailable' : 'completed', recordId);
    }

    if (operation === 'restore') {
      if (!recordId) return addReceipt(state, operation, 'unavailable');
      if (!state.records.some((record) => record.id === recordId)) return addReceipt(state, operation, 'unavailable', recordId);
      const next = applyAction(state, { kind: 'update', recordId, values: { archived: false } });
      return addReceipt(next, operation, next === state ? 'unavailable' : 'completed', recordId);
    }

    if (operation === 'retry') {
      return addReceipt(state, operation, 'completed', recordId || undefined);
    }

    if (operation === 'undo') {
      const next = state.undo?.length ? applyAction(state, { kind: 'undo' }) : state;
      return addReceipt(next, operation, next === state ? 'unavailable' : 'completed');
    }

    if (operation === 'export') return addReceipt(state, operation, 'completed', recordId || undefined);
    if (operation === 'navigate') return addReceipt(state, operation, 'completed', recordId || undefined);
    return addReceipt(state, operation, 'unavailable', recordId || undefined);
  }

  return state;
}

export function evaluate(expression: unknown, data: unknown): unknown {
  return expression && typeof expression === 'object' ? jsonLogic.apply(expression as never, data) : expression;
}

export function validateState(pkg: AppPackage, state: AppState): string[] {
  const errors: string[] = [];
  for (const record of state.records) {
    const collection = pkg.collections[record.collection];
    if (!collection) {
      errors.push(`${record.id}: unknown collection ${record.collection}`);
      continue;
    }
    for (const [field, spec] of Object.entries(collection.fields)) {
      if (spec.required && record.values[field] == null && !['id', 'collection', 'updated_at', 'properties'].includes(field)) {
        errors.push(`${record.id}: ${field} is required`);
      }
    }
  }
  return errors;
}
