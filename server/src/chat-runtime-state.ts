import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mutateJsonStateFile, readJsonStateFile } from './providers/json-state';

const CHAT_RUNTIME_STATE_PATH =
  process.env.LIFEOS_CHAT_RUNTIME_STATE_PATH?.trim()
  || join(process.cwd(), 'server-data', 'chat-runtime-state.json');
const STORE_VERSION = 1;
const IDEMPOTENCY_LIMIT = 512;
const RUN_LIMIT = 256;
const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RUN_RETENTION_MS = 24 * 60 * 60 * 1000;

export type PersistedScopedIdempotencyRecord = {
  status: 'reserved' | 'completed';
  reservationId: string;
  messageId: string | null;
  runId: string;
  conversationId: string;
  principalId: string;
  operationFingerprint: string;
  created_at: string;
  updated_at: string;
};

export type PersistedRunState = {
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  conversationId: string;
  principalId: string;
  ownerPid?: number;
  created_at: string;
  updated_at: string;
};

type ChatRuntimeStateFile = {
  version: 1;
  updated_at: string;
  idempotency: Record<string, PersistedScopedIdempotencyRecord>;
  runs: Record<string, PersistedRunState>;
};

let loaded = false;
let state = createDefaultState();

function nowIso() {
  return new Date().toISOString();
}

function createDefaultState(): ChatRuntimeStateFile {
  return {
    version: STORE_VERSION,
    updated_at: nowIso(),
    idempotency: {},
    runs: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPersistedIdempotencyRecord(value: unknown): value is PersistedScopedIdempotencyRecord {
  if (!isRecord(value)) {
    return false;
  }
  const current = (
    (value.status === 'reserved' || value.status === 'completed')
    && typeof value.reservationId === 'string'
    && (value.messageId === null || typeof value.messageId === 'string')
    && typeof value.runId === 'string'
    && typeof value.conversationId === 'string'
    && typeof value.principalId === 'string'
    && typeof value.operationFingerprint === 'string'
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
  );
  const legacy = (
    value.status === undefined
    && value.reservationId === undefined
    && typeof value.messageId === 'string'
    && typeof value.runId === 'string'
    && typeof value.conversationId === 'string'
    && typeof value.principalId === 'string'
    && typeof value.operationFingerprint === 'string'
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
  );
  return current || legacy;
}

function isPersistedRunState(value: unknown): value is PersistedRunState {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.status === 'running' || value.status === 'completed' || value.status === 'cancelled' || value.status === 'failed')
    && typeof value.conversationId === 'string'
    && typeof value.principalId === 'string'
    && (value.ownerPid === undefined || (typeof value.ownerPid === 'number' && Number.isInteger(value.ownerPid) && value.ownerPid > 0))
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
  );
}

function isChatRuntimeStateFile(value: unknown): value is ChatRuntimeStateFile {
  if (!isRecord(value)) {
    return false;
  }
  if ((value.version !== undefined && value.version !== STORE_VERSION) || typeof value.updated_at !== 'string') {
    return false;
  }
  if (!isRecord(value.idempotency) || !isRecord(value.runs)) {
    return false;
  }
  return (
    Object.values(value.idempotency).every((entry) => isPersistedIdempotencyRecord(entry))
    && Object.values(value.runs).every((entry) => isPersistedRunState(entry))
  );
}

