import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { executeQuery } from '@/server/src/kernel/query';
import type { QuerySpec } from '@/packages/shared/contracts/query';
import { loadCatalog } from '@/src/domain/catalog';
import { planOperation } from '@/src/ops/plan';
import { applyOperation } from '@/src/ops/apply';
import { undoOperation } from '@/src/ops/undo';
import { MemoryDb } from '../helpers/memory-db';
import { compileQueryToSql } from '@/server/src/kernel/query-sql';
import { runReactiveCycle } from '@/server/src/kernel/reactive-cycle';
import { validateAppPackage } from '@/server/src/kernel/package';
import {
  createReactiveReceiptStore,
  parseReactiveReceiptStore,
  recordReactiveCycle,
  serializeReactiveReceiptStore,
} from '@/server/src/kernel/reactive-receipts';

type BoundaryFixture = {
  querySpec: {
    rows: Record<string, unknown>[];
    reorderedRows: Record<string, unknown>[];
    spec: QuerySpec & { provenance?: string };
    compiled: {
      from: string;
      where: QuerySpec['where'];
      orderBy?: QuerySpec['orderBy'];
      limit?: number;
    };
  };
  apply: {
    recordId: string;
    collection: string;
    create: {
      title: string;
      properties: Record<string, unknown>;
    };
    update: Record<string, unknown>;
  };
  reactive: {
    package: Record<string, unknown>;
    eventId: string;
    causeId: string;
    beforeRows: Array<Record<string, unknown>>;
    afterRows: Array<Record<string, unknown>>;
  };
  reactiveV3: {
    package: Record<string, unknown>;
    eventId: string;
    causeId: string;
    beforeRows: Array<Record<string, unknown>>;
    afterRows: Array<Record<string, unknown>>;
  };
};

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'w1-kernel-boundary-fixtures.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as BoundaryFixture;
const manifest = loadCatalog().activeManifest;
const now = '2026-07-24T00:00:00.000Z';

function baseRecord(overrides: { properties?: Record<string, unknown> } = {}) {
  return {
    title: fixture.apply.create.title,
    properties: {
      ...fixture.apply.create.properties,
      ...overrides.properties,
    },
    relations: [],
    source: {
      provider: 'sqlite' as const,
      external_id: fixture.apply.recordId,
      url: null,
      observed_at: now,
      content_hash: null,
    },
    archived_at: null,
  };
}

