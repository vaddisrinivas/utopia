import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppPackage } from '@/packages/shared/contracts/package';
import { validateAppPackage } from '@/server/src/kernel/package';
import { evaluatePackage } from '@/server/src/kernel/runtime';

type Case = {
  appId: string;
  collection: string;
  query: string;
  records: Array<Record<string, unknown>>;
  dependencies: Record<string, string[]>;
  computed: Record<string, string>;
};

const cases: Case[] = [
  {
    appId: 'work-log',
    collection: 'work_entry',
    query: 'recent-work',
    records: [{
      id: 'work-1',
      collection: 'work_entry',
      title: 'Client delivery',
      updated_at: '2026-08-01T10:30:00Z',
      properties: '{}',
      work_date: '2026-08-01T08:00:00Z',
      project: 'Acme',
      category: 'delivery',
      duration_minutes: 90,
      outcome: 'Sent',
      blocker: '',
      status: 'closed',
      hourly_rate: 40,
    }],
    dependencies: { work_hours: [], billable_amount: ['work_hours'] },
    computed: { work_hours: '1.50', billable_amount: '60.00' },
  },
  {
    appId: 'shift-log',
    collection: 'shift_entry',
    query: 'shift-history',
    records: [{
      id: 'shift-1',
      collection: 'shift_entry',
      title: 'Morning shift',
      updated_at: '2026-08-01T18:00:00Z',
      properties: '{}',
      shift_date: '2026-08-01T08:00:00Z',
      location: 'Store',
      role: 'Associate',
      started_at: '2026-08-01T08:00:00Z',
      ended_at: '2026-08-01T16:30:00Z',
      break_minutes: 30,
      worked_minutes: 480,
      handover: 'All clear',
      incident: '',
      status: 'approved',
      hourly_rate: 25,
    }],
    dependencies: { worked_hours: [], pay_amount: ['worked_hours'] },
    computed: { worked_hours: '8.00', pay_amount: '200.00' },
  },
  {
    appId: 'household-budget',
    collection: 'budget_entry',
    query: 'budget-entries',
    records: [{
      id: 'budget-1',
      collection: 'budget_entry',
      title: 'Salary',
      amount: 2400,
      category: 'payroll',
      recorded_at: '2026-08-01T00:00:00Z',
      source: 'Payroll',
      direction: 'income',
      month: '2026-08',
    }],
    dependencies: { signed_amount: [] },
    computed: { signed_amount: '2400.00' },
  },
  {
    appId: 'invoice-review',
    collection: 'invoice_line',
    query: 'invoice_line-records',
    records: [{
      id: 'line-1',
      collection: 'invoice_line',
      title: 'Consulting',
      quantity: 3,
      unit_price: 125,
      tax_rate: 10,
      invoice_id: 'invoice-1',
      discount_rate: 0,
    }],
    dependencies: {
      line_total: [],
      tax_amount: ['line_total'],
      gross_total: ['line_total', 'tax_amount'],
    },
    computed: { line_total: '375.00', tax_amount: '37.50', gross_total: '412.50' },
  },
  {
    appId: 'project-burndown',
    collection: 'primary',
    query: 'sprint_day-records',
    records: [{
      id: 'day-1',
      collection: 'primary',
      title: 'Sprint day 1',
      sprint: 'Sprint 1',
      day: 'Day 1',
      planned_points: 40,
      completed_points: 30,
      date: '2026-08-01T00:00:00Z',
    }],
    dependencies: { remaining_points: [], completion_ratio: [] },
    computed: { remaining_points: '10.00', completion_ratio: '0.75' },
  },
  {
    appId: 'ticket-sla',
    collection: 'primary',
    query: 'ticket-records',
    records: [{
      id: 'ticket-1',
      collection: 'primary',
      title: 'Login issue',
      opened_at: '2026-08-01T08:00:00Z',
      due_at: '2026-08-02T08:00:00Z',
      priority: 1,
      status: 'resolved',
      sla_hours: 24,
      elapsed_hours: 10,
    }],
    dependencies: { hours_remaining: [], overdue_hours: ['hours_remaining'] },
    computed: { hours_remaining: '14.00', overdue_hours: '0.00' },
  },
];

describe('reporting app computed-field dependencies', () => {
  it.each(cases)('$appId references only computed ordering dependencies', ({
    appId,
    collection,
    query,
    records,
    dependencies,
    computed,
  }) => {
    const appPackage = loadPackage(appId);
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(Object.fromEntries(
      (appPackage.computedFields ?? []).map((field) => [field.id, field.dependsOn]),
    )).toEqual(dependencies);

    const result = evaluatePackage({
      package: appPackage,
      collections: packageCollections(appPackage, collection, records),
    });
    expect(result.queries[query]?.rows[0]).toEqual(expect.objectContaining(computed));
  });
});

function loadPackage(appId: string): AppPackage {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'apps', appId, `${appId}.v1.json`), 'utf8'),
  ) as AppPackage;
}

function packageCollections(
  appPackage: AppPackage,
  collection: string,
  records: Array<Record<string, unknown>>,
): Record<string, Array<Record<string, unknown>>> {
  return Object.fromEntries(
    Object.keys(appPackage.collections).map((id) => [id, id === collection ? records : []]),
  );
}
