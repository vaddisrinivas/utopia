import { afterEach, describe, expect, it } from 'vitest';

import type { AppPackage } from '@/packages/shared/contracts/package';
import {
  activateAppPackage,
  bootstrapAppPackageRegistry,
  getActiveAppPackage,
  rollbackAppPackage,
} from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import { getRecord } from '@/src/db/records';
import { loadAppPackage } from '@/src/domain/package-loader';
import { applyOperation } from '@/src/ops/apply';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

describe('app package activation', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) {
      db.close();
    }
  });

  it('preserves bundled bootstrap', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);

    await runMigrations(db as any);
    const active = await bootstrapAppPackageRegistry(db as any);

    expect(active.id).toBe('food');
    expect(active.version).toMatch(/^1\.0\.0\+bundle\./);
  });

  it('activates reference packages, preserves previous key, and keeps records through rollback', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);

    await runMigrations(db as any);

    const referenceV1 = makeReferencePackage('1.0.0');
    const referenceV2 = makeReferencePackage('1.1.0');
    const runtimeV1 = loadAppPackage(referenceV1);

    await activateAppPackage(db as any, referenceV1);
    const create = await applyOperation(db as any, runtimeV1.activeManifest, {
      op_id: 'reference-create-chore-1',
      kind: 'create',
      domain: 'reference-app',
      collection: 'chore',
      record_id: 'reference-chore-1',
      record: {
        title: 'Wash dishes',
        properties: { status: 'todo' },
        relations: [],
        source: {
          provider: 'sqlite',
          external_id: 'reference-chore-1',
          url: null,
          observed_at: '2026-07-27T00:00:00.000Z',
          content_hash: null,
        },
        archived_at: null,
      },
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'reference-create-chore-1',
    });
    expect(create.status).toBe('applied');

    await activateAppPackage(db as any, referenceV2);
    const stateAfterUpgrade = await db.getFirstAsync<{ active_package_key: string; previous_package_key: string | null }>(
      `SELECT active_package_key, previous_package_key FROM app_package_state WHERE id = 'default'`,
    );
    expect(stateAfterUpgrade).toEqual({
      active_package_key: 'reference-app@1.1.0',
      previous_package_key: 'reference-app@1.0.0',
    });

    const rolledBack = await rollbackAppPackage(db as any);
    const activeAfterRollback = await getActiveAppPackage(db as any);
    const record = await getRecord(db as any, 'reference-chore-1');

    expect(rolledBack?.version).toBe('1.0.0');
    expect(activeAfterRollback?.version).toBe('1.0.0');
    expect(record).toMatchObject({
      id: 'reference-chore-1',
      domain: 'reference-app',
      collection: 'chore',
      title: 'Wash dishes',
    });
  });

  it('leaves the previous package active when activation is invalid', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);

    await runMigrations(db as any);
    await activateAppPackage(db as any, makeReferencePackage('1.0.0'));

    await expect(activateAppPackage(db as any, { schemaVersion: 'wonder.app-package.v2' } as any)).rejects.toThrow(/app_package_invalid/);
    expect((await getActiveAppPackage(db as any))?.version).toBe('1.0.0');
  });
});

function makeReferencePackage(version: string): AppPackage {
  const choreFields: AppPackage['collections'][string]['fields'] = {
    id: { type: 'text', required: true, indexed: true },
    title: { type: 'text', required: true, indexed: true },
    collection: { type: 'text', required: true, indexed: true },
    updated_at: { type: 'timestamp', required: true, indexed: true },
    properties: { type: 'json', required: true },
    status: { type: 'text' },
    ...(version === '1.1.0' ? { estimated_minutes: { type: 'number' as const } } : {}),
  };

  return {
    schemaVersion: 'wonder.app-package.v2',
    id: 'reference-app',
    version,
    collections: {
      chore: { id: 'chore', fields: choreFields },
      assignment: {
        id: 'assignment',
        fields: {
          id: { type: 'text', required: true, indexed: true },
          title: { type: 'text', required: true, indexed: true },
          collection: { type: 'text', required: true, indexed: true },
          updated_at: { type: 'timestamp', required: true, indexed: true },
          properties: { type: 'json', required: true },
          assignee: { type: 'text' },
        },
      },
      household_member: {
        id: 'household_member',
        fields: {
          id: { type: 'text', required: true, indexed: true },
          title: { type: 'text', required: true, indexed: true },
          collection: { type: 'text', required: true, indexed: true },
          updated_at: { type: 'timestamp', required: true, indexed: true },
          properties: { type: 'json', required: true },
          role: { type: 'text' },
        },
      },
      completion: {
        id: 'completion',
        fields: {
          id: { type: 'text', required: true, indexed: true },
          title: { type: 'text', required: true, indexed: true },
          collection: { type: 'text', required: true, indexed: true },
          updated_at: { type: 'timestamp', required: true, indexed: true },
          properties: { type: 'json', required: true },
          completed_at: { type: 'timestamp' },
        },
      },
    },
    queries: {
      today: { from: 'records', where: { op: 'eq', field: 'collection', value: 'assignment' } },
      chores: { from: 'records', where: { op: 'eq', field: 'collection', value: 'chore' } },
      household: { from: 'records', where: { op: 'eq', field: 'collection', value: 'household_member' } },
    },
    views: {
      today: { id: 'today', query: 'today', mode: 'list', fields: ['title', 'updated_at'] },
      chores: { id: 'chores', query: 'chores', mode: 'list', fields: ['title', 'updated_at'] },
      household: { id: 'household', query: 'household', mode: 'list', fields: ['title', 'updated_at'] },
    },
    presentation: {
      label: 'Reference App',
      homeSurface: 'today',
      surfaces: [
        { id: 'today', label: 'Today', collections: ['assignment'], views: ['today'] },
        { id: 'chores', label: 'Chores', collections: ['chore'], views: ['chores'] },
        { id: 'household', label: 'Household', collections: ['household_member'], views: ['household'] },
      ],
    },
    rules: [],
    capabilities: [],
    acceptanceTests: ['reference-package-activation'],
  };
}
