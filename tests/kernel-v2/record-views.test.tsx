import { describe, expect, it } from 'vitest';

import { filterSortRecords, resolveBoardConfig, resolveCollection, RESERVED_RECORD_FIELDS } from '@/src/kernel/record-views';
import type { AppPackage, AppComponent } from '@/src/kernel/schema';
import type { JsonRecord } from '@/src/kernel/runtime';

const pkg = {
  collections: {
    tasks: {
      id: 'tasks',
      fields: {
        title: { type: 'text' },
        status: { type: 'text' },
        effort: { type: 'number' },
        due_at: { type: 'timestamp' },
      },
    },
  },
  queries: {
    active: { from: 'tasks', where: { op: 'eq', field: 'status', value: 'open' }, orderBy: [{ field: 'effort', direction: 'asc' }] },
  },
  views: {},
} as unknown as AppPackage;

const component = {
  kind: 'widget',
  widget: 'dataTable',
  title: 'Tasks',
  query: { collections: ['tasks'], match: '' },
} as AppComponent;

describe('record view helpers', () => {
  it('resolves collection precedence from component over query and view', () => {
    expect(resolveCollection(component, pkg, undefined)).toBe('tasks');
    expect(resolveCollection(
      { ...component, props: { collection: 'missing' } } as AppComponent,
      pkg,
      undefined,
    )).toBeUndefined();
    expect(resolveCollection(
      { ...component, props: { collection: 'tasks' }, query: {} } as AppComponent,
      pkg,
      { from: 'tasks' } as { from: string },
    )).toBe('tasks');
    expect(resolveCollection(
      { ...component, props: { collection: 'missing' }, query: {} } as AppComponent,
      pkg,
      { from: 'tasks' } as { from: string },
    )).toBe('tasks');
  });

  it('derives board config from props with safe fallback defaults', () => {
    const configured = resolveBoardConfig({
      ...component,
      widget: 'kanbanBoard',
      props: { groupBy: 'status', boardColumns: ['Todo', 'Doing', 'Done'] },
    } as AppComponent, pkg, 'tasks');
    expect(configured.field).toBe('status');
    expect(configured.columns).toEqual(['Todo', 'Doing', 'Done']);

    const fallback = resolveBoardConfig({
      ...component,
      widget: 'kanbanBoard',
      props: {},
    } as AppComponent, pkg, 'tasks');
    expect(fallback.field).toBe('status');
    expect(fallback.columns.length).toBe(4);
    expect(fallback.columns[0]).toBe('Todo');
  });

  it('filters, sorts, and limits records consistently', () => {
    const records: JsonRecord[] = [
      { id: 'a', collection: 'tasks', createdAt: '2026-01-01', updatedAt: '2026-01-02', values: { title: 'Bug fix', status: 'open', effort: 8, due_at: '2026-01-02' } },
      { id: 'b', collection: 'tasks', createdAt: '2026-01-01', updatedAt: '2026-01-02', values: { title: 'Alpha', status: 'done', effort: 3, due_at: '2026-01-01' } },
      { id: 'c', collection: 'tasks', createdAt: '2026-01-01', updatedAt: '2026-01-03', values: { title: 'Do docs', status: 'open', effort: 5, due_at: '2026-01-03' } },
    ];

    expect(filterSortRecords(records, { query: 'open', sortField: 'effort', sortDirection: 'asc' }).map((record) => record.id)).toEqual(['c', 'a']);
    expect(filterSortRecords(records, { query: 'bug', sortField: 'effort', sortDirection: 'desc' }).map((record) => record.id)).toEqual(['a']);
    expect(filterSortRecords(records, { sortField: 'title', sortDirection: 'asc', limit: 2 }).map((record) => record.id)).toEqual(['b', 'a']);
    expect(filterSortRecords(records, {}).map((record) => record.id)).toHaveLength(3);
  });

  it('keeps reserved data-shape fields blocked from auto fields display', () => {
    expect(RESERVED_RECORD_FIELDS.has('createdAt')).toBe(true);
    expect(RESERVED_RECORD_FIELDS.has('id')).toBe(true);
  });
});
