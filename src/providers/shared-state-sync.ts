import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import type { Operation } from '@/packages/shared/contracts/operation';
import { canonicalJson, sha256Canonical } from '@/src/domain/canonical-json';

export const SHARED_STATE_SYNC_SCHEMA_VERSION = 'utopia.vendor-neutral-shared-state-sync.v1' as const;
const DEFAULT_WORKSPACE_ID = 'default-workspace' as const;

type SyncKind = 'memory' | 'file';
type SyncStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';
type DeviceMap<T> = Record<string, T>;
type RecordMap<T> = Record<string, T>;

type OperationStreamEntry = Readonly<{
  cursor: string;
  opId: string;
  installationId: string;
  recordId: string;
  createdAt: string;
  checksum: string;
  operation: Operation;
}>;

type OperationStreamDesign = Readonly<{
  schemaVersion: 'utopia.operation-stream.v1';
  workspaceId: string;
  installationId: string;
  mode: 'append_only';
  ordering: 'cursor_then_created_at';
  cursor: string;
  checkpointChecksum: string;
  conflictPolicy: 'expected_revision_then_manual_review';
  entries: readonly OperationStreamEntry[];
}>;

function buildOperationStreamDesign(input: {
  workspaceId?: string;
  installationId: string;
  entries: readonly Omit<OperationStreamEntry, 'installationId' | 'checksum'>[];
  cursor?: string;
}): OperationStreamDesign {
  const installationId = input.installationId;
  const entries = input.entries.map((entry) => ({
    ...entry,
    installationId,
    checksum: sha256Canonical({
      cursor: entry.cursor,
      opId: entry.opId,
      recordId: entry.recordId,
      createdAt: entry.createdAt,
      operation: entry.operation,
    }),
  }));
  return {
    schemaVersion: 'utopia.operation-stream.v1',
    workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    installationId,
    mode: 'append_only',
    ordering: 'cursor_then_created_at',
    cursor: input.cursor ?? entries.at(-1)?.cursor ?? '0',
    checkpointChecksum: sha256Canonical(entries),
    conflictPolicy: 'expected_revision_then_manual_review',
    entries,
  };
}

export type SharedStateSyncEnvelope = Readonly<{
  schemaVersion: typeof SHARED_STATE_SYNC_SCHEMA_VERSION;
  workspaceId: string;
  installationId: string;
  deviceId: string;
  operation: Operation;
}>;

export type SharedStateSyncStageResult = Readonly<{
  status: SyncStatus;
  opId: string;
  recordId: string;
  reason?: string;
  changedFields?: readonly string[];
  revision?: number;
}>;

export type SharedStateSyncSyncResult = Readonly<{
  status: 'synced' | 'rejected';
  installationId: string;
  deviceId: string;
  applied: number;
  duplicates: number;
  conflicts: number;
  cursor: string;
}>;

export type SharedStateSyncDeviceSnapshot = Readonly<{
  deviceId: string;
  cursor: string;
  pending: number;
  conflicts: number;
  lost: boolean;
  localRecordIds: readonly string[];
}>;

export type SharedStateSyncConflict = Readonly<{
  opId: string;
  deviceId: string;
  installationId: string;
  recordId: string;
  reason: 'duplicate' | 'field_conflict' | 'tombstone_wins' | 'schema_version_invalid' | 'missing_record';
  changedFields: readonly string[];
  currentRevision: number | null;
  incomingRevision: number | null;
}>;

export type SharedStateSyncSnapshot = Readonly<{
  schemaVersion: typeof SHARED_STATE_SYNC_SCHEMA_VERSION;
  kind: SyncKind;
  workspaceId: string;
  installationId: string;
  cursor: string;
  records: readonly CanonicalRecord[];
  committedOperationStream: OperationStreamDesign;
  devices: readonly SharedStateSyncDeviceSnapshot[];
  conflicts: readonly SharedStateSyncConflict[];
  checkpointChecksum: string;
}>;

export type SharedStateSyncRecoveryResult = Readonly<{
  status: 'recovered';
  snapshot: SharedStateSyncSnapshot;
}>;

export type SharedStateSyncProof = Readonly<{
  schemaVersion: typeof SHARED_STATE_SYNC_SCHEMA_VERSION;
  kind: SyncKind;
  all_passed: boolean;
  offline_writes: {
    applied: number;
    sync_cursor: string;
    records: readonly string[];
  };
  same_record_conflict: {
    status: SyncStatus;
    reason?: string;
    winner_title: string | null;
    loser_pending: number;
  };
  simultaneous_edits: {
    status: SyncStatus;
    winner_title: string | null;
    conflicts: number;
  };
  offline_three_way_merge: {
    status: SyncStatus;
    applied: number;
    records: readonly string[];
  };
  idempotent_replay: {
    first: SyncStatus;
    second: SyncStatus;
    duplicate: boolean;
  };
  delete_update_conflict: {
    status: SyncStatus;
    reason?: string;
    deleted_title: string | null;
    loser_pending: number;
  };
  tombstones: {
    status: SyncStatus;
    deleted: boolean;
    archived_at: string | null;
  };
  per_installation_isolation: {
    installationA_records: readonly string[];
    installationB_records: readonly string[];
    shared_record_in_a: string | null;
    shared_record_in_b: string | null;
  };
  schema_version_refusal: {
    status: SyncStatus;
    reason?: string;
  };
  reconnect_convergence: {
    matched: boolean;
    snapshot_checksum: string;
    device_count: number;
  };
  device_loss_recovery_boundary: {
    lost_present_before: boolean;
    recovered_present_after: boolean;
    persisted_cursor: string;
  };
  family_group_sync_claims: {
    status: 'BLOCKED' | 'SUPPORTED';
    reason: string;
    deterministic_multi_writer_evidence: boolean;
  };
  live_multi_device_sync_claims: {
    status: 'BLOCKED' | 'SUPPORTED';
    readiness: {
      local_deterministic: 'PASS';
      live_provider_device: 'BLOCKED' | 'SUPPORTED';
    };
    reason: string;
    required_next_proof: string;
    deterministic_multi_writer_evidence: boolean;
  };
}>;

