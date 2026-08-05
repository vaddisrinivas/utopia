import { describe, expect, it } from 'vitest';

import {
  baseIdempotencyKey,
  buildOperationKey,
  nextOperationRecord,
  shouldRetry,
  transitionStatus,
  snapshotFromAction,
  isIdempotentReplay,
  markCompleted,
  markRolledBack,
  computeRetryDelay,
} from '@/src/kernel/operations';

describe('durable operations', () => {
  it('builds stable idempotency keys and detects replay', () => {
    const action = {
      kind: 'update',
      tenantId: 't1',
      appId: 'a1',
      collection: 'entries',
      recordId: 'r1',
      payload: { idempotencyKey: 'x', nested: { value: 1 } },
    };

    const base = baseIdempotencyKey(action);
    const provided = buildOperationKey(action, 'op');
    expect(base).toBeTruthy();
    expect(provided.startsWith('op::')).toBe(true);

    const record = snapshotFromAction(action, 'running', 'op');
    const replayed = isIdempotentReplay([{ ...record, status: 'succeeded' }], base, 'op');
    expect(replayed).toBe(true);
  });

  it('retries only when configured and statuses move safely', () => {
    const action = { kind: 'delete', tenantId: 't1', payload: {} };
    const snapshot = snapshotFromAction(action);
    expect(snapshot.status).toBe('running');

    const retryDelay = computeRetryDelay(1, { baseDelayMs: 100, multiplier: 2, maxDelayMs: 1000 });
    expect(retryDelay).toBe(100);

    const firstFail = nextOperationRecord(snapshot, new Error('e'), '2026-08-05T00:00:00.000Z', {
      maxAttempts: 3,
      baseDelayMs: 100,
      multiplier: 2,
      maxDelayMs: 1000,
    });
    expect(firstFail.status).toBe('retrying');
    expect(firstFail.attempts).toBe(1);
    expect(firstFail.nextRetryAt).toContain('2026-08-05T00:00:00');
    expect(shouldRetry(new Error('e'), 3, { maxAttempts: 3 })).toBe(false);

    const exhausted = nextOperationRecord(firstFail, { status: 500 }, '2026-08-05T00:00:01.000Z', {
      maxAttempts: 2,
      baseDelayMs: 100,
      multiplier: 2,
      maxDelayMs: 1000,
    });
    expect(exhausted.status).toBe('failed');

    expect(() => transitionStatus(exhausted, 'running')).toThrow('operation_terminal');
    const completed = markCompleted(snapshot);
    expect(completed.status).toBe('succeeded');

    const rolledBack = markRolledBack({
      ...snapshot,
      status: 'running',
      attempts: 1,
    });
    expect(rolledBack.status).toBe('rolled_back');
  });

  it('rejects permanent errors from retry', () => {
    expect(shouldRetry({ permanent: true }, 1, { maxAttempts: 4 })).toBe(false);
    expect(shouldRetry({ status: 400 }, 1, { maxAttempts: 4 })).toBe(false);
    expect(shouldRetry({ status: 500 }, 1, { maxAttempts: 4 })).toBe(true);
  });
});
