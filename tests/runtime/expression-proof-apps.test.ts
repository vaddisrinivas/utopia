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
        person: [
          { id: 'amy', collection: 'person', title: 'Amy' },
          { id: 'ben', collection: 'person', title: 'Ben' },
          { id: 'cara', collection: 'person', title: 'Cara' },
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
    expect(packageWidgets(appPackage)).toEqual(['dataTable']);
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
