import jsonPatch, { type Operation as JsonPatchOperation } from 'fast-json-patch';

import { sha256Canonical } from '@/src/domain/canonical-json';

export const COMPOSITION_STATE_SCHEMA_VERSION = 'wonder.composition.state.v1' as const;

export type CompositionCapabilityAction = 'read' | 'propose_write';
export type CompositionGrantMode = 'read' | 'propose_write';

export type CompositionCapabilitySchema = Readonly<{
  schemaVersion: 'wonder.composition.capability.v1';
  capabilityId: string;
  label: string;
  actions: readonly CompositionCapabilityAction[];
  resource: 'composition';
}>;

export type CompositionGrant = Readonly<{
  schemaVersion: 'wonder.composition.grant.v1';
  grantId: string;
  capabilityId: string;
  subjectId: string;
  mode: CompositionGrantMode;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  grantHash: string;
}>;

export type CompositionProposal = Readonly<{
  schemaVersion: 'wonder.composition.proposal.v1';
  proposalId: string;
  compositionId: string;
  capabilityId: string;
  grantId: string;
  grantHash: string;
  requestedBy: string;
  requestedAt: string;
  justification: string;
  baseRevision: string;
  operations: readonly JsonPatchOperation[];
  proposalHash: string;
}>;

export type CompositionApprovalReceipt = Readonly<{
  schemaVersion: 'wonder.composition.approval.v1';
  approved: true;
  proposalId: string;
  compositionId: string;
  capabilityId: string;
  grantId: string;
  grantHash: string;
  proposalHash: string;
  baseRevision: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string | null;
  nonce: string;
}>;

export type CompositionState = Readonly<{
  schemaVersion: typeof COMPOSITION_STATE_SCHEMA_VERSION;
  compositionId: string;
  revision: string;
  payload: Record<string, unknown>;
  capabilities: Record<string, CompositionCapabilitySchema>;
  grants: Record<string, CompositionGrant>;
  pendingProposals: Record<string, CompositionProposal>;
  consumedApprovals: Record<string, CompositionApprovalReceipt>;
}>;

export type CompositionRuntime = Readonly<{
  schemaVersion: 'wonder.composition.runtime.v1';
  compositionId: string;
  revision: string;
  mode: 'read_only';
  snapshot: Readonly<Record<string, unknown>>;
  capabilities: readonly string[];
  grants: readonly CompositionGrant[];
  canProposeWrite: boolean;
}>;

export function createCompositionCapabilitySchema(input: {
  capabilityId: string;
  label: string;
  actions: readonly CompositionCapabilityAction[];
}): CompositionCapabilitySchema {
  const capabilityId = text(input.capabilityId);
  const label = text(input.label);
  if (!capabilityId) throw new Error('composition_capability_required');
  if (!label) throw new Error('composition_capability_label_required');
  const actions = Array.from(new Set(input.actions));
  if (!actions.includes('read')) throw new Error('composition_capability_read_required');
  if (actions.some((action) => action !== 'read' && action !== 'propose_write')) {
    throw new Error('composition_capability_action_invalid');
  }
  return {
    schemaVersion: 'wonder.composition.capability.v1',
    capabilityId,
    label,
    actions,
    resource: 'composition',
  };
}

export function createCompositionGrant(
  capability: CompositionCapabilitySchema,
  input: {
    grantId: string;
    subjectId: string;
    mode: CompositionGrantMode;
    grantedBy: string;
    grantedAt: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
  },
): CompositionGrant {
  const grantId = text(input.grantId);
  const subjectId = text(input.subjectId);
  const grantedBy = text(input.grantedBy);
  if (!grantId) throw new Error('composition_grant_id_required');
  if (!subjectId) throw new Error('composition_grant_subject_required');
  if (!grantedBy) throw new Error('composition_grant_actor_required');
  assertIso(input.grantedAt, 'composition_grant_time_invalid');
  if (input.expiresAt != null) assertIso(input.expiresAt, 'composition_grant_expiry_invalid');
  if (input.revokedAt != null) assertIso(input.revokedAt, 'composition_grant_revoked_invalid');
  if (!capability.actions.includes(input.mode)) throw new Error('composition_grant_mode_not_allowed');
  const draft = {
    schemaVersion: 'wonder.composition.grant.v1' as const,
    grantId,
    capabilityId: capability.capabilityId,
    subjectId,
    mode: input.mode,
    grantedBy,
    grantedAt: input.grantedAt,
    expiresAt: input.expiresAt ?? null,
    revokedAt: input.revokedAt ?? null,
  };
  return {
    ...draft,
    grantHash: hashValue(draft),
  };
}

