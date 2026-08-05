import { describe, expect, it } from 'vitest';

import { applyAction, emptyState, queryRecords } from '@/src/kernel/runtime';
import type { AppAction } from '@/src/kernel/schema';
import { applyQueryPagination, matchesWhere, sortByFields } from '@/src/kernel/query';

describe('enhanced query primitives', () => {
  it('matches advanced predicates with dot paths and relations', () => {
    const values = {
      status: 'open',
      metrics: { score: 14, category: 'build' },
      labels: ['x', 'core'],
      owner: { profile: { title: 'Lead' } },
    };

    expect(matchesWhere({ op: 'gt', field: 'metrics.score', value: 10 }, values)).toBe(true);
    expect(matchesWhere({ op: 'contains', field: 'labels', value: 'core' }, values)).toBe(true);
    expect(matchesWhere({ op: 'startsWith', field: 'owner.profile.title', value: 'L' }, values)).toBe(true);
    expect(matchesWhere({ op: 'in', field: 'status', value: ['open', 'done'] }, values)).toBe(true);
    expect(matchesWhere({ op: 'between', field: 'metrics.score', value: [10, 20] }, values)).toBe(true);
  });

  it('sorts by nested fields and paginates deterministically', () => {
    const rows = [
      { id: 'a', collection: 'task', createdAt: '1', updatedAt: '1', values: { project: { name: 'x' }, rank: 2 } },
      { id: 'b', collection: 'task', createdAt: '1', updatedAt: '1', values: { project: { name: 'b' }, rank: 1 } },
      { id: 'c', collection: 'task', createdAt: '1', updatedAt: '1', values: { project: { name: 'a' }, rank: 3 } },
    ];

    const sorted = sortByFields(rows, [{ field: 'project.name', direction: 'asc' }, { field: 'rank', direction: 'desc' }]);
    expect(sorted.map((item) => item.id)).toEqual(['c', 'b', 'a']);
    expect(applyQueryPagination(sorted, { orderBy: [{ field: 'project.name', direction: 'asc' }], offset: 1, limit: 1, where: {} }))
      .toHaveLength(1);
  });

  it('queries records with saved filters, limit and offset', () => {
    const state = {
      records: [
        { id: 'a', collection: 'entry', createdAt: '2026-01-01', updatedAt: '2026-01-01', values: { score: 1, status: 'done' } },
        { id: 'b', collection: 'entry', createdAt: '2026-01-02', updatedAt: '2026-01-02', values: { score: 2, status: 'open' } },
        { id: 'c', collection: 'entry', createdAt: '2026-01-03', updatedAt: '2026-01-03', values: { score: 3, status: 'done' } },
      ],
    };

    const where = { op: 'and', args: [
      { op: 'saved', value: 'mustBeOpen' },
      { op: 'gt', field: 'score', value: 0 },
    ] };
    const records = queryRecords(state, ['entry'], '', 10, {
      where,
      orderBy: [{ field: 'score', direction: 'asc' }],
      offset: 0,
      limit: 1,
      savedFilters: { mustBeOpen: { op: 'eq', field: 'status', value: 'open' } },
    });
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('b');
  });
});

