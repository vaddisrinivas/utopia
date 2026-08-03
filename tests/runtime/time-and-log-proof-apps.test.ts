import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { evaluateExpression, type Expression } from '@/packages/runtime-kernel/expression';
import { runMigrations } from '@/src/db/migrations';
import {
  loadPersistedStepFlow,
  startPersistedStepFlow,
} from '@/src/workflows/timed-flow-runtime';
import { validateAppPackage } from '@/server/src/kernel/package';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const PROOF_APPS = [
  {
    id: 'simple-time-tracker',
    widgets: ['chartBlock', 'dataTable', 'durationTimer', 'formCard', 'operationHistory'],
    acceptanceTests: [
      'persisted-duration-timer',
      'background-foreground-observe',
      'restart-recovery-confirmed-elapsed',
      'completed-session-record',
      'activity-record-history',
    ],
  },
  {
    id: 'billable-project-timer',
    widgets: [
      'chartBlock',
      'dataTable',
      'durationTimer',
      'formCard',
      'operationHistory',
      'providerStatus',
      'recordHeroSummary',
      'recordReviewCard',
      'recordTimeline',
      'structuredList',
      'themeDensitySelector',
    ],
    acceptanceTests: [
      'persisted-project-duration-timer',
      'background-foreground-observe',
      'restart-recovery-confirmed-elapsed',
      'uncertain-elapsed-review-required',
      'completed-session-record',
      'computed-billable-amount',
      'generic-uninvoiced-entry-table',
    ],
  },
  {
    id: 'work-log',
    widgets: [
      'chartBlock',
      'dataTable',
      'durationTimer',
      'operationHistory',
      'recordContentCard',
      'recordReviewCard',
      'structuredList',
    ],
    acceptanceTests: [
      'installation-scoped-work-entry-list',
      'generic-structured-work-table',
      'record-detail-navigation',
    ],
  },
  {
    id: 'shift-log',
    widgets: [
      'calendarBlock',
      'chartBlock',
      'dataTable',
      'operationHistory',
      'recordContentCard',
      'recordReviewCard',
      'structuredList',
    ],
    acceptanceTests: [
      'installation-scoped-active-shift-list',
      'generic-shift-history-table',
      'review-status-filter',
    ],
  },
] as const;

const ALLOWED_WIDGETS = new Set([
  'durationTimer',
  'recordList',
  'dataTable',
  'metric',
  'formCard',
  'structuredList',
  'operationHistory',
  'recordReviewCard',
  'recordContentCard',
  'chartBlock',
  'calendarBlock',
  'providerStatus',
  'recordHeroSummary',
  'recordTimeline',
  'themeDensitySelector',
]);

