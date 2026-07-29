import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '@/src/db/migrations';
import {
  dispatchPersistedStepFlow,
  loadPersistedStepFlow,
  startPersistedStepFlow,
} from '@/src/workflows/timed-flow-runtime';
import { validateAppPackage } from '@/server/src/kernel/package';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const packagePath = join(process.cwd(), 'apps', 'focus-intervals', 'focus-intervals.v1.json');

describe('focus intervals flow app', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('validates as a bundled package, uses only generic widgets, and reuses the shared persisted flow kernel', async () => {
    const appPackage = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
    const validation = validateAppPackage(appPackage);

    expect(validation).toMatchObject({ valid: true });
    expect(widgetKinds(appPackage)).toEqual(['durationTimer', 'stepFlow']);
    expect(runtimeOperations(appPackage)).toEqual([]);
    expect(hasAppNamedRuntimeSurface(appPackage, 'focus-intervals')).toBe(false);

    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as never);

    const steps = [
      { id: 'deep-work', title: 'Deep Work', durationMs: 25 * 60 * 1000 },
      { id: 'short-break', title: 'Short Break', durationMs: 5 * 60 * 1000 },
    ] as const;

    const started = await startPersistedStepFlow({
      db: db as never,
      runId: 'install-a:focus-intervals:focus-cycle',
      appInstallationId: 'install-a',
      domain: 'focus-intervals',
      workflowId: 'focus-cycle',
      steps,
      clock: { utcMs: 0, monotonicMs: 0, monotonicEpoch: 'boot-a' },
    });
    expect(started).toMatchObject({
      schemaVersion: 'utopia.step-flow.v1',
      status: 'running',
      currentStep: 0,
      timer: { schemaVersion: 'utopia.duration-timer.v1', status: 'running' },
    });

    const restored = await loadPersistedStepFlow(db as never, 'install-a:focus-intervals:focus-cycle', 'install-a');
    expect(restored).toMatchObject({ status: 'running', currentStep: 0 });

    const observed = await dispatchPersistedStepFlow({
      db: db as never,
      runId: 'install-a:focus-intervals:focus-cycle',
      appInstallationId: 'install-a',
      event: { id: 'observe', kind: 'observe' },
      clock: { utcMs: 25 * 60 * 1000, monotonicMs: 25 * 60 * 1000, monotonicEpoch: 'boot-a' },
    });
    expect(observed).toMatchObject({
      status: 'step_complete',
      currentStep: 0,
      timer: { status: 'completed' },
    });

    const advanced = await dispatchPersistedStepFlow({
      db: db as never,
      runId: 'install-a:focus-intervals:focus-cycle',
      appInstallationId: 'install-a',
      event: { id: 'next', kind: 'next' },
      clock: { utcMs: 25 * 60 * 1000, monotonicMs: 25 * 60 * 1000, monotonicEpoch: 'boot-a' },
    });
    expect(advanced).toMatchObject({ status: 'running', currentStep: 1 });
  });
});

function widgetKinds(appPackage: Record<string, unknown>): string[] {
  return [...new Set(
    Object.values(((appPackage.presentation as { ui?: { screens?: Record<string, { components?: Array<{ kind?: string; widget?: string }> }> } } | undefined)?.ui?.screens ?? {}))
      .flatMap((screen) => screen.components ?? [])
      .filter((component): component is { kind: 'widget'; widget: string } => component?.kind === 'widget' && typeof component.widget === 'string')
      .map((component) => component.widget),
  )].sort();
}

function runtimeOperations(appPackage: Record<string, unknown>): string[] {
  return [...new Set(
    Object.values((appPackage.rules as Array<{ effect?: { operation?: unknown } }> | undefined) ?? [])
      .map((rule) => rule.effect?.operation)
      .filter((operation): operation is string => typeof operation === 'string' && operation.trim().length > 0),
  )].sort();
}

function hasAppNamedRuntimeSurface(appPackage: Record<string, unknown>, appName: string): boolean {
  const needle = appName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const widgets = widgetKinds(appPackage).map((widget) => widget.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  const operations = runtimeOperations(appPackage).map((operation) => operation.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return widgets.some((widget) => widget.includes(needle)) || operations.some((operation) => operation.includes(needle));
}
