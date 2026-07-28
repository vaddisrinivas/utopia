import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drainReactiveOutbox } from '../src/kernel/reactive-outbox';
import { createReactiveOutboxStore, enqueueReactiveProposals } from '../src/kernel/reactive-outbox';
import type { ReactiveCycleResult } from '../src/kernel/reactive-cycle';
import type { OperationCommitEvent } from '../src/kernel/operation-observer';
import { createOperationProposalIdempotencyKey } from '../src/kernel/rules';
import { setNotionPortForTests } from '../src/providers/notion/port';
import { setSheetsPortForTests } from '../src/providers/sheets/port';

const dir = mkdtempSync(join(tmpdir(), 'utopia-reactive-proposal-'));
process.env.WONDER_RUNTIME_STATE_PATH = join(dir, 'wonder-runtime.json');
const { executeReactiveProposal, executeReactiveProposalLive } = await import('../src/kernel/reactive-proposal-executor');
const { attachActionVerification, createRecord, findActionByIdempotencyKey, findRecord, getActionEvent, updateRecord } = await import('../src/runtime/state');
const proposalEvent = { kind: 'query_transition' as const, id: 'review:enter', queryId: 'review', transition: 'enter' as const };
const operationTemplate = { kind: 'custom' as const, tool: 'request_review' };
const authorization = {
  policyId: 'wonder.reactive-proposal-policy' as const,
  policyVersion: 'v1' as const,
  allowed: true,
  risk: 'standard' as const,
  reviewRequired: true,
  requiredCapability: 'reactive:propose:custom',
  capabilityPresent: false,
  providerAuthority: {
    targetProvider: 'user',
    authorityProvider: 'notion',
    allowed: true,
    requiredCapability: null,
    capabilityPresent: true,
    reason: 'provider_authority_ok',
  },
  reason: 'suggest_mode_requires_review',
};
const dryRun = {
  ok: true,
  effect: 'queue_review_action' as const,
  executable: false,
  reason: 'proposal_can_be_queued',
};
const proposalEvidence = {
  queryId: 'review',
  transition: 'enter' as const,
  beforeHash: 'before-hash',
  afterHash: 'after-hash',
  querySpecHash: 'sha256:query',
  packageHash: 'sha256:package',
  evaluatorVersion: 'wonder.query-evaluator.v1',
};
const proposalIdempotencyKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'review-rule',
  event: proposalEvent,
  causeId: 'source-cause',
  operationTemplate,
  evidence: proposalEvidence,
});

const event: OperationCommitEvent = {
  actionId: 'source-action',
  operationId: 'source-operation',
  causeId: 'source-cause',
  domain: 'food',
  recordId: 'source-record',
  before: null,
  after: { id: 'source-record' },
};
const cycle: ReactiveCycleResult = {
  cycleId: 'proposal-cycle',
  transitions: [],
  queryHashes: { review: { before: 'before-hash', after: 'after-hash' } },
  proposals: [{
    id: 'proposal-ledger',
    eventId: 'review:enter',
    event: proposalEvent,
    ruleId: 'review-rule',
    operation: 'request_review',
    operationTemplate,
    mode: 'suggest',
    causeId: 'source-cause',
    packageVersion: '1.0.0',
    depth: 0,
    envelope: {
      schemaVersion: 'wonder.operation-proposal.v1',
      proposalId: 'proposal-ledger',
      operation: 'request_review',
      operationTemplate,
      mode: 'suggest',
      ruleId: 'review-rule',
      packageId: 'food',
      packageVersion: '1.0.0',
      eventId: 'review:enter',
      event: proposalEvent,
      causeId: 'source-cause',
      depth: 0,
      idempotencyKey: proposalIdempotencyKey,
      review: { required: true, reason: 'suggest_mode', policyId: authorization.policyId, policyVersion: authorization.policyVersion },
      authorization,
      dryRun,
      evidence: proposalEvidence,
    },
  }],
};

const queued = enqueueReactiveProposals(createReactiveOutboxStore(), {
  cycle,
  event,
  proposalIds: ['proposal-ledger'],
  now: '2026-07-23T00:00:00.000Z',
});
assert.equal(queued.items['proposal-ledger'].domain, 'food');

const drained = await drainReactiveOutbox({
  store: queued,
  now: '2026-07-23T00:00:00.000Z',
  executeProposal: (item) => executeReactiveProposal(item, { actor: 'test-reactive' }),
});
assert.deepEqual(drained.acked, []);
assert.deepEqual(drained.queuedForReview, ['proposal-ledger']);
assert.equal(drained.store.items['proposal-ledger'].status, 'awaiting_review');

