import type { McpScope } from '../security/auth';
import { describeMcpResourceAuthorization, listMcpResources, readMcpResource } from '../resources/catalog';
import { callMcpTool, type ToolResult } from '../tools/catalog';
import { findRecord, findWorkflow, getActionEvent } from '../runtime/state';
import { listConversations } from '../conversations';

export class McpScopeDeniedError extends Error {}

function extractScopedDomain(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const domain = (value as { domain?: unknown }).domain;
  return typeof domain === 'string' && domain.trim().length > 0 ? domain.trim().toLowerCase() : null;
}

function hasDomainAccess(scope: McpScope, domain: string): boolean {
  return scope.allowAllDomains || scope.domains.has(domain);
}

function filterScopedJson(uri: string, text: string, scope: McpScope): string {
  if (scope.allowAllDomains || scope.domains.size === 0) {
    return text;
  }

  if (uri === 'utopia://records') {
    const payload = JSON.parse(text) as { records?: unknown[] };
    const records = Array.isArray(payload.records)
      ? payload.records.filter((record) => {
          const domain = extractScopedDomain(record);
          return domain !== null && scope.domains.has(domain);
        })
      : [];
    return JSON.stringify({ ...payload, count: records.length, records }, null, 2);
  }

  if (uri === 'utopia://actions') {
    const payload = JSON.parse(text) as { events?: unknown[] };
    const events = Array.isArray(payload.events)
      ? payload.events.filter((event) => {
          const domain = extractScopedDomain(event);
          return domain !== null && scope.domains.has(domain);
        })
      : [];
    return JSON.stringify({ ...payload, events }, null, 2);
  }

  if (uri === 'utopia://workflows') {
    const payload = JSON.parse(text) as { workflows?: unknown[] };
    const workflows = Array.isArray(payload.workflows)
      ? payload.workflows.filter((workflow) => {
          const domain = extractScopedDomain(workflow);
          return domain !== null && scope.domains.has(domain);
        })
      : [];
    return JSON.stringify({ ...payload, workflows }, null, 2);
  }

  if (uri === 'utopia://conversations') {
    const payload = JSON.parse(text) as { threads?: unknown[] };
    const threads = Array.isArray(payload.threads)
      ? payload.threads.filter((thread) => {
          const domain = extractScopedDomain(thread);
          return domain !== null && scope.domains.has(domain);
        })
      : [];
    return JSON.stringify({ ...payload, threads }, null, 2);
  }

  if (
    uri === 'utopia://domain-catalog'
    || uri === 'utopia://domain-catalog-v1'
    || uri === 'utopia://utopia/domain-catalog-v1'
  ) {
    const payload = JSON.parse(text) as {
      active_domain_id?: unknown;
      domains?: Array<{ id?: unknown }>;
      shell?: { tabs?: unknown[] } & Record<string, unknown>;
    } & Record<string, unknown>;
    const allDomainIds = new Set(
      Array.isArray(payload.domains)
        ? payload.domains
            .map((entry) => typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '')
            .filter(Boolean)
        : [],
    );
    const domains = Array.isArray(payload.domains)
      ? payload.domains.filter((entry) => {
          const domain = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
          return domain.length > 0 && scope.domains.has(domain);
        })
      : [];
    const activeDomainId = typeof payload.active_domain_id === 'string'
      && scope.domains.has(payload.active_domain_id.trim().toLowerCase())
      ? payload.active_domain_id
      : typeof domains[0]?.id === 'string' ? domains[0].id : null;
    const shell = payload.shell && typeof payload.shell === 'object'
      ? {
          ...payload.shell,
          tabs: Array.isArray(payload.shell.tabs)
            ? payload.shell.tabs.filter((tab) => {
                const normalized = typeof tab === 'string' ? tab.trim().toLowerCase() : '';
                return !allDomainIds.has(normalized) || scope.domains.has(normalized);
              })
            : payload.shell.tabs,
        }
      : payload.shell;
    return JSON.stringify({ ...payload, active_domain_id: activeDomainId, shell, domains }, null, 2);
  }

  if (uri === 'utopia://agent-registry-v1') {
    const payload = JSON.parse(text) as {
      agents?: Array<{
        domains?: unknown[];
        capabilities?: Array<Record<string, unknown>>;
      } & Record<string, unknown>>;
    } & Record<string, unknown>;
    const agents = Array.isArray(payload.agents)
      ? payload.agents.map((agent) => ({
          ...agent,
          domains: Array.isArray(agent.domains)
            ? [...new Set(agent.domains.flatMap((domain) => {
                if (domain === '*') return [...scope.domains];
                const normalized = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
                return normalized && scope.domains.has(normalized) ? [normalized] : [];
              }))]
            : [],
          capabilities: Array.isArray(agent.capabilities)
            ? agent.capabilities.flatMap((capability) => {
                const domain = typeof capability.domain === 'string'
                  ? capability.domain.trim().toLowerCase()
                  : '';
                if (domain === '*') {
                  return [...scope.domains].map((allowedDomain) => ({ ...capability, domain: allowedDomain }));
                }
                return domain && scope.domains.has(domain) ? [{ ...capability, domain }] : [];
              })
            : [],
        }))
      : [];
    return JSON.stringify({ ...payload, agents }, null, 2);
  }

  return text;
}

