import { normalizeConfidence, type ConfidenceValue } from '@/packages/shared/contracts/confidence';

export type ActionRisk = 'low' | 'standard' | 'sensitive' | 'irreversible' | 'restricted';
export type PolicyDecisionKind = 'deny' | 'clarify' | 'review' | 'execute';

type PolicyDecisionBase<TDecision extends PolicyDecisionKind> = {
  decision: TDecision;
  reason: string;
  risk: ActionRisk;
  confidence: ConfidenceValue;
};

export type DenyPolicyDecision = PolicyDecisionBase<'deny'>;

export type ClarifyPolicyDecision = PolicyDecisionBase<'clarify'> & {
  clarifyingQuestion: string;
};

export type ReviewPolicyDecision = PolicyDecisionBase<'review'> & {
  review: 'optional' | 'required';
};

export type ExecutePolicyDecision = PolicyDecisionBase<'execute'>;

export type PolicyDecision =
  | DenyPolicyDecision
  | ClarifyPolicyDecision
  | ReviewPolicyDecision
  | ExecutePolicyDecision;

export function policyDeniesExecution(policy: PolicyDecision): policy is DenyPolicyDecision {
  return policy.decision === 'deny';
}

export function policyNeedsClarification(policy: PolicyDecision): policy is ClarifyPolicyDecision {
  return policy.decision === 'clarify';
}

export function policyRequiresReview(policy: PolicyDecision): policy is ReviewPolicyDecision {
  return policy.decision === 'review';
}

export function policyCanExecute(policy: PolicyDecision): policy is ExecutePolicyDecision {
  return policy.decision === 'execute';
}

const WRITE_VERBS_RE = /\b(add|create|archive|update|delete|remove|order|buy|purchase)\b/i;
const FOOD_SUBJECT_RE = /\b(meal|recipe|shopping|item|inventory|record)\b/i;
const BLOCKED_TOOL_RE = /\b(delete|destroy|credential|private|payment|message|message.send|billing|export|purge)\b/i;

export function evaluateCommandPolicy(input: { domain: string; tool: string; command: string; actor?: string }) {
  const command = (input.command || '').trim();
  const isWrite = WRITE_VERBS_RE.test(command);
  const hasAmbiguousWrite = isWrite && !FOOD_SUBJECT_RE.test(command);

  if (BLOCKED_TOOL_RE.test(input.tool) || BLOCKED_TOOL_RE.test(command)) {
    return {
      decision: 'deny',
      reason: 'Tool or command is restricted for safety policy.',
      risk: 'restricted' as ActionRisk,
      confidence: normalizeConfidence('high'),
    } satisfies PolicyDecision;
  }

  if (hasAmbiguousWrite) {
    return {
      decision: 'clarify',
      reason: 'Write command missing target subject for safe policy.',
      clarifyingQuestion: 'Which exact Food record should I act on? (meal, recipe, shopping list, inventory item, or record id)',
      risk: 'standard' as ActionRisk,
      confidence: normalizeConfidence('medium'),
    } satisfies PolicyDecision;
  }

  const isRiskyWrite = /(destroy|delete|archive|purchase|buy|update|remove|message)/i.test(command);

  return {
    decision: 'execute',
    reason: `${input.domain} command accepted under domain policy.`,
    risk: (isRiskyWrite ? 'standard' : 'low') as ActionRisk,
    confidence: normalizeConfidence('high'),
  } satisfies PolicyDecision;
}
