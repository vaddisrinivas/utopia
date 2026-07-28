import type { OperationTemplate } from '@/packages/shared/contracts/package';

export const REACTIVE_PROPOSAL_POLICY_ID = 'wonder.reactive-proposal-policy' as const;
export const REACTIVE_PROPOSAL_POLICY_VERSION = 'v1' as const;

export type ReactiveProposalRisk = 'low' | 'standard' | 'sensitive' | 'restricted';

export type ReactiveProposalPolicyResult = Readonly<{
  policyId: typeof REACTIVE_PROPOSAL_POLICY_ID;
  policyVersion: typeof REACTIVE_PROPOSAL_POLICY_VERSION;
  allowed: boolean;
  risk: ReactiveProposalRisk;
  reviewRequired: boolean;
  requiredCapability: string;
  capabilityPresent: boolean;
  providerAuthority: {
    targetProvider: string;
    authorityProvider: string;
    allowed: boolean;
    requiredCapability: string | null;
    capabilityPresent: boolean;
    reason: string;
  };
  reason: string;
}>;

export type ReactiveProposalDryRun = Readonly<{
  ok: boolean;
  effect: 'queue_review_action';
  executable: boolean;
  reason: string;
}>;

export function evaluateReactiveProposalPolicy(input: {
  operationTemplate: OperationTemplate;
  requestedMode: 'suggest' | 'automatic';
  capabilities: readonly string[];
  targetProvider?: string;
  authorityProvider?: string;
}): ReactiveProposalPolicyResult {
  const risk = operationRisk(input.operationTemplate);
  const requiredCapability = requiredCapabilityFor(input.operationTemplate, input.requestedMode);
  const capabilityPresent = input.capabilities.includes(requiredCapability);
  const providerAuthority = evaluateProviderAuthority({
    operationTemplate: input.operationTemplate,
    capabilities: input.capabilities,
    targetProvider: input.targetProvider,
    authorityProvider: input.authorityProvider,
  });
  const automaticAllowed = input.requestedMode === 'automatic'
    && capabilityPresent
    && providerAuthority.allowed
    && risk === 'low'
    && input.operationTemplate.kind !== 'custom';
  const blocked = risk === 'restricted';
  return {
    policyId: REACTIVE_PROPOSAL_POLICY_ID,
    policyVersion: REACTIVE_PROPOSAL_POLICY_VERSION,
    allowed: !blocked && providerAuthority.allowed,
    risk,
    reviewRequired: !automaticAllowed,
    requiredCapability,
    capabilityPresent,
    providerAuthority,
    reason: blocked
      ? 'operation_template_restricted'
      : !providerAuthority.allowed
        ? providerAuthority.reason
      : automaticAllowed
        ? 'automatic_policy_authorized'
        : input.requestedMode === 'automatic'
          ? 'automatic_requires_policy_or_review'
          : 'suggest_mode_requires_review',
  };
}

function evaluateProviderAuthority(input: {
  operationTemplate: OperationTemplate;
  capabilities: readonly string[];
  targetProvider?: string;
  authorityProvider?: string;
}): ReactiveProposalPolicyResult['providerAuthority'] {
  const targetProvider = normalizeProvider(input.targetProvider);
  const authorityProvider = normalizeProvider(input.authorityProvider ?? 'notion');
  const localProvider = targetProvider === 'user' || targetProvider === 'sqlite' || targetProvider === 'local_sqlite';
  const requiredCapability = localProvider || input.operationTemplate.kind === 'custom'
    ? null
    : `reactive:provider:${targetProvider}:${input.operationTemplate.kind}`;
  const capabilityPresent = requiredCapability ? input.capabilities.includes(requiredCapability) : true;
  const allowed = localProvider
    || input.operationTemplate.kind === 'custom'
    || (targetProvider === authorityProvider && capabilityPresent);
  return {
    targetProvider,
    authorityProvider,
    allowed,
    requiredCapability,
    capabilityPresent,
    reason: allowed
      ? 'provider_authority_ok'
      : targetProvider !== authorityProvider
        ? 'provider_not_configured_authority'
        : 'provider_authority_capability_missing',
  };
}

function normalizeProvider(value?: string): string {
  const normalized = value?.trim();
  return normalized || 'user';
}

export function dryRunReactiveProposal(input: {
  operationTemplate: OperationTemplate;
  policy: ReactiveProposalPolicyResult;
}): ReactiveProposalDryRun {
  return {
    ok: input.policy.allowed,
    effect: 'queue_review_action',
    executable: input.policy.allowed && input.operationTemplate.kind !== 'custom',
    reason: input.policy.allowed ? 'proposal_can_be_queued' : input.policy.reason,
  };
}

function requiredCapabilityFor(operationTemplate: OperationTemplate, requestedMode: 'suggest' | 'automatic'): string {
  return requestedMode === 'automatic'
    ? `reactive:auto:${operationTemplate.kind}`
    : `reactive:propose:${operationTemplate.kind}`;
}

function operationRisk(operationTemplate: OperationTemplate): ReactiveProposalRisk {
  if (operationTemplate.kind === 'custom') return 'standard';
  if (operationTemplate.kind === 'create_record') return 'low';
  if (operationTemplate.kind === 'update_record') return 'standard';
  if (operationTemplate.kind === 'archive_record' || operationTemplate.kind === 'restore_record') return 'sensitive';
  return 'restricted';
}
