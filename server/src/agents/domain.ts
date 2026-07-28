import { normalizeConfidence, type ConfidenceValue } from '@/packages/shared/contracts/confidence';

type Policy = {
  domain: string;
  command: string;
  allowed: boolean;
  reason: string;
  policy: string;
  confidence: ConfidenceValue;
  requiresClarification?: boolean;
  clarifyingQuestion?: string;
};

export async function applyDomainPolicy(input: { domain: string; command: string }) {
  const isWrite = /\b(add|create|archive|update|delete|remove|order|buy|purchase)\b/i.test(input.command);
  const hasAmbiguousTarget = isWrite && !/\b(\bmeal\b|\brecipe\b|\bshopping\b|\bitem\b|\binventory\b|\brecord)\b/i.test(input.command);
  const ambiguousWrite = hasAmbiguousTarget;

  return {
    domain: input.domain,
    command: input.command,
    policy: 'food-safe',
    allowed: !ambiguousWrite,
    reason: ambiguousWrite ? 'Write command missing target subject for safe approval policy.' : 'Within allowed domain tool surface.',
    confidence: normalizeConfidence(ambiguousWrite ? 'medium' : 'high'),
    requiresClarification: ambiguousWrite,
    clarifyingQuestion: ambiguousWrite
      ? 'Which exact record should I update?'
      : undefined,
  } satisfies Policy;
}
