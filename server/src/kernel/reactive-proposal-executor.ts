import {
  archiveRecordWithAction,
  attachActionVerification,
  createActionEvent,
  createRecordWithAction,
  findActionByIdempotencyKey,
  findRecord,
  updateRecordWithAction,
} from '../runtime/state';
import type { RecordSource } from '../runtime/state';
import { writeNotionRecord } from '../providers/notion/push';
import { pullNotionRecordsLive } from '../providers/notion/pull';
import { writeSheetsRecord } from '../providers/sheets/push';
import { pullSheetsRecordsLive } from '../providers/sheets/pull';
import { previewReactiveProposalCommand } from './reactive-proposal-command';
import type {
  ReactiveProposalApprovalReceipt,
  ReactiveProposalExecutionReceipt,
  ReactiveProviderWritebackReceipt,
  ReactiveProposalVerificationReceipt,
} from '@/packages/shared/contracts/receipts';
import { verifyReactiveProposalPostcondition } from './reactive-proposal-verification';
import type { ReactiveOutboxExecutionResult, ReactiveOutboxItem } from './reactive-outbox';
import { sha256Canonical } from '@/src/domain/canonical-json';

export type ReactiveProposalExecutionResult = ReactiveOutboxExecutionResult & Readonly<{
  receipt?: ReactiveProposalExecutionReceipt;
}>;

export function executeReactiveProposal(
  item: ReactiveOutboxItem,
  input: { actor?: string; approval?: ReactiveProposalApprovalReceipt } = {},
): ReactiveProposalExecutionResult {
  return executeReactiveProposalInternal(item, input) as ReactiveProposalExecutionResult;
}

export async function executeReactiveProposalLive(
  item: ReactiveOutboxItem,
  input: { actor?: string; approval?: ReactiveProposalApprovalReceipt } = {},
): Promise<ReactiveProposalExecutionResult> {
  return executeReactiveProposalInternal(item, input, executeProviderWriteback);
}

export async function executeReactiveProposalWithProviderWriteback(
  item: ReactiveOutboxItem,
  input: {
    actor?: string;
    approval?: ReactiveProposalApprovalReceipt;
    providerWriteback: ReactiveProviderWritebackVerifier;
  },
): Promise<ReactiveProposalExecutionResult> {
  return executeReactiveProposalInternal(item, input, input.providerWriteback);
}