function isProcessAlive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function pruneStore(input: ChatRuntimeStateFile, options: { markRestartedRunsFailed?: boolean } = {}): ChatRuntimeStateFile {
  const now = Date.now();
  const updatedAt = nowIso();
  const idempotency = Object.fromEntries(
    (Object.entries(input.idempotency) as Array<[string, PersistedScopedIdempotencyRecord]>)
      .map(([namespace, entry]) => [namespace, {
        ...entry,
        status: entry.status ?? 'completed',
        reservationId: entry.reservationId ?? `legacy-${entry.runId}`,
      }] as [string, PersistedScopedIdempotencyRecord])
      .filter(([, entry]) => {
        const updatedMs = Date.parse(entry.updated_at);
        return Number.isFinite(updatedMs) && (now - updatedMs) <= IDEMPOTENCY_RETENTION_MS;
      })
      .sort(([, left], [, right]) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, IDEMPOTENCY_LIMIT)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const runs = Object.fromEntries(
    (Object.entries(input.runs) as Array<[string, PersistedRunState]>)
      .map(([runId, entry]) => {
        if (options.markRestartedRunsFailed && entry.status === 'running' && !isProcessAlive(entry.ownerPid)) {
          return [runId, {
            ...entry,
            status: 'failed' as const,
            updated_at: updatedAt,
          }] as [string, PersistedRunState];
        }
        return [runId, entry] as [string, PersistedRunState];
      })
      .filter(([, entry]) => {
        if (entry.status === 'running') {
          return true;
        }
        const updatedMs = Date.parse(entry.updated_at);
        return Number.isFinite(updatedMs) && (now - updatedMs) <= RUN_RETENTION_MS;
      })
      .sort(([, left], [, right]) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, RUN_LIMIT)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    version: STORE_VERSION,
    updated_at: updatedAt,
    idempotency,
    runs,
  };
}

function loadState() {
  if (loaded) {
    return;
  }
  loaded = true;
  if (!existsSync(CHAT_RUNTIME_STATE_PATH)) {
    state = createDefaultState();
    return;
  }
  try {
    const parsed = readJsonStateFile(CHAT_RUNTIME_STATE_PATH, {
      label: 'chat runtime state',
      validate: isChatRuntimeStateFile,
    });
    state = pruneStore(parsed, { markRestartedRunsFailed: true });
    if (JSON.stringify(state) !== JSON.stringify(parsed)) {
      persistState((current) => pruneStore(current, { markRestartedRunsFailed: true }));
    }
  } catch {
    state = createDefaultState();
  }
}

function persistState(mutate: (current: ChatRuntimeStateFile) => ChatRuntimeStateFile): ChatRuntimeStateFile {
  const next = mutateJsonStateFile(CHAT_RUNTIME_STATE_PATH, {
    label: 'chat runtime state',
    validate: isChatRuntimeStateFile,
    createDefault: createDefaultState,
    mutate: (current) => pruneStore(mutate(pruneStore(current))),
  });
  state = next;
  loaded = true;
  return next;
}

export function getScopedIdempotencyRecord(namespace: string): PersistedScopedIdempotencyRecord | null {
  loadState();
  if (existsSync(CHAT_RUNTIME_STATE_PATH)) {
    try {
      state = pruneStore(readJsonStateFile(CHAT_RUNTIME_STATE_PATH, {
        label: 'chat runtime state',
        validate: isChatRuntimeStateFile,
      }));
    } catch {
      // A writer may be replacing the file. The next locked mutation refreshes it.
    }
  }
  return state.idempotency[namespace] ?? null;
}

export function setScopedIdempotencyRecord(
  namespace: string,
  record: Omit<PersistedScopedIdempotencyRecord, 'status' | 'reservationId' | 'created_at' | 'updated_at'>,
): PersistedScopedIdempotencyRecord {
  loadState();
  const now = nowIso();
  persistState((current) => ({
    ...current,
    idempotency: {
      ...current.idempotency,
      [namespace]: {
        ...record,
        status: 'completed',
        reservationId: current.idempotency[namespace]?.reservationId ?? `legacy-${record.runId}`,
        created_at: current.idempotency[namespace]?.created_at ?? now,
        updated_at: now,
      },
    },
  }));
  return state.idempotency[namespace];
}

export type ScopedIdempotencyReservationResult =
  | { status: 'reserved'; record: PersistedScopedIdempotencyRecord }
  | { status: 'completed'; record: PersistedScopedIdempotencyRecord }
  | { status: 'in_progress'; record: PersistedScopedIdempotencyRecord }
  | { status: 'conflict'; record: PersistedScopedIdempotencyRecord };

export function reserveScopedIdempotencyRecord(
  namespace: string,
  input: {
    reservationId: string;
    runId: string;
    conversationId: string;
    principalId: string;
    operationFingerprint: string;
  },
): ScopedIdempotencyReservationResult {
  loadState();
  const now = nowIso();
  let result: ScopedIdempotencyReservationResult | null = null;
  persistState((current) => {
    const existing = current.idempotency[namespace];
    if (existing) {
      if (existing.operationFingerprint !== input.operationFingerprint) {
        result = { status: 'conflict', record: existing };
        return current;
      }
      if (existing.status === 'completed' && existing.messageId) {
        result = { status: 'completed', record: existing };
        return current;
      }
      const existingRun = current.runs[existing.runId];
      if (existing.status === 'reserved' && existingRun?.status === 'running') {
        result = { status: 'in_progress', record: existing };
        return current;
      }
    }

    const record: PersistedScopedIdempotencyRecord = {
      status: 'reserved',
      reservationId: input.reservationId,
      messageId: null,
      runId: input.runId,
      conversationId: input.conversationId,
      principalId: input.principalId,
      operationFingerprint: input.operationFingerprint,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    result = { status: 'reserved', record };
    return {
      ...current,
      idempotency: {
        ...current.idempotency,
        [namespace]: record,
      },
      runs: {
        ...current.runs,
        [input.runId]: {
          status: 'running',
          conversationId: input.conversationId,
          principalId: input.principalId,
          ownerPid: process.pid,
          created_at: current.runs[input.runId]?.created_at ?? now,
          updated_at: now,
        },
      },
    };
  });
  if (!result) {
    throw new Error('chat idempotency reservation did not produce a result');
  }
  return result;
}

export function completeScopedIdempotencyReservation(
  namespace: string,
  input: {
    reservationId: string;
    messageId: string;
  },
): PersistedScopedIdempotencyRecord {
  loadState();
  const now = nowIso();
  persistState((current) => {
    const existing = current.idempotency[namespace];
    if (!existing || existing.status !== 'reserved' || existing.reservationId !== input.reservationId) {
      throw new Error('chat idempotency reservation ownership mismatch');
    }
    return {
      ...current,
      idempotency: {
        ...current.idempotency,
        [namespace]: {
          ...existing,
          status: 'completed',
          messageId: input.messageId,
          updated_at: now,
        },
      },
    };
  });
  return state.idempotency[namespace];
}

export function getRunState(runId: string): PersistedRunState | null {
  loadState();
  return state.runs[runId] ?? null;
}

export function setRunState(
  runId: string,
  input: Omit<PersistedRunState, 'created_at' | 'updated_at'>,
): PersistedRunState {
  loadState();
  const now = nowIso();
  persistState((current) => ({
    ...current,
    runs: {
      ...current.runs,
      [runId]: {
        ...input,
        ownerPid: input.status === 'running' ? process.pid : current.runs[runId]?.ownerPid,
        created_at: current.runs[runId]?.created_at ?? now,
        updated_at: now,
      },
    },
  }));
  return state.runs[runId];
}

export function findRunningConversationRun(principalId: string, conversationId: string, excludeRunId?: string): {
  runId: string;
  run: PersistedRunState;
} | null {
  loadState();
  const match = Object.entries(state.runs)
    .filter(([runId, run]) => runId !== excludeRunId && run.status === 'running' && run.principalId === principalId && run.conversationId === conversationId)
    .sort(([, left], [, right]) => right.updated_at.localeCompare(left.updated_at))[0];
  return match ? { runId: match[0], run: match[1] } : null;
}

export function getChatRuntimeStateSnapshotForTest() {
  loadState();
  return structuredClone(state);
}
