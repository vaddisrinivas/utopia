import type { DomainManifest } from '@/src/domain/catalog';
import type { CanonicalProvenance, CanonicalRecord, CanonicalRelation } from '@/packages/shared/contracts/records';
import { validateCanonicalRecord } from '@/src/domain/runtime';
import { computeInverse } from '@/src/ops/inverse';
import type { Operation, OperationDiff } from '@/src/ops/operation';

export type DuplicateOperationEvidence = {
  op_id: string;
  after: CanonicalRecord | null;
  status: string;
};

export type OperationVerificationRequirement =
  | { kind: 'local_canonical'; record_id: string; expected_revision: number }
  | { kind: 'provider_writeback'; provider: string; record_id: string };

export type OperationPlan =
  | { status: 'duplicate'; op_id: string; record?: CanonicalRecord }
  | { status: 'rejected'; op_id: string; reject_reason: string; before: CanonicalRecord | null }
  | {
      status: 'planned';
      op_id: string;
      before: CanonicalRecord | null;
      after: CanonicalRecord;
      inverse: Operation;
      diff: OperationDiff;
      verification: OperationVerificationRequirement[];
    };

export function planOperation(input: {
  manifest: DomainManifest;
  operation: Operation;
  current: CanonicalRecord | null;
  duplicate?: DuplicateOperationEvidence | null;
  now?: () => string;
}): OperationPlan {
  const op = input.operation;
  if (input.duplicate && (input.duplicate.status === 'applied' || input.duplicate.status === 'undone')) {
    return {
      status: 'duplicate',
      op_id: input.duplicate.op_id,
      ...(input.duplicate.after ? { record: input.duplicate.after } : {}),
    };
  }
  if (op.domain !== input.manifest.id) {
    return reject(op, input.current, `domain_scope_rejected:${op.domain}`);
  }
  if (input.current && op.kind === 'create') {
    return reject(op, input.current, 'record_already_exists');
  }
  if (input.current && op.kind !== 'create' && op.expected_revision == null) {
    return reject(op, input.current, 'expected_revision_required');
  }
  if (input.current && op.expected_revision != null && op.expected_revision !== input.current.revision) {
    return reject(op, input.current, 'revision_conflict');
  }

  let after: CanonicalRecord;
  try {
    after = buildPlannedRecord(input.manifest, op, input.current, input.now ?? (() => new Date().toISOString()));
  } catch (error) {
    return reject(op, input.current, error instanceof Error ? error.message : 'validation_failed');
  }
  const inverse = computeInverse(input.current, op, after);
  const diff = diffRecords(input.current, after);
  return {
    status: 'planned',
    op_id: op.op_id,
    before: input.current,
    after,
    inverse,
    diff,
    verification: verificationRequirements(op, after),
  };
}

function reject(op: Operation, before: CanonicalRecord | null, rejectReason: string): OperationPlan {
  return { status: 'rejected', op_id: op.op_id, before, reject_reason: rejectReason };
}

