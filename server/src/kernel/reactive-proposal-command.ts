import type { OperationTemplate } from '@/packages/shared/contracts/package';

export type ReactiveProposalCommandPreview = Readonly<
  | {
      ok: true;
      tool: 'utopia.create_record' | 'utopia.update_record' | 'utopia.archive_record';
      args: Readonly<Record<string, unknown>>;
      recordIds: readonly string[];
    }
  | {
      ok: false;
      reason: 'custom_operation_requires_review' | 'restore_requires_review' | 'unsupported_operation_template';
      recordIds: readonly string[];
    }
>;

export function previewReactiveProposalCommand(input: {
  operationTemplate: OperationTemplate;
  domain: string;
  idempotencyKey: string;
  actionId: string;
  actor: string;
}): ReactiveProposalCommandPreview {
  if (input.operationTemplate.kind === 'custom') {
    return { ok: false, reason: 'custom_operation_requires_review', recordIds: [] };
  }
  const domain = input.operationTemplate.domain ?? input.domain;
  if (input.operationTemplate.kind === 'create_record') {
    const recordId = input.operationTemplate.recordId ?? input.actionId;
    return {
      ok: true,
      tool: 'utopia.create_record',
      args: {
        actor: input.actor,
        domain,
        collection: input.operationTemplate.collection,
        id: recordId,
        properties: input.operationTemplate.properties ?? {},
        idempotency_key: input.idempotencyKey,
        action_id: input.actionId,
        data_home: 'local_sqlite',
      },
      recordIds: [recordId],
    };
  }
  if (input.operationTemplate.kind === 'update_record') {
    return {
      ok: true,
      tool: 'utopia.update_record',
      args: {
        actor: input.actor,
        domain,
        id: input.operationTemplate.recordId,
        patch: input.operationTemplate.changes,
        ...(input.operationTemplate.expectedRevision !== undefined ? { expected_revision: input.operationTemplate.expectedRevision } : {}),
        idempotency_key: input.idempotencyKey,
        action_id: input.actionId,
        data_home: 'local_sqlite',
      },
      recordIds: [input.operationTemplate.recordId],
    };
  }
  if (input.operationTemplate.kind === 'archive_record') {
    return {
      ok: true,
      tool: 'utopia.archive_record',
      args: {
        actor: input.actor,
        domain,
        id: input.operationTemplate.recordId,
        ...(input.operationTemplate.expectedRevision !== undefined ? { expected_revision: input.operationTemplate.expectedRevision } : {}),
        idempotency_key: input.idempotencyKey,
        action_id: input.actionId,
        data_home: 'local_sqlite',
      },
      recordIds: [input.operationTemplate.recordId],
    };
  }
  if (input.operationTemplate.kind === 'restore_record') {
    return { ok: false, reason: 'restore_requires_review', recordIds: [input.operationTemplate.recordId] };
  }
  return { ok: false, reason: 'unsupported_operation_template', recordIds: [] };
}
