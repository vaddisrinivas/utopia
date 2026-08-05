import { describe, expect, it } from 'vitest';

import { computedRecords, evaluateExpression, reconcileTimer, workflow } from '@/src/kernel/engine';
import { loadState, saveState } from '@/src/kernel/persistence';
import { applyAction, emptyState } from '@/src/kernel/runtime';
import { fixtureActivePackage } from './v3-fixtures';

const record = { id: 'one', collection: 'item', createdAt: '', updatedAt: '', values: { value: 2 } };

describe('compact durable runtime semantics', () => {
  it('orders computed dependencies and rejects cycles', () => {
    const pkg = fixtureActivePackage();
    pkg.computedFields = [
      { id: 'third', collection: 'item', dependsOn: ['second'], expression: { '+': [{ var: 'record.second' }, 1] } },
      { id: 'second', collection: 'item', dependsOn: ['first'], expression: { '+': [{ var: 'record.first' }, 1] } },
      { id: 'first', collection: 'item', dependsOn: [], expression: { '+': [{ var: 'record.value' }, 1] } },
    ];
    expect(computedRecords(pkg, { records: [record] })[0].values).toMatchObject({ first: 3, second: 4, third: 5 });
    pkg.computedFields[0].dependsOn = ['second'];
    pkg.computedFields[1].dependsOn = ['third'];
    expect(() => computedRecords(pkg, { records: [record] })).toThrow('computed_field_cycle');
  });

  it('bounds expression work and row fanout', () => {
    let expression: unknown = 1;
    for (let index = 0; index < 501; index += 1) expression = { '+': [expression, 1] };
    expect(() => evaluateExpression(expression, {})).toThrow('expression_budget_exceeded');
    expect(() => evaluateExpression({ group_sum: { rows: Array.from({ length: 501 }, () => ({})), groupBy: 'x', equals: 1, value: 'x' } }, {})).toThrow(/expression_(rows_invalid|budget_exceeded)/);
  });

  it('keeps revisions, tombstones, and idempotency durable', () => {
    const created = applyAction(emptyState, { kind: 'create', collection: 'item', recordId: 'one', payload: { idempotencyKey: 'create:one' } });
    expect(created.records[0].revision).toBe(1);
    expect(applyAction(created, { kind: 'create', collection: 'item', recordId: 'one', payload: { idempotencyKey: 'create:one' } })).toBe(created);
    expect(applyAction(created, { kind: 'create', collection: 'item', recordId: 'one', values: { value: 1 }, payload: { idempotencyKey: 'create:one', idempotent: false } })).not.toBe(created);
    expect(applyAction(created, { kind: 'create', collection: 'item', recordId: 'two', payload: { idempotencyKey: 'create:one', idempotent: false } })).not.toBe(created);
    expect(applyAction(created, { kind: 'update', recordId: 'one', values: { value: 3 }, payload: { expectedRevision: 2 } })).toBe(created);
    const deleted = applyAction(created, { kind: 'delete', recordId: 'one', payload: { expectedRevision: 1 } });
    expect(deleted.records).toHaveLength(0);
    expect(deleted.tombstones?.[0]).toMatchObject({ id: 'one', revision: 2 });
    const restored = applyAction(deleted, { kind: 'create', collection: 'item', recordId: 'one' });
    expect(restored.records[0].revision).toBe(3);
    expect(restored.tombstones).toBeUndefined();
  });

  it('persists workflow/timer snapshots and reconciles elapsed time', async () => {
    const flow = workflow<{ stage: string }>({
      initial: 'idle',
      states: {
        idle: { on: { START: 'running' } },
        running: { on: { PAUSE: 'pausedState', STOP: 'stopped' } },
        pausedState: { on: { STOP: 'stopped' } },
        stopped: {},
      },
    });
    const workflowSnapshot = flow.advance(undefined, 'START', '2026-08-05T00:00:00.000Z', { stage: 'started' });
    expect(workflowSnapshot).toMatchObject({
      schemaVersion: 'workflow.snapshot.v3',
      state: 'running',
      control: 'running',
      revision: 1,
      checkpoint: { stage: 'started' },
    });
    const businessPause = flow.advance(workflowSnapshot, 'PAUSE', '2026-08-05T00:00:00.100Z');
    expect(businessPause).toMatchObject({ state: 'pausedState', control: 'running', revision: 2 });
    const controlPaused = flow.control(businessPause, 'PAUSE', '2026-08-05T00:00:00.200Z');
    expect(controlPaused).toMatchObject({ state: 'pausedState', control: 'paused', revision: 3 });
    expect(() => flow.control(controlPaused, 'PAUSE', '2026-08-05T00:00:00.300Z')).toThrow('workflow_control_illegal');
    expect(() => flow.advance(controlPaused, 'STOP')).toThrow('workflow_control_blocked');
    const resumed = flow.control(controlPaused, 'RESUME', '2026-08-05T00:00:01.000Z');
    const restarted = flow.advance(resumed, 'STOP', '2026-08-05T00:00:01.100Z');
    expect(restarted).toMatchObject({ state: 'stopped', control: 'running', revision: 5 });
    const timer = reconcileTimer({ durationMs: 5_000, elapsedMs: 1_000, status: 'running', updatedAt: '2026-08-05T00:00:00.000Z' }, Date.parse('2026-08-05T00:00:02.000Z'));
    const values = new Map<string, string>();
    const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); } };
    const state = { ...emptyState, workflows: { focus: workflowSnapshot }, timers: { focus: timer } };
    await saveState(storage, 'app', state);
    await expect(loadState(storage, 'app')).resolves.toStrictEqual(state);
    values.set('app', '{broken');
    await expect(loadState(storage, 'app')).resolves.toStrictEqual(state);
    expect(reconcileTimer(timer, Date.parse('2026-08-04T00:00:00.000Z')).status).toBe('review');
  });
});
