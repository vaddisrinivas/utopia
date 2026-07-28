import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import type { Operation } from '@/src/ops/operation';

export function computeInverse(before: CanonicalRecord | null, op: Operation, after: CanonicalRecord): Operation {
  const base = {
    op_id: `${op.op_id}:undo`,
    domain: op.domain,
    collection: op.collection,
    record_id: op.record_id,
    expected_revision: after.revision,
    actor: op.actor,
    origin: op.origin,
    idempotency_key: op.idempotency_key ? `${op.idempotency_key}:undo` : undefined,
    confidence: op.confidence ?? null,
    evidence: op.evidence ?? [],
    reason: `Undo ${op.op_id}`,
  } satisfies Omit<Operation, 'kind'>;

  if (op.kind === 'create') return { ...base, kind: 'delete' };
  if (op.kind === 'archive' || op.kind === 'delete') return { ...base, kind: 'restore' };
  if (op.kind === 'relate') return { ...base, kind: 'unrelate', relations_remove: op.relations_add };
  if (op.kind === 'unrelate') return { ...base, kind: 'relate', relations_add: op.relations_remove };

  return {
    ...base,
    kind: 'update',
    changes: before?.properties ?? {},
    record: before ? {
      title: before.title,
      properties: before.properties,
      source: before.source,
      archived_at: before.archived_at,
      deleted: before.deleted,
      privacy: before.privacy,
      relations: before.relations,
    } : undefined,
  };
}