function executeReactiveProposalInternal(
  item: ReactiveOutboxItem,
  input: { actor?: string; approval?: ReactiveProposalApprovalReceipt } = {},
  providerWriteback?: ReactiveProviderWritebackVerifier,
): ReactiveProposalExecutionResult | Promise<ReactiveProposalExecutionResult> {
  const envelope = item.proposal.envelope;
  const actor = input.actor?.trim() || 'reactive-runtime';
  const actionId = `reactive-proposal:${item.proposalId.replace(/[^A-Za-z0-9_.:-]/g, '_')}`;
  if (envelope.schemaVersion !== 'wonder.operation-proposal.v1') return { ok: false, error: 'proposal_envelope_invalid' };
  if (envelope.proposalId !== item.proposalId || envelope.operation !== item.proposal.operation) return { ok: false, error: 'proposal_envelope_mismatch' };
  if (!envelope.authorization.allowed || !envelope.dryRun.ok) return { ok: false, error: 'proposal_policy_blocked' };

  const commandPreview = previewReactiveProposalCommand({
    operationTemplate: envelope.operationTemplate,
    domain: item.domain,
    idempotencyKey: envelope.idempotencyKey,
    actionId,
    actor,
  });

  const existing = findActionByIdempotencyKey(envelope.idempotencyKey);
  if (existing?.status === 'completed') {
    const verification = isVerificationReceipt(existing.verification_json) ? existing.verification_json : undefined;
    if (!verification) {
      return { ok: false, error: 'proposal_verification_receipt_missing' };
    }
    if (!isVerificationBoundToProposal(verification, item, existing.operation_id)) {
      return { ok: false, error: 'proposal_verification_receipt_mismatch' };
    }
    return { ok: true, receipt: { actionId: existing.id, idempotencyKey: envelope.idempotencyKey, replayed: true, status: existing.status, verification } };
  }

  const approval = input.approval ? validateApproval(input.approval, item, actor) : { ok: false as const, error: 'proposal_approval_required' };
  if (input.approval && !approval.ok) return { ok: false, error: approval.error };

  if (!commandPreview.ok || (envelope.review.required && !approval.ok)) {
    const action = queueProposalAction({ item, actionId, actor, commandPreview });
    return { ok: true, receipt: { actionId: action.id, idempotencyKey: envelope.idempotencyKey, replayed: false, status: action.status } };
  }

  const targetProvider = envelope.authorization.providerAuthority.targetProvider;
  if (!isLocalWriteProvider(targetProvider)) {
    if (!providerWriteback) return { ok: false, error: 'provider_writeback_verification_missing' };
    return providerWriteback({
      item,
      actionId,
      actor,
      commandPreview,
      approval: input.approval,
      provider: targetProvider,
    }).then((providerResult) => {
      if (!providerResult.ok) return { ok: false, error: providerResult.error };
      const write = executeApprovedCommand({
        item,
        actionId,
        actor,
        commandPreview,
        approval: input.approval,
        source: providerResult.source,
        providerWriteback: providerResult.receipt,
      });
      return finalizeApprovedWrite(item, envelope.idempotencyKey, write);
    });
  }

  const write = executeApprovedCommand({ item, actionId, actor, commandPreview, approval: input.approval });
  return finalizeApprovedWrite(item, envelope.idempotencyKey, write);
}

function finalizeApprovedWrite(
  item: ReactiveOutboxItem,
  idempotencyKey: string,
  write: ReturnType<typeof createRecordWithAction> & { verification?: ReactiveProposalVerificationReceipt },
): ReactiveProposalExecutionResult {
  if (!write.verification?.ok) return { ok: false, error: write.verification?.reason ?? 'proposal_verification_failed' };
  if (write.action.status !== 'completed') return { ok: false, error: write.action.command || 'proposal_execution_failed' };
  const verifiedAction = attachActionVerification(write.action.id, write.verification) ?? write.action;
  return {
    ok: true,
    receipt: {
      actionId: verifiedAction.id,
      idempotencyKey,
      replayed: write.replayed,
      status: verifiedAction.status,
      verification: write.verification,
    },
  };
}

function queueProposalAction(input: {
  item: ReactiveOutboxItem;
  actionId: string;
  actor: string;
  commandPreview: ReturnType<typeof previewReactiveProposalCommand>;
}) {
  const envelope = input.item.proposal.envelope;
  return createActionEvent({
    id: input.actionId,
    actor: input.actor,
    domain: input.item.domain,
    tool: envelope.operation,
    risk: envelope.authorization.risk === 'restricted' ? 'sensitive' : envelope.authorization.risk,
    recordIds: [],
    idempotencyKey: envelope.idempotencyKey,
    command: JSON.stringify({
      kind: 'reactive_proposal',
      proposalId: input.item.proposalId,
      operation: envelope.operation,
      operationTemplate: envelope.operationTemplate,
      ruleId: envelope.ruleId,
      eventId: envelope.eventId,
      review: envelope.review,
      authorization: envelope.authorization,
      dryRun: envelope.dryRun,
      commandPreview: input.commandPreview,
    }),
    before: null,
    after: { proposal: envelope, policy: envelope.authorization, dryRun: envelope.dryRun, commandPreview: input.commandPreview },
    undoPayload: null,
    status: 'queued',
    operationId: `proposal:${input.item.proposalId}:operation`,
    causeId: envelope.causeId,
  });
}

function isLocalWriteProvider(provider: string): boolean {
  return provider === 'user' || provider === 'sqlite' || provider === 'local_sqlite';
}

