import { describe, expect, it } from 'vitest';

import { applyAction, emptyState, matchesWhere, queryRecords, routeScreen, validateState } from '@/src/kernel/runtime';
import { exportPayload } from '@/src/kernel/export';
import { jsonUiActionKinds, jsonUiComponentKinds, JsonUiSpecSchema, parsePackage, type AppPackage } from '@/src/kernel/schema';
import { recordWidgets, supportsWidget } from '@/src/kernel/widget-support';
import { fixturePackages } from './v3-fixtures';

const packages = fixturePackages();

function ensureLatest(pkg: AppPackage) {
  expect(pkg.schemaVersion).toBe('wonder.app-package.v3');
  expect(Object.keys(pkg.presentation.ui.screens).length).toBeGreaterThan(0);
  expect(Object.entries(pkg.presentation.ui.screens).filter(([, screen]) => !screen.components.length), pkg.id).toEqual([]);
}

describe('Kernel V3 package contract', () => {
  it('loads fixture packages through one Zod contract', () => {
    for (const pkg of packages) {
      expect(parsePackage(pkg)).toEqual(pkg);
      expect(getters(pkg)).toBeDefined();
      ensureLatest(pkg);
    }
  });

  it('rejects broken cross references', () => {
    const candidate = structuredClone(packages[0]);
    candidate.queries.broken = { from: 'missing' };
    expect(() => parsePackage(candidate)).toThrow(/unknown collection/);
  });

  it('has a real renderer for every bundled widget declaration', () => {
    const widgets = packages.flatMap((pkg) => Object.values(pkg.presentation.ui.screens))
      .flatMap((screen) => screen.components.map((component) => component.widget).filter(Boolean));
    expect([...new Set(widgets)].filter((widget) => !supportsWidget(widget))).toEqual([]);
  });

  it('exposes standard JSON UI library and rejects unknown components', () => {
    expect(jsonUiComponentKinds).toEqual(expect.arrayContaining(['Button', 'Modal', 'Slider', 'SearchBar', 'Card', 'ListItem']));
    expect(jsonUiActionKinds).toEqual(expect.arrayContaining(['navigate', 'goBack', 'setState', 'openURL']));
    expect(JsonUiSpecSchema.safeParse({ root: 'x', elements: { x: { type: 'Unknown', props: {}, children: [] } } }).success).toBe(false);
  });

  it('keeps duplicates loadable but inactive', () => {
    const active = new Set(packages.filter((pkg) => pkg.catalog.status === 'active').map((pkg) => pkg.id));
    expect(active.size).toBe(1);
    expect(packages.length - active.size).toBe(1);
    for (const pkg of packages) {
      if (pkg.catalog.status === 'inactive') {
        expect(active.has(pkg.catalog.duplicateOf)).toBe(true);
        expect(pkg.catalog.similarity).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it('binds every persistent widget to a collection', () => {
    const missing = packages.flatMap((pkg) => Object.entries(pkg.presentation.ui.screens).flatMap(([screenId, screen]) =>
      screen.components.filter((component) => recordWidgets.has(component.widget ?? ''))
        .filter((component) => !component.query?.collections?.[0] && !component.props?.collection)
        .map((component) => `${pkg.id}/${screenId}/${component.id ?? component.widget}`)));
    expect(missing).toEqual([]);
  });
});

describe('Kernel V3 records', () => {
  it('creates, queries, updates, toggles, and deletes arbitrary records', () => {
    let state = applyAction(emptyState, { kind: 'create', collection: 'meal', recordId: 'one', values: { title: 'Soup', ready: false } });
    expect(queryRecords(state, ['meal'], 'soup')).toHaveLength(1);
    state = applyAction(state, { kind: 'update', recordId: 'one', values: { title: 'Stew' } });
    state = applyAction(state, { kind: 'toggle', recordId: 'one', payload: { field: 'ready' } });
    expect(state.records[0].values).toMatchObject({ title: 'Stew', ready: true });
    state = applyAction(state, { kind: 'delete', recordId: 'one' });
    expect(state.records).toHaveLength(0);
  });

  it('upserts deterministic creates instead of duplicating records', () => {
    const created = applyAction(emptyState, { kind: 'create', collection: 'draft', recordId: 'draft-thread-1', values: { text: 'One' } });
    const replaced = applyAction(created, { kind: 'create', collection: 'draft', recordId: 'draft-thread-1', values: { text: 'Two' } });
    expect(replaced.records).toHaveLength(1);
    expect(replaced.records[0].values).toMatchObject({ text: 'Two' });
  });

  it('filters and orders records using the V3 query contract', () => {
    const state = [
      { id: 'a', collection: 'task', createdAt: '', updatedAt: '', values: { status: 'open', priority: 2 } },
      { id: 'b', collection: 'task', createdAt: '', updatedAt: '', values: { status: 'done', priority: 1 } },
      { id: 'c', collection: 'task', createdAt: '', updatedAt: '', values: { status: 'open', priority: 3 } },
    ];
    const where = { op: 'and', args: [{ op: 'eq', field: 'status', value: 'open' }, { op: 'gt', field: 'priority', value: 1 }] };
    expect(matchesWhere(where, state[0].values)).toBe(true);
    expect(queryRecords({ records: state }, ['task'], '', 10, { where, orderBy: [{ field: 'priority', direction: 'desc' }] }).map((record) => record.id)).toEqual(['c', 'a']);
  });

  it('validates records against package collections', () => {
    const pkg = packages.find((item) => item.id === 'fixture-active');
    expect(pkg).toBeTruthy();
    expect(validateState(pkg!, { records: [{ id: 'x', collection: 'missing', createdAt: '', updatedAt: '', values: {} }] })).toEqual(['x: unknown collection missing']);
  });

  it('routes only exact V3 screen ids', () => {
    const screens = ['overview', 'capture', 'chat'];
    expect(routeScreen('/overview', screens)).toBe('overview');
    expect(routeScreen('/capture?mode=receipt', screens)).toBe('capture');
    expect(routeScreen('?screen=overview', screens)).toBe('overview');
    expect(routeScreen('/food', screens)).toBeUndefined();
    expect(routeScreen('/removed', screens)).toBeUndefined();
  });

  it('confirms generic proposals and records durable receipts', () => {
    const created = applyAction(emptyState, { kind: 'propose', operation: 'create', collection: 'item', values: { title: 'One' }, payload: { confirmed: true } });
    expect(created.records[0].values.title).toBe('One');
    expect(created.receipts?.at(-1)).toMatchObject({ operation: 'create', status: 'completed' });
    const archived = applyAction(created, { kind: 'propose', operation: 'archive', recordId: created.records[0].id, payload: { confirmed: true } });
    expect(archived.records[0].values.archived).toBe(true);
    expect(archived.receipts?.at(-1)).toMatchObject({ operation: 'archive', status: 'completed' });
    const exported = applyAction(archived, { kind: 'propose', operation: 'export', payload: { confirmed: true } });
    expect(exported.receipts?.at(-1)).toMatchObject({ operation: 'export', status: 'completed' });
    expect(exportPayload(packages[0], exported)).toMatchObject({
      schemaVersion: 'utopia.app-data.v1',
      package: { id: packages[0].id, version: packages[0].version },
      records: exported.records,
    });
  });
});

describe('Kernel V3 boundary', () => {
  it('keeps app package boundary strict and stable', () => {
    for (const pkg of packages) {
      expect(pkg.catalog).toMatchObject({ status: expect.any(String) });
      expect(pkg.schemaVersion).toBe('wonder.app-package.v3');
      expect(pkg.presentation.ui.screens).toEqual(expect.any(Object));
      if (pkg.catalog.status === 'inactive') {
        expect(pkg.catalog.duplicateOf).toBe('fixture-active');
        expect(pkg.catalog.similarity).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it('keeps runtime behavior product-blind', () => {
    expect(packages.every((pkg) => !/food|pomodoro|focus-intervals|scientific-calculator|audio-loop-108/i.test(pkg.id))).toBe(true);
  });
});

function getters(pkg: AppPackage) {
  return parsePackage(pkg).id && pkg.collections && pkg.presentation;
}