const action = findActionByIdempotencyKey(proposalIdempotencyKey);
assert.ok(action);
assert.equal(action.id, 'reactive-proposal:proposal-ledger');
assert.equal(action.actor, 'test-reactive');
assert.equal(action.domain, 'food');
assert.equal(action.tool, 'request_review');
assert.equal(action.status, 'queued');
assert.equal(action.cause_id, 'source-cause');
assert.deepEqual(action.record_ids, []);
assert.equal((action.after_json as { proposal?: { proposalId?: string } }).proposal?.proposalId, 'proposal-ledger');
assert.equal((action.after_json as { policy?: { policyId?: string } }).policy?.policyId, authorization.policyId);
assert.equal((action.after_json as { dryRun?: { ok?: boolean } }).dryRun?.ok, true);
assert.deepEqual((action.after_json as { commandPreview?: { ok?: boolean; reason?: string } }).commandPreview, {
  ok: false,
  reason: 'custom_operation_requires_review',
  recordIds: [],
});
assert.equal(getActionEvent(action.id)?.id, action.id);

const blocked = executeReactiveProposal({
  ...queued.items['proposal-ledger'],
  proposal: {
    ...queued.items['proposal-ledger'].proposal,
    envelope: {
      ...queued.items['proposal-ledger'].proposal.envelope,
      authorization: { ...authorization, allowed: false, reason: 'operation_template_restricted' },
      dryRun: { ...dryRun, ok: false, reason: 'operation_template_restricted' },
    },
  },
});
assert.equal(blocked.ok, false);
assert.equal(blocked.error, 'proposal_policy_blocked');

const replay = executeReactiveProposal(queued.items['proposal-ledger'], { actor: 'ignored' });
assert.equal(replay.ok, true);
assert.equal(replay.receipt?.replayed, false);
assert.equal(replay.receipt?.actionId, action.id);

const autoEvent = { kind: 'operation' as const, id: 'auto-source-operation' };
const autoTemplate = { kind: 'create_record' as const, collection: 'recipe', recordId: 'auto-created-record', properties: { title: 'Auto created', status: 'queued' } };
const autoAuthorization = {
  policyId: 'wonder.reactive-proposal-policy' as const,
  policyVersion: 'v1' as const,
  allowed: true,
  risk: 'low' as const,
  reviewRequired: false,
  requiredCapability: 'reactive:auto:create_record',
  capabilityPresent: true,
  providerAuthority: {
    targetProvider: 'user',
    authorityProvider: 'notion',
    allowed: true,
    requiredCapability: null,
    capabilityPresent: true,
    reason: 'provider_authority_ok',
  },
  reason: 'automatic_policy_authorized',
};
const autoDryRun = {
  ok: true,
  effect: 'queue_review_action' as const,
  executable: true,
  reason: 'proposal_can_be_queued',
};
const autoKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'auto-create-rule',
  event: autoEvent,
  causeId: 'auto-cause',
  operationTemplate: autoTemplate,
});
const autoItem = {
  ...queued.items['proposal-ledger'],
  proposalId: 'auto-create-proposal',
  eventId: 'auto-source-operation',
  causeId: 'auto-cause',
  proposal: {
    ...queued.items['proposal-ledger'].proposal,
    id: 'auto-create-proposal',
    eventId: 'auto-source-operation',
    event: autoEvent,
    ruleId: 'auto-create-rule',
    operation: 'create_record',
    operationTemplate: autoTemplate,
    mode: 'automatic' as const,
    causeId: 'auto-cause',
    envelope: {
      ...queued.items['proposal-ledger'].proposal.envelope,
      proposalId: 'auto-create-proposal',
      operation: 'create_record',
      operationTemplate: autoTemplate,
      mode: 'automatic' as const,
      ruleId: 'auto-create-rule',
      eventId: 'auto-source-operation',
      event: autoEvent,
      causeId: 'auto-cause',
      idempotencyKey: autoKey,
      review: { required: false, reason: 'policy_authorized' as const, policyId: autoAuthorization.policyId, policyVersion: autoAuthorization.policyVersion },
      authorization: autoAuthorization,
      dryRun: autoDryRun,
      evidence: {},
    },
  },
};
const executed = executeReactiveProposal(autoItem, { actor: 'test-reactive' });
assert.equal(executed.ok, true);
assert.equal(executed.receipt?.status, 'completed');
assert.equal(executed.receipt?.verification?.reason, 'canonical_create_verified');
assert.equal(getActionEvent(executed.receipt?.actionId ?? '')?.verification_json && (getActionEvent(executed.receipt?.actionId ?? '')?.verification_json as { reason?: string }).reason, 'canonical_create_verified');
assert.equal(findRecord('auto-created-record')?.properties.status, 'queued');
const executedReplay = executeReactiveProposal(autoItem, { actor: 'ignored' });
assert.equal(executedReplay.ok, true);
assert.equal(executedReplay.receipt?.replayed, true);
assert.equal(executedReplay.receipt?.verification?.reason, 'canonical_create_verified');
updateRecord('auto-created-record', { properties: { title: 'Auto created', status: 'tampered' } }, { persist: false });
attachActionVerification(executed.receipt?.actionId ?? '', null, { persist: false });
const failedVerificationReplay = executeReactiveProposal(autoItem, { actor: 'ignored' });
assert.equal(failedVerificationReplay.ok, false);
assert.equal(failedVerificationReplay.error, 'proposal_verification_receipt_missing');

