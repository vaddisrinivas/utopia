import type { OperationTemplate } from './package';

export type RuleContext = {
  event: ProposalEvent;
  data: unknown;
  packageVersion: string;
  causeId: string;
  depth: number;
};

export type ProposalEvent = Readonly<{
  kind: 'operation' | 'schedule' | 'query_transition';
  id: string;
  queryId?: string;
  transition?: 'enter' | 'leave' | 'change';
}>;

export type OperationProposal = {
  ruleId: string;
  operation: string;
  operationTemplate: OperationTemplate;
  mode: 'suggest' | 'automatic';
  causeId: string;
  packageVersion: string;
  depth: number;
  event: ProposalEvent;
};

export type OperationProposalEnvelope = Readonly<{
  schemaVersion: 'wonder.operation-proposal.v1';
  proposalId: string;
  operation: string;
  operationTemplate: OperationTemplate;
  mode: 'suggest' | 'automatic';
  ruleId: string;
  packageId: string;
  packageVersion: string;
  eventId: string;
  event: ProposalEvent;
  causeId: string;
  depth: number;
  idempotencyKey: string;
  review: {
    required: boolean;
    reason: 'suggest_mode' | 'policy_required' | 'policy_authorized';
    policyId: string;
    policyVersion: string;
  };
  authorization: {
    policyId: string;
    policyVersion: string;
    allowed: boolean;
    risk: 'low' | 'standard' | 'sensitive' | 'restricted';
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
  };
  dryRun: {
    ok: boolean;
    effect: 'queue_review_action';
    executable: boolean;
    reason: string;
  };
  evidence: {
    queryId?: string;
    transition?: 'enter' | 'leave' | 'change';
    beforeHash?: string;
    afterHash?: string;
    querySpecHash?: string;
    packageHash?: string;
    evaluatorVersion?: string;
    targetRecordId?: string;
    targetBeforeRevision?: number;
    targetAfterRevision?: number;
    beforeVersionVectorHash?: string;
    afterVersionVectorHash?: string;
    sourceEventId?: string;
  };
}>;
