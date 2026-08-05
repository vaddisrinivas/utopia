import { canonicalize } from 'json-canonicalize';

type JsonPayload = Record<string, unknown> | undefined;
type JsonError = { message?: string; status?: number; permanent?: boolean; retryable?: boolean; retryAfterMs?: number };

type DurableAction = {
  kind: string;
  tenantId?: string;
  appId?: string;
  collection?: string;
  recordId?: string;
  payload?: JsonPayload;
};

export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
};

export type DurableOperationRecord = {
  key: string;
  status: 'idle' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'rolled_back';
  attempts: number;
  lastError?: string;
  nextRetryAt?: string;
  lastUpdatedAt?: string;
  startedAt?: string;
  completedAt?: string;
};

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 250,
  multiplier: 2,
  maxDelayMs: 30_000,
};

const toNumber = (value: unknown, fallback: number): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const sanitizePayload = (payload: JsonPayload): JsonPayload => {
  if (!payload) return payload;
  const safe = { ...payload };
  if ('idempotencyKey' in safe) delete safe.idempotencyKey;
  return safe;
};

const canonicalPayload = (payload: JsonPayload): string => canonicalize(sanitizePayload(payload) ?? null);

const normalizePolicy = (policy: Partial<RetryPolicy> = {}): RetryPolicy => {
  const base = { ...DEFAULT_RETRY_POLICY, ...policy } as RetryPolicy;
  return {
    maxAttempts: Math.max(1, toNumber(base.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts)),
    baseDelayMs: Math.max(0, toNumber(base.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs)),
    multiplier: Math.max(1, toNumber(base.multiplier, DEFAULT_RETRY_POLICY.multiplier)),
    maxDelayMs: Math.max(1, toNumber(base.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs)),
  };
};

const describeError = (error: unknown): string => {
  if (error == null) return 'error';
  if (error instanceof Error) return error.message || 'error';
  return String(error);
};

const toTimestamp = (at: string): number => {
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const terminalStates = new Set(['failed', 'succeeded', 'rolled_back']);

const retryDelayMs = (attempt: number, policy: RetryPolicy): number => {
  const scale = Math.max(0, attempt - 1);
  const raw = policy.baseDelayMs * policy.multiplier ** scale;
  return Math.max(0, Math.min(raw, policy.maxDelayMs));
};

const isRetryableError = (error: unknown): boolean => {
  if (error == null) return true;
  if (!(error instanceof Error) && typeof error !== 'object') return true;

  const candidate = error as JsonError;
  if (candidate.permanent || candidate.retryable === false) return false;

  const status = toNumber(candidate.status, 0);
  if (status >= 400 && status < 500) {
    if (status === 408 || status === 425 || status === 429) return true;
    return false;
  }

  if (typeof candidate.message === 'string' && /(validation|unauthorized|forbidden|unsupported|signature)/i.test(candidate.message)) {
    return false;
  }

  return true;
};

export function baseIdempotencyKey(action: DurableAction): string {
  const body = sanitizePayload(action.payload);
  return canonicalize({
    tenantId: action.tenantId ?? '',
    appId: action.appId ?? '',
    collection: action.collection ?? '',
    recordId: action.recordId ?? '',
    kind: action.kind,
    payload: body,
  });
}

export function buildOperationKey(action: DurableAction, supplied?: string): string {
  const base = baseIdempotencyKey(action);
  const key = supplied?.trim();
  return key ? `${key}::${base}` : base;
}

export function snapshotFromAction(action: DurableAction, status: DurableOperationRecord['status'] = 'running', key?: string): DurableOperationRecord {
  const now = new Date().toISOString();
  return {
    key: buildOperationKey(action, key),
    status,
    attempts: 0,
    lastUpdatedAt: now,
    startedAt: status === 'running' ? now : undefined,
  };
}

export function shouldRetry(error: unknown, attempt: number, policy: Partial<RetryPolicy> = {}): boolean {
  const normalized = normalizePolicy(policy);
  if (attempt >= normalized.maxAttempts) return false;
  if (!isRetryableError(error)) return false;
  return true;
}

export function computeRetryDelay(attempt: number, policy: Partial<RetryPolicy> = {}): number {
  return retryDelayMs(attempt, normalizePolicy(policy));
}

export function nextRetryAt(attempt: number, policy: Partial<RetryPolicy> = {}, now = new Date().toISOString()): string {
  const delayMs = computeRetryDelay(attempt, policy);
  return new Date(toTimestamp(now) + delayMs).toISOString();
}

export function nextOperationRecord(
  record: DurableOperationRecord,
  error: unknown,
  at = new Date().toISOString(),
  policy: Partial<RetryPolicy> = {},
): DurableOperationRecord {
  if (record.status === 'succeeded' || record.status === 'rolled_back') {
    return record;
  }

  const nextAttempt = record.attempts + 1;
  const failed = !shouldRetry(error, nextAttempt, policy);

  const next: DurableOperationRecord = {
    ...record,
    attempts: nextAttempt,
    status: failed ? 'failed' : 'retrying',
    lastError: describeError(error),
    lastUpdatedAt: at,
    completedAt: failed ? at : undefined,
    nextRetryAt: failed ? undefined : nextRetryAt(nextAttempt, policy, at),
  };

  if (typeof (error as JsonError)?.retryAfterMs === 'number') {
    const explicitMs = toNumber((error as JsonError).retryAfterMs, 0);
    next.nextRetryAt = new Date(toTimestamp(at) + Math.max(0, explicitMs)).toISOString();
  }

  return next;
}

export function isIdempotentReplay(records: DurableOperationRecord[], key: string, supplied?: string): boolean {
  const normalized = supplied?.trim() ? `${supplied}::${key}` : key;
  return records.some((record) => record.key === key || record.key === normalized || record.key.endsWith(`::${key}`));
}

export function transitionStatus(
  record: DurableOperationRecord,
  next: DurableOperationRecord['status'],
  at = new Date().toISOString(),
): DurableOperationRecord {
  if (terminalStates.has(record.status) && record.status !== next) {
    throw new Error(`operation_terminal:${record.status}->${next}`);
  }

  if (next === 'running') {
    return {
      ...record,
      status: 'running',
      attempts: Math.max(record.attempts, 1),
      startedAt: record.startedAt ?? at,
      completedAt: undefined,
      nextRetryAt: undefined,
      lastUpdatedAt: at,
      lastError: undefined,
    };
  }

  if (next === 'succeeded') {
    return {
      ...record,
      status: 'succeeded',
      attempts: Math.max(record.attempts, 1),
      completedAt: at,
      lastUpdatedAt: at,
      nextRetryAt: undefined,
      lastError: undefined,
    };
  }

  if (next === 'rolled_back') {
    return {
      ...record,
      status: 'rolled_back',
      attempts: Math.max(record.attempts, 1),
      completedAt: at,
      lastUpdatedAt: at,
      nextRetryAt: undefined,
      lastError: undefined,
    };
  }

  return {
    ...record,
    status: next,
    lastUpdatedAt: at,
  };
}

export const markCompleted = (record: DurableOperationRecord, at = new Date().toISOString()): DurableOperationRecord => transitionStatus(record, 'succeeded', at);
export const markRolledBack = (record: DurableOperationRecord, at = new Date().toISOString()): DurableOperationRecord => transitionStatus(record, 'rolled_back', at);
