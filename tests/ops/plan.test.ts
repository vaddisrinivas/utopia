import { describe, expect, it } from 'vitest';

import { loadCatalog } from '@/src/domain/catalog';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import type { Operation } from '@/src/ops/operation';
import { planOperation } from '@/src/ops/plan';

const manifest = loadCatalog().activeManifest;
const at = '2026-07-24T10:00:00.000Z';

function baseOperation(patch: Partial<Operation> = {}): Operation {
  return {
    op_id: 'plan-op',
    kind: 'create',
    domain: manifest.id,
    collection: 'inventory',
    record_id: 'plan-record',
    record: {
      title: 'Plan yogurt',
      properties: { body: 'Greek yogurt', quantity: 2 },
      relations: [],
      source: { provider: 'sqlite', external_id: 'plan-record', url: null, observed_at: at, content_hash: null },
      archived_at: null,
    },
    actor: 'user',
    origin: 'manual',
    ...patch,
  };
}

function currentRecord(patch: Partial<CanonicalRecord> = {}): CanonicalRecord {
  return {
    id: 'plan-record',
    domain: manifest.id,
    collection: 'inventory',
    title: 'Plan yogurt',
    properties: { body: 'Greek yogurt', quantity: 2 },
    relations: [],
    source: { provider: 'sqlite', external_id: 'plan-record', url: null, observed_at: at, content_hash: null },
    archived_at: null,
    created_at: at,
    updated_at: at,
    revision: 1,
    schema_version: manifest.schema_version,
    deleted: false,
    privacy: 'personal',
    provenance: null,
    ...patch,
  };
}

describe('planOperation', () => {
  it('plans create with diff, inverse and local verification', () => {
    const plan = planOperation({ manifest, operation: baseOperation(), current: null, now: () => at });
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    expect(plan.after.revision).toBe(1);
    expect(plan.diff.changed_fields).toEqual(['record']);
    expect(plan.inverse.kind).toBe('delete');
    expect(plan.verification).toEqual([{ kind: 'local_canonical', record_id: 'plan-record', expected_revision: 1 }]);
  });

  it('plans update/archive/restore with stable revision semantics', () => {
    const updated = planOperation({
      manifest,
      current: currentRecord(),
      now: () => at,
      operation: baseOperation({ kind: 'update', expected_revision: 1, changes: { quantity: 3 }, record: undefined }),
    });
    expect(updated.status).toBe('planned');
    if (updated.status !== 'planned') return;
    expect(updated.after.revision).toBe(2);
    expect(updated.after.properties.quantity).toBe(3);
    expect(updated.diff.changed_fields).toEqual(['properties.quantity']);

    const archived = planOperation({
      manifest,
      current: updated.after,
      now: () => at,
      operation: baseOperation({ kind: 'archive', expected_revision: 2, record: undefined }),
    });
    expect(archived.status).toBe('planned');
    if (archived.status !== 'planned') return;
    expect(archived.after.archived_at).toBe(at);
    expect(archived.inverse.kind).toBe('restore');

    const restored = planOperation({
      manifest,
      current: archived.after,
      now: () => at,
      operation: baseOperation({ kind: 'restore', expected_revision: 3, record: undefined }),
    });
    expect(restored.status).toBe('planned');
    if (restored.status !== 'planned') return;
    expect(restored.after.archived_at).toBeNull();
    expect(restored.after.revision).toBe(4);
  });

  it('rejects the same preconditions as the storage adapter', () => {
    expect(planOperation({ manifest, operation: baseOperation({ domain: 'health' }), current: null }).status).toBe('rejected');
    expect(planOperation({ manifest, operation: baseOperation(), current: currentRecord() })).toMatchObject({ status: 'rejected', reject_reason: 'record_already_exists' });
    expect(planOperation({ manifest, operation: baseOperation({ kind: 'update', record: undefined }), current: currentRecord() })).toMatchObject({ status: 'rejected', reject_reason: 'expected_revision_required' });
    expect(planOperation({ manifest, operation: baseOperation({ kind: 'update', expected_revision: 0, record: undefined }), current: currentRecord() })).toMatchObject({ status: 'rejected', reject_reason: 'revision_conflict' });
  });

  it('returns duplicate decisions from committed operation evidence', () => {
    const duplicate = planOperation({
      manifest,
      operation: baseOperation(),
      current: null,
      duplicate: { op_id: 'first-op', status: 'applied', after: currentRecord() },
    });
    expect(duplicate).toMatchObject({ status: 'duplicate', op_id: 'first-op' });
  });

  it('marks provider-backed operations as needing provider verification', () => {
    const plan = planOperation({
      manifest,
      current: currentRecord({ source: { provider: 'notion', external_id: 'page-1', url: null, observed_at: at, content_hash: null } }),
      now: () => at,
      operation: baseOperation({ kind: 'update', expected_revision: 1, changes: { quantity: 4 }, record: undefined }),
    });
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    expect(plan.verification).toContainEqual({ kind: 'provider_writeback', provider: 'notion', record_id: 'plan-record' });
  });
});