describe('W1-KERNEL kernel contracts', () => {
  it('freezes QuerySpec and query SQL boundary semantics', () => {
    const unordered = executeQuery(fixture.querySpec.rows as Array<Record<string, unknown>>, fixture.querySpec.spec);
    const ordered = executeQuery(fixture.querySpec.reorderedRows as Array<Record<string, unknown>>, fixture.querySpec.spec);

    expect(unordered.resultHash).toBe(ordered.resultHash);
    expect(unordered.total).toBe(3);
    expect(unordered.rows).toEqual([
      {
        id: 'meal-2',
        collection: 'inventory',
        'properties.status': 'open',
        'properties.score': 4,
      },
      {
        id: 'meal-3',
        collection: 'inventory',
        'properties.status': 'open',
        'properties.score': 4,
      },
      {
        id: 'dinner-1',
        collection: 'notes',
        'properties.status': 'open',
        'properties.score': 2,
      },
    ]);
    expect(unordered.provenance).toBe(fixture.querySpec.spec.provenance);

    const compiled = compileQueryToSql(fixture.querySpec.compiled);
    expect(compiled.sql).toBe(
      'SELECT * FROM "records" WHERE json_extract("properties", \'$.status\') = ? ORDER BY json_extract("properties", \'$.score\') DESC, "id" ASC LIMIT 2',
    );
    expect(compiled.params).toEqual(['open']);
  });

  it('freezes planOperation and applyOperation revision sequencing plus idempotent replay', async () => {
    const db = new MemoryDb() as any;
    const create = await applyOperation(db, manifest, {
      op_id: 'kernel-contract-create',
      kind: 'create',
      domain: manifest.id,
      collection: fixture.apply.collection,
      record_id: fixture.apply.recordId,
      record: baseRecord(),
      actor: 'user',
      origin: 'manual',
    });
    expect(create.status).toBe('applied');
    expect(create.record?.revision).toBe(1);

    const plannedUpdate = planOperation({
      manifest,
      current: create.record!,
      operation: {
        op_id: 'kernel-contract-plan-update',
        kind: 'update',
        domain: manifest.id,
        collection: fixture.apply.collection,
        record_id: fixture.apply.recordId,
        changes: fixture.apply.update,
        actor: 'user',
        origin: 'manual',
        expected_revision: create.record!.revision,
        idempotency_key: 'kernel-plan-update-idem',
      },
    });
    expect(plannedUpdate.status).toBe('planned');
    expect(plannedUpdate.status === 'planned' ? plannedUpdate.after.revision : 0).toBe(2);
    expect(plannedUpdate.status === 'planned' ? plannedUpdate.diff.changed_fields : []).toContain('properties.status');
    expect(plannedUpdate.status === 'planned' ? plannedUpdate.verification : []).toEqual([
      { kind: 'local_canonical', record_id: fixture.apply.recordId, expected_revision: 2 },
    ]);

    const update = await applyOperation(db, manifest, {
      op_id: 'kernel-contract-update',
      kind: 'update',
      domain: manifest.id,
      collection: fixture.apply.collection,
      record_id: fixture.apply.recordId,
      expected_revision: 1,
      changes: fixture.apply.update,
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'kernel-contract-update-idem',
    });
    expect(update.status).toBe('applied');
    expect(update.record?.revision).toBe(2);

    const archive = await applyOperation(db, manifest, {
      op_id: 'kernel-contract-archive',
      kind: 'archive',
      domain: manifest.id,
      collection: fixture.apply.collection,
      record_id: fixture.apply.recordId,
      expected_revision: 2,
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'kernel-contract-archive-idem',
    });
    expect(archive.status).toBe('applied');
    expect(archive.record?.revision).toBe(3);
    expect(Boolean(archive.record?.archived_at)).toBe(true);

    const archiveReplay = await applyOperation(db, manifest, {
      op_id: 'kernel-contract-archive-replay',
      kind: 'archive',
      domain: manifest.id,
      collection: fixture.apply.collection,
      record_id: fixture.apply.recordId,
      expected_revision: 2,
      actor: 'user',
      origin: 'manual',
      idempotency_key: 'kernel-contract-archive-idem',
    });
    expect(archiveReplay.status).toBe('duplicate');
    expect(archiveReplay.op_id).toBe('kernel-contract-archive');

    const restore = await applyOperation(db, manifest, {
      op_id: 'kernel-contract-restore',
      kind: 'restore',
      domain: manifest.id,
      collection: fixture.apply.collection,
      record_id: fixture.apply.recordId,
      expected_revision: 3,
      actor: 'user',
      origin: 'manual',
    });
    expect(restore.status).toBe('applied');
    expect(restore.record?.archived_at).toBeNull();

    const undo = await undoOperation(db, manifest, 'kernel-contract-restore');
    expect(undo.status).toBe('applied');
    expect(Boolean(db.records.get(fixture.apply.recordId)?.archived_at)).toBe(true);

    const duplicateUndo = await undoOperation(db, manifest, 'kernel-contract-restore');
    expect(duplicateUndo.status).toBe('duplicate');
  });

  it('freezes proposal idempotency, target revision, and version vector receipts', () => {
    const first = runReactiveCycle({
      package: fixture.reactive.package as never,
      beforeRows: fixture.reactive.beforeRows,
      afterRows: fixture.reactive.afterRows,
      event: { kind: 'operation', id: fixture.reactive.eventId },
      causeId: fixture.reactive.causeId,
    });

    expect(first.transitions.length).toBe(1);
    expect(first.proposals).toHaveLength(1);
    const proposal = first.proposals[0];
    expect(proposal.id).toMatch(/^reactive:[a-f0-9]{8}$/);
    expect(proposal.envelope.review.reason).toBe('policy_required');
    expect(proposal.envelope.evidence.targetRecordId).toBe('decision-kernel');
    expect(proposal.envelope.evidence.targetBeforeRevision).toBe(1);
    expect(proposal.envelope.evidence.targetAfterRevision).toBe(2);
    expect(proposal.envelope.evidence.beforeVersionVectorHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(proposal.envelope.evidence.afterVersionVectorHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const replay = runReactiveCycle({
      package: fixture.reactive.package as never,
      beforeRows: fixture.reactive.beforeRows,
      afterRows: fixture.reactive.afterRows,
      event: { kind: 'operation', id: fixture.reactive.eventId },
      causeId: fixture.reactive.causeId,
    });
    expect(replay.proposals[0]!.id).toBe(proposal.id);
    expect(replay.proposals[0]!.envelope.idempotencyKey).toBe(proposal.envelope.idempotencyKey);

    const withReceipt = createReactiveReceiptStore();
    const firstRecord = recordReactiveCycle(withReceipt, {
      cycleId: first.cycleId,
      proposals: first.proposals.map((entry) => ({ id: entry.id })),
    });
    expect(firstRecord.isNewCycle).toBe(true);
    expect(firstRecord.newProposalIds).toEqual([proposal.id]);

    const parsed = parseReactiveReceiptStore(serializeReactiveReceiptStore(firstRecord.store));
    expect(parsed).toEqual(firstRecord.store);

    const replayRecord = recordReactiveCycle(firstRecord.store, {
      cycleId: first.cycleId,
      proposals: first.proposals.map((entry) => ({ id: entry.id })),
    });
    expect(replayRecord.isNewCycle).toBe(false);
    expect(replayRecord.newProposalIds).toHaveLength(0);
    expect(replayRecord.duplicateProposalIds).toEqual([proposal.id]);
  });

  it('accepts AppPackage v3 contract lock contracts', () => {
    const validation = validateAppPackage(fixture.reactiveV3.package);
    expect(validation.valid).toBe(true);

    const packageV3 = fixture.reactiveV3.package as {
      dependencyPins: Array<{ package: string; version: string; source?: string }>;
      nativeCapabilities: { schemaVersion: string; platform: string; packages: string[] };
      contractLock: {
        schemaVersion: string;
        algorithm: string;
        checksum: string;
        pinnedAt: string;
        dependencyPins: Array<{ package: string; version: string; source?: string }>;
        nativeCapabilities: { schemaVersion: string; platform: string; packages: string[] };
      };
    };
    expect(packageV3.contractLock.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);

    const expectedChecksum = `sha256:${createHash('sha256').update(stableJson({
      schemaVersion: packageV3.contractLock.schemaVersion,
      algorithm: packageV3.contractLock.algorithm,
      pinnedAt: packageV3.contractLock.pinnedAt,
      dependencyPins: packageV3.dependencyPins,
      nativeCapabilities: packageV3.nativeCapabilities,
    })).digest('hex')}`;
    expect(packageV3.contractLock.checksum).toBe(expectedChecksum);

    const seenPins = new Set(packageV3.dependencyPins.map((pin) => `${pin.package}@${pin.version}`));
    const contractPins = new Set(packageV3.contractLock.dependencyPins.map((pin) => `${pin.package}@${pin.version}`));
    expect(seenPins).toEqual(contractPins);

    const cycle = runReactiveCycle({
      package: fixture.reactiveV3.package as never,
      beforeRows: fixture.reactiveV3.beforeRows,
      afterRows: fixture.reactiveV3.afterRows,
      event: { kind: 'operation', id: fixture.reactiveV3.eventId },
      causeId: fixture.reactiveV3.causeId,
    });
    expect(cycle.transitions.length).toBe(1);
    expect(cycle.proposals).toHaveLength(1);
  });
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