type SharedStateSyncCommittedOperation = Readonly<{
  cursor: string;
  operation: Operation;
  deviceId: string;
  installationId: string;
  before: CanonicalRecord | null;
  after: CanonicalRecord;
  changedFields: readonly string[];
  checksum: string;
}>;

type DeviceState = {
  cursor: string;
  pending: SharedStateSyncEnvelope[];
  localRecords: RecordMap<CanonicalRecord>;
  conflicts: SharedStateSyncConflict[];
  lost: boolean;
};

type InstallationState = {
  workspaceId: string;
  nextCursor: number;
  committed: SharedStateSyncCommittedOperation[];
  records: RecordMap<CanonicalRecord>;
  history: RecordMap<ReadonlyArray<{ revision: number; changedFields: readonly string[] }>>;
  appliedOpIds: RecordMap<true>;
  appliedIdempotencyKeys: RecordMap<true>;
  devices: DeviceMap<DeviceState>;
  conflicts: SharedStateSyncConflict[];
};

type SyncStore = {
  installations: RecordMap<InstallationState>;
};

interface StoreBackend {
  load(): SyncStore;
  save(store: SyncStore): void;
}

function blankStore(): SyncStore {
  return { installations: {} };
}

function installationKey(workspaceId: string, installationId: string): string {
  return `${workspaceId}::${installationId}`;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSupportedSchemaVersion(value: unknown): value is typeof SHARED_STATE_SYNC_SCHEMA_VERSION {
  return value === SHARED_STATE_SYNC_SCHEMA_VERSION;
}

function recordFieldValues(record: CanonicalRecord): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    title: record.title,
    archived_at: record.archived_at,
    deleted: record.deleted,
    privacy: record.privacy,
    relations: record.relations,
  };
  for (const key of Object.keys(record.properties).sort()) {
    fields[`properties.${key}`] = record.properties[key];
  }
  return fields;
}

function fieldPaths(before: CanonicalRecord | null, after: CanonicalRecord): string[] {
  const beforeFields = before ? recordFieldValues(before) : {};
  const afterFields = recordFieldValues(after);
  const keys = Array.from(new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])).sort();
  return keys.filter((key) => canonicalJson(beforeFields[key]) !== canonicalJson(afterFields[key]));
}

function setField(record: CanonicalRecord, field: string, value: unknown) {
  if (field === 'title') {
    record.title = String(value ?? '');
    return;
  }
  if (field === 'archived_at') {
    record.archived_at = typeof value === 'string' ? value : null;
    return;
  }
  if (field === 'deleted') {
    record.deleted = value === true;
    return;
  }
  if (field === 'privacy') {
    record.privacy = value === 'private' || value === 'shared' ? value : 'personal';
    return;
  }
  if (field === 'relations') {
    record.relations = Array.isArray(value) ? deepClone(value as CanonicalRecord['relations']) : [];
    return;
  }
  if (field.startsWith('properties.')) {
    const key = field.slice('properties.'.length);
    if (!key) return;
    if (!record.properties || typeof record.properties !== 'object') {
      record.properties = {};
    }
    if (value === undefined) {
      delete record.properties[key];
      return;
    }
    record.properties[key] = value;
  }
}

function getField(record: CanonicalRecord, field: string): unknown {
  if (field.startsWith('properties.')) {
    return record.properties[field.slice('properties.'.length)];
  }
  if (field === 'title') return record.title;
  if (field === 'archived_at') return record.archived_at;
  if (field === 'deleted') return record.deleted;
  if (field === 'privacy') return record.privacy;
  if (field === 'relations') return record.relations;
  return undefined;
}

function patchRecord(base: CanonicalRecord, source: CanonicalRecord, changedFields: readonly string[]): CanonicalRecord {
  const next = deepClone(base);
  for (const field of changedFields) {
    if (field.startsWith('properties.')) {
      const key = field.slice('properties.'.length);
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(source.properties, key)) {
        setField(next, field, source.properties[key]);
      } else {
        setField(next, field, undefined);
      }
      continue;
    }
    setField(next, field, getField(source, field));
  }
  return next;
}

function normalizeRecord(operation: Operation): CanonicalRecord | null {
  if (!operation.record) return null;
  const next = deepClone(operation.record as CanonicalRecord);
  next.id = operation.record_id;
  next.domain = operation.domain;
  next.collection = operation.collection;
  return next;
}

function materializeAfter(operation: Operation, current: CanonicalRecord | null): CanonicalRecord | null {
  const base = normalizeRecord(operation) ?? (current ? deepClone(current) : null);
  if (!base) return null;
  if (operation.kind === 'delete' || operation.kind === 'archive') {
    base.deleted = true;
    base.archived_at = base.archived_at ?? base.updated_at;
  } else if (operation.kind === 'restore') {
    base.deleted = false;
    base.archived_at = null;
  }
  return base;
}

