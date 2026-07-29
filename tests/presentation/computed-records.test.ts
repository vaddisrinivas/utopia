import { describe, expect, it } from 'vitest';

import type { AppPackageV2 } from '@/packages/shared/contracts/package';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import { recordsToComputedViews } from '@/src/presentation/computed-records';

const appPackage: AppPackageV2 = {
  schemaVersion: 'wonder.app-package.v2',
  id: 'shared-expenses',
  version: '1.0.0',
  collections: {
    split: { id: 'split', fields: {} },
    summary: { id: 'summary', fields: {} },
  },
  queries: {
    splits: {
      from: 'split',
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
  },
  views: {},
  computedFields: [
    {
      id: 'participant_paid',
      collection: 'split',
      dependsOn: [],
      expression: {
        group_sum: {
          rows: { var: 'queries.splits.rows' },
          groupBy: 'person_id',
          equals: { var: 'record.person_id' },
          value: 'paid_amount',
        },
      },
    },
    {
      id: 'settlements',
      collection: 'summary',
      dependsOn: [],
      expression: {
        balance_transfers: {
          rows: { var: 'queries.splits.rows' },
          participant: 'person_id',
          paid: 'paid_amount',
          owed: 'share_amount',
        },
      },
    },
  ],
  rules: [],
  capabilities: [],
  acceptanceTests: [],
};

describe('computed record presentation', () => {
  it('uses the shared aggregate kernel before producing record views', () => {
    const views = recordsToComputedViews([
      record('split-a', 'split', { person_id: 'amy', paid_amount: '30.00', share_amount: '10.00' }),
      record('split-b', 'split', { person_id: 'ben', paid_amount: '0.00', share_amount: '10.00' }),
      record('split-c', 'split', { person_id: 'cara', paid_amount: '0.00', share_amount: '10.00' }),
      record('summary', 'summary', {}),
    ], appPackage);

    expect(views[0]?.properties.participant_paid).toBe('30.00');
    expect(views[3]?.properties.settlements).toEqual([
      { from: 'ben', to: 'amy', amount: '10.00' },
      { from: 'cara', to: 'amy', amount: '10.00' },
    ]);
  });
});

function record(
  id: string,
  collection: string,
  properties: Record<string, unknown>,
): CanonicalRecord {
  return {
    id,
    domain: 'shared-expenses',
    collection,
    title: id,
    properties,
    relations: [],
    source: {
      provider: 'sqlite',
      external_id: id,
      url: null,
      observed_at: '2026-07-29T00:00:00.000Z',
      content_hash: null,
    },
    archived_at: null,
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
    revision: 1,
    schema_version: '1.0.0',
    deleted: false,
    privacy: 'personal',
    provenance: null,
  };
}
