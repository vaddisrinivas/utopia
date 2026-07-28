import type { AppPackage } from './package';
import { executeQuery, type QueryResult, type QuerySpec } from './query';
import { detectQueryTransitions, type QueryTransitionEvent } from './query-transition';
import { createOperationProposalIdempotencyKey, evaluateRules, type OperationProposal, type OperationProposalEnvelope } from './rules';
import { applyComputedFieldsToRows, createComputedFieldEvaluationContext } from './computed-fields';
import { dryRunReactiveProposal, evaluateReactiveProposalPolicy } from './reactive-proposal-policy';
import { canonicalJson, sha256Canonical } from '@/src/domain/canonical-json';

export type ReactiveCycleInput = {
  package: AppPackage;
  beforeRows: readonly Record<string, unknown>[];
  afterRows: readonly Record<string, unknown>[];
  event: { kind: 'operation' | 'schedule'; id: string };
  data?: unknown;
  causeId: string;
  depth?: number;
  authorityProvider?: string;
  budget?: {
    maxQueries?: number;
    maxRows?: number;
    maxTransitions?: number;
    maxProposals?: number;
  };
};

export type ReactiveCycleProposal = OperationProposal & {
  id: string;
  eventId: string;
  envelope: OperationProposalEnvelope;
};

export type ReactiveCycleResult = {
  cycleId: string;
  transitions: QueryTransitionEvent[];
  proposals: ReactiveCycleProposal[];
  queryHashes: Record<string, { before: string; after: string }>;
};

const DEFAULT_BUDGET = {
  maxQueries: 128,
  maxRows: 10_000,
  maxTransitions: 256,
  maxProposals: 256,
};
const QUERY_EVALUATOR_VERSION = 'wonder.query-evaluator.v1' as const;

/**
 * Deterministic reactive pass. Queries observe immutable before/after rows;
 * rules can only return operation proposals. This function performs no writes.
 */
