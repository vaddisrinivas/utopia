import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderWritebackInput } from '../../server/src/kernel/reactive-proposal-executor';

const stateDir = mkdtempSync(join(tmpdir(), 'utopia-reactive-provider-writeback-'));
process.env.WONDER_RUNTIME_STATE_PATH = join(stateDir, 'wonder-runtime.json');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
const { createRecordWithAction, findRecord, getActionEvent } = await import('../../server/src/runtime/state');
const {
  executeReactiveProposal,
  executeReactiveProposalWithProviderWriteback,
} = await import('../../server/src/kernel/reactive-proposal-executor');

const recordId = 'reactive-provider-yogurt';
createRecordWithAction({
  actionId: 'seed-reactive-provider-yogurt',
  actor: 'test',
  domain: 'food',
  tool: 'seed',
  risk: 'low',
  command: 'seed provider-backed record',
  record: {
    id: recordId,
    domain: 'food',
    collection: 'inventory',
    title: 'Reactive provider yogurt',
    properties: { quantity: 2, nested: { unit: 'cups' } },
    relations: [],
    source: {
      provider: 'notion',
      external_id: 'notion-page-reactive-provider-yogurt',
      url: 'https://notion.so/notion-page-reactive-provider-yogurt',
      observed_at: '2026-07-24T00:00:00.000Z',
      content_hash: 'notion-before-digest',
    },
    archived_at: null,
    revision: 1,
  },
  idempotencyKey: 'seed-reactive-provider-yogurt',
});

const operationTemplate = {
  kind: 'update_record' as const,
  domain: 'food',
  collection: 'inventory',
  recordId,
  expectedRevision: 1,
  changes: { quantity: 4, nested: { unit: 'cups' } },
};

const envelope = {
  schemaVersion: 'wonder.operation-proposal.v1' as const,
  proposalId: 'proposal-reactive-provider-writeback',
  operation: 'utopia.update_record',
  operationTemplate,
  mode: 'automatic' as const,
  ruleId: 'test-provider-writeback',
  packageId: 'wonder.food',
  packageVersion: 'test',
  eventId: 'event-provider-writeback',
  event: { kind: 'operation' as const, id: 'event-provider-writeback' },
  causeId: 'cause-provider-writeback',
  depth: 0,
  idempotencyKey: 'reactive-provider-writeback-update-key',
  review: {
    required: false,
    reason: 'policy_authorized' as const,
    policyId: 'wonder.reactive-proposal-policy',
    policyVersion: 'v1',
  },
  authorization: {
    policyId: 'wonder.reactive-proposal-policy' as const,
    policyVersion: 'v1' as const,
    allowed: true,
    risk: 'standard' as const,
    reviewRequired: false,
    requiredCapability: 'records.update',
    capabilityPresent: true,
    providerAuthority: {
      targetProvider: 'notion',
      authorityProvider: 'notion',
      allowed: true,
      requiredCapability: 'notion.write',
      capabilityPresent: true,
      reason: 'provider authority present',
    },
    reason: 'authorized for provider writeback proof',
  },
  dryRun: {
    ok: true,
    effect: 'queue_review_action' as const,
    executable: true,
    reason: 'dry run ok',
  },
  evidence: {
    targetRecordId: recordId,
    targetBeforeRevision: 1,
    targetAfterRevision: 2,
    beforeVersionVectorHash: 'before-vector',
    afterVersionVectorHash: 'after-vector',
    sourceEventId: 'event-provider-writeback',
  },
};

const item = {
  proposalId: envelope.proposalId,
  cycleId: 'cycle-provider-writeback',
  eventId: envelope.eventId,
  actionId: 'source-action-provider-writeback',
  operationId: 'source-operation-provider-writeback',
  causeId: envelope.causeId,
  domain: 'food',
  status: 'pending' as const,
  attempts: 0,
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  nextAttemptAt: '2026-07-24T00:00:00.000Z',
  proposal: {
    id: envelope.proposalId,
    eventId: envelope.eventId,
    operation: envelope.operation,
    operationTemplate,
    ruleId: envelope.ruleId,
    packageVersion: envelope.packageVersion,
    event: envelope.event,
    causeId: envelope.causeId,
    mode: envelope.mode,
    depth: envelope.depth,
    envelope,
  },
};

const blocked = executeReactiveProposal(item);
assert(!blocked.ok && blocked.error === 'provider_writeback_verification_missing', 'provider target must fail closed without verifier');
assert(findRecord(recordId)?.properties.quantity === 2, 'fail-closed provider proposal must not mutate local record');

let verifierCalled = false;
const verified = await executeReactiveProposalWithProviderWriteback(item, {
  providerWriteback: async (input: ProviderWritebackInput) => {
    verifierCalled = true;
    assert(input.provider === 'notion', 'verifier must receive target provider');
    assert(input.commandPreview.args.id === recordId, 'verifier must receive target record id');
    return {
      ok: true,
      source: {
        provider: 'notion',
        external_id: 'notion-page-reactive-provider-yogurt',
        url: 'https://notion.so/notion-page-reactive-provider-yogurt',
        observed_at: '2026-07-24T00:01:00.000Z',
        content_hash: 'notion-after-digest',
      },
      receipt: {
        ok: true,
        provider: 'notion',
        operation: 'update_record',
        providerRecordId: 'notion-page-reactive-provider-yogurt',
        sourceSnapshotHash: 'sha256:provider-write',
        sourceSnapshot: { page_id: 'notion-page-reactive-provider-yogurt', title: 'Reactive provider yogurt' },
        readbackSnapshotHash: 'sha256:provider-readback',
        readbackSnapshot: { page_id: 'notion-page-reactive-provider-yogurt', quantity: 4 },
        reason: 'provider_writeback_verified',
      },
    };
  },
});

assert(verifierCalled, 'provider verifier was not called');
assert(verified.ok, `verified provider proposal failed: ${JSON.stringify(verified)}`);
const after = findRecord(recordId);
assert(after?.properties.quantity === 4, 'provider-verified proposal did not update canonical record');
assert(after?.source.provider === 'notion', 'provider-verified proposal lost provider source');
assert(after?.source.content_hash === 'notion-after-digest', 'provider source digest was not retained');

const action = getActionEvent(verified.receipt!.actionId);
const receipt = action?.verification_json as { providerWriteback?: { ok?: boolean; reason?: string } } | null | undefined;
assert(receipt?.providerWriteback?.ok === true, 'stored action receipt missing provider writeback verifier');
assert(receipt.providerWriteback.reason === 'provider_writeback_verified', 'provider verifier reason not retained');

console.log(JSON.stringify({
  ok: true,
  proof: 'reactive_provider_writeback_verifier',
  runtime_state_path: process.env.WONDER_RUNTIME_STATE_PATH,
  provider_verifier_called: verifierCalled,
  action_id: verified.receipt!.actionId,
  verification_reason: verified.receipt!.verification?.reason,
  provider_reason: receipt.providerWriteback.reason,
}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