const updateSeed = createRecord({
  id: 'auto-update-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Auto update seed',
  properties: { status: 'open' },
  relations: [],
  source: { provider: 'user', external_id: 'auto-update-record', url: null, observed_at: new Date().toISOString(), content_hash: null },
  archived_at: null,
}, { persist: false });
const updateEvent = { kind: 'operation' as const, id: 'auto-update-operation' };
const updateTemplate = { kind: 'update_record' as const, collection: 'recipe', recordId: 'auto-update-record', expectedRevision: updateSeed.revision, changes: { status: 'done' } };
const updateAuthorization = {
  ...autoAuthorization,
  risk: 'standard' as const,
  reviewRequired: true,
  requiredCapability: 'reactive:propose:update_record',
  capabilityPresent: false,
  reason: 'automatic_requires_policy_or_review',
};
const updateKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'auto-update-rule',
  event: updateEvent,
  causeId: 'update-cause',
  operationTemplate: updateTemplate,
});
const updateItem = {
  ...autoItem,
  proposalId: 'auto-update-proposal',
  eventId: 'auto-update-operation',
  causeId: 'update-cause',
  proposal: {
    ...autoItem.proposal,
    id: 'auto-update-proposal',
    eventId: 'auto-update-operation',
    event: updateEvent,
    ruleId: 'auto-update-rule',
    operation: 'update_record',
    operationTemplate: updateTemplate,
    causeId: 'update-cause',
    envelope: {
      ...autoItem.proposal.envelope,
      proposalId: 'auto-update-proposal',
      operation: 'update_record',
      operationTemplate: updateTemplate,
      ruleId: 'auto-update-rule',
      eventId: 'auto-update-operation',
      event: updateEvent,
      causeId: 'update-cause',
      idempotencyKey: updateKey,
      review: { required: true, reason: 'policy_required' as const, policyId: updateAuthorization.policyId, policyVersion: updateAuthorization.policyVersion },
      authorization: updateAuthorization,
    },
  },
};
const queuedUpdate = executeReactiveProposal(updateItem);
assert.equal(queuedUpdate.ok, true, 'review-required update should queue without approval');
assert.equal(queuedUpdate.receipt?.status, 'queued');
const queuedUpdateActionId = queuedUpdate.receipt?.actionId;
assert.equal(findRecord('auto-update-record')?.properties.status, 'open');
const tamperedIdempotencyApproval = executeReactiveProposal(updateItem, {
  actor: 'approver',
  approval: { ...approvalFor(updateItem), idempotencyKey: 'tampered-key' },
});
assert.equal(tamperedIdempotencyApproval.ok, false);
assert.equal(tamperedIdempotencyApproval.error, 'proposal_approval_mismatch');
const tamperedOperationApproval = executeReactiveProposal(updateItem, {
  actor: 'approver',
  approval: { ...approvalFor(updateItem), operationHash: hashValue({ bad: true }) },
});
assert.equal(tamperedOperationApproval.ok, false);
assert.equal(tamperedOperationApproval.error, 'proposal_approval_mismatch');
const tamperedProposalApproval = executeReactiveProposal(updateItem, {
  actor: 'approver',
  approval: { ...approvalFor(updateItem), proposalHash: hashValue('tampered-proposal-hash') },
});
assert.equal(tamperedProposalApproval.ok, false);
assert.equal(tamperedProposalApproval.error, 'proposal_approval_mismatch');
const tamperedTemplateApproval = executeReactiveProposal(updateItem, {
  actor: 'approver',
  approval: { ...approvalFor(updateItem), operationTemplateHash: hashValue('tampered-template') },
});
assert.equal(tamperedTemplateApproval.ok, false);
assert.equal(tamperedTemplateApproval.error, 'proposal_approval_mismatch');
const wrongActorApproval = executeReactiveProposal(updateItem, {
  actor: 'different-actor',
  approval: approvalFor(updateItem),
});
assert.equal(wrongActorApproval.ok, false);
assert.equal(wrongActorApproval.error, 'proposal_approval_actor_mismatch');
const expiredApproval = executeReactiveProposal(updateItem, {
  actor: 'approver',
  approval: { ...approvalFor(updateItem), expiresAt: '2026-01-01T00:00:00.000Z' },
});
assert.equal(expiredApproval.ok, false);
assert.equal(expiredApproval.error, 'proposal_approval_expired');
const revokedApproval = executeReactiveProposal(updateItem, {
  actor: 'approver',
  approval: { ...approvalFor(updateItem), revoked: true },
});
assert.equal(revokedApproval.ok, false);
assert.equal(revokedApproval.error, 'proposal_approval_revoked');
const approvedUpdate = executeReactiveProposal(updateItem, { actor: 'approver', approval: approvalFor(updateItem) });
assert.equal(approvedUpdate.ok, true);
assert.equal(approvedUpdate.receipt?.actionId, queuedUpdateActionId);
assert.equal(approvedUpdate.receipt?.idempotencyKey, queuedUpdate.receipt?.idempotencyKey);
assert.equal(approvedUpdate.receipt?.idempotencyKey, updateKey);
assert.equal(approvedUpdate.receipt?.status, 'completed');
assert.equal(approvedUpdate.receipt?.verification?.reason, 'canonical_update_verified');
assert.equal((getActionEvent(approvedUpdate.receipt?.actionId ?? '')?.verification_json as { reason?: string }).reason, 'canonical_update_verified');
assert.equal(findRecord('auto-update-record')?.properties.status, 'done');
assert.equal(findActionByIdempotencyKey(updateKey)?.id, 'reactive-proposal:auto-update-proposal');
const updateRevision = findRecord('auto-update-record')?.revision;
const approvedUpdateReplay = executeReactiveProposal(updateItem, { actor: 'approver', approval: approvalFor(updateItem) });
assert.equal(approvedUpdateReplay.ok, true);
assert.equal(approvedUpdateReplay.receipt?.replayed, true);
assert.equal(approvedUpdateReplay.receipt?.actionId, approvedUpdate.receipt?.actionId);
assert.equal(approvedUpdateReplay.receipt?.verification?.operationId, approvedUpdate.receipt?.verification?.operationId);
assert.equal(findRecord('auto-update-record')?.revision, updateRevision);
const approvedUpdateReplayWithoutApproval = executeReactiveProposal(updateItem);
assert.equal(approvedUpdateReplayWithoutApproval.ok, true);
assert.equal(approvedUpdateReplayWithoutApproval.receipt?.replayed, true);
assert.equal(approvedUpdateReplayWithoutApproval.receipt?.actionId, approvedUpdate.receipt?.actionId);
attachActionVerification(approvedUpdate.receipt?.actionId ?? '', null, { persist: false });
const replayWithoutVerification = executeReactiveProposal(updateItem, { actor: 'approver', approval: approvalFor(updateItem) });
assert.equal(replayWithoutVerification.ok, false);
assert.equal(replayWithoutVerification.error, 'proposal_verification_receipt_missing');

const providerUpdateKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'auto-provider-update-rule',
  event: updateEvent,
  causeId: 'provider-update-cause',
  operationTemplate: updateTemplate,
});
const providerUpdateItem = {
  ...updateItem,
  proposalId: 'auto-provider-update-proposal',
  causeId: 'provider-update-cause',
  proposal: {
    ...updateItem.proposal,
    id: 'auto-provider-update-proposal',
    ruleId: 'auto-provider-update-rule',
    causeId: 'provider-update-cause',
    envelope: {
      ...updateItem.proposal.envelope,
      proposalId: 'auto-provider-update-proposal',
      ruleId: 'auto-provider-update-rule',
      causeId: 'provider-update-cause',
      idempotencyKey: providerUpdateKey,
      authorization: {
        ...updateAuthorization,
        capabilityPresent: true,
        providerAuthority: {
          targetProvider: 'notion',
          authorityProvider: 'notion',
          allowed: true,
          requiredCapability: 'reactive:provider:notion:update_record',
          capabilityPresent: true,
          reason: 'provider_authority_ok',
        },
      },
    },
  },
};
const providerWriteback = executeReactiveProposal(providerUpdateItem, { actor: 'approver', approval: approvalFor(providerUpdateItem) });
assert.equal(providerWriteback.ok, false);
assert.equal(providerWriteback.error, 'provider_writeback_verification_missing');
assert.equal(findRecord('auto-update-record')?.revision, updateRevision);

