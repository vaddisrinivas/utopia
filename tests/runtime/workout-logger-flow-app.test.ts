import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppPackage } from '@/packages/shared/contracts/package';
import type { StepFlowDefinition } from '@/packages/runtime-kernel/timed-flow';
import { validateAppPackage } from '@/server/src/kernel/package';
import { runMigrations } from '@/src/db/migrations';
import {
  dispatchPersistedStepFlow,
  loadPersistedStepFlow,
  startPersistedStepFlow,
} from '@/src/workflows/timed-flow-runtime';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

describe('workout logger flow app runtime proof', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('validates workout-logger package manifest', () => {
    const appPackage = loadWorkoutLogger();
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
  });

  it('uses supported generic widgets and does not include app-named timer widgets', () => {
    const appPackage = loadWorkoutLogger();
    const widgets = packageWidgets(appPackage);

    expect(widgets.map((widget) => widget.name)).toContain('stepFlow');
    expect(widgets.map((widget) => widget.name)).toContain('durationTimer');
    expect(widgets.map((widget) => widget.name)).not.toContain('workoutTimer');
    expect(widgets.some((widget) => /workout/i.test(widget.name))).toBe(false);
    expect(widgets.some((widget) => /app-?/i.test(widget.name))).toBe(false);
  });

  it('defines correct stepFlow and durationTimer props for kernel-backed execution', () => {
    const appPackage = loadWorkoutLogger();
    const stepFlowProps = getWidgetProps(appPackage, 'stepFlow');
    const timerProps = getWidgetProps(appPackage, 'durationTimer');

    expect(stepFlowProps).toMatchObject({
      runId: 'guided-workout',
      steps: [
        { id: 'warmup', title: 'Warm-up', durationSeconds: 300 },
        { id: 'work', title: 'Work set', durationSeconds: 45 },
        { id: 'rest', title: 'Rest', durationSeconds: 30 },
        { id: 'log', title: 'Log set' },
      ],
    });
    expect(timerProps).toMatchObject({
      runId: 'recovery-timer',
      label: 'Recovery',
      durationSeconds: 60,
    });

    expect(normalizeStepFlowDefinitions(stepFlowProps)).toEqual([
      { id: 'warmup', title: 'Warm-up', durationMs: 300_000 },
      { id: 'work', title: 'Work set', durationMs: 45_000 },
      { id: 'rest', title: 'Rest', durationMs: 30_000 },
      { id: 'log', title: 'Log set' },
    ] as StepFlowDefinition[]);
  });

  it('persists and reloads stepFlow kernel state from workout package configuration', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as never);

    const packageSteps = normalizeStepFlowDefinitions(getWidgetProps(loadWorkoutLogger(), 'stepFlow'));
    expect(packageSteps.length).toBeGreaterThanOrEqual(2);
    const firstStepDurationMs = packageSteps[0]?.durationMs ?? 30_000;

    const appPackage = loadWorkoutLogger();
    const runId = `${appPackage.id}:install-a:guided-workout`;
    const installationId = 'install-a';

    const started = await startPersistedStepFlow({
      db: db as never,
      runId,
      appInstallationId: installationId,
      domain: appPackage.id,
      workflowId: 'guided-workout',
      steps: packageSteps,
      clock: { utcMs: 0, monotonicMs: 0, monotonicEpoch: 'process-a' },
    });
    expect(started.status).toBe('running');
    expect(started.currentStep).toBe(0);

    const observed = await dispatchPersistedStepFlow({
      db: db as never,
      runId,
      appInstallationId: installationId,
      event: { id: 'observe-first-step-complete', kind: 'observe' },
      clock: {
        utcMs: firstStepDurationMs + 1_000,
        monotonicMs: firstStepDurationMs + 1_000,
        monotonicEpoch: 'process-a',
      },
    });
    expect(observed.status).toBe('step_complete');

    const resumed = await dispatchPersistedStepFlow({
      db: db as never,
      runId,
      appInstallationId: installationId,
      event: { id: 'advance-to-step-2', kind: 'next' },
      clock: { utcMs: 46_000, monotonicMs: 46_001, monotonicEpoch: 'process-a' },
    });
    expect(resumed.status).toBe('running');
    expect(resumed.currentStep).toBe(1);
    await expect(loadPersistedStepFlow(db as never, runId, installationId)).resolves.toEqual(resumed);
    const restartObserved = await dispatchPersistedStepFlow({
      db: db as never,
      runId,
      appInstallationId: installationId,
      event: { id: 'restore-observe', kind: 'observe' },
      clock: {
        utcMs: firstStepDurationMs + 5_000,
        monotonicMs: 5,
        monotonicEpoch: 'process-b',
      },
    });
    expect(restartObserved.currentStep).toBe(1);
  });
});

function loadWorkoutLogger(): AppPackage {
  return JSON.parse(readFileSync(join(process.cwd(), 'apps', 'workout-logger', 'workout-logger.v1.json'), 'utf8')) as AppPackage;
}

function packageWidgets(appPackage: AppPackage): Array<{ name: string; props: unknown }> {
  const ui = appPackage.presentation?.ui;
  if (!isObject(ui) || !isObject(ui.screens)) return [];
  return Object.values(ui.screens)
    .flatMap((screen) => isObject(screen) && Array.isArray(screen.components)
      ? screen.components.flatMap((component) => isObject(component)
        && component.kind === 'widget'
        && typeof component.widget === 'string'
        ? [{ name: component.widget, props: component.props ?? {} }]
        : []
      )
      : []);
}

function getWidgetProps(appPackage: AppPackage, widgetName: string): unknown {
  const widget = packageWidgets(appPackage).find((entry) => entry.name === widgetName);
  return widget?.props ?? {};
}

function normalizeStepFlowDefinitions(value: unknown): StepFlowDefinition[] {
  const props = isObject(value) ? value : {};
  const steps = Array.isArray((props as { steps?: unknown }).steps) ? (props.steps as unknown[]) : [];
  return steps.slice(0, 100).flatMap((entry, index) => {
    if (!isObject(entry)) return [];
    const title = stringValue(entry.title);
    if (!title) return [];
    const durationSeconds = numberValue(entry.durationSeconds);
    const id = stringValue(entry.id, `step-${index + 1}`);
    return [{ id, title, ...(durationSeconds > 0 ? { durationMs: Math.floor(durationSeconds * 1000) } : {}) }];
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