function executeApprovedCommand(input: {
  item: ReactiveOutboxItem;
  actionId: string;
  actor: string;
  commandPreview: Extract<ReturnType<typeof previewReactiveProposalCommand>, { ok: true }>;
  approval?: ReactiveProposalApprovalReceipt;
  source?: RecordSource;
  providerWriteback?: ReactiveProviderWritebackReceipt;
}): ReturnType<typeof createRecordWithAction> & { verification?: ReactiveProposalVerificationReceipt } {
  const envelope = input.item.proposal.envelope;
  const template = envelope.operationTemplate;
  const command = JSON.stringify({
    kind: 'reactive_proposal_execute',
    proposalId: input.item.proposalId,
    operationTemplate: template,
    commandPreview: input.commandPreview,
    authorization: envelope.authorization,
    approval: input.approval ?? null,
    providerWriteback: input.providerWriteback ?? null,
  });
  const risk = envelope.authorization.risk === 'restricted' ? 'sensitive' : envelope.authorization.risk;
  if (template.kind === 'create_record') {
    const recordId = String(input.commandPreview.args.id);
    const write = createRecordWithAction({
      actionId: input.actionId,
      actor: input.actor,
      domain: String(input.commandPreview.args.domain),
      tool: input.commandPreview.tool,
      risk,
      command,
      record: {
        id: recordId,
        domain: String(input.commandPreview.args.domain),
        collection: String(input.commandPreview.args.collection),
        title: typeof template.properties?.title === 'string' ? template.properties.title : recordId,
        properties: template.properties ?? {},
        relations: [],
        source: {
          ...(input.source ?? {
            provider: 'user',
            external_id: recordId,
            url: null,
            observed_at: new Date().toISOString(),
            content_hash: envelope.evidence.afterHash ?? null,
          }),
        },
        archived_at: null,
      },
      idempotencyKey: envelope.idempotencyKey,
      operationId: operationIdForProposal(input.item),
      causeId: envelope.causeId,
      before: { proposal: envelope, commandPreview: input.commandPreview },
      undoPayload: { operation: 'delete_record', record_id: recordId },
    });
    return { ...write, verification: verifyForAction({ item: input.item, actionId: write.action.id, operationId: write.action.operation_id, record: write.record, providerWriteback: input.providerWriteback }) };
  }
  if (template.kind === 'update_record') {
    const existing = findRecord(template.recordId);
    const beforeRevision = existing?.revision;
    const write = updateRecordWithAction({
      actionId: input.actionId,
      actor: input.actor,
      domain: String(input.commandPreview.args.domain),
      tool: input.commandPreview.tool,
      risk,
      command,
      id: template.recordId,
      patch: {
        properties: {
          ...(existing?.properties ?? {}),
          ...template.changes,
        },
      },
      source: input.source,
      expectedRevision: template.expectedRevision,
      idempotencyKey: envelope.idempotencyKey,
      operationId: operationIdForProposal(input.item),
      causeId: envelope.causeId,
    });
    return { ...write, verification: verifyForAction({ item: input.item, actionId: write.action.id, operationId: write.action.operation_id, beforeRevision, providerWriteback: input.providerWriteback }) };
  }
  if (template.kind !== 'archive_record') {
    const failed = {
      action: createActionEvent({
        id: input.actionId,
        actor: input.actor,
        domain: input.item.domain,
        tool: envelope.operation,
        risk,
        recordIds: [],
        idempotencyKey: envelope.idempotencyKey,
        command: 'proposal_execution_template_unsupported',
        before: { proposal: envelope },
        after: null,
        undoPayload: null,
        status: 'failed',
        operationId: operationIdForProposal(input.item),
        causeId: envelope.causeId,
      }),
      replayed: false,
    };
    return { ...failed, verification: verifyForAction({ item: input.item, actionId: failed.action.id, operationId: failed.action.operation_id }) };
  }
  const existing = findRecord(template.recordId);
  const beforeRevision = existing?.revision;
  const write = archiveRecordWithAction({
    actionId: input.actionId,
    actor: input.actor,
    domain: String(input.commandPreview.args.domain),
    tool: input.commandPreview.tool,
    risk,
    command,
    id: template.recordId,
    source: input.source,
    expectedRevision: template.expectedRevision,
    idempotencyKey: envelope.idempotencyKey,
    operationId: operationIdForProposal(input.item),
    causeId: envelope.causeId,
  });
  return { ...write, verification: verifyForAction({ item: input.item, actionId: write.action.id, operationId: write.action.operation_id, beforeRevision, providerWriteback: input.providerWriteback }) };
}