const providerSeed = createRecord({
  id: 'auto-provider-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Provider seed',
  properties: { status: 'open' },
  relations: [],
  source: { provider: 'notion', external_id: 'notion-page-provider', url: null, observed_at: new Date().toISOString(), content_hash: null },
  archived_at: null,
}, { persist: false });
const providerLiveTemplate = { kind: 'update_record' as const, collection: 'recipe', recordId: providerSeed.id, expectedRevision: providerSeed.revision, changes: { status: 'done' } };
const providerLiveKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'auto-provider-live-rule',
  event: updateEvent,
  causeId: 'provider-live-cause',
  operationTemplate: providerLiveTemplate,
});
const providerLiveItem = {
  ...providerUpdateItem,
  proposalId: 'auto-provider-live-proposal',
  causeId: 'provider-live-cause',
  proposal: {
    ...providerUpdateItem.proposal,
    id: 'auto-provider-live-proposal',
    ruleId: 'auto-provider-live-rule',
    operationTemplate: providerLiveTemplate,
    causeId: 'provider-live-cause',
    envelope: {
      ...providerUpdateItem.proposal.envelope,
      proposalId: 'auto-provider-live-proposal',
      ruleId: 'auto-provider-live-rule',
      operationTemplate: providerLiveTemplate,
      causeId: 'provider-live-cause',
      idempotencyKey: providerLiveKey,
    },
  },
};
process.env.NOTION_TOKEN = 'test-notion-token';
process.env.NOTION_DATA_SOURCE_ID = 'test-notion-data-source';
const notionCalls: Array<{ kind: 'queryDataSource' | 'updatePage'; input: Record<string, unknown> }> = [];
setNotionPortForTests({
  async queryDataSource(input) {
    notionCalls.push({ kind: 'queryDataSource', input: input as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      data: {
        results: [{
          id: 'notion-page-provider',
          archived: false,
          in_trash: false,
          parent: { database_id: 'db-test' },
          properties: {
            Name: { title: [{ plain_text: 'Provider seed' }] },
            'Utopia Domain': { rich_text: [{ plain_text: 'food' }] },
            'Utopia Collection': { rich_text: [{ plain_text: 'recipe' }] },
            status: { rich_text: [{ plain_text: 'done' }] },
          },
        }],
      },
    };
  },
  async createPage() {
    throw new Error('reactive-proposal-executor should not create notion pages in provider update flow');
  },
  async updatePage(input) {
    notionCalls.push({ kind: 'updatePage', input: input as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      data: {
        id: 'notion-page-provider',
        url: 'https://notion.test/notion-page-provider',
        archived: false,
        parent: { database_id: 'db-test' },
        created_time: '2026-07-23T00:00:00.000Z',
        last_edited_time: '2026-07-23T00:00:01.000Z',
      },
    };
  },
});
const providerLive = await executeReactiveProposalLive(providerLiveItem, { actor: 'approver', approval: approvalFor(providerLiveItem) });
setNotionPortForTests(null);
assert.equal(providerLive.ok, true);
assert.equal(providerLive.receipt?.verification?.providerWriteback?.provider, 'notion');
assert.equal(providerLive.receipt?.verification?.providerWriteback?.providerRecordId, 'notion-page-provider');
assert.equal(providerLive.receipt?.verification?.providerWriteback?.reason, 'provider_writeback_verified');
assert.equal(findRecord(providerSeed.id)?.source.provider, 'notion');
assert.equal(findRecord(providerSeed.id)?.properties.status, 'done');
assert.equal(notionCalls.some((call) => call.kind === 'updatePage'), true);
assert.equal(notionCalls.some((call) => call.kind === 'queryDataSource' && call.input.dataSourceId === 'test-notion-data-source'), true);

const mismatchSeed = createRecord({
  id: 'auto-provider-mismatch-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Provider mismatch seed',
  properties: { status: 'open' },
  relations: [],
  source: { provider: 'notion', external_id: 'notion-page-missing', url: null, observed_at: new Date().toISOString(), content_hash: null },
  archived_at: null,
}, { persist: false });
const mismatchTemplate = { kind: 'update_record' as const, collection: 'recipe', recordId: mismatchSeed.id, expectedRevision: mismatchSeed.revision, changes: { status: 'done' } };
const mismatchKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'auto-provider-mismatch-rule',
  event: updateEvent,
  causeId: 'provider-mismatch-cause',
  operationTemplate: mismatchTemplate,
});
const mismatchItem = {
  ...providerLiveItem,
  proposalId: 'auto-provider-mismatch-proposal',
  causeId: 'provider-mismatch-cause',
  proposal: {
    ...providerLiveItem.proposal,
    id: 'auto-provider-mismatch-proposal',
    ruleId: 'auto-provider-mismatch-rule',
    operationTemplate: mismatchTemplate,
    causeId: 'provider-mismatch-cause',
    envelope: {
      ...providerLiveItem.proposal.envelope,
      proposalId: 'auto-provider-mismatch-proposal',
      ruleId: 'auto-provider-mismatch-rule',
      operationTemplate: mismatchTemplate,
      causeId: 'provider-mismatch-cause',
      idempotencyKey: mismatchKey,
    },
  },
};
setNotionPortForTests({
  async queryDataSource() {
    return { ok: true, status: 200, data: { results: [] } };
  },
  async createPage() {
    throw new Error('reactive-proposal-executor should not create notion pages in mismatch flow');
  },
  async updatePage() {
    return {
      ok: true,
      status: 200,
      data: { id: 'notion-page-missing', url: 'https://notion.test/notion-page-missing', archived: false },
    };
  },
});
const mismatchLive = await executeReactiveProposalLive(mismatchItem, { actor: 'approver', approval: approvalFor(mismatchItem) });
setNotionPortForTests(null);
assert.equal(mismatchLive.ok, false);
assert.equal(mismatchLive.error, 'provider_writeback_readback_missing');
assert.equal(findRecord(mismatchSeed.id)?.properties.status, 'open');

