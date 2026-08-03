import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppPackage } from '@/packages/shared/contracts/package';
import { validateAppPackage } from '@/server/src/kernel/package';
import { evaluatePackage } from '@/server/src/kernel/runtime';

describe('expression proof apps', () => {
  it('computes Expense Splitter balances and minimized transfers package-only', () => {
    const appPackage = loadPackage('expense-splitter', 'expense-splitter.v1.json');
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });

    const result = evaluatePackage({
      package: appPackage,
      collections: {
        group: [],
        person: [
          { id: 'amy', collection: 'person', title: 'Amy', key: 'amy' },
          { id: 'ben', collection: 'person', title: 'Ben', key: 'ben' },
          { id: 'cara', collection: 'person', title: 'Cara', key: 'cara' },
        ],
        split: [
          { id: 'one', collection: 'split', person_id: 'amy', paid_amount: '50.00', share_amount: '20.00' },
          { id: 'two', collection: 'split', person_id: 'ben', paid_amount: '10.00', share_amount: '20.00' },
          { id: 'three', collection: 'split', person_id: 'cara', paid_amount: '0.00', share_amount: '20.00' },
        ],
        settlement_summary: [
          { id: 'current', collection: 'settlement_summary', title: 'Current settlement' },
        ],
      },
    });

    expect(result.queries.people.rows).toEqual([
      expect.objectContaining({ id: 'amy', balance: '30.00' }),
      expect.objectContaining({ id: 'ben', balance: '-10.00' }),
      expect.objectContaining({ id: 'cara', balance: '-20.00' }),
    ]);
    expect(result.queries.summary.rows[0]?.settlements).toEqual([
      { from: 'cara', to: 'amy', amount: '20.00' },
      { from: 'ben', to: 'amy', amount: '10.00' },
    ]);
    expect(packageWidgets(appPackage)).toEqual(['chartBlock', 'dataTable', 'operationHistory', 'recordHeroSummary', 'recordReviewCard', 'structuredList']);
    expect(packageWidgets(appPackage).some((widget) => /expense|splitter/i.test(widget))).toBe(false);
  });

  it('allocates Split Rent exactly with deterministic remainder handling', () => {
    const appPackage = loadPackage('split-rent', 'split-rent.v1.json');
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });

    const result = evaluatePackage({
      package: appPackage,
      collections: {
        participant: [
          { id: 'amy', collection: 'participant', title: 'Amy', weight: 1 },
          { id: 'ben', collection: 'participant', title: 'Ben', weight: 1 },
          { id: 'cara', collection: 'participant', title: 'Cara', weight: 1 },
        ],
        rent_plan: [
          { id: 'july', collection: 'rent_plan', title: 'July', total_rent: '100.00' },
        ],
      },
    });

    expect(result.queries.plans.rows[0]?.allocations).toEqual([
      { key: 'amy', amount: '33.34', weight: '1.00' },
      { key: 'ben', amount: '33.33', weight: '1.00' },
      { key: 'cara', amount: '33.33', weight: '1.00' },
    ]);
    expect(packageWidgets(appPackage)).toEqual(['dataTable']);
  });

  it('proves Scientific Calculator power cases through a computed field', () => {
    const appPackage = loadPackage('scientific-calculator', 'scientific-calculator.v1.json');
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });

    const result = evaluatePackage({
      package: appPackage,
      collections: {
        records: [],
        power_case: [
          { id: 'integer', collection: 'power_case', title: 'Integer', base: 1.1, exponent: 3, updated_at: '2026-08-01T00:00:00Z' },
          { id: 'negative', collection: 'power_case', title: 'Negative', base: 2, exponent: -2, updated_at: '2026-08-01T00:00:01Z' },
        ],
      },
    });

    expect(result.queries['power-cases'].rows).toEqual([
      expect.objectContaining({ title: 'Integer', power_result: '1.33' }),
      expect.objectContaining({ title: 'Negative', power_result: '0.25' }),
    ]);
  });

  it('rejects an unknown expression operator at the package schema boundary', () => {
    const appPackage = loadPackage('scientific-calculator', 'scientific-calculator.v1.json');
    const invalid = {
      ...appPackage,
      computedFields: [{
        id: 'bad',
        collection: 'power_case',
        dependsOn: [],
        expression: { eval: ['process.env'] },
      }],
    };
    expect(validateAppPackage(invalid)).toMatchObject({ valid: false });
  });
});

function loadPackage(directory: string, file: string): AppPackage {
  return JSON.parse(readFileSync(join(process.cwd(), 'apps', directory, file), 'utf8')) as AppPackage;
}

function packageWidgets(appPackage: AppPackage): string[] {
  return [...new Set(
    Object.values(appPackage.presentation?.ui?.screens ?? {})
      .flatMap((screen) => screen.components ?? [])
      .filter((component) => component.kind === 'widget')
      .map((component) => String(component.widget)),
  )].sort();
}
