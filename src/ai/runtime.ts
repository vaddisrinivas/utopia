import type { SQLiteDatabase } from 'expo-sqlite';

import registryJson from '@/packages/domain-config/agents/registry.v1.json';
import type { DomainManifest } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import type { ApplyOperationOptions, Operation, OperationKind, OperationResult } from '@/src/ops/operation';

export type AgentCapability = {
  domain: string;
  collections: string[];
  ops: OperationKind[];
};

export type AgentRegistryEntry = {
  id: string;
  risk: 'read' | 'reversible_write' | 'sensitive';
  domains: string[];
  tools: string[];
  capabilities: AgentCapability[];
};

export type AiRuntimeIntent = {
  id: string;
  text?: string;
  operations: Operation[];
  raw_sql?: unknown;
  sql?: unknown;
  crud?: unknown;
  command?: unknown;
};

export type AiRuntimeContext = {
  agentId: string;
  actor?: 'ai' | 'agent';
  capabilities?: AgentCapability[];
};

export type AiProposalRejection = {
  op_id: string;
  reason: string;
};

export type AiProposalPlan = {
  status: 'accepted' | 'rejected';
  operations: Operation[];
  rejected: AiProposalRejection[];
};

export type AiApplyResult = {
  status: 'applied' | 'dry_run' | 'rejected';
  plan: AiProposalPlan;
  results: OperationResult[];
};

const registry = registryJson as { agents: AgentRegistryEntry[] };

function agentFor(id: string): AgentRegistryEntry | null {
  return registry.agents.find((agent) => agent.id === id) ?? null;
}

function capabilityMatches(capability: AgentCapability, manifest: DomainManifest, op: Operation) {
  const domainMatches = capability.domain === '*' || capability.domain === manifest.id || capability.domain === op.domain;
  const collectionMatches = capability.collections.includes('*') || capability.collections.includes(op.collection);
  const opMatches = capability.ops.includes(op.kind);
  return domainMatches && collectionMatches && opMatches;
}

function containsRawMutationChannel(intent: AiRuntimeIntent) {
  return intent.raw_sql != null || intent.sql != null || intent.crud != null || intent.command != null;
}

function reject(opId: string, reason: string): AiProposalRejection {
  return { op_id: opId, reason };
}

export function getAgentCapabilities(agentId: string): AgentCapability[] {
  return agentFor(agentId)?.capabilities ?? [];
}

export function propose(intent: AiRuntimeIntent, context: AiRuntimeContext, manifest: DomainManifest): AiProposalPlan {
  const rejected: AiProposalRejection[] = [];
  const agent = agentFor(context.agentId);
  const capabilities = context.capabilities ?? agent?.capabilities ?? [];

  if (!agent && !context.capabilities) {
    return {
      status: 'rejected',
      operations: [],
      rejected: [reject(intent.id, `unknown_agent:${context.agentId}`)],
    };
  }
  if (containsRawMutationChannel(intent)) {
    return {
      status: 'rejected',
      operations: [],
      rejected: [reject(intent.id, 'raw_mutation_channel_rejected')],
    };
  }
  if (!Array.isArray(intent.operations) || intent.operations.length === 0) {
    return { status: 'accepted', operations: [], rejected: [] };
  }

  const accepted: Operation[] = [];
  for (const op of intent.operations) {
    if (op.domain !== manifest.id) {
      rejected.push(reject(op.op_id, `domain_scope_rejected:${op.domain}`));
      continue;
    }
    if (!manifest.collections.includes(op.collection)) {
      rejected.push(reject(op.op_id, `collection_unknown:${op.collection}`));
      continue;
    }
    if (op.actor !== 'ai' && op.actor !== 'agent') {
      rejected.push(reject(op.op_id, `actor_rejected:${op.actor}`));
      continue;
    }
    if (!capabilities.some((capability) => capabilityMatches(capability, manifest, op))) {
      rejected.push(reject(op.op_id, `capability_scope_rejected:${op.collection}:${op.kind}`));
      continue;
    }
    accepted.push(op);
  }

  return {
    status: rejected.length ? 'rejected' : 'accepted',
    operations: rejected.length ? [] : accepted,
    rejected,
  };
}

export async function applyAiProposals(input: {
  db: SQLiteDatabase;
  manifest: DomainManifest;
  intent: AiRuntimeIntent;
  context: AiRuntimeContext;
  options?: ApplyOperationOptions;
}): Promise<AiApplyResult> {
  const plan = propose(input.intent, input.context, input.manifest);
  if (plan.status === 'rejected') {
    return { status: 'rejected', plan, results: [] };
  }

  const results: OperationResult[] = [];
  for (const op of plan.operations) {
    results.push(await applyOperation(input.db, input.manifest, op, input.options));
  }
  const rejected = results.filter((result) => result.status === 'rejected');
  if (rejected.length) {
    return {
      status: 'rejected',
      plan: {
        status: 'rejected',
        operations: [],
        rejected: rejected.map((result) => reject(result.op_id, result.reject_reason ?? 'operation_rejected')),
      },
      results,
    };
  }
  return {
    status: input.options?.dryRun ? 'dry_run' : 'applied',
    plan,
    results,
  };
}