function verifyForAction(input: {
  item: ReactiveOutboxItem;
  actionId: string;
  operationId: string;
  beforeRevision?: number;
  record?: ReturnType<typeof findRecord>;
  providerWriteback?: ReactiveProviderWritebackReceipt;
}): ReactiveProposalVerificationReceipt {
  const template = input.item.proposal.envelope.operationTemplate;
  const record = input.record ?? (template.kind === 'custom' ? null
    : template.kind === 'create_record' ? findRecord(template.recordId ?? '')
    : findRecord(template.recordId));
  return verifyReactiveProposalPostcondition({
    operationTemplate: template,
    record,
    beforeRevision: input.beforeRevision,
    actionId: input.actionId,
    operationId: input.operationId,
    proposalId: input.item.proposalId,
    operationTemplateHash: hashValue(template),
    providerWriteback: input.providerWriteback,
  });
}

export type ProviderWritebackInput = {
  item: ReactiveOutboxItem;
  actionId: string;
  actor: string;
  commandPreview: Extract<ReturnType<typeof previewReactiveProposalCommand>, { ok: true }>;
  approval?: ReactiveProposalApprovalReceipt;
  provider: string;
};

export type ProviderWritebackResult =
  | { ok: true; source: RecordSource; receipt: ReactiveProviderWritebackReceipt }
  | { ok: false; error: string };

export type ReactiveProviderWritebackVerifier = (input: ProviderWritebackInput) => Promise<ProviderWritebackResult>;

