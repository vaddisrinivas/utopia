import { evaluateExpression } from './expression';
import type { Expression } from './expression';
import type { ReactiveProposalDryRun, ReactiveProposalPolicyResult } from './reactive-proposal-policy';
import { normalizeOperationTemplate, operationTemplateName } from './package';
import {
  type OperationProposal,
  type OperationProposalEnvelope,
  type ProposalEvent,
  type RuleContext,
} from '@/packages/shared/contracts/rules';
import {
  type OperationTemplate,
  type RuleSpec,
} from '@/packages/shared/contracts/package';
import { canonicalJson, sha256Canonical } from '@/src/domain/canonical-json';

export type { OperationProposal, OperationProposalEnvelope, OperationTemplate, ProposalEvent, RuleContext, RuleSpec };

export function createOperationProposalIdempotencyKey(input: {
  packageId: string;
  packageVersion: string;
  ruleId: string;
  event: ProposalEvent;
  causeId: string;
  operationTemplate: OperationTemplate;
  evidence?: OperationProposalEnvelope['evidence'];
}): string {
  return `reactive:${sha256Canonical({
    schemaVersion: 'wonder.operation-proposal.v1',
    ...input,
  }).slice('sha256:'.length)}`;
}

export function evaluateRules(rules: readonly RuleSpec[], context: RuleContext): OperationProposal[] {
  if (context.depth > 32) throw new Error('rule_depth_exceeded');
  const proposals: OperationProposal[] = [];
  for (const rule of rules) {
    if (rule.trigger.kind !== context.event.kind) continue;
    if (rule.trigger.kind === 'query_transition' && rule.trigger.query !== (context.event.queryId ?? context.event.id)) continue;
    if (rule.trigger.kind === 'query_transition' && rule.trigger.transition && rule.trigger.transition !== context.event.transition) continue;
    if (rule.when && !Boolean(evaluateExpression(context.data, rule.when as Expression))) continue;
    const operationTemplate = normalizeOperationTemplate(rule.effect.operation);
    const max = Math.min(rule.maxRunsPerEvent, 64);
    for (let count = 0; count < max; count += 1) {
      proposals.push({
        ruleId: rule.id,
        operation: operationTemplateName(operationTemplate),
        operationTemplate,
        mode: rule.mode,
        causeId: context.causeId,
        packageVersion: context.packageVersion,
        depth: context.depth,
        event: context.event,
      });
    }
  }
  return proposals;
}

function stableJson(value: unknown): string {
  return canonicalJson(value);
}
