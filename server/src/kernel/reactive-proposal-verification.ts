import type { OperationTemplate } from '@/packages/shared/contracts/package';
import type { McpRecord } from '../runtime/state';
import type { ReactiveProposalVerificationReceipt, ReactiveProviderWritebackReceipt } from '@/packages/shared/contracts/receipts';

export function verifyReactiveProposalPostcondition(input: {
  operationTemplate: OperationTemplate;
  record: McpRecord | null | undefined;
  beforeRevision?: number;
  actionId: string;
  operationId: string;
  proposalId: string;
  operationTemplateHash: string;
  providerWriteback?: ReactiveProviderWritebackReceipt;
}): ReactiveProposalVerificationReceipt {
  const template = input.operationTemplate;
  const identity = {
    actionId: input.actionId,
    operationId: input.operationId,
    proposalId: input.proposalId,
    operationTemplateHash: input.operationTemplateHash,
  };
  if (template.kind === 'custom') {
    return receipt(identity, false, null, {}, null, 'custom_operation_has_no_canonical_postcondition', input.providerWriteback);
  }
  if (template.kind === 'restore_record') {
    return receipt(identity, false, template.recordId, {}, observedRecord(input.record), 'restore_postcondition_requires_undo_context', input.providerWriteback);
  }
  if (template.kind === 'create_record') {
    const record = input.record;
    const recordId = template.recordId ?? input.record?.id ?? null;
    const expected = {
      exists: true,
      collection: template.collection,
      properties: template.properties ?? {},
    };
    const observed = observedRecord(record);
    if (!record) {
      return receipt(identity, false, recordId, expected, observed, 'canonical_create_mismatch', input.providerWriteback);
    }
    const ok = record.collection === template.collection && hasProperties(record.properties, template.properties ?? {});
    return receipt(identity, ok && providerOk(input.providerWriteback), recordId, expected, observed, ok ? providerReason(input.providerWriteback, 'canonical_create_verified') : 'canonical_create_mismatch', input.providerWriteback);
  }
  if (template.kind === 'update_record') {
    const observed = observedRecord(input.record);
    const expected = {
      exists: true,
      properties: template.changes,
      revisionAfter: input.beforeRevision === undefined ? undefined : input.beforeRevision + 1,
    };
    const ok = Boolean(input.record)
      && hasProperties(input.record?.properties ?? {}, template.changes)
      && (input.beforeRevision === undefined || input.record?.revision === input.beforeRevision + 1);
    return receipt(identity, ok && providerOk(input.providerWriteback), template.recordId, expected, observed, ok ? providerReason(input.providerWriteback, 'canonical_update_verified') : 'canonical_update_mismatch', input.providerWriteback);
  }
  const observed = observedRecord(input.record);
  const expected = {
    archived: true,
    revisionAfter: input.beforeRevision === undefined ? undefined : input.beforeRevision + 1,
  };
  const ok = Boolean(input.record?.archived_at)
    && (input.beforeRevision === undefined || input.record?.revision === input.beforeRevision + 1);
  return receipt(identity, ok && providerOk(input.providerWriteback), template.recordId, expected, observed, ok ? providerReason(input.providerWriteback, 'canonical_archive_verified') : 'canonical_archive_mismatch', input.providerWriteback);
}

function providerOk(receipt: ReactiveProviderWritebackReceipt | undefined): boolean {
  return receipt === undefined || receipt.ok;
}

function providerReason(receipt: ReactiveProviderWritebackReceipt | undefined, localReason: string): string {
  if (!receipt) return localReason;
  return receipt.ok ? `${localReason}+provider_writeback_verified` : receipt.reason;
}

function hasProperties(observed: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => deepEqual(observed[key], value));
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
    const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
}

function observedRecord(record: McpRecord | null | undefined): Record<string, unknown> | null {
  if (!record) return null;
  return {
    id: record.id,
    collection: record.collection,
    archived: Boolean(record.archived_at),
    revision: record.revision ?? null,
    properties: record.properties,
  };
}

function receipt(
  identity: {
    actionId: string;
    operationId: string;
    proposalId: string;
    operationTemplateHash: string;
  },
  ok: boolean,
  recordId: string | null,
  expected: Record<string, unknown>,
  observed: Record<string, unknown> | null,
  reason: string,
  providerWriteback?: ReactiveProviderWritebackReceipt,
): ReactiveProposalVerificationReceipt {
  return {
    ok,
    verifierVersion: 'wonder.reactive-proposal-verifier.v1',
    ...identity,
    recordId,
    expected,
    observed,
    resultingRevision: typeof observed?.revision === 'number' ? observed.revision : null,
    ...(providerWriteback ? { providerWriteback } : {}),
    reason,
  };
}