export function createCompositionState(input: {
  compositionId: string;
  payload: Record<string, unknown>;
  capabilities: readonly CompositionCapabilitySchema[];
  grants?: readonly CompositionGrant[];
}): CompositionState {
  const compositionId = text(input.compositionId);
  if (!compositionId) throw new Error('composition_id_required');
  const capabilities = Object.fromEntries(input.capabilities.map((item) => [item.capabilityId, item]));
  const grants = Object.fromEntries((input.grants ?? []).map((item) => [item.grantId, item]));
  return {
    schemaVersion: COMPOSITION_STATE_SCHEMA_VERSION,
    compositionId,
    revision: computeCompositionRevision(input.payload),
    payload: clone(input.payload),
    capabilities,
    grants,
    pendingProposals: {},
    consumedApprovals: {},
  };
}

export function buildCompositionRuntime(
  state: CompositionState,
  input: {
    subjectId: string;
    at: string;
  },
): CompositionRuntime {
  assertIso(input.at, 'composition_runtime_time_invalid');
  const grants = activeGrants(state, input.subjectId, input.at);
  const capabilityIds = Array.from(new Set(grants.map((grant) => grant.capabilityId))).sort();
  return {
    schemaVersion: 'wonder.composition.runtime.v1',
    compositionId: state.compositionId,
    revision: state.revision,
    mode: 'read_only',
    snapshot: deepFreeze(clone(state.payload)),
    capabilities: capabilityIds,
    grants,
    canProposeWrite: grants.some((grant) => grant.mode === 'propose_write'),
  };
}

export function submitCompositionProposal(
  state: CompositionState,
  input: {
    proposalId: string;
    capabilityId: string;
    grantId: string;
    requestedBy: string;
    requestedAt: string;
    justification: string;
    operations: readonly JsonPatchOperation[];
  },
): {
  state: CompositionState;
  proposal: CompositionProposal;
} {
  assertIso(input.requestedAt, 'composition_proposal_time_invalid');
  const capability = state.capabilities[input.capabilityId];
  if (!capability) throw new Error('composition_capability_missing');
  if (!capability.actions.includes('propose_write')) throw new Error('composition_capability_read_only');
  const grant = requireActiveGrant(state, input.grantId, input.requestedBy, input.requestedAt, 'propose_write');
  if (grant.capabilityId !== capability.capabilityId) throw new Error('composition_grant_capability_mismatch');
  const proposalId = text(input.proposalId);
  const justification = text(input.justification);
  if (!proposalId) throw new Error('composition_proposal_id_required');
  if (!justification) throw new Error('composition_proposal_justification_required');
  if (input.operations.length < 1) throw new Error('composition_proposal_operations_required');
  if (input.operations.length > 24) throw new Error('composition_proposal_operations_exceeded');
  applyOperations(state.payload, input.operations);
  const draft = {
    schemaVersion: 'wonder.composition.proposal.v1' as const,
    proposalId,
    compositionId: state.compositionId,
    capabilityId: capability.capabilityId,
    grantId: grant.grantId,
    grantHash: grant.grantHash,
    requestedBy: text(input.requestedBy),
    requestedAt: input.requestedAt,
    justification,
    baseRevision: state.revision,
    operations: input.operations.map((operation) => clone(operation)),
  };
  const proposal: CompositionProposal = {
    ...draft,
    proposalHash: hashValue(draft),
  };
  return {
    proposal,
    state: {
      ...state,
      pendingProposals: {
        ...state.pendingProposals,
        [proposal.proposalId]: proposal,
      },
    },
  };
}