async function executeProviderWriteback(input: ProviderWritebackInput): Promise<ProviderWritebackResult> {
  const template = input.item.proposal.envelope.operationTemplate;
  if (template.kind === 'custom' || template.kind === 'restore_record') return { ok: false, error: 'provider_writeback_template_unsupported' };
  const operation = template.kind;
  const domain = String(input.commandPreview.args.domain);
  const collection = String(input.commandPreview.args.collection);
  const recordId = template.kind === 'create_record' ? String(input.commandPreview.args.id) : template.recordId;
  const existing = template.kind === 'create_record' ? null : findRecord(recordId);
  const sourceProvider = providerName(input.provider);
  if (!sourceProvider) return { ok: false, error: 'provider_writeback_provider_unsupported' };
  if (template.kind !== 'create_record' && !existing) {
    return { ok: false, error: 'provider_writeback_record_missing' };
  }
  if (template.kind !== 'create_record' && template.expectedRevision !== undefined && existing?.revision !== template.expectedRevision) {
    return { ok: false, error: 'provider_writeback_revision_mismatch' };
  }
  if (existing && existing.source.provider !== sourceProvider) {
    return { ok: false, error: 'provider_writeback_source_mismatch' };
  }
  const externalId = existing?.source.external_id || (template.kind === 'create_record' ? undefined : '');
  if (template.kind !== 'create_record' && !externalId) {
    return { ok: false, error: 'provider_writeback_external_id_missing' };
  }
  const title = template.kind === 'create_record'
    ? typeof template.properties?.title === 'string' ? template.properties.title : recordId
    : existing?.title ?? recordId;
  const properties = template.kind === 'update_record'
    ? { ...(existing?.properties ?? {}), ...template.changes }
    : template.kind === 'create_record'
      ? template.properties ?? {}
      : existing?.properties ?? {};

  if (sourceProvider === 'notion') {
    const write = await writeNotionRecord({
      operation,
      recordId,
      pageId: template.kind === 'create_record' ? undefined : externalId,
      domain,
      collection,
      title,
      properties,
      archived: template.kind === 'archive_record' ? true : undefined,
      externalId,
    });
    if (!write.ok || !write.source_snapshot || !write.source) {
      return { ok: false, error: `provider_writeback_failed:${write.error || 'notion write missing source receipt'}` };
    }
    const source = normalizeProviderSource(write.source, 'notion', recordId);
    if (!source) return { ok: false, error: 'provider_writeback_source_invalid' };
    const providerRecordId = write.provider_record_id ?? source.external_id;
    const readback = await verifyNotionReadback({
      providerRecordId,
      domain,
      collection,
      archived: template.kind === 'archive_record',
      expectedProperties: template.kind === 'archive_record' ? undefined : properties,
    });
    if (!readback.ok) return { ok: false, error: readback.error };
    return {
      ok: true,
      source,
      receipt: providerReceipt({
        provider: 'notion',
        operation,
        providerRecordId,
        sourceSnapshot: write.source_snapshot,
        readbackSnapshot: readback.snapshot,
        reason: 'provider_writeback_verified',
      }),
    };
  }

  const write = await writeSheetsRecord({
    operation,
    record: {
      id: recordId,
      domain,
      collection,
      title,
      properties,
      relations: existing?.relations ?? [],
      archived: template.kind === 'archive_record' ? true : Boolean(existing?.archived_at),
      externalId: externalId || recordId,
      expectedDigest: typeof existing?.source.content_hash === 'string' ? existing.source.content_hash : undefined,
    },
  });
  if (!write.ok || !write.source_snapshot || !write.source) {
    return { ok: false, error: `provider_writeback_failed:${write.error || 'sheets write missing source receipt'}` };
  }
  const source = normalizeProviderSource(write.source, 'google_sheets', recordId);
  if (!source) return { ok: false, error: 'provider_writeback_source_invalid' };
  const readback = await verifySheetsReadback({
    recordId,
    domain,
    collection,
    writeSnapshot: write.source_snapshot,
    expectedProperties: template.kind === 'archive_record' ? undefined : properties,
  });
  if (!readback.ok) return { ok: false, error: readback.error };
  return {
    ok: true,
    source,
    receipt: providerReceipt({
      provider: 'google_sheets',
      operation,
      providerRecordId: source.external_id,
      sourceSnapshot: write.source_snapshot,
      readbackSnapshot: readback.snapshot,
      reason: write.noChange ? 'provider_writeback_noop_verified' : 'provider_writeback_verified',
    }),
  };
}

async function verifyNotionReadback(input: {
  providerRecordId: string | null;
  domain: string;
  collection: string;
  archived: boolean;
  expectedProperties?: Record<string, unknown>;
}): Promise<{ ok: true; snapshot: Record<string, unknown> } | { ok: false; error: string }> {
  if (!input.providerRecordId) return { ok: false, error: 'provider_writeback_readback_missing_provider_id' };
  const readback = await pullNotionRecordsLive({ domain: input.domain, collection: input.collection, limit: 100 });
  if (readback.status !== 'ready') return { ok: false, error: `provider_writeback_readback_failed:${readback.error || readback.message}` };
  const snapshot = readback.source_snapshots.find((candidate) => {
    const row = candidate as Record<string, unknown>;
    return row.page_id === input.providerRecordId || row.pageId === input.providerRecordId;
  }) as Record<string, unknown> | undefined;
  if (!snapshot) return { ok: false, error: 'provider_writeback_readback_missing' };
  if (input.archived && snapshot.archived !== true && snapshot.inTrash !== true) {
    return { ok: false, error: 'provider_writeback_readback_mismatch' };
  }
  const properties = snapshot.properties && typeof snapshot.properties === 'object' && !Array.isArray(snapshot.properties)
    ? snapshot.properties as Record<string, unknown>
    : {};
  if (input.expectedProperties && !hasProviderProperties(properties, input.expectedProperties)) {
    return { ok: false, error: 'provider_writeback_readback_mismatch' };
  }
  return { ok: true, snapshot };
}