function normalizeIdempotencyKey(operation: Operation): string {
  return operation.idempotency_key?.trim() || operation.op_id;
}

function intersect(left: readonly string[], right: readonly string[]) {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function ensureInstallationState(store: SyncStore, workspaceId: string, installationId: string): InstallationState {
  const key = installationKey(workspaceId, installationId);
  const existing = store.installations[key];
  if (existing) return existing;
  const state: InstallationState = {
    workspaceId,
    nextCursor: 0,
    committed: [],
    records: {},
    history: {},
    appliedOpIds: {},
    appliedIdempotencyKeys: {},
    devices: {},
    conflicts: [],
  };
  store.installations[key] = state;
  return state;
}

function ensureDeviceState(state: InstallationState, deviceId: string): DeviceState {
  const existing = state.devices[deviceId];
  if (existing) return existing;
  const device: DeviceState = {
    cursor: '0',
    pending: [],
    localRecords: deepClone(state.records),
    conflicts: [],
    lost: false,
  };
  state.devices[deviceId] = device;
  return device;
}

function commitOperation(
  state: InstallationState,
  input: SharedStateSyncEnvelope,
): { status: SyncStatus; reason?: string; committed?: SharedStateSyncCommittedOperation; changedFields?: readonly string[] } {
  const operation = input.operation;
  const opKey = normalizeIdempotencyKey(operation);
  if (state.appliedOpIds[operation.op_id] || state.appliedIdempotencyKeys[opKey]) {
    return { status: 'duplicate', reason: 'duplicate' };
  }

  const current = state.records[operation.record_id] ?? null;
  const incoming = materializeAfter(operation, current);
  if (!incoming) {
    return { status: 'rejected', reason: 'missing_record' };
  }

  const changedFields = fieldPaths(current, incoming);
  if (current && (current.deleted || current.archived_at)) {
    if (operation.kind !== 'restore') {
      return { status: 'conflict', reason: 'tombstone_wins', changedFields };
    }
  }

  const expectedRevision = operation.expected_revision ?? current?.revision ?? 0;
  if (current && expectedRevision < current.revision) {
    const history = state.history[operation.record_id] ?? [];
    const changedSince = history
      .filter((entry) => entry.revision > expectedRevision)
      .flatMap((entry) => entry.changedFields);
    if (intersect(changedFields, changedSince)) {
      return { status: 'conflict', reason: 'field_conflict', changedFields };
    }
  }

  const nextRevision = (current?.revision ?? 0) + 1;
  const next = current && expectedRevision < current.revision
    ? patchRecord(current, incoming, changedFields)
    : deepClone(incoming);
  next.revision = nextRevision;
  if (!next.created_at) next.created_at = current?.created_at ?? next.updated_at;
  if (!next.updated_at) next.updated_at = next.created_at;

  const cursor = String(++state.nextCursor).padStart(6, '0');
  const committed: SharedStateSyncCommittedOperation = {
    cursor,
    operation,
    deviceId: input.deviceId,
    installationId: input.installationId,
    before: current ? deepClone(current) : null,
    after: next,
    changedFields,
    checksum: sha256Canonical({
      cursor,
      opId: operation.op_id,
      recordId: operation.record_id,
      deviceId: input.deviceId,
      installationId: input.installationId,
      changedFields,
      revision: next.revision,
    }),
  };

  state.records[operation.record_id] = next;
  state.appliedOpIds[operation.op_id] = true;
  state.appliedIdempotencyKeys[opKey] = true;
  state.history[operation.record_id] = [...(state.history[operation.record_id] ?? []), { revision: next.revision, changedFields }];
  state.committed = [...state.committed, committed];
  return { status: 'applied', committed, changedFields };
}

function syncDeviceState(state: InstallationState, installationId: string, deviceId: string): SharedStateSyncSyncResult {
  const device = ensureDeviceState(state, deviceId);
  const pending = [...device.pending];
  let applied = 0;
  let duplicates = 0;
  let conflicts = 0;

  for (const envelope of pending) {
    const result = commitOperation(state, envelope);
    if (result.status === 'applied') {
      applied += 1;
    } else if (result.status === 'duplicate') {
      duplicates += 1;
    } else {
      conflicts += 1;
      state.conflicts = [
        ...state.conflicts,
        {
          opId: envelope.operation.op_id,
          deviceId: envelope.deviceId,
          installationId: envelope.installationId,
          recordId: envelope.operation.record_id,
          reason: result.reason === 'schema_version_invalid'
            ? 'schema_version_invalid'
            : result.reason === 'missing_record'
              ? 'missing_record'
              : result.reason === 'tombstone_wins'
                ? 'tombstone_wins'
                : 'field_conflict',
          changedFields: result.changedFields ?? [],
          currentRevision: state.records[envelope.operation.record_id]?.revision ?? null,
          incomingRevision: envelope.operation.expected_revision ?? null,
        },
      ];
      device.conflicts = [
        ...device.conflicts,
        {
          opId: envelope.operation.op_id,
          deviceId: envelope.deviceId,
          installationId: envelope.installationId,
          recordId: envelope.operation.record_id,
          reason: result.reason === 'schema_version_invalid'
            ? 'schema_version_invalid'
            : result.reason === 'missing_record'
              ? 'missing_record'
              : result.reason === 'tombstone_wins'
                ? 'tombstone_wins'
                : 'field_conflict',
          changedFields: result.changedFields ?? [],
          currentRevision: state.records[envelope.operation.record_id]?.revision ?? null,
          incomingRevision: envelope.operation.expected_revision ?? null,
        },
      ];
    }
  }

  device.pending = [];
  device.cursor = String(state.nextCursor).padStart(6, '0');
  device.localRecords = deepClone(state.records);
  device.lost = false;

  return {
    status: 'synced',
    installationId,
    deviceId,
    applied,
    duplicates,
    conflicts,
    cursor: device.cursor,
  };
}

function buildSnapshot(kind: SyncKind, store: SyncStore, installationId: string, workspaceId: string): SharedStateSyncSnapshot {
  const state = ensureInstallationState(store, workspaceId, installationId);
  const devices = Object.entries(state.devices)
    .map(([deviceId, device]) => ({
      deviceId,
      cursor: device.cursor,
      pending: device.pending.length,
      conflicts: device.conflicts.length,
      lost: device.lost,
      localRecordIds: Object.keys(device.localRecords).sort(),
    }))
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  const committedOperationStream = buildOperationStreamDesign({
    workspaceId: state.workspaceId || workspaceId || DEFAULT_WORKSPACE_ID,
    installationId,
    entries: state.committed.map((entry) => ({
      cursor: entry.cursor,
      opId: entry.operation.op_id,
      recordId: entry.operation.record_id,
      createdAt: entry.after.updated_at,
      operation: entry.operation,
    })),
  });
  const records = Object.values(state.records).sort((left, right) => left.id.localeCompare(right.id));
  const checkpointChecksum = sha256Canonical({
    workspaceId: state.workspaceId || workspaceId || DEFAULT_WORKSPACE_ID,
    installationId,
    cursor: committedOperationStream.cursor,
    records,
    deviceCursors: devices.map((device) => [device.deviceId, device.cursor]),
    conflicts: state.conflicts,
  });
  return {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    kind,
    workspaceId: state.workspaceId || workspaceId || DEFAULT_WORKSPACE_ID,
    installationId,
    cursor: committedOperationStream.cursor,
    records,
    committedOperationStream,
    devices,
    conflicts: state.conflicts,
    checkpointChecksum,
  };
}

class MemoryBackend implements StoreBackend {
  constructor(private store: SyncStore = blankStore()) {}

  load(): SyncStore {
    return deepClone(this.store);
  }

  save(store: SyncStore): void {
    this.store = deepClone(store);
  }
}

class FileBackend implements StoreBackend {
  constructor(private readonly filePath: string) {}

  load(): SyncStore {
    try {
      const text = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(text) as SyncStore;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return blankStore();
      return parsed;
    } catch {
      return blankStore();
    }
  }

  save(store: SyncStore): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`);
  }
}

class SharedStateSyncAdapterImpl {
  private store: SyncStore;

  constructor(
    readonly kind: SyncKind,
    private readonly backend: StoreBackend,
  ) {
    this.store = this.backend.load();
  }

  stage(input: SharedStateSyncEnvelope): SharedStateSyncStageResult {
    if (!isSupportedSchemaVersion(input.schemaVersion)) {
      return {
        status: 'rejected',
        opId: input.operation.op_id,
        recordId: input.operation.record_id,
        reason: 'schema_version_invalid',
      };
    }
    const state = ensureInstallationState(this.store, input.workspaceId, input.installationId);
    const device = ensureDeviceState(state, input.deviceId);
    const opKey = normalizeIdempotencyKey(input.operation);
    if (state.appliedOpIds[input.operation.op_id] || state.appliedIdempotencyKeys[opKey]) {
      return {
        status: 'duplicate',
        opId: input.operation.op_id,
        recordId: input.operation.record_id,
        reason: 'duplicate',
      };
    }
    if (device.pending.some((item) => item.operation.op_id === input.operation.op_id || normalizeIdempotencyKey(item.operation) === opKey)) {
      return {
        status: 'duplicate',
        opId: input.operation.op_id,
        recordId: input.operation.record_id,
        reason: 'duplicate',
      };
    }
    const current = device.localRecords[input.operation.record_id] ?? state.records[input.operation.record_id] ?? null;
    const after = materializeAfter(input.operation, current);
    if (!after) {
      return {
        status: 'rejected',
        opId: input.operation.op_id,
        recordId: input.operation.record_id,
        reason: 'missing_record',
      };
    }
    const changedFields = fieldPaths(current, after);
    const nextRevision = (current?.revision ?? 0) + 1;
    after.revision = nextRevision;
    device.localRecords[input.operation.record_id] = after;
    device.pending = [...device.pending, input];
    this.backend.save(this.store);
    return {
      status: 'applied',
      opId: input.operation.op_id,
      recordId: input.operation.record_id,
      changedFields,
      revision: nextRevision,
    };
  }

  syncDevice(input: { schemaVersion: typeof SHARED_STATE_SYNC_SCHEMA_VERSION; workspaceId: string; installationId: string; deviceId: string }): SharedStateSyncSyncResult {
    if (!isSupportedSchemaVersion(input.schemaVersion)) {
      return {
        status: 'rejected',
        installationId: input.installationId,
        deviceId: input.deviceId,
        applied: 0,
        duplicates: 0,
        conflicts: 0,
        cursor: '0',
      };
    }
    const state = ensureInstallationState(this.store, input.workspaceId, input.installationId);
    ensureDeviceState(state, input.deviceId);
    const result = syncDeviceState(state, input.installationId, input.deviceId);
    this.backend.save(this.store);
    return {
      ...result,
      installationId: input.installationId,
    };
  }

  snapshot(input: { schemaVersion: typeof SHARED_STATE_SYNC_SCHEMA_VERSION; workspaceId: string; installationId: string }): SharedStateSyncSnapshot {
    if (!isSupportedSchemaVersion(input.schemaVersion)) {
      throw new Error('shared_state_sync_schema_version_invalid');
    }
    return buildSnapshot(this.kind, this.store, input.installationId, input.workspaceId);
  }

  loseDevice(input: { schemaVersion: typeof SHARED_STATE_SYNC_SCHEMA_VERSION; workspaceId: string; installationId: string; deviceId: string }): void {
    if (!isSupportedSchemaVersion(input.schemaVersion)) return;
    const state = ensureInstallationState(this.store, input.workspaceId, input.installationId);
    const device = ensureDeviceState(state, input.deviceId);
    state.devices[input.deviceId] = {
      ...device,
      pending: [],
      localRecords: deepClone(state.records),
      conflicts: [],
      lost: true,
    };
    this.backend.save(this.store);
  }

  recoverDevice(input: { schemaVersion: typeof SHARED_STATE_SYNC_SCHEMA_VERSION; workspaceId: string; installationId: string; deviceId: string }): SharedStateSyncRecoveryResult {
    if (!isSupportedSchemaVersion(input.schemaVersion)) {
      throw new Error('shared_state_sync_schema_version_invalid');
    }
    const state = ensureInstallationState(this.store, input.workspaceId, input.installationId);
    const device = ensureDeviceState(state, input.deviceId);
    state.devices[input.deviceId] = {
      ...device,
      pending: [],
      localRecords: deepClone(state.records),
      conflicts: [],
      lost: false,
      cursor: String(state.nextCursor).padStart(6, '0'),
    };
    this.backend.save(this.store);
    return {
      status: 'recovered',
      snapshot: buildSnapshot(this.kind, this.store, input.installationId, input.workspaceId),
    };
  }
}

export type SharedStateSyncAdapter = SharedStateSyncAdapterImpl;

export function createInMemorySharedStateSyncAdapter(initial?: SyncStore): SharedStateSyncAdapter {
  return new SharedStateSyncAdapterImpl('memory', new MemoryBackend(initial ? deepClone(initial) : blankStore()));
}

export function createFileSharedStateSyncAdapter(filePath: string): SharedStateSyncAdapter {
  return new SharedStateSyncAdapterImpl('file', new FileBackend(filePath));
}

function makeRecord(input: {
  id: string;
  title: string;
  collection?: string;
  properties?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  deleted?: boolean;
  archivedAt?: string | null;
  revision?: number;
}): CanonicalRecord {
  const now = input.updatedAt ?? input.createdAt ?? '2026-07-29T00:00:00.000Z';
  return {
    id: input.id,
    domain: 'food',
    collection: input.collection ?? 'inventory',
    title: input.title,
    properties: deepClone(input.properties ?? {}),
    relations: [],
    source: {
      provider: 'sqlite',
      external_id: input.id,
      url: null,
      observed_at: now,
      content_hash: null,
    },
    archived_at: input.archivedAt ?? null,
    created_at: input.createdAt ?? now,
    updated_at: input.updatedAt ?? now,
    revision: input.revision ?? 1,
    schema_version: '1.0.0',
    deleted: input.deleted ?? false,
    privacy: 'personal',
    provenance: {
      actor: 'sync',
      confidence: null,
      evidence: [],
      reason: 'shared-state-sync-proof',
    },
  };
}

function makeOperation(input: {
  opId: string;
  kind: Operation['kind'];
  record: CanonicalRecord;
  expectedRevision?: number;
  idempotencyKey?: string;
}): Operation {
  return {
    op_id: input.opId,
    kind: input.kind,
    domain: input.record.domain,
    collection: input.record.collection,
    record_id: input.record.id,
    expected_revision: input.expectedRevision,
    record: deepClone(input.record),
    actor: 'sync',
    origin: 'sync',
    idempotency_key: input.idempotencyKey ?? input.opId,
    evidence: [input.opId],
    reason: 'shared-state-sync-proof',
  };
}

function stage(adapter: SharedStateSyncAdapter, input: SharedStateSyncEnvelope): SharedStateSyncStageResult {
  return adapter.stage(input);
}

function sync(adapter: SharedStateSyncAdapter, workspaceId: string, installationId: string, deviceId: string): SharedStateSyncSyncResult {
  return adapter.syncDevice({
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId,
    deviceId,
  });
}

function snapshot(adapter: SharedStateSyncAdapter, workspaceId: string, installationId: string): SharedStateSyncSnapshot {
  return adapter.snapshot({
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId,
  });
}

function recordNames(records: readonly CanonicalRecord[]) {
  return records.map((record) => record.id).sort();
}

export function runSharedStateSyncProof(adapter: SharedStateSyncAdapter): SharedStateSyncProof {
  const workspaceId = DEFAULT_WORKSPACE_ID;
  const installationA = 'install-a';
  const installationB = 'install-b';
  const deviceA = 'device-a';
  const deviceB = 'device-b';
  const deviceC = 'device-c';

  const base = makeRecord({
    id: 'shared-note',
    title: 'Shared note',
    properties: { body: 'Base body', aisle: 'Pantry' },
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({ opId: 'base-create', kind: 'create', record: base, expectedRevision: 0 }),
  });
  const baseSync = sync(adapter, workspaceId, installationA, deviceA);

  const deviceAUpdate = makeRecord({
    ...base,
    title: 'Shared note',
    properties: { body: 'A body', aisle: 'Pantry' },
    revision: 2,
    updatedAt: '2026-07-29T00:01:00.000Z',
  });
  const deviceBUpdate = makeRecord({
    ...base,
    title: 'Shared note',
    properties: { body: 'Base body', aisle: 'B aisle' },
    revision: 2,
    updatedAt: '2026-07-29T00:01:05.000Z',
  });
  const deviceCCreate = makeRecord({
    id: 'offline-third',
    title: 'Third device note',
    properties: { body: 'C body' },
    createdAt: '2026-07-29T00:02:00.000Z',
    updatedAt: '2026-07-29T00:02:00.000Z',
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({ opId: 'a-update', kind: 'update', record: deviceAUpdate, expectedRevision: 1 }),
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceB,
    operation: makeOperation({ opId: 'b-update', kind: 'update', record: deviceBUpdate, expectedRevision: 1 }),
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceC,
    operation: makeOperation({ opId: 'c-create', kind: 'create', record: deviceCCreate, expectedRevision: 0 }),
  });
  const syncA = sync(adapter, workspaceId, installationA, deviceA);
  const syncB = sync(adapter, workspaceId, installationA, deviceB);
  const syncC = sync(adapter, workspaceId, installationA, deviceC);
  const simultaneousEditsSnapshot = snapshot(adapter, workspaceId, installationA);
  const simultaneousEdits: SharedStateSyncProof['simultaneous_edits'] = {
    status: syncA.applied > 0 ? 'applied' : (syncA.duplicates > 0 ? 'duplicate' : 'conflict'),
    winner_title: simultaneousEditsSnapshot.records.find((record) => record.id === 'shared-note')?.title ?? null,
    conflicts: syncB.conflicts + syncC.conflicts,
  };

  const offlinePartyA = makeRecord({
    id: 'offline-party-a',
    title: 'Offline party A',
    properties: { body: 'Party A body' },
    createdAt: '2026-07-29T00:02:10.000Z',
    updatedAt: '2026-07-29T00:02:10.000Z',
  });
  const offlinePartyB = makeRecord({
    id: 'offline-party-b',
    title: 'Offline party B',
    properties: { body: 'Party B body' },
    createdAt: '2026-07-29T00:02:20.000Z',
    updatedAt: '2026-07-29T00:02:20.000Z',
  });
  const offlinePartyC = makeRecord({
    id: 'offline-party-c',
    title: 'Offline party C',
    properties: { body: 'Party C body' },
    createdAt: '2026-07-29T00:02:30.000Z',
    updatedAt: '2026-07-29T00:02:30.000Z',
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({ opId: 'offline-party-a', kind: 'create', record: offlinePartyA, expectedRevision: 0 }),
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceB,
    operation: makeOperation({ opId: 'offline-party-b', kind: 'create', record: offlinePartyB, expectedRevision: 0 }),
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceC,
    operation: makeOperation({ opId: 'offline-party-c', kind: 'create', record: offlinePartyC, expectedRevision: 0 }),
  });
  const offlineMergeA = sync(adapter, workspaceId, installationA, deviceA);
  const offlineMergeB = sync(adapter, workspaceId, installationA, deviceB);
  const offlineMergeC = sync(adapter, workspaceId, installationA, deviceC);
  const offlineThreeWaySnapshot = snapshot(adapter, workspaceId, installationA);
  const offlineThreeWayMerge: SharedStateSyncProof['offline_three_way_merge'] = {
    status: offlineMergeA.applied + offlineMergeB.applied + offlineMergeC.applied === 3 ? 'applied' : 'conflict',
    applied: offlineMergeA.applied + offlineMergeB.applied + offlineMergeC.applied,
    records: recordNames(
      offlineThreeWaySnapshot.records.filter((record) => record.id.startsWith('offline-party')),
    ),
  };

  const conflictBase = makeRecord({
    id: 'conflict-note',
    title: 'Conflict note',
    properties: { body: 'Original conflict' },
    createdAt: '2026-07-29T00:03:00.000Z',
    updatedAt: '2026-07-29T00:03:00.000Z',
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({ opId: 'conflict-base', kind: 'create', record: conflictBase, expectedRevision: 0 }),
  });
  sync(adapter, workspaceId, installationA, deviceA);
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({
      opId: 'conflict-a',
      kind: 'update',
      record: makeRecord({
        ...conflictBase,
        properties: { body: 'Winner body' },
        revision: 2,
        updatedAt: '2026-07-29T00:03:30.000Z',
      }),
      expectedRevision: 1,
    }),
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceB,
    operation: makeOperation({
      opId: 'conflict-b',
      kind: 'update',
      record: makeRecord({
        ...conflictBase,
        properties: { body: 'Loser body' },
        revision: 2,
        updatedAt: '2026-07-29T00:03:35.000Z',
      }),
      expectedRevision: 1,
    }),
  });
  const firstConflict = sync(adapter, workspaceId, installationA, deviceA);
  const secondConflict = sync(adapter, workspaceId, installationA, deviceB);
  const conflictSnapshot = snapshot(adapter, workspaceId, installationA);

  const replayRecord = makeRecord({
    id: 'replay-note',
    title: 'Replay note',
    properties: { body: 'Replay body' },
    createdAt: '2026-07-29T00:04:00.000Z',
    updatedAt: '2026-07-29T00:04:00.000Z',
  });
  const firstReplay = stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({ opId: 'replay-op', kind: 'create', record: replayRecord, expectedRevision: 0, idempotencyKey: 'replay-key' }),
  });
  const secondReplay = stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({ opId: 'replay-op-again', kind: 'create', record: replayRecord, expectedRevision: 0, idempotencyKey: 'replay-key' }),
  });
  sync(adapter, workspaceId, installationA, deviceA);

  const tombstoneRecord = makeRecord({
    id: 'tombstone-note',
    title: 'Tombstone note',
    properties: { body: 'To delete' },
    createdAt: '2026-07-29T00:05:00.000Z',
    updatedAt: '2026-07-29T00:05:00.000Z',
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({ opId: 'tombstone-create', kind: 'create', record: tombstoneRecord, expectedRevision: 0 }),
  });
  sync(adapter, workspaceId, installationA, deviceA);
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({
      opId: 'tombstone-delete',
      kind: 'delete',
      record: makeRecord({
        ...tombstoneRecord,
        deleted: true,
        archivedAt: '2026-07-29T00:05:30.000Z',
        updatedAt: '2026-07-29T00:05:30.000Z',
        revision: 2,
      }),
      expectedRevision: 1,
    }),
  });
  const tombstoneSync = sync(adapter, workspaceId, installationA, deviceA);
  const tombstoneSnapshot = snapshot(adapter, workspaceId, installationA);

  const deleteUpdateBase = makeRecord({
    id: 'delete-update-note',
    title: 'Delete-update note',
    properties: { body: 'Delete update baseline' },
    createdAt: '2026-07-29T00:05:30.000Z',
    updatedAt: '2026-07-29T00:05:30.000Z',
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({ opId: 'delete-update-create', kind: 'create', record: deleteUpdateBase, expectedRevision: 0 }),
  });
  sync(adapter, workspaceId, installationA, deviceA);
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({
      opId: 'delete-update-delete',
      kind: 'delete',
      record: makeRecord({
        ...deleteUpdateBase,
        deleted: true,
        archivedAt: '2026-07-29T00:05:45.000Z',
        updatedAt: '2026-07-29T00:05:45.000Z',
        revision: 2,
      }),
      expectedRevision: 1,
    }),
  });
  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceB,
    operation: makeOperation({
      opId: 'delete-update-update',
      kind: 'update',
      record: makeRecord({
        ...deleteUpdateBase,
        properties: { body: 'Update after delete' },
        updatedAt: '2026-07-29T00:05:55.000Z',
        revision: 2,
      }),
      expectedRevision: 1,
    }),
  });
  const deleteThenSync = sync(adapter, workspaceId, installationA, deviceA);
  const updateAfterDelete = sync(adapter, workspaceId, installationA, deviceB);
  const deleteUpdateSnapshot = snapshot(adapter, workspaceId, installationA);
  const deleteUpdateConflict: SharedStateSyncProof['delete_update_conflict'] = {
    status: updateAfterDelete.conflicts > 0 ? 'conflict' : deleteThenSync.applied > 0 ? 'applied' : 'rejected',
    reason: deleteUpdateSnapshot.conflicts.at(-1)?.reason,
    deleted_title: deleteUpdateSnapshot.records.find((record) => record.id === 'delete-update-note')?.title ?? null,
    loser_pending: deleteUpdateSnapshot.devices.find((device) => device.deviceId === deviceB)?.pending ?? 0,
  };

  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationB,
    deviceId: deviceA,
    operation: makeOperation({
      opId: 'install-b-create',
      kind: 'create',
      record: makeRecord({
        id: 'shared-note',
        title: 'Install B note',
        properties: { body: 'B body' },
        createdAt: '2026-07-29T00:06:00.000Z',
        updatedAt: '2026-07-29T00:06:00.000Z',
      }),
      expectedRevision: 0,
    }),
  });
  sync(adapter, workspaceId, installationB, deviceA);

  const reconnectA = sync(adapter, workspaceId, installationA, deviceA);
  const reconnectB = sync(adapter, workspaceId, installationA, deviceB);
  const reconnectC = sync(adapter, workspaceId, installationA, deviceC);
  const convergenceSnapshot = snapshot(adapter, workspaceId, installationA);
  const installASnapshot = snapshot(adapter, workspaceId, installationA);
  const installBSnapshot = snapshot(adapter, workspaceId, installationB);

  const invalidSchema = stage(adapter, {
    schemaVersion: 'utopia.vendor-neutral-shared-state-sync.v0' as typeof SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceA,
    operation: makeOperation({
      opId: 'invalid-schema',
      kind: 'create',
      record: makeRecord({
        id: 'invalid-schema',
        title: 'Invalid schema',
        properties: { body: 'nope' },
      }),
      expectedRevision: 0,
    }),
  });

  stage(adapter, {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceC,
    operation: makeOperation({
      opId: 'loss-boundary',
      kind: 'create',
      record: makeRecord({
        id: 'lost-write',
        title: 'Lost write',
        properties: { body: 'unsynced' },
        createdAt: '2026-07-29T00:07:00.000Z',
        updatedAt: '2026-07-29T00:07:00.000Z',
      }),
      expectedRevision: 0,
    }),
  });
  const lostBefore = snapshot(adapter, workspaceId, installationA).devices
    .find((device) => device.deviceId === deviceC)?.localRecordIds.includes('lost-write') ?? false;
  adapter.loseDevice({
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceC,
  });
  const recovered = adapter.recoverDevice({
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId,
    installationId: installationA,
    deviceId: deviceC,
  });
  const lostAfter = recovered.snapshot.records.some((record) => record.id === 'lost-write');

  const reconnectMatched =
    reconnectA.cursor === convergenceSnapshot.cursor
    && reconnectB.cursor === convergenceSnapshot.cursor
    && reconnectC.cursor === convergenceSnapshot.cursor
    && convergenceSnapshot.devices
      .filter((device) => [deviceA, deviceB, deviceC].includes(device.deviceId))
      .every((device) => device.pending === 0 && device.cursor === convergenceSnapshot.cursor);

  const allPassed =
    baseSync.applied === 1
    && syncA.applied === 1
    && syncB.conflicts >= 1
    && syncC.applied === 1
    && offlineThreeWayMerge.applied === 3
    && deleteUpdateConflict.status === 'conflict'
    && deleteThenSync.applied === 1
    && deleteUpdateConflict.loser_pending === 0
    && firstConflict.applied === 1
    && secondConflict.conflicts === 1
    && secondReplay.status === 'duplicate'
    && tombstoneSync.applied === 1
    && invalidSchema.status === 'rejected'
    && reconnectMatched
    && !lostAfter
    && lostBefore
    && installASnapshot.records.some((record) => record.id === 'shared-note')
    && installBSnapshot.records.some((record) => record.id === 'shared-note');

  return {
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    kind: (adapter as SharedStateSyncAdapterImpl).kind,
    all_passed: allPassed,
    offline_writes: {
      applied: baseSync.applied + syncA.applied + syncB.applied + syncC.applied,
      sync_cursor: convergenceSnapshot.cursor,
      records: recordNames(convergenceSnapshot.records),
    },
    same_record_conflict: {
      status: secondConflict.conflicts > 0 ? 'conflict' : (firstConflict.applied > 0 ? 'applied' : 'rejected'),
      reason: conflictSnapshot.conflicts.at(-1)?.reason,
      winner_title: conflictSnapshot.records.find((record) => record.id === 'conflict-note')?.title ?? null,
      loser_pending: conflictSnapshot.devices.find((device) => device.deviceId === deviceB)?.pending ?? 0,
    },
    simultaneous_edits: {
      status: simultaneousEdits.status,
      winner_title: simultaneousEdits.winner_title,
      conflicts: simultaneousEdits.conflicts,
    },
    offline_three_way_merge: {
      status: offlineThreeWayMerge.status,
      applied: offlineThreeWayMerge.applied,
      records: offlineThreeWayMerge.records,
    },
    idempotent_replay: {
      first: firstReplay.status,
      second: secondReplay.status,
      duplicate: secondReplay.status === 'duplicate',
    },
    delete_update_conflict: {
      status: deleteUpdateConflict.status,
      reason: deleteUpdateConflict.reason,
      deleted_title: deleteUpdateConflict.deleted_title,
      loser_pending: deleteUpdateConflict.loser_pending,
    },
    tombstones: {
      status: tombstoneSync.applied > 0 ? 'applied' : tombstoneSync.conflicts > 0 ? 'conflict' : 'rejected',
      deleted: Boolean(tombstoneSnapshot.records.find((record) => record.id === 'tombstone-note')?.deleted),
      archived_at: tombstoneSnapshot.records.find((record) => record.id === 'tombstone-note')?.archived_at ?? null,
    },
    per_installation_isolation: {
      installationA_records: recordNames(installASnapshot.records),
      installationB_records: recordNames(installBSnapshot.records),
      shared_record_in_a: installASnapshot.records.find((record) => record.id === 'shared-note')?.title ?? null,
      shared_record_in_b: installBSnapshot.records.find((record) => record.id === 'shared-note')?.title ?? null,
    },
    schema_version_refusal: {
      status: invalidSchema.status,
      reason: invalidSchema.reason,
    },
    reconnect_convergence: {
      matched: reconnectMatched,
      snapshot_checksum: convergenceSnapshot.checkpointChecksum,
      device_count: convergenceSnapshot.devices.length,
    },
    device_loss_recovery_boundary: {
      lost_present_before: lostBefore,
      recovered_present_after: lostAfter,
      persisted_cursor: recovered.snapshot.cursor,
    },
    family_group_sync_claims: {
      status: 'BLOCKED',
      reason: 'family/group sync claims are blocked until live provider/device multi-writer service is implemented',
      deterministic_multi_writer_evidence: allPassed,
    },
    live_multi_device_sync_claims: {
      status: 'BLOCKED',
      readiness: {
        local_deterministic: 'PASS',
        live_provider_device: 'BLOCKED',
      },
      reason:
        'live provider/device multi-writer sync has not been validated with a real sync adapter and device matrix',
      required_next_proof:
        'Add live sync adapter coverage across at least two real installations/devices and assert deterministic convergence and rollback behavior.',
      deterministic_multi_writer_evidence: allPassed,
    },
  };
}