export function approveCompositionProposal(
  state: CompositionState,
  proposal: CompositionProposal,
  input: {
    approvedBy: string;
    approvedAt: string;
    expiresAt?: string | null;
    nonce: string;
  },
): CompositionApprovalReceipt {
  if (!state.pendingProposals[proposal.proposalId]) throw new Error('composition_proposal_missing');
  const approvedBy = text(input.approvedBy);
  const nonce = text(input.nonce);
  if (!approvedBy) throw new Error('composition_approval_actor_required');
  if (!nonce) throw new Error('composition_approval_nonce_required');
  assertIso(input.approvedAt, 'composition_approval_time_invalid');
  if (input.expiresAt != null) assertIso(input.expiresAt, 'composition_approval_expiry_invalid');
  if (proposal.baseRevision !== state.revision) throw new Error('composition_revision_moved');
  return {
    schemaVersion: 'wonder.composition.approval.v1',
    approved: true,
    proposalId: proposal.proposalId,
    compositionId: state.compositionId,
    capabilityId: proposal.capabilityId,
    grantId: proposal.grantId,
    grantHash: proposal.grantHash,
    proposalHash: proposal.proposalHash,
    baseRevision: proposal.baseRevision,
    approvedBy,
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt ?? null,
    nonce,
  };
}

export function applyApprovedCompositionProposal(
  state: CompositionState,
  proposal: CompositionProposal,
  approval: CompositionApprovalReceipt,
): {
  state: CompositionState;
  revision: string;
} {
  const stored = state.pendingProposals[proposal.proposalId];
  if (!stored) throw new Error('composition_proposal_missing');
  if (approval.schemaVersion !== 'wonder.composition.approval.v1' || approval.approved !== true) {
    throw new Error('composition_approval_mismatch');
  }
  if (state.consumedApprovals[approval.nonce]) throw new Error('composition_approval_replayed');
  if (approval.compositionId !== state.compositionId) throw new Error('composition_approval_scope_mismatch');
  if (approval.proposalHash !== stored.proposalHash || approval.grantHash !== stored.grantHash) {
    throw new Error('composition_approval_mismatch');
  }
  if (approval.baseRevision !== state.revision || stored.baseRevision !== state.revision) {
    throw new Error('composition_revision_moved');
  }
  if (approval.expiresAt && Date.parse(approval.expiresAt) < Date.parse(approval.approvedAt)) {
    throw new Error('composition_approval_expired');
  }
  const nextPayload = applyOperations(state.payload, stored.operations);
  const revision = computeCompositionRevision(nextPayload);
  const nextPending = { ...state.pendingProposals };
  delete nextPending[proposal.proposalId];
  return {
    revision,
    state: {
      ...state,
      revision,
      payload: nextPayload,
      pendingProposals: nextPending,
      consumedApprovals: {
        ...state.consumedApprovals,
        [approval.nonce]: approval,
      },
    },
  };
}

export function computeCompositionRevision(payload: Record<string, unknown>): string {
  return hashValue(payload);
}

function activeGrants(state: CompositionState, subjectId: string, at: string): CompositionGrant[] {
  return Object.values(state.grants)
    .filter((grant) => (
      grant.subjectId === subjectId
      && !grant.revokedAt
      && (!grant.expiresAt || Date.parse(grant.expiresAt) >= Date.parse(at))
    ))
    .sort((left, right) => left.grantId.localeCompare(right.grantId));
}

function requireActiveGrant(
  state: CompositionState,
  grantId: string,
  subjectId: string,
  at: string,
  mode: CompositionGrantMode,
): CompositionGrant {
  const grant = state.grants[grantId];
  if (!grant) throw new Error('composition_grant_missing');
  if (grant.subjectId !== subjectId) throw new Error('composition_grant_subject_mismatch');
  if (grant.mode !== mode) throw new Error('composition_grant_mode_mismatch');
  if (grant.revokedAt) throw new Error('composition_grant_revoked');
  if (grant.expiresAt && Date.parse(grant.expiresAt) < Date.parse(at)) throw new Error('composition_grant_expired');
  return grant;
}

function applyOperations(
  payload: Record<string, unknown>,
  operations: readonly JsonPatchOperation[],
): Record<string, unknown> {
  const clonePayload = clone(payload);
  return jsonPatch.applyPatch(
    clonePayload as Record<string, unknown>,
    operations.map((operation) => clone(operation)),
    true,
    true,
  ).newDocument as Record<string, unknown>;
}

function hashValue(value: unknown): string {
  return sha256Canonical(value);
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function assertIso(value: string, errorCode: string) {
  if (Number.isNaN(Date.parse(value))) throw new Error(errorCode);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