async function verifySheetsReadback(input: {
  recordId: string;
  domain: string;
  collection: string;
  writeSnapshot: Record<string, unknown>;
  expectedProperties?: Record<string, unknown>;
}): Promise<{ ok: true; snapshot: Record<string, unknown> } | { ok: false; error: string }> {
  const readback = await pullSheetsRecordsLive({ domain: input.domain, collection: input.collection });
  if (readback.status !== 'ready') return { ok: false, error: `provider_writeback_readback_failed:${readback.error || readback.message}` };
  const writeRow = typeof input.writeSnapshot.row === 'number' ? input.writeSnapshot.row : null;
  const afterDigest = typeof input.writeSnapshot.afterDigest === 'string' ? input.writeSnapshot.afterDigest : undefined;
  const valueDigest = typeof input.writeSnapshot.valueDigest === 'string' ? input.writeSnapshot.valueDigest : undefined;
  const snapshot = readback.source_snapshots.find((candidate, index) => {
    const row = candidate as Record<string, unknown>;
    const record = readback.records[index];
    return row.row === writeRow || record?.id === input.recordId;
  }) as Record<string, unknown> | undefined;
  if (!snapshot) return { ok: false, error: 'provider_writeback_readback_missing' };
  const readDigest = typeof snapshot.value_digest === 'string' ? snapshot.value_digest : undefined;
  const readRevision = typeof snapshot.revision === 'string' ? snapshot.revision : undefined;
  if ((afterDigest && readDigest !== afterDigest) && (valueDigest && readRevision !== valueDigest)) {
    return { ok: false, error: 'provider_writeback_readback_mismatch' };
  }
  const record = readback.records.find((candidate) => candidate.id === input.recordId);
  if (input.expectedProperties && !hasProviderProperties(record?.properties ?? {}, input.expectedProperties)) {
    return { ok: false, error: 'provider_writeback_readback_mismatch' };
  }
  return { ok: true, snapshot };
}

function hasProviderProperties(observed: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => providerValueMatches(observed[key], value));
}

function providerValueMatches(observed: unknown, expected: unknown): boolean {
  if (deepEqual(observed, expected)) return true;
  const observedText = providerValueText(observed);
  if (typeof expected === 'string') return observedText === expected;
  if (typeof expected === 'number') return Number(observedText) === expected;
  if (typeof expected === 'boolean') return observedText.toLowerCase() === String(expected);
  return false;
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

function providerValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(providerValueText).join('').trim();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.plain_text === 'string') return record.plain_text.trim();
    if (record.text && typeof record.text === 'object' && typeof (record.text as Record<string, unknown>).content === 'string') {
      return String((record.text as Record<string, unknown>).content).trim();
    }
    if (typeof record.name === 'string') return record.name.trim();
    if (record.title !== undefined) return providerValueText(record.title);
    if (record.rich_text !== undefined) return providerValueText(record.rich_text);
    if (record.number !== undefined) return providerValueText(record.number);
    if (record.checkbox !== undefined) return providerValueText(record.checkbox);
    if (record.select !== undefined) return providerValueText(record.select);
  }
  return '';
}

function providerName(provider: string): 'notion' | 'google_sheets' | null {
  if (provider === 'notion') return 'notion';
  if (provider === 'google_sheets') return 'google_sheets';
  return null;
}

function normalizeProviderSource(
  value: Record<string, unknown>,
  provider: 'notion' | 'google_sheets',
  fallbackExternalId: string,
): RecordSource | null {
  const externalId = typeof value.external_id === 'string' && value.external_id.trim()
    ? value.external_id.trim()
    : fallbackExternalId;
  if (!externalId) return null;
  return {
    provider,
    external_id: externalId,
    url: typeof value.url === 'string' ? value.url : null,
    observed_at: typeof value.observed_at === 'string' && value.observed_at.trim()
      ? value.observed_at
      : new Date().toISOString(),
    content_hash: typeof value.content_hash === 'string' ? value.content_hash : null,
  };
}

