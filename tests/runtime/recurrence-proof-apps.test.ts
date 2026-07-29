import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppPackage } from '@/packages/shared/contracts/package';
import { validateAppPackage } from '@/server/src/kernel/package';
import { evaluatePackage } from '@/server/src/kernel/runtime';

describe('recurrence proof apps', () => {
  it('runs recurring bills package-only through the shared recurrence engine', () => {
    const appPackage = loadPackage('recurring-bills', 'recurring-bills.v1.json');
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(widgetKinds(appPackage)).toEqual(['dataTable']);
    expect(hasAppNamedWidget(appPackage, 'recurring-bills')).toBe(false);

    const result = evaluatePackage({
      package: appPackage,
      collections: {
        bill: [
          {
            id: 'rent',
            collection: 'bill',
            title: 'Rent',
            due_amount: 1800,
            status: 'active',
            as_of: '2026-06-30T12:00:00Z',
            schedule: {
              schemaVersion: 'utopia.recurrence.v1',
              timezone: 'America/New_York',
              anchor: '2026-07-01T09:00:00-04:00',
              dstPolicy: 'compatible',
              rules: [
                { id: 'monthly-rent', kind: 'interval', every: 1, unit: 'month' },
              ],
            },
          },
          {
            id: 'insurance',
            collection: 'bill',
            title: 'Insurance',
            due_amount: 420,
            status: 'active',
            as_of: '2025-01-01T00:00:00Z',
            schedule: {
              schemaVersion: 'utopia.recurrence.v1',
              timezone: 'America/New_York',
              anchor: '2024-02-29T08:00:00-05:00',
              dstPolicy: 'compatible',
              rules: [
                { id: 'annual-leap-day', kind: 'interval', every: 1, unit: 'year' },
              ],
            },
          },
        ],
      },
    });

    const billRows = result.queries.bills.rows as Array<Record<string, any>>;

    expect(billRows.map((row) => row.title)).toEqual(['Insurance', 'Rent']);
    expect(billRows[0]?.next_due).toMatchObject({
      instant: '2028-02-29T13:00:00.000Z',
      local: '2028-02-29T08:00:00',
      offset: '-05:00',
    });
    expect(billRows[1]?.next_due).toMatchObject({
      instant: '2026-07-01T13:00:00.000Z',
      local: '2026-07-01T09:00:00',
      offset: '-04:00',
    });
    expect(billRows[0]?.upcoming_due_dates.status).toBe('ok');
    expect(billRows[1]?.upcoming_due_dates.status).toBe('ok');
  });

  it('runs spaced repetition package-only through weekday and monthday recurrence rules', () => {
    const appPackage = loadPackage('spaced-repetition', 'spaced-repetition.v1.json');
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(widgetKinds(appPackage)).toEqual(['dataTable']);
    expect(hasAppNamedWidget(appPackage, 'spaced-repetition')).toBe(false);

    const result = evaluatePackage({
      package: appPackage,
      collections: {
        card: [
          {
            id: 'verbs',
            collection: 'card',
            title: 'Spanish verbs',
            topic: 'Language',
            ease_factor: 2.4,
            status: 'active',
            as_of: '2026-07-29T07:30:01-04:00',
            schedule: {
              schemaVersion: 'utopia.recurrence.v1',
              timezone: 'America/New_York',
              anchor: '2026-07-29T07:30:00-04:00',
              dstPolicy: 'compatible',
              rules: [
                { id: 'study-days', kind: 'weekday', every: 1, weekdays: ['mon', 'wed', 'fri'] },
              ],
            },
          },
          {
            id: 'deck',
            collection: 'card',
            title: 'Deck review',
            topic: 'Medicine',
            ease_factor: 1.8,
            status: 'active',
            as_of: '2026-07-01T00:00:00Z',
            schedule: {
              schemaVersion: 'utopia.recurrence.v1',
              timezone: 'America/New_York',
              anchor: '2026-07-01T08:00:00-04:00',
              dstPolicy: 'compatible',
              rules: [
                { id: 'monthly-review', kind: 'monthday', every: 1, monthDays: [1, 15] },
              ],
            },
          },
        ],
      },
    });

    const cardRows = result.queries.cards.rows as Array<Record<string, any>>;

    expect(cardRows[0]?.next_review).toMatchObject({
      instant: '2026-07-01T12:00:00.000Z',
      local: '2026-07-01T08:00:00',
      offset: '-04:00',
    });
    expect(cardRows[1]?.next_review).toMatchObject({
      instant: '2026-07-31T11:30:00.000Z',
      local: '2026-07-31T07:30:00',
      offset: '-04:00',
    });
    expect(cardRows[0]?.review_window.status).toBe('ok');
    expect(cardRows[1]?.review_window.status).toBe('ok');
  });
});

function loadPackage(directory: string, file: string): AppPackage {
  return JSON.parse(readFileSync(join(process.cwd(), 'apps', directory, file), 'utf8')) as AppPackage;
}

function widgetKinds(appPackage: AppPackage): string[] {
  return [...new Set(
    Object.values(appPackage.presentation?.ui?.screens ?? {})
      .flatMap((screen) => screen.components ?? [])
      .filter((component) => component.kind === 'widget')
      .map((component) => String(component.widget)),
  )].sort();
}

function hasAppNamedWidget(appPackage: AppPackage, appName: string): boolean {
  const needle = appName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return widgetKinds(appPackage).some((widget) => widget.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(needle));
}