export function runReactiveCycle(input: ReactiveCycleInput): ReactiveCycleResult {
  const budget = { ...DEFAULT_BUDGET, ...(input.budget ?? {}) };
  const depth = input.depth ?? 0;
  if (depth > 32) throw new Error('reactive_cycle_depth_exceeded');
  if (input.beforeRows.length > budget.maxRows || input.afterRows.length > budget.maxRows) {
    throw new Error('reactive_cycle_row_budget_exceeded');
  }

  const queryEntries = Object.entries(input.package.queries).sort(([left], [right]) => left.localeCompare(right));
  if (queryEntries.length > budget.maxQueries) throw new Error('reactive_cycle_query_budget_exceeded');
  const computedBudget = {
    maxQueries: budget.maxQueries,
    maxRows: budget.maxRows,
    maxQueryEvaluations: budget.maxQueries * 2,
  };
  const beforeRows = applyComputedFieldsToRows(
    input.beforeRows,
    input.package.computedFields ?? [],
    input.package.queries,
    input.beforeRows,
    createComputedFieldEvaluationContext(computedBudget),
  );
  const afterRows = applyComputedFieldsToRows(
    input.afterRows,
    input.package.computedFields ?? [],
    input.package.queries,
    input.afterRows,
    createComputedFieldEvaluationContext(computedBudget),
  );

  const transitions: QueryTransitionEvent[] = [];
  const queryHashes: ReactiveCycleResult['queryHashes'] = {};
  const transitionResults = new Map<string, {
    before: QueryResult<Record<string, unknown>>;
    after: QueryResult<Record<string, unknown>>;
  }>();

  for (const [queryId, query] of queryEntries) {
    const before = executePackageQuery(beforeRows, queryId, query);
    const after = executePackageQuery(afterRows, queryId, query);
    queryHashes[queryId] = { before: before.resultHash, after: after.resultHash };
    transitionResults.set(queryId, { before, after });
    transitions.push(...detectQueryTransitions(queryId, before, after));
    if (transitions.length > budget.maxTransitions) {
      throw new Error('reactive_cycle_transition_budget_exceeded');
    }
  }

  const rawProposals: Array<OperationProposal & { eventId: string }> = [];
  rawProposals.push(...evaluateRules(input.package.rules, {
    event: { ...input.event },
    data: input.data ?? {},
    packageVersion: input.package.version,
    causeId: input.causeId,
    depth,
  }).map((proposal) => ({ ...proposal, eventId: input.event.id })));
  if (rawProposals.length > budget.maxProposals) {
    throw new Error('reactive_cycle_proposal_budget_exceeded');
  }

  for (const transition of transitions) {
    const results = transitionResults.get(transition.id);
    if (!results) continue;
    const data = {
      event: transition,
      query: {
        id: transition.id,
        before: { total: results.before.total, resultHash: results.before.resultHash },
        after: { total: results.after.total, resultHash: results.after.resultHash },
      },
      input: input.data ?? {},
    };
    rawProposals.push(...evaluateRules(input.package.rules, {
      event: {
        kind: 'query_transition',
        id: `${transition.id}:${transition.transition}`,
        queryId: transition.id,
        transition: transition.transition,
      },
      data,
      packageVersion: input.package.version,
      causeId: input.causeId,
      depth,
    }).map((proposal) => ({
      ...proposal,
      eventId: proposal.event.id,
    })));
    if (rawProposals.length > budget.maxProposals) {
      throw new Error('reactive_cycle_proposal_budget_exceeded');
    }
  }

  const proposals = dedupeProposals(rawProposals)
    .map((proposal) => {
      const id = stableId({
        packageId: input.package.id,
        packageVersion: input.package.version,
        causeId: input.causeId,
        eventId: proposal.eventId,
        ruleId: proposal.ruleId,
        operation: proposal.operation,
        operationTemplate: proposal.operationTemplate,
      });
      return {
        ...proposal,
        id,
        envelope: createProposalEnvelope({
          proposalId: id,
          proposal,
          package: input.package,
          eventId: proposal.eventId,
          queryHashes,
          rows: [...afterRows, ...beforeRows],
          beforeRows,
          afterRows,
          authorityProvider: input.authorityProvider,
          sourceEventId: input.event.id,
        }),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const cycleId = stableId({
    packageId: input.package.id,
    packageVersion: input.package.version,
    causeId: input.causeId,
    event: input.event,
    depth,
    queryHashes,
  });

  return { cycleId, transitions, proposals, queryHashes };
}

function createProposalEnvelope(input: {
  proposalId: string;
  proposal: OperationProposal & { eventId: string };
  package: AppPackage;
  eventId: string;
  queryHashes: ReactiveCycleResult['queryHashes'];
  rows: readonly Record<string, unknown>[];
  beforeRows: readonly Record<string, unknown>[];
  afterRows: readonly Record<string, unknown>[];
  authorityProvider?: string;
  sourceEventId: string;
}): OperationProposalEnvelope {
  const queryId = input.proposal.event.kind === 'query_transition' ? input.proposal.event.queryId : undefined;
  const transition = input.proposal.event.kind === 'query_transition' ? input.proposal.event.transition : undefined;
  const queryEvidence = queryId ? input.queryHashes[queryId] : undefined;
  const packageHash = stableSha256(input.package);
  const querySpecHash = queryId && input.package.queries[queryId] ? stableSha256(input.package.queries[queryId]) : undefined;
  const authorization = evaluateReactiveProposalPolicy({
    operationTemplate: input.proposal.operationTemplate,
    requestedMode: input.proposal.mode,
    capabilities: input.package.capabilities,
    targetProvider: targetProviderFor(input.proposal.operationTemplate, input.rows),
    authorityProvider: input.authorityProvider,
  });
  const dryRun = dryRunReactiveProposal({
    operationTemplate: input.proposal.operationTemplate,
    policy: authorization,
  });
  const evidence = {
    ...(queryId ? { queryId } : {}),
    ...(transition === 'enter' || transition === 'leave' || transition === 'change' ? { transition } : {}),
    ...(queryEvidence ? { beforeHash: queryEvidence.before, afterHash: queryEvidence.after } : {}),
    ...(querySpecHash ? { querySpecHash, packageHash, evaluatorVersion: QUERY_EVALUATOR_VERSION } : {}),
    ...targetRevisionEvidence(input.proposal.operationTemplate, input.beforeRows, input.afterRows),
    ...(input.proposal.operationTemplate.kind !== 'custom' && input.proposal.operationTemplate.recordId !== undefined ? {
      beforeVersionVectorHash: versionVectorHash(input.beforeRows, input.proposal.operationTemplate.recordId),
      afterVersionVectorHash: versionVectorHash(input.afterRows, input.proposal.operationTemplate.recordId),
    } : {}),
    sourceEventId: input.sourceEventId,
  };
  return {
    schemaVersion: 'wonder.operation-proposal.v1',
    proposalId: input.proposalId,
    operation: input.proposal.operation,
    operationTemplate: input.proposal.operationTemplate,
    mode: input.proposal.mode,
    ruleId: input.proposal.ruleId,
    packageId: input.package.id,
    packageVersion: input.proposal.packageVersion,
    eventId: input.eventId,
    event: input.proposal.event,
    causeId: input.proposal.causeId,
    depth: input.proposal.depth,
    idempotencyKey: createOperationProposalIdempotencyKey({
      packageId: input.package.id,
      packageVersion: input.proposal.packageVersion,
      ruleId: input.proposal.ruleId,
      event: input.proposal.event,
      causeId: input.proposal.causeId,
      operationTemplate: input.proposal.operationTemplate,
      evidence,
    }),
    review: {
      required: authorization.reviewRequired,
      reason: authorization.reviewRequired
        ? input.proposal.mode === 'automatic' ? 'policy_required' : 'suggest_mode'
        : 'policy_authorized',
      policyId: authorization.policyId,
      policyVersion: authorization.policyVersion,
    },
    authorization,
    dryRun,
    evidence,
  };
}

function executePackageQuery(
  rows: readonly Record<string, unknown>[],
  queryId: string,
  query: AppPackage['queries'][string],
) {
  const stableRows = [...rows].sort((left, right) => rowKey(left).localeCompare(rowKey(right)));
  const scopedRows = query.from === 'records'
    ? stableRows
    : stableRows.filter((row) => row.collection === query.from);
  const spec: QuerySpec<Record<string, unknown>> = {
    ...query,
    provenance: `${queryId}:${query.from}`,
  };
  return executeQuery(scopedRows, spec);
}

function rowKey(row: Record<string, unknown>) {
  return typeof row.id === 'string' ? row.id : stableJson(row);
}

function targetProviderFor(operationTemplate: OperationProposal['operationTemplate'], rows: readonly Record<string, unknown>[]): string {
  if (operationTemplate.kind === 'custom' || operationTemplate.kind === 'create_record') return 'user';
  const record = rows.find((row) => row.id === operationTemplate.recordId);
  const source = record?.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return 'user';
  const provider = (source as { provider?: unknown }).provider;
  return typeof provider === 'string' && provider.trim() ? provider.trim() : 'user';
}

function targetRevisionEvidence(
  operationTemplate: OperationProposal['operationTemplate'],
  beforeRows: readonly Record<string, unknown>[],
  afterRows: readonly Record<string, unknown>[],
): { targetRecordId?: string; targetBeforeRevision?: number; targetAfterRevision?: number } {
  if (operationTemplate.kind === 'custom') return {};
  const targetRecordId = operationTemplate.kind === 'create_record'
    ? operationTemplate.recordId
    : operationTemplate.recordId;
  if (!targetRecordId) return {};
  const before = beforeRows.find((row) => row.id === targetRecordId);
  const after = afterRows.find((row) => row.id === targetRecordId);
  return {
    targetRecordId,
    ...(revisionOf(before) !== undefined ? { targetBeforeRevision: revisionOf(before) } : {}),
    ...(revisionOf(after) !== undefined ? { targetAfterRevision: revisionOf(after) } : operationTemplate.kind === 'create_record' ? { targetAfterRevision: 1 } : {}),
  };
}

function revisionOf(row: Record<string, unknown> | undefined): number | undefined {
  return typeof row?.revision === 'number' && Number.isInteger(row.revision) && row.revision >= 0 ? row.revision : undefined;
}

function versionVectorHash(rows: readonly Record<string, unknown>[], recordId?: string): string | undefined {
  if (!recordId) return undefined;
  const scoped = rows.filter((row) => row.id === recordId);
  if (scoped.length === 0) return undefined;
  return stableSha256(scoped
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : rowKey(row),
      revision: revisionOf(row),
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

function dedupeProposals<T extends OperationProposal & { eventId: string }>(proposals: T[]): T[] {
  const seen = new Set<string>();
  return proposals.filter((proposal) => {
    const key = stableJson({
      eventId: proposal.eventId,
      ruleId: proposal.ruleId,
      operation: proposal.operation,
      operationTemplate: proposal.operationTemplate,
      mode: proposal.mode,
      causeId: proposal.causeId,
      packageVersion: proposal.packageVersion,
      depth: proposal.depth,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableId(value: unknown) {
  const encoded = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < encoded.length; index += 1) {
    hash ^= encoded.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `reactive:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableSha256(value: unknown) {
  return sha256Canonical(value);
}

function stableJson(value: unknown): string {
  return canonicalJson(value);
}
