import { loadCatalog } from '../../../src/domain/catalog';
import { normalizeConfidence, type ConfidenceValue } from '@/packages/shared/contracts/confidence';
import type { ActionRisk } from '@/src/actions/policy';

export type McpToolKind = 'read' | 'write';

type McpSafety = 'read-only' | 'review-only' | 'review-required' | 'blocked';

type McpPolicyBase<TDecision extends 'deny' | 'clarify' | 'review' | 'execute'> = {
  decision: TDecision;
  risk: ActionRisk;
  reason: string;
  confidence: ConfidenceValue;
  safety: McpSafety;
};

export type McpPolicy =
  | McpPolicyBase<'deny'>
  | (McpPolicyBase<'clarify'> & { clarifyingQuestion: string })
  | McpPolicyBase<'review'>
  | McpPolicyBase<'execute'>;

const READ_TOOLS = new Set([
  'utopia.status',
  'utopia.get_resource',
  'utopia.validate_command_envelope',
  'utopia.search_records',
  'utopia.read_record',
]);

const REVIEW_TOOLS = new Set([
  'utopia.propose_app_link',
  'utopia.wrap_proposal_package',
]);

const WRITE_TOOLS = new Set([
  'utopia.create_record',
  'utopia.update_record',
  'utopia.archive_record',
  'utopia.run_workflow',
  'utopia.undo_action',
]);

const BLOCKED_ACTION_RE = /(delete|destroy|credential|private|payment|message|export|purge|billing|permission)/i;

export function getMcpToolKind(toolName: string): McpToolKind {
  if (WRITE_TOOLS.has(toolName) || REVIEW_TOOLS.has(toolName)) {
    return 'write';
  }
  return 'read';
}

export function isMcpToolReadOnly(toolName: string): boolean {
  return getMcpToolKind(toolName) === 'read';
}

export function isMcpToolAllowed(toolName: string): boolean {
  const toolSet = new Set([...Array.from(READ_TOOLS), ...Array.from(REVIEW_TOOLS), ...Array.from(WRITE_TOOLS)]);
  return toolSet.has(toolName);
}

function evaluateCommandRisk(command: string) {
  const normalized = command.toLowerCase();
  if (BLOCKED_ACTION_RE.test(normalized)) {
    return 'restricted' as const;
  }
  if (/(delete|archive|cancel|remove|bill|export|transfer|message)/i.test(command)) {
    return 'standard' as const;
  }
  return 'low' as const;
}

export function evaluateMcpPolicy(input: {
  tool: string;
  domain?: string;
  command?: string;
  actor?: string;
}): McpPolicy {
  const command = (input.command ?? '').trim();
  const actor = (input.actor ?? 'unknown').trim();

  if (!isMcpToolAllowed(input.tool)) {
    return {
      decision: 'deny',
      risk: 'restricted',
      reason: `Tool ${input.tool} is not registered for this MCP server.`,
      confidence: normalizeConfidence('high'),
      safety: 'blocked',
    };
  }

  if (input.domain && input.tool !== 'utopia.status') {
    try {
      const catalog = loadCatalog();
      if (!catalog.catalog.domains.some((entry) => entry.id === input.domain)) {
        return {
          decision: 'deny',
          risk: 'restricted',
          reason: `Unknown domain ${input.domain} for MCP policy.`,
          confidence: normalizeConfidence('high'),
          safety: 'blocked',
        };
      }
    } catch {
      return {
        decision: 'deny',
        risk: 'restricted',
        reason: 'Domain policy verification is unavailable.',
        confidence: normalizeConfidence('high'),
        safety: 'blocked',
      };
    }
  }

  if (getMcpToolKind(input.tool) === 'read') {
    return {
      decision: 'execute',
      risk: 'low',
      reason: `Read operation ${input.tool} is allowed for ${actor}.`,
      confidence: normalizeConfidence('high'),
      safety: 'read-only',
    };
  }

  if (input.tool === 'utopia.undo_action') {
    if (!command || !command.trim()) {
      return {
        decision: 'clarify',
        risk: 'standard',
        reason: 'Undo requires an action id.',
        clarifyingQuestion: 'Please provide an action id to undo.',
        confidence: normalizeConfidence('medium'),
        safety: 'review-required',
      };
    }
    return {
      decision: 'execute',
      risk: 'standard',
      reason: `Undo is allowed for ${actor}.`,
      confidence: normalizeConfidence('high'),
      safety: 'review-only',
    };
  }

  const risk = evaluateCommandRisk(command);
  if (risk === 'restricted') {
    return {
      decision: 'deny',
      risk: 'restricted',
      reason: 'Tool command was blocked by policy safeguards.',
      confidence: normalizeConfidence('high'),
      safety: 'blocked',
    };
  }

  if (risk === 'standard' && !command) {
    return {
      decision: 'clarify',
      risk: 'standard',
      reason: 'Unsafe write command is missing explicit request text.',
      clarifyingQuestion: 'Can you state the exact record subject and mutation in one sentence?',
      confidence: normalizeConfidence('medium'),
      safety: 'review-required',
    };
  }

  if (risk === 'low') {
    return {
      decision: 'execute',
      risk,
      reason: `Write operation ${input.tool} is allowed under MCP policy.`,
      confidence: normalizeConfidence('high'),
      safety: 'review-only',
    };
  }

  return {
    decision: 'review',
    risk,
    reason: `Write operation ${input.tool} is allowed under MCP policy.`,
    confidence: normalizeConfidence('high'),
    safety: 'review-required',
  };
}

export function isReviewOnlyTool(toolName: string): boolean {
  return REVIEW_TOOLS.has(toolName);
}
