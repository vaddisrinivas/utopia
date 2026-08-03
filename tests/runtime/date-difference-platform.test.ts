import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppPackage } from '@/packages/shared/contracts/package';
import { evaluatePackage } from '@/server/src/kernel/runtime';
import { validateAppPackage } from '@/server/src/kernel/package';

describe('date difference platform proof', () => {
  it('uses date_diff for Shift Planner duration with an explicit end-before-start refusal', () => {
    const appPackage = loadPackage('shift-planner', 'shift-planner.v1.json');
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });

    const result = evaluatePackage({
      package: appPackage,
      collections: {
        primary: [{
          id: 'morning',
          collection: 'primary',
          person: 'Alex',
          starts_at: '2026-08-01T09:00:00Z',
          ends_at: '2026-08-01T17:30:00Z',
          break_minutes: 30,
          hourly_rate: 20,
        }],
      },
    });

    expect(result.queries['shift-records'].rows[0]).toEqual(expect.objectContaining({
      duration_hours: 8,
      paid_hours: '7.50',
      estimated_pay: '150.00',
    }));
    expect(() => evaluatePackage({
      package: appPackage,
      collections: {
        primary: [{
          id: 'invalid',
          collection: 'primary',
          person: 'Alex',
          starts_at: '2026-08-02T09:00:00Z',
          ends_at: '2026-08-01T17:30:00Z',
          break_minutes: 30,
          hourly_rate: 20,
        }],
      },
    })).toThrow('expression_date_diff_end_before_start');
  });

  it('uses date_diff for Invoice Aging days and deterministic age buckets', () => {
    const appPackage = loadPackage('invoice-aging', 'invoice-aging.v1.json');
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });

    const result = evaluatePackage({
      package: appPackage,
      collections: {
        primary: [{
          id: 'invoice-1',
          collection: 'primary',
          client: 'Acme',
          amount: '100.00',
          issued_at: '2026-07-01',
          due_at: '2026-07-15',
          as_of: '2026-08-01',
          terms_days: 14,
          status: 'open',
        }],
      },
    });

    expect(result.queries['invoice-records'].rows[0]).toEqual(expect.objectContaining({
      days_since_issue: 31,
      days_outstanding: 17,
      overdue_days: 17,
      age_bucket: '1-30',
    }));
  });
});

function loadPackage(directory: string, file: string): AppPackage {
  return JSON.parse(readFileSync(join(process.cwd(), 'apps', directory, file), 'utf8')) as AppPackage;
}