describe('time and log package-only proof apps', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it.each(PROOF_APPS)('$id is schema-valid and uses only existing generic surfaces', (definition) => {
    const appPackage = loadPackage(definition.id);

    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(appPackage.acceptanceTests).toEqual(expect.arrayContaining([...definition.acceptanceTests]));
    expect(widgetKinds(appPackage)).toEqual(definition.widgets);
    expect(allComponentKinds(appPackage).every((kind) => (
      kind === 'widget' || kind === 'recordList' || kind === 'metric' || kind === 'section' || kind === 'callout'
    ))).toBe(true);
    expect(widgetKinds(appPackage).every((widget) => ALLOWED_WIDGETS.has(widget))).toBe(true);
    expect(hasAppNamedWidget(appPackage, definition.id)).toBe(false);
    expect(appPackage.capabilities).toEqual([]);
    expect(appPackage.rules).toEqual([]);
  });

  it.each([
    ['simple-time-tracker', 'current-timer', 3600],
    ['billable-project-timer', 'billable-session', 7200],
  ] as const)('%s timer configuration starts and restores through the persisted generic timer kernel', async (
    appId,
    expectedRunId,
    expectedDurationSeconds,
  ) => {
    const appPackage = loadPackage(appId);
    const timer = timerComponent(appPackage);
    expect(timer.props).toMatchObject({
      runId: expectedRunId,
      durationSeconds: expectedDurationSeconds,
    });

    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as never);

    const installationId = `install:${appId}`;
    const persistedRunId = `${installationId}:${appId}:${expectedRunId}`;
    const started = await startPersistedStepFlow({
      db: db as never,
      runId: persistedRunId,
      appInstallationId: installationId,
      domain: appId,
      workflowId: expectedRunId,
      steps: [{
        id: 'timer',
        title: String(timer.props.label),
        durationMs: expectedDurationSeconds * 1000,
      }],
      clock: { utcMs: 1_000, monotonicMs: 1_000, monotonicEpoch: 'boot-a' },
    });
    expect(started).toMatchObject({
      schemaVersion: 'utopia.step-flow.v1',
      status: 'running',
      timer: {
        schemaVersion: 'utopia.duration-timer.v1',
        status: 'running',
      },
    });

    const restored = await loadPersistedStepFlow(db as never, persistedRunId, installationId);
    expect(restored).toMatchObject({
      status: 'running',
      timer: { status: 'running' },
    });
  });

  it('billable project timer derives amount through the generic expression contract', () => {
    const appPackage = loadPackage('billable-project-timer');
    const computedField = firstComputedField(appPackage);
    expect(appPackage.computedFields).toEqual([
      expect.objectContaining({
        id: 'billable_amount',
        collection: 'billable_entry',
        expression: {
          '*': [
            { '/': [{ var: 'record.duration_minutes' }, 60] },
            { var: 'record.hourly_rate' },
          ],
        },
      }),
    ]);
    expect(evaluateExpression({
      record: { duration_minutes: 90, hourly_rate: 80 },
    }, computedField.expression)).toBe('120.00');
  });

  it('work and shift logs expose query-backed list and table views without pretending form submission exists', () => {
    for (const appId of ['work-log', 'shift-log'] as const) {
      const appPackage = loadPackage(appId);
      expect(widgetKinds(appPackage)).not.toContain('formCard');
      expect(queryBackedComponents(appPackage).length).toBeGreaterThanOrEqual(3);
      expect(queryBackedComponents(appPackage).every((component) => (
        Array.isArray(component.query.collections) && component.query.collections.length === 1
      ))).toBe(true);
    }
  });
});

type PackageShape = {
  id: string;
  capabilities: unknown[];
  rules: unknown[];
  acceptanceTests: string[];
  computedFields?: unknown[];
  presentation: {
    ui: {
      screens: Record<string, {
        components: Array<{
          kind: string;
          widget?: string;
          query?: { collections?: string[] };
          props?: Record<string, unknown>;
        }>;
      }>;
    };
  };
};

function loadPackage(appId: string): PackageShape {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'apps', appId, `${appId}.v1.json`), 'utf8'),
  ) as PackageShape;
}

function components(appPackage: PackageShape) {
  return Object.values(appPackage.presentation.ui.screens).flatMap((screen) => screen.components);
}

function widgetKinds(appPackage: PackageShape): string[] {
  return [...new Set(
    components(appPackage)
      .filter((component) => component.kind === 'widget' && typeof component.widget === 'string')
      .map((component) => component.widget as string),
  )].sort();
}

function allComponentKinds(appPackage: PackageShape): string[] {
  return components(appPackage).map((component) => component.kind);
}

function hasAppNamedWidget(appPackage: PackageShape, appId: string): boolean {
  const appNeedle = appId.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  return widgetKinds(appPackage).some((widget) => (
    widget.replace(/[^a-z0-9]+/gi, '').toLowerCase().includes(appNeedle)
  ));
}

function timerComponent(appPackage: PackageShape) {
  const timer = components(appPackage).find((component) => component.widget === 'durationTimer');
  if (!timer?.props) throw new Error(`${appPackage.id} has no configured durationTimer`);
  return timer as { props: Record<string, unknown> };
}

function queryBackedComponents(appPackage: PackageShape) {
  return components(appPackage).filter(
    (component): component is typeof component & { query: { collections: string[] } } => (
      Boolean(component.query) && Array.isArray(component.query?.collections)
    ),
  );
}

function firstComputedField(appPackage: PackageShape): { expression: Expression } {
  const [field] = appPackage.computedFields ?? [];
  if (!isRecord(field) || !isExpression(field.expression)) {
    throw new Error(`${appPackage.id} has no first computed expression`);
  }
  return { expression: field.expression };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isExpression(value: unknown): value is Expression {
  if (value === null) return true;
  if (['boolean', 'string', 'number'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isExpression);
  return isRecord(value);
}