describe('proposal action receipts', () => {
  it('confirms create/update/delete/archive/restore/retry/undo receipts', () => {
    const create = applyAction(emptyState, {
      kind: 'propose',
      operation: 'create' as unknown as AppAction['operation'],
      collection: 'task',
      values: { status: 'open', title: 'first' },
      payload: { confirmed: true },
    });
    const recordId = create.records[0].id;
    expect(create.receipts?.at(-1)).toMatchObject({ operation: 'create', status: 'completed' });

    const updated = applyAction(create, {
      kind: 'propose',
      operation: 'update' as unknown as AppAction['operation'],
      recordId,
      values: { title: 'next' },
      payload: { confirmed: true },
    });
    expect(updated.records[0].values).toMatchObject({ title: 'next' });
    expect(updated.receipts?.at(-1)).toMatchObject({ operation: 'update', status: 'completed', recordId });

    const archived = applyAction(updated, {
      kind: 'propose',
      operation: 'archive' as unknown as AppAction['operation'],
      recordId,
      payload: { confirmed: true },
    });
    expect(archived.records[0].values).toMatchObject({ archived: true });
    expect(archived.receipts?.at(-1)).toMatchObject({ operation: 'archive', status: 'completed', recordId });

    const restored = applyAction(archived, {
      kind: 'propose',
      operation: 'restore' as unknown as AppAction['operation'],
      recordId,
      payload: { confirmed: true },
    });
    expect(restored.receipts?.at(-1)).toMatchObject({ operation: 'restore', status: 'completed', recordId });

    const retried = applyAction(restored, {
      kind: 'propose',
      operation: 'retry' as unknown as AppAction['operation'],
      recordId,
      payload: { confirmed: true, retryReason: 'user' },
    });
    expect(retried.receipts?.at(-1)).toMatchObject({ operation: 'retry', status: 'completed' });

    const undone = applyAction(retried, {
      kind: 'propose',
      operation: 'undo' as unknown as AppAction['operation'],
      payload: { confirmed: true },
    });
    expect(undone.receipts?.at(-1)).toMatchObject({ operation: 'undo', status: 'completed' });
    expect(undone.records[0].values).toMatchObject({ archived: true });

    const deleted = applyAction(undone, {
      kind: 'propose',
      operation: 'delete' as unknown as AppAction['operation'],
      recordId,
      payload: { confirmed: true },
    });
    expect(deleted.receipts?.at(-1)).toMatchObject({ operation: 'delete', status: 'completed', recordId });
    expect(deleted.records).toHaveLength(0);
  });

  it('prevents speculative navigation and export/ retry without bindings', () => {
    const base = applyAction(emptyState, {
      kind: 'create',
      collection: 'task',
      values: { status: 'open', title: 'bound' },
      payload: { confirmed: true },
    });
    const targetId = base.records[0].id;

    expect(applyAction(base, {
      kind: 'propose',
      operation: 'retry' as unknown as AppAction['operation'],
      payload: { confirmed: true },
    }).receipts?.at(-1)).toMatchObject({ operation: 'retry', status: 'unavailable' });

    expect(applyAction(base, {
      kind: 'propose',
      operation: 'retry' as unknown as AppAction['operation'],
      recordId: targetId,
      payload: { confirmed: true },
    }).receipts?.at(-1)).toMatchObject({ operation: 'retry', status: 'completed', recordId: targetId });

    expect(applyAction(base, {
      kind: 'propose',
      operation: 'export' as unknown as AppAction['operation'],
      payload: { confirmed: true },
    }).receipts?.at(-1)).toMatchObject({ operation: 'export', status: 'completed' });

    expect(applyAction(base, {
      kind: 'propose',
      operation: 'export' as unknown as AppAction['operation'],
      recordId: 'missing',
      payload: { confirmed: true },
    }).receipts?.at(-1)).toMatchObject({ operation: 'export', status: 'unavailable', recordId: 'missing' });

    expect(applyAction(base, {
      kind: 'propose',
      operation: 'navigate' as unknown as AppAction['operation'],
      payload: { confirmed: true },
    }).receipts?.at(-1)).toMatchObject({ operation: 'navigate', status: 'unavailable' });

    expect(applyAction(base, {
      kind: 'propose',
      operation: 'navigate' as unknown as AppAction['operation'],
      target: '/history',
      payload: { confirmed: true },
    }).receipts?.at(-1)).toMatchObject({ operation: 'navigate', status: 'completed' });
  });

  it('marks unavailable receipt when proposal target is missing', () => {
    const missing = applyAction(emptyState, {
      kind: 'propose',
      operation: 'update' as unknown as AppAction['operation'],
      recordId: 'missing',
      values: { title: 'x' },
      payload: { confirmed: true },
    });
    expect(missing.receipts?.at(-1)).toMatchObject({ operation: 'update', status: 'unavailable', recordId: 'missing' });
  });
});