const staleReadbackSeed = createRecord({
  id: 'auto-provider-stale-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Provider stale seed',
  properties: { status: 'open' },
  relations: [],
  source: { provider: 'notion', external_id: 'notion-page-stale', url: null, observed_at: new Date().toISOString(), content_hash: null },
  archived_at: null,
}, { persist: false });
const staleReadbackTemplate = { kind: 'update_record' as const, collection: 'recipe', recordId: staleReadbackSeed.id, expectedRevision: staleReadbackSeed.revision, changes: { status: 'done' } };
const staleReadbackKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'auto-provider-stale-rule',
  event: updateEvent,
  causeId: 'provider-stale-cause',
  operationTemplate: staleReadbackTemplate,
});
const staleReadbackItem = {
  ...providerLiveItem,
  proposalId: 'auto-provider-stale-proposal',
  causeId: 'provider-stale-cause',
  proposal: {
    ...providerLiveItem.proposal,
    id: 'auto-provider-stale-proposal',
    ruleId: 'auto-provider-stale-rule',
    operationTemplate: staleReadbackTemplate,
    causeId: 'provider-stale-cause',
    envelope: {
      ...providerLiveItem.proposal.envelope,
      proposalId: 'auto-provider-stale-proposal',
      ruleId: 'auto-provider-stale-rule',
      operationTemplate: staleReadbackTemplate,
      causeId: 'provider-stale-cause',
      idempotencyKey: staleReadbackKey,
    },
  },
};
setNotionPortForTests({
  async queryDataSource() {
    return {
      ok: true,
      status: 200,
      data: {
        results: [{
          id: 'notion-page-stale',
          archived: false,
          in_trash: false,
          parent: { database_id: 'db-test' },
          properties: {
            Name: { title: [{ plain_text: 'Provider stale seed' }] },
            'Utopia Domain': { rich_text: [{ plain_text: 'food' }] },
            'Utopia Collection': { rich_text: [{ plain_text: 'recipe' }] },
            status: { rich_text: [{ plain_text: 'open' }] },
          },
        }],
      },
    };
  },
  async createPage() {
    throw new Error('reactive-proposal-executor should not create notion pages in stale readback flow');
  },
  async updatePage() {
    return {
      ok: true,
      status: 200,
      data: { id: 'notion-page-stale', url: 'https://notion.test/notion-page-stale', archived: false },
    };
  },
});
const staleReadbackLive = await executeReactiveProposalLive(staleReadbackItem, { actor: 'approver', approval: approvalFor(staleReadbackItem) });
setNotionPortForTests(null);
assert.equal(staleReadbackLive.ok, false);
assert.equal(staleReadbackLive.error, 'provider_writeback_readback_mismatch');
assert.equal(findRecord(staleReadbackSeed.id)?.properties.status, 'open');

