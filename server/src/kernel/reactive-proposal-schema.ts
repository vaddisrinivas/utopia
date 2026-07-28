import { z } from 'zod';
import type { OperationTemplate } from '@/packages/shared/contracts/package';
import type { OperationProposalEnvelope, ProposalEvent } from './rules';

const nonEmpty = z.string().min(1);
const transitionSchema = z.enum(['enter', 'leave', 'change']);

export const proposalEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('operation'),
    id: nonEmpty,
  }).strict(),
  z.object({
    kind: z.literal('schedule'),
    id: nonEmpty,
  }).strict(),
  z.object({
    kind: z.literal('query_transition'),
    id: nonEmpty,
    queryId: nonEmpty,
    transition: transitionSchema,
  }).strict(),
]);

export const operationTemplateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('custom'),
    tool: nonEmpty,
  }).strict(),
  z.object({
    kind: z.literal('create_record'),
    domain: nonEmpty.optional(),
    collection: nonEmpty,
    recordId: nonEmpty.optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    kind: z.literal('update_record'),
    domain: nonEmpty.optional(),
    collection: nonEmpty.optional(),
    recordId: nonEmpty,
    expectedRevision: z.number().int().nonnegative().optional(),
    changes: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({
    kind: z.literal('archive_record'),
    domain: nonEmpty.optional(),
    collection: nonEmpty.optional(),
    recordId: nonEmpty,
    expectedRevision: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    kind: z.literal('restore_record'),
    domain: nonEmpty.optional(),
    collection: nonEmpty.optional(),
    recordId: nonEmpty,
    expectedRevision: z.number().int().nonnegative().optional(),
  }).strict(),
]);

export const operationProposalEnvelopeSchema = z.object({
  schemaVersion: z.literal('wonder.operation-proposal.v1'),
  proposalId: nonEmpty,
  operation: nonEmpty,
  operationTemplate: operationTemplateSchema,
  mode: z.enum(['suggest', 'automatic']),
  ruleId: nonEmpty,
  packageId: nonEmpty,
  packageVersion: nonEmpty,
  eventId: nonEmpty,
  event: proposalEventSchema,
  causeId: nonEmpty,
  depth: z.number().int().nonnegative(),
  idempotencyKey: nonEmpty,
  review: z.object({
    required: z.boolean(),
    reason: z.enum(['suggest_mode', 'policy_required', 'policy_authorized']),
    policyId: nonEmpty,
    policyVersion: nonEmpty,
  }).strict(),
  authorization: z.object({
    policyId: z.literal('wonder.reactive-proposal-policy'),
    policyVersion: z.literal('v1'),
    allowed: z.boolean(),
    risk: z.enum(['low', 'standard', 'sensitive', 'restricted']),
    reviewRequired: z.boolean(),
    requiredCapability: nonEmpty,
    capabilityPresent: z.boolean(),
    providerAuthority: z.object({
      targetProvider: nonEmpty,
      authorityProvider: nonEmpty,
      allowed: z.boolean(),
      requiredCapability: nonEmpty.nullable(),
      capabilityPresent: z.boolean(),
      reason: nonEmpty,
    }).strict(),
    reason: nonEmpty,
  }).strict(),
  dryRun: z.object({
    ok: z.boolean(),
    effect: z.literal('queue_review_action'),
    executable: z.boolean(),
    reason: nonEmpty,
  }).strict(),
  evidence: z.object({
    queryId: nonEmpty.optional(),
    transition: transitionSchema.optional(),
    beforeHash: nonEmpty.optional(),
    afterHash: nonEmpty.optional(),
    querySpecHash: nonEmpty.optional(),
    packageHash: nonEmpty.optional(),
    evaluatorVersion: nonEmpty.optional(),
    targetRecordId: nonEmpty.optional(),
    targetBeforeRevision: z.number().int().nonnegative().optional(),
    targetAfterRevision: z.number().int().nonnegative().optional(),
    beforeVersionVectorHash: nonEmpty.optional(),
    afterVersionVectorHash: nonEmpty.optional(),
    sourceEventId: nonEmpty.optional(),
  }).strict(),
}).strict();

export function parseProposalEvent(input: unknown): ProposalEvent {
  return proposalEventSchema.parse(input) as ProposalEvent;
}

export function parseOperationTemplate(input: unknown): OperationTemplate {
  return operationTemplateSchema.parse(input) as OperationTemplate;
}

export function parseOperationProposalEnvelope(input: unknown): OperationProposalEnvelope {
  return operationProposalEnvelopeSchema.parse(input) as OperationProposalEnvelope;
}