export function canReadScopedMcpResource(uri: string, scope: McpScope): boolean {
  try {
    const access = describeMcpResourceAuthorization(uri);
    if (access.kind === 'safe-global') {
      return true;
    }
    if (access.kind === 'global-index') {
      return scope.allowAllDomains || scope.domains.size > 0;
    }
    return hasDomainAccess(scope, access.domain);
  } catch {
    return false;
  }
}

export function listScopedMcpResources(scope: McpScope) {
  return listMcpResources().filter((resource) => canReadScopedMcpResource(resource.uri, scope));
}

export function readScopedMcpResource(uri: string, scope: McpScope): string {
  if (!canReadScopedMcpResource(uri, scope)) {
    throw new McpScopeDeniedError(`Resource not readable for scoped domains: ${uri}`);
  }
  const text = uri === 'utopia://conversations'
    ? JSON.stringify({ type: 'conversation-index', threads: listConversations(scope.principal ?? undefined) }, null, 2)
    : readMcpResource(uri);
  return filterScopedJson(uri, text, scope);
}

type ToolScopeDecision =
  | { ok: true }
  | { ok: false; message: string };

function normalizedDomain(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

function authorizeToolDomain(scope: McpScope, domain: string | null, toolName: string): ToolScopeDecision {
  if (!domain) {
    return { ok: true };
  }
  return hasDomainAccess(scope, domain)
    ? { ok: true }
    : { ok: false, message: `Tool ${toolName} target is not authorized for the trusted MCP domain scope` };
}

function authorizeScopedToolCall(toolName: string, args: Record<string, unknown>, scope: McpScope): ToolScopeDecision {
  if (toolName === 'utopia.get_resource') {
    const uri = typeof args.uri === 'string' ? args.uri : '';
    return uri && canReadScopedMcpResource(uri, scope)
      ? { ok: true }
      : { ok: false, message: `Tool ${toolName} is not authorized for resource ${uri || '<missing>'}` };
  }

  if (toolName === 'utopia.search_records' || toolName === 'utopia.create_record') {
    return authorizeToolDomain(scope, normalizedDomain(args.domain), toolName);
  }

  if (
    toolName === 'utopia.read_record'
    || toolName === 'utopia.update_record'
    || toolName === 'utopia.archive_record'
  ) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    const record = id ? findRecord(id) : null;
    const actual = record ? normalizedDomain(record.domain) : null;
    const claimed = normalizedDomain(args.domain);
    const actualDecision = authorizeToolDomain(scope, actual, toolName);
    if (!actualDecision.ok) return actualDecision;
    return authorizeToolDomain(scope, claimed, toolName);
  }

  if (toolName === 'utopia.run_workflow') {
    const workflowId = typeof args.workflow === 'string' ? args.workflow.trim() : '';
    const workflow = workflowId ? findWorkflow(workflowId) : null;
    const actualDecision = authorizeToolDomain(scope, normalizedDomain(workflow?.domain), toolName);
    if (!actualDecision.ok) return actualDecision;
    return authorizeToolDomain(scope, normalizedDomain(args.domain), toolName);
  }

  if (toolName === 'utopia.undo_action') {
    const actionId = typeof args.actionId === 'string' ? args.actionId.trim() : '';
    const action = actionId ? getActionEvent(actionId) : null;
    return authorizeToolDomain(scope, normalizedDomain(action?.domain), toolName);
  }

  return { ok: true };
}

const PRINCIPAL_BOUND_TOOLS = new Set([
  'utopia.propose_app_link',
  'utopia.create_record',
  'utopia.update_record',
  'utopia.archive_record',
  'utopia.run_workflow',
  'utopia.undo_action',
]);

function bindTrustedPrincipal(
  toolName: string,
  args: Record<string, unknown>,
  scope: McpScope,
): Record<string, unknown> {
  if (!PRINCIPAL_BOUND_TOOLS.has(toolName) || !scope.principal) {
    return args;
  }
  return { ...args, actor: scope.principal };
}

export async function callScopedMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  scope: McpScope,
): Promise<ToolResult> {
  const scopeDecision = authorizeScopedToolCall(toolName, args, scope);
  if (!scopeDecision.ok) {
    throw new McpScopeDeniedError(scopeDecision.message);
  }

  if (toolName === 'utopia.get_resource') {
    const uri = String(args.uri);
    return {
      json: { uri, text: readScopedMcpResource(uri, scope) },
      reviewOnly: false,
      safety: 'read',
    };
  }

  return callMcpTool(toolName, bindTrustedPrincipal(toolName, args, scope));
}