const sheetsSeed = createRecord({
  id: 'auto-sheets-provider-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Sheets seed',
  properties: { status: 'open' },
  relations: [],
  source: { provider: 'google_sheets', external_id: 'auto-sheets-provider-record', url: null, observed_at: new Date().toISOString(), content_hash: null },
  archived_at: null,
}, { persist: false });
const sheetsTemplate = { kind: 'update_record' as const, collection: 'recipe', recordId: sheetsSeed.id, expectedRevision: sheetsSeed.revision, changes: { status: 'done' } };
const sheetsKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'auto-sheets-provider-rule',
  event: updateEvent,
  causeId: 'sheets-provider-cause',
  operationTemplate: sheetsTemplate,
});
const sheetsItem = {
  ...providerLiveItem,
  proposalId: 'auto-sheets-provider-proposal',
  causeId: 'sheets-provider-cause',
  proposal: {
    ...providerLiveItem.proposal,
    id: 'auto-sheets-provider-proposal',
    ruleId: 'auto-sheets-provider-rule',
    operationTemplate: sheetsTemplate,
    causeId: 'sheets-provider-cause',
    envelope: {
      ...providerLiveItem.proposal.envelope,
      proposalId: 'auto-sheets-provider-proposal',
      ruleId: 'auto-sheets-provider-rule',
      operationTemplate: sheetsTemplate,
      causeId: 'sheets-provider-cause',
      idempotencyKey: sheetsKey,
      authorization: {
        ...providerLiveItem.proposal.envelope.authorization,
        providerAuthority: {
          targetProvider: 'google_sheets',
          authorityProvider: 'google_sheets',
          allowed: true,
          requiredCapability: 'reactive:provider:google_sheets:update_record',
          capabilityPresent: true,
          reason: 'provider_authority_ok',
        },
      },
    },
  },
};
process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'test-sheets-token';
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-sheets-id';
process.env.GOOGLE_SHEETS_DATA_SOURCE_ID = 'test-sheets-data-source';
const sheetRows = [
  ['id', 'title', 'domain', 'collection', 'properties', 'archived', 'version', 'updated_at', 'source', 'external_id'],
  ['auto-sheets-provider-record', 'Sheets seed', 'food', 'recipe', '{"status":"open"}', 'false', '1', '2026-07-23T00:00:00.000Z', '', 'auto-sheets-provider-record'],
];
setSheetsPortForTests({
  async getSpreadsheet() {
    return {
      ok: true,
      status: 200,
      data: {
        spreadsheetId: 'test-sheets-id',
        sheets: [{ properties: { title: 'Utopia Runtime', gridProperties: { columnCount: 26, rowCount: 100 } } }],
      },
    };
  },
  async batchGetValues() {
    return {
      ok: true,
      status: 200,
      data: { valueRanges: [{ range: 'Utopia Runtime!A:Z', values: sheetRows }] },
    };
  },
  async batchUpdateValues(input) {
    const update = input.data?.[0];
    const row = Number.parseInt(/!A([0-9]+)/.exec(String(update?.range ?? ''))?.[1] ?? '', 10);
    assert.equal(row, 2);
    sheetRows[row - 1] = update?.values?.[0] ?? [];
    return {
      ok: true,
      status: 200,
      data: { responses: [{ updatedRange: 'Utopia Runtime!A2:J2' }] },
    };
  },
});
const sheetsLive = await executeReactiveProposalLive(sheetsItem, { actor: 'approver', approval: approvalFor(sheetsItem) });
setSheetsPortForTests(null);
assert.equal(sheetsLive.ok, true);
assert.equal(sheetsLive.receipt?.verification?.providerWriteback?.provider, 'google_sheets');
assert.equal(sheetsLive.receipt?.verification?.providerWriteback?.providerRecordId, 'auto-sheets-provider-record');
assert.equal(sheetsLive.receipt?.verification?.providerWriteback?.reason, 'provider_writeback_verified');
assert.equal(findRecord(sheetsSeed.id)?.source.provider, 'google_sheets');
assert.equal(findRecord(sheetsSeed.id)?.properties.status, 'done');

const archiveSeed = createRecord({
  id: 'auto-archive-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Auto archive seed',
  properties: { status: 'stale' },
  relations: [],
  source: { provider: 'user', external_id: 'auto-archive-record', url: null, observed_at: new Date().toISOString(), content_hash: null },
  archived_at: null,
}, { persist: false });
const archiveEvent = { kind: 'operation' as const, id: 'auto-archive-operation' };
const archiveTemplate = { kind: 'archive_record' as const, collection: 'recipe', recordId: archiveSeed.id, expectedRevision: archiveSeed.revision };
const archiveAuthorization = {
  ...autoAuthorization,
  risk: 'sensitive' as const,
  reviewRequired: true,
  requiredCapability: 'reactive:propose:archive_record',
  capabilityPresent: false,
  reason: 'automatic_requires_policy_or_review',
};
const archiveKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'auto-archive-rule',
  event: archiveEvent,
  causeId: 'archive-cause',
  operationTemplate: archiveTemplate,
});
const archiveItem = {
  ...updateItem,
  proposalId: 'auto-archive-proposal',
  eventId: 'auto-archive-operation',
  causeId: 'archive-cause',
  proposal: {
    ...updateItem.proposal,
    id: 'auto-archive-proposal',
    eventId: 'auto-archive-operation',
    event: archiveEvent,
    ruleId: 'auto-archive-rule',
    operation: 'archive_record',
    operationTemplate: archiveTemplate,
    causeId: 'archive-cause',
    envelope: {
      ...updateItem.proposal.envelope,
      proposalId: 'auto-archive-proposal',
      operation: 'archive_record',
      operationTemplate: archiveTemplate,
      ruleId: 'auto-archive-rule',
      eventId: 'auto-archive-operation',
      event: archiveEvent,
      causeId: 'archive-cause',
      idempotencyKey: archiveKey,
      authorization: archiveAuthorization,
    },
  },
};
assert.equal(executeReactiveProposal(archiveItem).ok, true, 'review-required archive should queue without approval');
assert.equal(findRecord('auto-archive-record')?.archived_at, null);
const approvedArchive = executeReactiveProposal(archiveItem, { actor: 'approver', approval: approvalFor(archiveItem) });
assert.equal(approvedArchive.ok, true);
assert.equal(approvedArchive.receipt?.status, 'completed');
assert.equal(approvedArchive.receipt?.verification?.reason, 'canonical_archive_verified');
assert.equal((getActionEvent(approvedArchive.receipt?.actionId ?? '')?.verification_json as { reason?: string }).reason, 'canonical_archive_verified');
assert.ok(findRecord('auto-archive-record')?.archived_at);
const archiveRevision = findRecord('auto-archive-record')?.revision;
assert.equal(archiveRevision, (archiveSeed.revision ?? 0) + 1);
const approvedArchiveReplay = executeReactiveProposal(archiveItem, { actor: 'approver', approval: approvalFor(archiveItem) });
assert.equal(approvedArchiveReplay.ok, true);
assert.equal(approvedArchiveReplay.receipt?.replayed, true);
assert.equal(approvedArchiveReplay.receipt?.actionId, approvedArchive.receipt?.actionId);
assert.equal(approvedArchiveReplay.receipt?.verification?.operationId, approvedArchive.receipt?.verification?.operationId);
assert.equal(findRecord('auto-archive-record')?.revision, archiveRevision);