function providerReceipt(input: {
  provider: 'notion' | 'google_sheets';
  operation: 'create_record' | 'update_record' | 'archive_record';
  providerRecordId: string | null;
  sourceSnapshot: Record<string, unknown>;
  readbackSnapshot: Record<string, unknown>;
  reason: string;
}): ReactiveProviderWritebackReceipt {
  return {
    ok: true,
    provider: input.provider,
    operation: input.operation,
    providerRecordId: input.providerRecordId,
    sourceSnapshotHash: hashValue(input.sourceSnapshot),
    sourceSnapshot: input.sourceSnapshot,
    readbackSnapshotHash: hashValue(input.readbackSnapshot),
    readbackSnapshot: input.readbackSnapshot,
    reason: input.reason,
  };
}

function validateApproval(approval: ReactiveProposalApprovalReceipt | undefined, item: ReactiveOutboxItem, actor: string): { ok: true } | { ok: false; error: string } {
  if (!approval) return { ok: false, error: 'proposal_approval_required' };
  if (approval.schemaVersion !== 'wonder.reactive-proposal-approval.v1') return { ok: false, error: 'proposal_approval_invalid' };
  if (approval.revoked === true) return { ok: false, error: 'proposal_approval_revoked' };
  if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now()) return { ok: false, error: 'proposal_approval_expired' };
  if (!approval.approver.trim() || !approval.authority.trim() || !approval.localActor.trim()) return { ok: false, error: 'proposal_approval_invalid' };
  if (approval.localActor !== actor || approval.approver !== actor) return { ok: false, error: 'proposal_approval_actor_mismatch' };
  if (approval.proposalId !== item.proposalId) return { ok: false, error: 'proposal_approval_mismatch' };
  if (approval.idempotencyKey !== item.proposal.envelope.idempotencyKey) return { ok: false, error: 'proposal_approval_mismatch' };
  if (approval.operationId !== operationIdForProposal(item)) return { ok: false, error: 'proposal_approval_mismatch' };
  if (approval.operationHash !== hashValue(operationApprovalPayload(item))) return { ok: false, error: 'proposal_approval_mismatch' };
  if (approval.proposalHash !== hashValue(item.proposal.envelope)) return { ok: false, error: 'proposal_approval_mismatch' };
  if (approval.operationTemplateHash !== hashValue(item.proposal.envelope.operationTemplate)) return { ok: false, error: 'proposal_approval_mismatch' };
  return { ok: true };
}

function operationIdForProposal(item: ReactiveOutboxItem): string {
  return `proposal:${item.proposalId}:operation`;
}

function operationApprovalPayload(item: ReactiveOutboxItem): Record<string, unknown> {
  return {
    proposalId: item.proposalId,
    operation: item.proposal.operation,
    operationTemplate: item.proposal.envelope.operationTemplate,
    idempotencyKey: item.proposal.envelope.idempotencyKey,
  };
}

function isVerificationBoundToProposal(
  verification: ReactiveProposalVerificationReceipt | undefined,
  item: ReactiveOutboxItem,
  operationId: string,
): verification is ReactiveProposalVerificationReceipt {
  return Boolean(verification?.ok)
    && verification?.proposalId === item.proposalId
    && verification?.operationId === operationId
    && verification?.operationTemplateHash === hashValue(item.proposal.envelope.operationTemplate);
}

function isVerificationReceipt(value: unknown): value is ReactiveProposalVerificationReceipt {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { verifierVersion?: unknown }).verifierVersion === 'wonder.reactive-proposal-verifier.v1'
    && typeof (value as { ok?: unknown }).ok === 'boolean'
    && typeof (value as { actionId?: unknown }).actionId === 'string'
    && typeof (value as { operationId?: unknown }).operationId === 'string'
    && typeof (value as { proposalId?: unknown }).proposalId === 'string'
    && typeof (value as { operationTemplateHash?: unknown }).operationTemplateHash === 'string';
}

function hashValue(value: unknown): string {
  return sha256Canonical(value);
}
