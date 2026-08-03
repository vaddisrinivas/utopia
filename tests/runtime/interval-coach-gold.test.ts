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

const PACKAGE_PATH = join(process.cwd(), 'apps', 'focus-intervals', 'focus-intervals.v1.json');

describe('interval coach gold package', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('validates and stays inside generic package-owned surfaces', () => {
    const appPackage = loadPackage();

    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(widgetKinds(appPackage)).toEqual([
      'durationTimer',
      'operationHistory',
      'providerStatus',
      'recordContentCard',
      'recordHeroSummary',
      'recordReviewCard',
      'recordTimeline',
      'stepFlow',
      'structuredList',
    ]);
    expect(appPackage.capabilities).toEqual([]);
    expect(appPackage.rules).toEqual([]);
    expect(widgetKinds(appPackage)).not.toContain('notificationScheduler');
    expect(widgetKinds(appPackage).some((widget) => /focusintervals|intervalcoach/i.test(widget))).toBe(false);
    expect(appPackage.acceptanceTests).toEqual(expect.arrayContaining([
      'persisted-focus-step-flow',
      'background-foreground-observe',
      'restart-recovery-confirmed-elapsed',
      'uncertain-elapsed-review-required',
      'completed-session-record',
      'session-note-draft-recovery',
      'truthful-notification-boundary',
    ]));
  });

  it('defines a recoverable coached flow and a separate honest re-entry timer', () => {
    const appPackage = loadPackage();
    const stepFlowProps = widgetProps(appPackage, 'stepFlow');
    const timerProps = widgetProps(appPackage, 'durationTimer');

    expect(stepFlowProps).toMatchObject({
      runId: 'interval-coach-session',
      recovery: {
        onRestart: 'restore-active-session',
        onUncertainElapsed: 'require-confirmation',
      },
      completionRecord: {
        collection: 'focus_session',
        title: 'Four-block focus cycle',
        properties: {
          status: 'completed',
          session_type: 'coached-cycle',
          elapsed_seconds: 4200,
          background_policy: 'foreground-only',
        },
      },
      steps: [
        { id: 'deep-work-1', title: 'Deep Work', durationSeconds: 1500 },
        { id: 'reset-1', title: 'Short Reset', durationSeconds: 300 },
        { id: 'deep-work-2', title: 'Deep Work Again', durationSeconds: 1500 },
        { id: 'reset-2', title: 'Long Reset', durationSeconds: 900 },
      ],
    });
    expect(timerProps).toMatchObject({
      runId: 'interval-coach-reentry',
      label: 'Back on task',
      durationSeconds: 600,
      recovery: {
        onRestart: 'restore-active-session',
        onUncertainElapsed: 'require-confirmation',
      },
    });
    expect((stepFlowProps as { completionRecord?: { properties?: Record<string, unknown> } })
      .completionRecord?.properties).not.toHaveProperty('note_count');
  });

  it('keeps package navigation scoped to the active installation', () => {
    const appPackage = loadPackage();
    const heroProps = widgetProps(appPackage, 'recordHeroSummary') as {
      actions?: Array<{ route?: string }>;
    };

    expect(heroProps.actions?.map((action) => action.route)).toEqual([
      '?screen=notes',
      '?screen=history',
    ]);
  });

  it('persists and restores the coached flow from package configuration', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as never);

    const appPackage = loadPackage();
    const flowProps = widgetProps(appPackage, 'stepFlow');
    const steps = normalizeStepFlowDefinitions(flowProps);
    const firstStepDurationMs = steps[0]?.durationMs ?? 1_500_000;

    const installationId = 'install-interval-coach';
    const runId = `${installationId}:${appPackage.id}:${stringValue((flowProps as { runId?: unknown }).runId)}`;

    const started = await startPersistedStepFlow({
      db: db as never,
      runId,
      appInstallationId: installationId,
      domain: appPackage.id,
      workflowId: 'interval-coach-session',
      steps,
      clock: { utcMs: 0, monotonicMs: 0, monotonicEpoch: 'boot-a' },
    });
    expect(started).toMatchObject({
      status: 'running',
      currentStep: 0,
      timer: { status: 'running' },
    });

    const observed = await dispatchPersistedStepFlow({
      db: db as never,
      runId,
      appInstallationId: installationId,
      event: { id: 'observe-first-block', kind: 'observe' },
      clock: {
        utcMs: firstStepDurationMs + 1_000,
        monotonicMs: firstStepDurationMs + 1_000,
        monotonicEpoch: 'boot-a',
      },
    });
    expect(observed).toMatchObject({
      status: 'step_complete',
      currentStep: 0,
      timer: { status: 'completed' },
    });

    const advanced = await dispatchPersistedStepFlow({
      db: db as never,
      runId,
      appInstallationId: installationId,
      event: { id: 'advance-to-reset', kind: 'next' },
      clock: {
        utcMs: firstStepDurationMs + 2_000,
        monotonicMs: firstStepDurationMs + 2_000,
        monotonicEpoch: 'boot-a',
      },
    });
    expect(advanced).toMatchObject({ status: 'running', currentStep: 1 });

    await expect(loadPersistedStepFlow(db as never, runId, installationId)).resolves.toMatchObject({
      status: 'running',
      currentStep: 1,
    });

    const restored = await dispatchPersistedStepFlow({
      db: db as never,
      runId,
      appInstallationId: installationId,
      event: { id: 'restart-observe', kind: 'observe' },
      clock: {
        utcMs: firstStepDurationMs + 10_000,
        monotonicMs: 10,
        monotonicEpoch: 'boot-b',
      },
    });
    expect(restored.currentStep).toBe(1);
  });

  it('keeps note capture local, draft-recoverable, and explicit', () => {
    const appPackage = loadPackage();
    const noteListProps = widgetProps(appPackage, 'structuredList');

    expect(noteListProps).toMatchObject({
      collection: 'focus_note',
      commandPolicy: {
        autosave: 'blur',
        optimistic: true,
        offline: 'local',
        draftPersistence: { enabled: true, scope: 'local' },
        restartRecovery: { enabled: true, maxAgeMs: 604800000 },
      },
    });
    expect(JSON.stringify(noteListProps)).toContain('Session ID');
    expect(JSON.stringify(noteListProps)).toContain('Fix note');
  });
});

function loadPackage(): AppPackage {
  return JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as AppPackage;
}

function widgetKinds(appPackage: AppPackage): string[] {
  return [...new Set(widgetEntries(appPackage).map((entry) => entry.name))].sort();
}

function widgetEntries(appPackage: AppPackage): Array<{ name: string; props: unknown }> {
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

function widgetProps(appPackage: AppPackage, widgetName: string): unknown {
  return widgetEntries(appPackage).find((entry) => entry.name === widgetName)?.props ?? {};
}

function normalizeStepFlowDefinitions(value: unknown): StepFlowDefinition[] {
  const props = isObject(value) ? value : {};
  const steps = Array.isArray((props as { steps?: unknown }).steps) ? (props.steps as unknown[]) : [];
  return steps.flatMap((entry, index) => {
    if (!isObject(entry)) return [];
    const title = stringValue(entry.title);
    if (!title) return [];
    const durationSeconds = numberValue(entry.durationSeconds);
    const id = stringValue(entry.id, `step-${index + 1}`);
    return [{ id, title, ...(durationSeconds > 0 ? { durationMs: durationSeconds * 1000 } : {}) }];
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}