const staleArchiveSeed = createRecord({
  id: 'auto-stale-archive-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Auto stale archive seed',
  properties: { status: 'stale' },
  relations: [],
  source: { provider: 'user', external_id: 'auto-stale-archive-record', url: null, observed_at: new Date().toISOString(), content_hash: null },
  archived_at: null,
}, { persist: false });
const staleArchiveTemplate = { kind: 'archive_record' as const, collection: 'recipe', recordId: staleArchiveSeed.id, expectedRevision: staleArchiveSeed.revision };
updateRecord(staleArchiveSeed.id, { properties: { status: 'changed-before-approval' } }, { persist: false });
const staleArchiveKey = createOperationProposalIdempotencyKey({
  packageId: 'food',
  packageVersion: '1.0.0',
  ruleId: 'auto-stale-archive-rule',
  event: archiveEvent,
  causeId: 'stale-archive-cause',
  operationTemplate: staleArchiveTemplate,
});
const staleArchiveItem = {
  ...archiveItem,
  proposalId: 'auto-stale-archive-proposal',
  causeId: 'stale-archive-cause',
  proposal: {
    ...archiveItem.proposal,
    id: 'auto-stale-archive-proposal',
    ruleId: 'auto-stale-archive-rule',
    operationTemplate: staleArchiveTemplate,
    causeId: 'stale-archive-cause',
    envelope: {
      ...archiveItem.proposal.envelope,
      proposalId: 'auto-stale-archive-proposal',
      ruleId: 'auto-stale-archive-rule',
      operationTemplate: staleArchiveTemplate,
      causeId: 'stale-archive-cause',
      idempotencyKey: staleArchiveKey,
    },
  },
};
const staleArchive = executeReactiveProposal(staleArchiveItem, { actor: 'approver', approval: approvalFor(staleArchiveItem) });
assert.equal(staleArchive.ok, false);
assert.equal(staleArchive.error, 'canonical_archive_mismatch');
assert.equal(findRecord(staleArchiveSeed.id)?.archived_at, null);

console.log('reactive-proposal-executor: passed');

function approvalFor(item: { proposalId: string; proposal: { operation: string; envelope: { operationTemplate: unknown; idempotencyKey: string } & Record<string, unknown> } }, approver = 'approver') {
  return {
    schemaVersion: 'wonder.reactive-proposal-approval.v1' as const,
    approver,
    authority: 'test-authority',
    proposalId: item.proposalId,
    idempotencyKey: item.proposal.envelope.idempotencyKey,
    operationId: `proposal:${item.proposalId}:operation`,
    operationHash: hashValue(operationApprovalPayload(item)),
    proposalHash: hashValue(item.proposal.envelope),
    operationTemplateHash: hashValue(item.proposal.envelope.operationTemplate),
    localActor: approver,
    approvedAt: '2026-07-23T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
  };
}

function operationApprovalPayload(item: { proposalId: string; proposal: { operation: string; envelope: { operationTemplate: unknown; idempotencyKey: string } } }) {
  return {
    proposalId: item.proposalId,
    operation: item.proposal.operation,
    operationTemplate: item.proposal.envelope.operationTemplate,
    idempotencyKey: item.proposal.envelope.idempotencyKey,
  };
}

function hashValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

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