function mergePatch(base: Record<string, unknown>, patch: Record<string, unknown> | undefined) {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

function mergeRelations(current: CanonicalRelation[], op: Operation) {
  const byKey = new Map(current.map((relation) => [`${relation.name}:${relation.target_id}`, relation]));
  for (const relation of op.relations_remove ?? []) {
    byKey.delete(`${relation.name}:${relation.target_id}`);
  }
  for (const relation of op.relations_add ?? []) {
    byKey.set(`${relation.name}:${relation.target_id}`, relation);
  }
  return Array.from(byKey.values());
}

function provenanceFor(op: Operation): CanonicalProvenance {
  return {
    actor: op.actor,
    confidence: typeof op.confidence === 'number' ? op.confidence : null,
    evidence: op.evidence ?? [],
    reason: op.reason ?? null,
  };
}

function buildPlannedRecord(manifest: DomainManifest, op: Operation, current: CanonicalRecord | null, now: () => string): CanonicalRecord {
  const at = now();
  const base = current ?? {
    id: op.record_id,
    domain: manifest.id,
    collection: op.collection,
    title: String(op.record?.title ?? op.changes?.title ?? 'Untitled'),
    properties: {},
    relations: [],
    source: op.record?.source ?? {
      provider: 'sqlite' as const,
      external_id: op.record_id,
      url: null,
      observed_at: at,
      content_hash: null,
    },
    archived_at: null,
    created_at: at,
    updated_at: at,
    revision: 0,
    schema_version: manifest.schema_version ?? '1.0.0',
    deleted: false,
    privacy: 'personal' as const,
    provenance: null,
  };
  const recordPatch = op.record ?? {};
  const properties = recordPatch.properties && typeof recordPatch.properties === 'object' && !Array.isArray(recordPatch.properties)
    ? recordPatch.properties as Record<string, unknown>
    : mergePatch(base.properties, op.changes);
  const archivedAt = op.kind === 'archive' || op.kind === 'delete'
    ? (typeof recordPatch.archived_at === 'string' ? recordPatch.archived_at : at)
    : op.kind === 'restore'
      ? null
      : recordPatch.archived_at !== undefined
        ? recordPatch.archived_at ?? null
        : base.archived_at;
  return validateCanonicalRecord({
    ...base,
    ...recordPatch,
    id: op.record_id,
    domain: manifest.id,
    collection: op.collection,
    title: String(recordPatch.title ?? properties.title ?? base.title),
    properties,
    relations: mergeRelations(Array.isArray(recordPatch.relations) ? recordPatch.relations : base.relations, op),
    source: recordPatch.source ?? base.source,
    archived_at: archivedAt,
    deleted: op.kind === 'delete' ? true : op.kind === 'restore' ? false : recordPatch.deleted ?? base.deleted,
    privacy: recordPatch.privacy ?? base.privacy,
    provenance: provenanceFor(op),
    revision: base.revision + 1,
    schema_version: recordPatch.schema_version ?? base.schema_version ?? manifest.schema_version ?? '1.0.0',
    created_at: base.created_at || at,
    updated_at: at,
  }, manifest.id, manifest, 'operation');
}

function stable(value: unknown) {
  return JSON.stringify(value ?? null);
}

function diffRecords(before: CanonicalRecord | null, after: CanonicalRecord): OperationDiff {
  const changed = new Set<string>();
  if (!before) {
    changed.add('record');
  } else {
    if (before.title !== after.title) changed.add('title');
    if (before.archived_at !== after.archived_at) changed.add('archived_at');
    if (before.deleted !== after.deleted) changed.add('deleted');
    if (before.privacy !== after.privacy) changed.add('privacy');
    if (stable(before.relations) !== stable(after.relations)) changed.add('relations');
    const propertyKeys = new Set([...Object.keys(before.properties), ...Object.keys(after.properties)]);
    for (const key of propertyKeys) {
      if (stable(before.properties[key]) !== stable(after.properties[key])) changed.add(`properties.${key}`);
    }
  }
  return { before, after, changed_fields: Array.from(changed).sort() };
}

function verificationRequirements(op: Operation, after: CanonicalRecord): OperationVerificationRequirement[] {
  const requirements: OperationVerificationRequirement[] = [
    { kind: 'local_canonical', record_id: after.id, expected_revision: after.revision },
  ];
  if (after.source.provider !== 'sqlite' && after.source.provider !== 'user') {
    requirements.push({ kind: 'provider_writeback', provider: after.source.provider, record_id: after.id });
  }
  if (op.record?.source && op.record.source.provider !== 'sqlite' && op.record.source.provider !== 'user') {
    requirements.push({ kind: 'provider_writeback', provider: op.record.source.provider, record_id: after.id });
  }
  return requirements.filter((requirement, index, all) =>
    all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(requirement)) === index
  );
}
