import { createHash } from 'node:crypto';
import { evaluateMcpPolicy } from '../security/policy';
import { readMcpResource } from '../resources/catalog';
import {
  actionToolPolicy,
  getOrCreateActionFromPolicy,
  policyBlocksExecution,
  policyNeedsReview,
  requireDurableReviewApproval,
  resolveToolResult,
  resolveWriteResult,
  type ToolResult,
} from './policy-receipts';
export type { ToolResult } from './policy-receipts';
import {
  WorkflowDocument,
  createActionEvent,
  createRecordWithAction,
  findActionByIdempotencyKey,
  findRecord,
  findWorkflow,
  getActionEvent,
  listRecords,
  markActionCompleted,
  markActionFailed,
  runUndo,
  updateRecordWithAction,
  archiveRecordWithAction,
  listWorkflows,
  ActionEvent,
  McpRecord,
} from '../runtime/state';
import { buildWorkflowCompensation, runWorkflowCompensation, WorkflowCompensationResult } from '../workflows/compensation';
import {
  completeWorkflowCheckpoint,
  finalizeWorkflowCompensated,
  markWorkflowStep,
  startWorkflowCheckpoint,
} from '../workflows/checkpoint';
import {
  buildNotionArchiveSource,
  buildNotionCreateSource,
  buildNotionUpdateSource,
  writeNotionRecord,
} from '../providers/notion/push';
import {
  buildSheetsArchiveSource,
  buildSheetsCreateSource,
  buildSheetsUpdateSource,
  writeSheetsRecord,
} from '../providers/sheets/push';
import {
  MCP_PROVIDER_DATA_HOMES,
  MutableProvider,
  ProviderWriteResult,
  resolveCanonicalProvider,
  toMutableProviderOrDefault,
} from '../providers/contracts';

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  reviewOnly: boolean;
  nextStep: string;
};

const ACTION_TOOLS = {
  status: 'utopia.status',
  getResource: 'utopia.get_resource',
  validateCommandEnvelope: 'utopia.validate_command_envelope',
  proposeAppLink: 'utopia.propose_app_link',
  wrapProposalPackage: 'utopia.wrap_proposal_package',
};

const RECORD_TOOLS = {
  searchRecords: 'utopia.search_records',
  readRecord: 'utopia.read_record',
  createRecord: 'utopia.create_record',
  updateRecord: 'utopia.update_record',
  archiveRecord: 'utopia.archive_record',
  runWorkflow: 'utopia.run_workflow',
  undoAction: 'utopia.undo_action',
};

const MAX_ACTIONS_PER_REQUEST = 12;
const DATA_HOME = MCP_PROVIDER_DATA_HOMES;
const WRITE_DATA_HOME = ['local_sqlite', 'notion', 'google_sheets'] as const;
const SCHEME_HTTPS = 'https';
const SCHEME_WONDERFOOD = 'utopia';
const MAX_RECORD_SEARCH_RESULTS = 200;
const WORKFLOW_MAX_STEPS = 30;
const PROTOCOL_VERSION = '2026-03-11';

type CandidateAction = Record<string, unknown>;

export type WorkflowExecutionResult = {
  status: 'ok' | 'failed' | 'skipped' | 'cancelled';
  tool: string;
  stepResult: {
    status: 'ok' | 'failed' | 'skipped' | 'cancelled';
    details?: {
      id: string;
      tool: string;
      status: 'ok' | 'failed' | 'skipped' | 'cancelled';
      result: unknown;
      output?: string;
    }[];
    outputs?: Record<string, unknown>;
    changedRecords?: string[];
    error?: string;
    source_snapshot?: Record<string, unknown>;
  };
  details?: {
    id: string;
    tool: string;
    status: 'ok' | 'failed' | 'skipped' | 'cancelled';
    result: unknown;
    output?: string;
  }[];
  changedRecords: string[];
  checkpointRunId?: string;
  compensation?: WorkflowCompensationResult;
  error?: string;
};

type ParsedWorkflowStepInput = {
  id: string;
  tool: string;
  skill?: string;
  required: boolean;
  input: Record<string, unknown>;
  input_from?: string[];
  output?: string;
  [key: string]: unknown;
};

export type WorkflowDependencyResult = {
  step_id: string;
  output?: string;
  result: unknown;
};

export type WorkflowInputBinding =
  | {
      ok: true;
      input: Record<string, unknown>;
      bindings: Record<string, unknown>;
    }
  | {
      ok: false;
      input: Record<string, unknown>;
      bindings: Record<string, unknown>;
      missing: string[];
    };

function getActionIdFromToolResult(result: ToolResult): string | null {
  if (!isObject(result.json)) {
    return null;
  }
  const action = (result.json as Record<string, unknown>).action;
  if (!isObject(action)) {
    return null;
  }
  const actionId = (action as Record<string, unknown>).id;
  return typeof actionId === 'string' && actionId.length > 0 ? actionId : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? (value as Record<string, unknown>) : {};
}

function makeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureDomain(raw: unknown): string {
  const value = makeText(raw);
  return value.length > 0 ? value : 'food';
}

function ensureActor(raw: unknown): string {
  const value = makeText(raw);
  return value.length > 0 ? value : 'hearth';
}

function ensureConversationId(raw: unknown): string | null {
  const value = makeText(raw);
  return value.length > 0 ? value : null;
}

function ensureCollection(raw: unknown): string {
  const value = makeText(raw);
  if (!value) {
    throw new Error('collection is required');
  }
  return value;
}

function ensureDataHome(raw: unknown): MutableProvider {
  return toMutableProviderOrDefault(makeText(raw));
}

function stringifyForHash(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyForHash(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stringifyForHash((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deterministicHash(value: unknown): string {
  return createHash('sha256').update(stringifyForHash(value)).digest('hex');
}

function hashValue(value: unknown): string {
  return `sha256:${deterministicHash(value)}`;
}

function ensureId(raw: unknown, fallbackSeed?: unknown): string {
  const value = makeText(raw);
  if (value) {
    return value;
  }

  if (fallbackSeed !== undefined) {
    return `utopia-${deterministicHash(fallbackSeed).slice(0, 18)}`;
  }

  return `utopia-random-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function deterministicRecordId(input: {
  operation: string;
  domain: string;
  collection: string;
  title: string;
  sourceHome: MutableProvider;
  payload?: unknown;
}) {
  return `utopia-${input.operation}-${deterministicHash({
    operation: input.operation,
    domain: input.domain,
    collection: input.collection,
    title: input.title,
    sourceHome: input.sourceHome,
    payload: input.payload,
  }).slice(0, 18)}`;
}

function makeActionId(prefix: string, seed: unknown) {
  const hashInput = seed === undefined
    ? `${prefix}-missing-seed`
    : seed;
  return `${prefix}:${deterministicHash(hashInput).slice(0, 20)}`;
}

function providerSourceFromWrite(input: {
  dataHome: MutableProvider;
  operation: 'create_record' | 'update_record' | 'archive_record';
  recordId: string;
  domain: string;
  collection: string;
  title?: string;
  externalId?: string;
}): ProviderWriteResult {
  if (input.dataHome === 'notion') {
    if (input.operation === 'create_record') {
      return buildNotionCreateSource({
        recordId: input.recordId,
        domain: input.domain,
        collection: input.collection,
        title: input.title,
        externalId: input.externalId,
      });
    }
    if (input.operation === 'update_record') {
      return buildNotionUpdateSource({
        recordId: input.recordId,
        domain: input.domain,
        collection: input.collection,
      });
    }
    return buildNotionArchiveSource({
      recordId: input.recordId,
      domain: input.domain,
      collection: input.collection,
    });
  }

  if (input.dataHome === 'google_sheets') {
    if (input.operation === 'create_record') {
      return buildSheetsCreateSource({
        recordId: input.recordId,
        domain: input.domain,
        collection: input.collection,
        title: input.title,
        externalId: input.externalId,
      });
    }
    if (input.operation === 'update_record') {
      return buildSheetsUpdateSource({
        recordId: input.recordId,
        domain: input.domain,
        collection: input.collection,
      });
    }
    return buildSheetsArchiveSource({
      recordId: input.recordId,
      domain: input.domain,
      collection: input.collection,
    });
  }

  return {
    ok: true,
    source: {
      provider: resolveCanonicalProvider('local_sqlite'),
      external_id: input.externalId || input.recordId,
      url: null,
      observed_at: new Date().toISOString(),
      content_hash: null,
    },
    source_snapshot: {
      provider: resolveCanonicalProvider('local_sqlite'),
      mode: 'authoritative_local',
      operation: input.operation,
      domain: input.domain,
      collection: input.collection,
      timestamp: new Date().toISOString(),
    },
    operation: input.operation,
  };
}

function notionSourceFromResponse(input: {
  ok: boolean;
  source: Record<string, unknown> | undefined;
  source_snapshot: Record<string, unknown> | undefined;
  operation: 'create_record' | 'update_record' | 'archive_record';
}): ProviderWriteResult | null {
  if (!input.ok || !input.source || !input.source_snapshot) {
    return null;
  }

  const source = input.source;
  const sourceProvider = typeof source.provider === 'string' ? source.provider : 'notion';
  if (sourceProvider !== 'notion') {
    return null;
  }
  return {
    ok: true,
    source: {
      provider: 'notion',
      external_id: typeof source.external_id === 'string' ? source.external_id : '',
      url: typeof source.url === 'string' ? source.url : null,
      observed_at: typeof source.observed_at === 'string' ? source.observed_at : new Date().toISOString(),
      content_hash: typeof source.content_hash === 'string' ? source.content_hash : null,
    },
    source_snapshot: input.source_snapshot,
    operation: input.operation,
  };
}

function sheetsSourceFromResponse(input: {
  ok: boolean;
  source: Record<string, unknown> | undefined;
  source_snapshot: Record<string, unknown> | undefined;
}): ProviderWriteResult | null {
  if (!input.ok || !input.source || !input.source_snapshot) {
    return null;
  }

  return {
    ok: true,
    source: {
      provider: 'google_sheets',
      external_id: typeof input.source.external_id === 'string' ? input.source.external_id : '',
      url: typeof input.source.url === 'string' ? input.source.url : null,
      observed_at: typeof input.source.observed_at === 'string' ? input.source.observed_at : new Date().toISOString(),
      content_hash: typeof input.source.content_hash === 'string' ? input.source.content_hash : null,
    },
    source_snapshot: input.source_snapshot,
    operation: (input.source_snapshot.operation as ProviderWriteResult['operation']) || 'update_record',
  };
}

function notionPropertiesForWrite(existing: McpRecord, patch: Partial<McpRecord>) {
  const existingProperties = isObject(existing.properties) ? existing.properties : {};
  const patchProperties = isObject(patch.properties) ? (patch.properties as Record<string, unknown>) : {};
  return {
    ...existingProperties,
    ...patchProperties,
  };
}

function expectedSheetsDigest(existing: McpRecord) {
  if (existing.source?.provider !== 'google_sheets') {
    return undefined;
  }
  return typeof existing.source.content_hash === 'string' && existing.source.content_hash.length > 0
    ? existing.source.content_hash
    : undefined;
}

function ensureTool(raw: unknown) {
  return makeText(raw);
}

function normalizeQuery(raw: unknown): string {
  const value = makeText(raw);
  return value.length > 0 ? value : '';
}

function safeJsonText(raw: unknown) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  return JSON.stringify(raw);
}

function buildDeterministicIdempotencyKey(input: {
  operation: string;
  dataHome: MutableProvider;
  recordId: string;
  domain: string;
  collection: string;
  payload?: unknown;
}) {
  const seed = stringifyForHash({
    operation: input.operation,
    dataHome: input.dataHome,
    recordId: input.recordId,
    domain: input.domain,
    collection: input.collection,
    payload: input.payload,
  });
  return `utopia:${deterministicHash(seed).slice(0, 24)}`;
}

function parseWorkflowStepInput(step: Record<string, unknown>, contextSeed: string): ParsedWorkflowStepInput {
  const tool = ensureTool(step.tool);
  const action = ensureTool(step.action);
  const normalizedTool = tool || action;
  const explicitStepId = makeText(step.id);

  const input = isObject(step.input) ? (step.input as Record<string, unknown>) : {};
  return {
    ...step,
    id: explicitStepId || makeActionId(`step`, {
      tool: normalizedTool,
      contextSeed,
      command: safeJsonText(input),
    }),
    tool: normalizedTool,
    required: typeof step.required === 'boolean' ? step.required : true,
    input,
  };
}

export function bindWorkflowStepInput(
  step: {
    input?: Record<string, unknown>;
    input_from?: string[];
  },
  completed: readonly WorkflowDependencyResult[],
): WorkflowInputBinding {
  const explicitInput = isObject(step.input) ? step.input : {};
  const bindings: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const sourceId of step.input_from ?? []) {
    const source = completed.find((entry) => entry.step_id === sourceId);
    if (!source) {
      missing.push(sourceId);
      continue;
    }
    if (isObject(source.result)) {
      Object.assign(bindings, source.result);
    }
    const bindingKey = source.output?.trim() || source.step_id;
    bindings[bindingKey] = source.result;
  }

  const input = {
    ...bindings,
    ...explicitInput,
  };
  return missing.length > 0
    ? { ok: false, input, bindings, missing }
    : { ok: true, input, bindings };
}

function getContextSourceSnapshot(context: WorkflowExecutionContext): Record<string, unknown> {
  return {
    workflow_run_id: context.workflowRunId,
    visited_records: Array.from(context.visitedRecords),
  };
}

function buildWorkflowStepSeed(input: {
  workflowId: string;
  stepIndex: number;
  tool: string;
  checkpointRunId?: string;
  contextSeed?: string;
}) {
  return deterministicHash({
    workflowId: input.workflowId,
    stepIndex: input.stepIndex,
    tool: input.tool,
    checkpointRunId: input.checkpointRunId,
    contextSeed: input.contextSeed,
  });
}

function buildWorkflowExecutionSeed(input: {
  workflowId: string;
  actor: string;
  actionId?: string;
  checkpointRunId?: string;
  nested?: boolean;
}) {
  return deterministicHash({
    workflowId: input.workflowId,
    actor: input.actor,
    actionId: input.actionId,
    checkpointRunId: input.checkpointRunId,
    nested: Boolean(input.nested),
  });
}

function buildWorkflowIdempotencyKey(input: {
  workflowId: string;
  actor: string;
  domain: string;
  actionId?: string;
}) {
  return `utopia:${deterministicHash({
    operation: 'run_workflow',
    workflowId: input.workflowId,
    actor: input.actor,
    domain: input.domain,
    actionId: input.actionId,
  }).slice(0, 24)}`;
}

function buildWorkflowRunSourceSnapshot(input: {
  workflowRunId?: string;
  changedRecords: string[];
}) {
  return {
    workflow_run_id: input.workflowRunId,
    visited_records: input.changedRecords,
  };
}

function getActionSourceSnapshot(action?: ActionEvent): Record<string, unknown> | undefined {
  if (!action) {
    return undefined;
  }
  const after = asRecord(action.after_json);
  const before = asRecord(action.before_json);
  const direct = asRecord(after.source_snapshot);
  if (Object.keys(direct).length > 0) {
    return direct;
  }
  const afterSource = asRecord(after.source);
  const afterProvider = typeof afterSource.provider === 'string' ? afterSource.provider : undefined;
  if (afterProvider) {
    const source = {
      ...(typeof afterSource.source_snapshot === 'object' && afterSource.source_snapshot !== null
        ? asRecord(afterSource.source_snapshot)
        : {}),
      provider: afterProvider,
      external_id: afterSource.external_id,
      url: afterSource.url,
      observed_at: afterSource.observed_at,
      content_hash: afterSource.content_hash,
      mode: (afterSource.mode as string) || 'provider_record',
    };
    if (Object.keys(source).length > 0) {
      return source;
    }
  }

  const beforeSourceSnapshot = asRecord(before.source_snapshot);
  if (Object.keys(beforeSourceSnapshot).length > 0) {
    return beforeSourceSnapshot;
  }
  const beforeSource = asRecord(before.source);
  const beforeProvider = typeof beforeSource.provider === 'string' ? beforeSource.provider : undefined;
  if (beforeProvider) {
    return {
      ...(typeof beforeSource.source_snapshot === 'object' && beforeSource.source_snapshot !== null ? asRecord(beforeSource.source_snapshot) : {}),
      provider: beforeProvider,
      external_id: beforeSource.external_id,
      url: beforeSource.url,
      observed_at: beforeSource.observed_at,
      content_hash: beforeSource.content_hash,
      mode: (beforeSource.mode as string) || 'provider_record',
    };
  }

  const beforeAfter = asRecord(before.after_json);
  const beforeAfterSource = asRecord(beforeAfter.source);
  const beforeAfterProvider = typeof beforeAfterSource.provider === 'string' ? beforeAfterSource.provider : undefined;
  if (beforeAfterProvider) {
    return {
      ...(typeof beforeAfterSource.source_snapshot === 'object' && beforeAfterSource.source_snapshot !== null ? asRecord(beforeAfterSource.source_snapshot) : {}),
      provider: beforeAfterProvider,
      external_id: beforeAfterSource.external_id,
      url: beforeAfterSource.url,
      observed_at: beforeAfterSource.observed_at,
      content_hash: beforeAfterSource.content_hash,
      mode: (beforeAfterSource.mode as string) || 'provider_record',
    };
  }

  const beforeAfterSnapshot = asRecord(beforeAfter.source_snapshot);
  if (Object.keys(beforeAfterSnapshot).length > 0) {
    return beforeAfterSnapshot;
  }

  const changedRecords = Array.isArray(after.changed_records)
    ? (after.changed_records as string[])
    : [];
  const workflowRunId = typeof after.checkpoint_run_id === 'string'
    ? after.checkpoint_run_id
    : typeof after.workflow_run_id === 'string'
      ? after.workflow_run_id
      : undefined;
  if (workflowRunId || changedRecords.length > 0) {
    return buildWorkflowRunSourceSnapshot({
      workflowRunId,
      changedRecords,
    });
  }

  return undefined;
}

function normalizeWorkflowToolName(raw: string): string {
  if (raw === 'search') {
    return 'search_records';
  }
  if (raw === 'read') {
    return 'read_record';
  }
  return raw;
}

function getWorkflowStepError(tool: string, stepResult: unknown) {
  if (!isObject(stepResult)) {
    return `workflow step ${tool} failed`;
  }
  const input = stepResult as { error?: unknown };
  if (typeof input.error === 'string') {
    return input.error;
  }
  if (input.error && typeof input.error === 'object' && 'error' in input.error) {
    const nested = (input.error as { error: unknown }).error;
    if (typeof nested === 'string') {
      return nested;
    }
  }
  return `workflow step ${tool} failed`;
}

function dedupeIds(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

type WorkflowExecutionContext = {
  seenWorkflows: Set<string>;
  visitedRecords: Set<string>;
  workflowRunId?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function runWorkflowStep(
  toolInput: Record<string, unknown>,
  actor: string,
  workflow: WorkflowDocument,
  context: WorkflowExecutionContext,
  options?: {
    checkpointRunId?: string;
    isNested?: boolean;
    signal?: AbortSignal | null;
    seed?: string;
  },
): Promise<{ status: 'ok' | 'failed' | 'skipped' | 'cancelled'; tool: string; stepResult: unknown; changedRecords: string[] }> {
  if (options?.signal?.aborted) {
    return {
      status: 'cancelled',
      tool: 'run_workflow',
      stepResult: { error: 'workflow cancelled' },
      changedRecords: [],
    };
  }

  const declaredSkill = ensureTool(toolInput.skill);
  const rawTool = ensureTool(toolInput.tool);
  if (!rawTool && declaredSkill) {
    // Skills are executable-data handoffs, not a second write path. They
    // return a deterministic proposal payload for a later typed operation.
    return {
      status: 'ok',
      tool: `skill:${declaredSkill}`,
      stepResult: {
        status: 'ok',
        skill: declaredSkill,
        input: isObject(toolInput.input) ? toolInput.input : {},
      },
      changedRecords: [],
    };
  }
  const tool = normalizeWorkflowToolName(rawTool);
  if (!tool) {
    return {
      status: 'failed',
      tool: '',
      stepResult: { error: 'tool is required' },
      changedRecords: [],
    };
  }
  const input = isObject(toolInput.input) ? toolInput.input : {};

  const domain = ensureDomain(input.domain);
  const commandText = `${tool} ${safeJsonText(input)}`;
  const policy = evaluateMcpPolicy({
    tool: `utopia.${tool}`,
    domain,
    command: commandText,
    actor,
  });
  if (policyBlocksExecution(policy)) {
    return {
      status: policy.decision === 'clarify' ? 'failed' : 'skipped',
      tool,
      stepResult: { policy },
      changedRecords: [],
    };
  }

  if (tool === 'search_records') {
    const query = normalizeQuery((input as { query?: unknown }).query);
    const collection = ensureCollection((input as { collection?: unknown }).collection);
    const records = listRecords({
      domain,
      collection,
      includeArchived: Boolean((input as { includeArchived?: unknown }).includeArchived),
      query,
      limit: Math.min(
        Number((input as { limit?: unknown }).limit) || MAX_RECORD_SEARCH_RESULTS,
        MAX_RECORD_SEARCH_RESULTS,
      ),
    });
    return {
      status: 'ok',
      tool,
      stepResult: { count: records.length, records },
      changedRecords: [],
    };
  }

  if (tool === 'read_record') {
    const id = ensureId((input as { id?: unknown }).id, { tool: 'read_record', workflow: workflow.id, input });
    const record = findRecord(id);
    return {
      status: record ? 'ok' : 'failed',
      tool,
      stepResult: record ? { record } : { error: 'record_not_found', id },
      changedRecords: [],
    };
  }

  if (tool === 'create_record' || tool === 'run_workflow') {
    if (tool === 'run_workflow') {
      const workflowId = makeText(input.workflow || input.id);
      if (!workflowId) {
        return { status: 'failed', tool, stepResult: { error: 'workflow id required' }, changedRecords: [] };
      }
      const nextWorkflow = findWorkflow(workflowId);
      if (!nextWorkflow || context.seenWorkflows.has(workflowId)) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: 'workflow_not_found_or_recursive', workflowId },
          changedRecords: [],
        };
      }
      const nestedActionId = buildWorkflowExecutionSeed({
        workflowId: workflowId,
        actor,
        actionId: `${workflow.id}->${workflowId}:${context.workflowRunId ?? options?.checkpointRunId ?? ''}`,
        checkpointRunId: options?.checkpointRunId,
        nested: true,
      });
      const nestedSeed = buildWorkflowExecutionSeed({
        workflowId: workflowId,
        actor,
        actionId: `${workflow.id}->${workflowId}:${context.workflowRunId || options?.checkpointRunId || ''}`,
        checkpointRunId: options?.checkpointRunId,
        nested: true,
      });
      return runWorkflow(nextWorkflow, actor, context, {
        isNested: true,
        checkpointRunId: options?.checkpointRunId,
        signal: options?.signal,
        actionId: nestedActionId,
        seed: nestedSeed,
      });
    }

    const recInput = input.record ?? input;
    const collection = ensureCollection((recInput as { collection?: unknown }).collection);
    const title = makeText((recInput as { title?: unknown }).title);
    const dataHome = ensureDataHome(makeText((recInput as { data_home?: unknown }).data_home || (recInput as { dataHome?: unknown }).dataHome || 'local_sqlite'));
    const recordId = ensureId((recInput as { id?: unknown }).id, {
      sourceHome: dataHome,
      operation: 'workflow-create-record',
      workflowId: workflow.id,
      collection,
      domain,
      title,
      properties: isObject((recInput as { properties?: unknown }).properties)
        ? ((recInput as { properties: Record<string, unknown> }).properties)
        : {},
    });
    const properties = isObject((recInput as { properties?: unknown }).properties)
      ? ((recInput as { properties: Record<string, unknown> }).properties)
      : {};
    const relations = Array.isArray((recInput as { relations?: unknown }).relations)
      ? (recInput as { relations: unknown[] }).relations
      : [];
    const externalId = makeText((recInput as { external_id?: unknown }).external_id);
    let source = providerSourceFromWrite({
      dataHome,
      operation: 'create_record',
      recordId,
      domain,
      collection,
      title,
      externalId,
    });

    if (dataHome === 'notion') {
      const notionWrite = await writeNotionRecord({
        operation: 'create_record',
        recordId,
        domain,
        collection,
        title,
        properties,
        externalId,
      });
      const notionSource = notionSourceFromResponse({
        ok: notionWrite.ok,
        source: notionWrite.source,
        source_snapshot: notionWrite.source_snapshot,
        operation: 'create_record',
      });
      if (!notionSource) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: notionWrite.error || 'notion write failed', source_snapshot: notionWrite.source_snapshot },
          changedRecords: [],
        };
      }
      source = notionSource;
      source.source_snapshot = notionWrite.source_snapshot || source.source_snapshot;
    }

    if (dataHome === 'google_sheets') {
      const sheetWrite = await writeSheetsRecord({
        operation: 'create_record',
        record: {
          id: recordId,
          domain,
          collection,
          title,
          properties,
          archived: false,
          externalId,
        },
      });
      if (!sheetWrite.ok) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: sheetWrite.error || 'sheets write failed', source_snapshot: sheetWrite.source_snapshot },
          changedRecords: [],
        };
      }
      const mapped = sheetsSourceFromResponse({
        ok: sheetWrite.ok,
        source: sheetWrite.source,
        source_snapshot: sheetWrite.source_snapshot,
      }) || source;
      if (!mapped.ok) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: sheetWrite.error || 'sheets source mapping failed', source_snapshot: sheetWrite.source_snapshot },
          changedRecords: [],
        };
      }
      source = mapped;
      source.source_snapshot = sheetWrite.source_snapshot || source.source_snapshot;
    }

    if (!source.ok) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: source.reason || 'provider write failed', source_snapshot: source.source_snapshot },
        changedRecords: [],
      };
    }

    const mutationKey = `workflow-step:${options?.seed || deterministicHash({
      workflow: workflow.id,
      run: context.workflowRunId,
      tool,
      recordId,
    })}`;
    const write = createRecordWithAction({
      actionId: mutationKey,
      actor,
      domain,
      tool: 'workflow_create_record',
      risk: 'standard',
      command: commandText,
      record: {
        id: recordId,
        domain,
        collection,
        title,
        properties,
        relations: isObject(relations[0] as object) ? (relations as McpRecord['relations']) : [],
        source: {
          provider: source.source.provider,
          external_id: source.source.external_id,
          url: source.source.url,
          observed_at: source.source.observed_at,
          content_hash: source.source.content_hash,
        },
        archived_at: null,
      },
      idempotencyKey: mutationKey,
      operationId: `${mutationKey}:operation`,
      causeId: context.workflowRunId || mutationKey,
    });
    const record = write.record;
    if (write.action.status !== 'completed' || !record) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: 'canonical workflow create failed', action: write.action },
        changedRecords: [],
      };
    }
    return {
      status: 'ok',
      tool,
      stepResult: { id: record.id, after: record, source_snapshot: source.source_snapshot, action_id: write.action.id },
      changedRecords: [record.id],
    };
  }

  if (tool === 'update_record') {
    const id = makeText((input as { id?: unknown }).id);
    if (!id) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: 'record id required for workflow update_record' },
        changedRecords: [],
      };
    }
    const existing = findRecord(id);
    if (!existing) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: 'record_not_found', id },
        changedRecords: [],
      };
    }

    const dataHome = ensureDataHome(
      makeText((input as { data_home?: unknown }).data_home || (input as { dataHome?: unknown }).dataHome || existing.source.provider),
    );
    const externalId = makeText((existing.source as { external_id?: unknown })?.external_id);

    if (dataHome !== 'local_sqlite' && existing.source.provider !== dataHome) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: `record ${id} is stored on ${existing.source.provider}; route writes using matching data_home.` },
        changedRecords: [],
      };
    }

    if (dataHome !== 'local_sqlite' && !externalId) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: `record ${id} is missing external_id for ${dataHome} mutation.` },
        changedRecords: [],
      };
    }

    const patch = isObject((input as { patch?: unknown }).patch)
      ? ((input as { patch: Record<string, unknown> }).patch)
      : {};
    const updatedTitle = isObject(patch.title)
      ? makeText(patch.title)
      : makeText((patch as { title?: unknown }).title) || existing.title;
    const properties = notionPropertiesForWrite(existing, patch as Partial<McpRecord>);
    const relations = Array.isArray((patch as { relations?: unknown }).relations)
      ? ((patch as { relations: unknown[] }).relations as McpRecord['relations'])
      : existing.relations;

    const source = providerSourceFromWrite({
      dataHome,
      operation: 'update_record',
      recordId: id,
      domain,
      collection: existing.collection,
      title: updatedTitle,
      externalId,
    });

    if (dataHome === 'notion') {
      const notionWrite = await writeNotionRecord({
        operation: 'update_record',
        recordId: id,
        pageId: externalId,
        domain,
        collection: existing.collection,
        title: updatedTitle || existing.title,
        properties,
      });
      const notionSource = notionSourceFromResponse({
        ok: notionWrite.ok,
        source: notionWrite.source,
        source_snapshot: notionWrite.source_snapshot,
        operation: 'update_record',
      });
      if (!notionSource) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: notionWrite.error || 'notion write failed', source_snapshot: notionWrite.source_snapshot },
          changedRecords: [],
        };
      }
      if (notionSource.source_snapshot) {
        source.source_snapshot = notionSource.source_snapshot;
      }
    }

    if (dataHome === 'google_sheets') {
      const sheetWrite = await writeSheetsRecord({
        operation: 'update_record',
        record: {
          id,
          title: updatedTitle || existing.title,
          domain,
          collection: existing.collection,
          properties,
          archived: Boolean(existing.archived_at),
          externalId,
          expectedDigest: expectedSheetsDigest(existing),
        },
      });
      if (!sheetWrite.ok) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: sheetWrite.error || 'sheets write failed', source_snapshot: sheetWrite.source_snapshot },
          changedRecords: [],
        };
      }
      if (sheetWrite.noChange) {
        return {
          status: 'ok',
          tool,
          stepResult: { message: 'No changes detected; local record is already up to date.', source_snapshot: sheetWrite.source_snapshot },
          changedRecords: [],
        };
      }
      const sheetSource = sheetsSourceFromResponse({
        ok: sheetWrite.ok,
        source: sheetWrite.source,
        source_snapshot: sheetWrite.source_snapshot,
      }) || source;
      if (!sheetSource.ok) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: sheetWrite.error || 'sheets source mapping failed', source_snapshot: sheetWrite.source_snapshot },
          changedRecords: [],
        };
      }
      if (sheetSource.source_snapshot) {
        source.source_snapshot = sheetSource.source_snapshot;
      }
      source.source = {
        provider: sheetSource.source.provider,
        external_id: sheetSource.source.external_id,
        url: sheetSource.source.url,
        observed_at: sheetSource.source.observed_at,
        content_hash: sheetSource.source.content_hash,
      };
    }

    if (!source.ok) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: source.reason || 'provider write failed', source_snapshot: source.source_snapshot },
        changedRecords: [],
      };
    }

    const mutationKey = `workflow-step:${options?.seed || deterministicHash({
      workflow: workflow.id,
      run: context.workflowRunId,
      tool,
      id,
    })}`;
    const write = updateRecordWithAction({
      actionId: mutationKey,
      actor,
      domain,
      tool: 'workflow_update_record',
      risk: 'standard',
      command: commandText,
      id,
      patch: {
        ...patch,
        title: updatedTitle || existing.title,
        properties,
        relations,
      } as Partial<McpRecord>,
      ...(dataHome === 'local_sqlite' ? {} : { source: source.source }),
      idempotencyKey: mutationKey,
      expectedRevision: existing.revision,
      operationId: `${mutationKey}:operation`,
      causeId: context.workflowRunId || mutationKey,
    });
    if (write.action.status !== 'completed' || !write.record) {
      return { status: 'failed', tool, stepResult: { error: 'canonical workflow update failed', action: write.action }, changedRecords: [] };
    }

    return {
      status: 'ok',
      tool,
      stepResult: {
        before: existing,
        after: write.record,
        source_snapshot: source.source_snapshot,
        action_id: write.action.id,
      },
      changedRecords: [write.record.id],
    };
  }

  if (tool === 'archive_record') {
    const id = makeText((input as { id?: unknown }).id);
    if (!id) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: 'record id required for workflow archive_record' },
        changedRecords: [],
      };
    }
    const existing = findRecord(id);
    if (!existing) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: 'record_not_found', id },
        changedRecords: [],
      };
    }

    const dataHome = ensureDataHome(makeText((input as { data_home?: unknown }).data_home || (input as { dataHome?: unknown }).dataHome || existing.source.provider));
    const externalId = makeText((existing.source as { external_id?: unknown })?.external_id);

    if (dataHome !== 'local_sqlite' && existing.source.provider !== dataHome) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: `record ${id} is stored on ${existing.source.provider}; route writes using matching data_home.` },
        changedRecords: [],
      };
    }

    if (dataHome !== 'local_sqlite' && !externalId) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: `record ${id} is missing external_id for ${dataHome} archive mutation.` },
        changedRecords: [],
      };
    }

    const source = providerSourceFromWrite({
      dataHome,
      operation: 'archive_record',
      recordId: id,
      domain,
      collection: existing.collection,
      title: existing.title,
      externalId,
    });

    if (dataHome === 'notion') {
      const notionWrite = await writeNotionRecord({
        operation: 'archive_record',
        recordId: id,
        pageId: externalId,
        domain,
        collection: existing.collection,
        title: existing.title,
        archived: true,
      });
      const notionSource = notionSourceFromResponse({
        ok: notionWrite.ok,
        source: notionWrite.source,
        source_snapshot: notionWrite.source_snapshot,
        operation: 'archive_record',
      });
      if (!notionSource) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: notionWrite.error || 'notion write failed', source_snapshot: notionWrite.source_snapshot },
          changedRecords: [],
        };
      }
      source.source_snapshot = notionSource.source_snapshot || source.source_snapshot;
    }

    if (dataHome === 'google_sheets') {
      const sheetWrite = await writeSheetsRecord({
        operation: 'archive_record',
        record: {
          id,
          title: existing.title,
          domain,
          collection: existing.collection,
          properties: existing.properties,
          archived: true,
          externalId,
          expectedDigest: expectedSheetsDigest(existing),
        },
      });
      if (!sheetWrite.ok) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: sheetWrite.error || 'sheets write failed', source_snapshot: sheetWrite.source_snapshot },
          changedRecords: [],
        };
      }
      const sheetSource = sheetsSourceFromResponse({
        ok: sheetWrite.ok,
        source: sheetWrite.source,
        source_snapshot: sheetWrite.source_snapshot,
      }) || source;
      if (!sheetSource.ok) {
        return {
          status: 'failed',
          tool,
          stepResult: { error: sheetWrite.error || 'sheets source mapping failed', source_snapshot: sheetWrite.source_snapshot },
          changedRecords: [],
        };
      }
      if (sheetSource.source_snapshot) {
        source.source_snapshot = sheetSource.source_snapshot;
      }
    }

    if (!source.ok) {
      return {
        status: 'failed',
        tool,
        stepResult: { error: source.reason || 'provider write failed', source_snapshot: source.source_snapshot },
        changedRecords: [],
      };
    }

    const mutationKey = `workflow-step:${options?.seed || deterministicHash({
      workflow: workflow.id,
      run: context.workflowRunId,
      tool,
      id,
    })}`;
    const write = archiveRecordWithAction({
      actionId: mutationKey,
      actor,
      domain,
      tool: 'workflow_archive_record',
      risk: 'standard',
      command: commandText,
      id,
      ...(dataHome === 'local_sqlite' ? {} : { source: source.source }),
      idempotencyKey: mutationKey,
      expectedRevision: existing.revision,
      operationId: `${mutationKey}:operation`,
      causeId: context.workflowRunId || mutationKey,
    });
    if (write.action.status !== 'completed' || !write.record) {
      return { status: 'failed', tool, stepResult: { error: 'canonical workflow archive failed', action: write.action }, changedRecords: [] };
    }
    return {
      status: 'ok',
      tool,
      stepResult: {
        before: existing,
        after: write.record,
        source_snapshot: source.source_snapshot,
        action_id: write.action.id,
      },
      changedRecords: [write.record.id],
    };
  }

  return {
    status: 'skipped',
    tool,
    stepResult: { skipped: true, tool },
    changedRecords: [],
  };
}

export async function runWorkflow(
  workflow: WorkflowDocument,
  actor: string,
  context: WorkflowExecutionContext,
  options?: {
    isNested?: boolean;
    checkpointRunId?: string;
    signal?: AbortSignal | null;
    seed?: string;
    actionId?: string;
  },
): Promise<WorkflowExecutionResult> {
  context.seenWorkflows.add(workflow.id);
  const stepReports: Array<{
    id: string;
    tool: string;
    status: 'ok' | 'failed' | 'skipped' | 'cancelled';
    result: unknown;
    output?: string;
  }> = [];
  const completedOutputs: WorkflowDependencyResult[] = [];
  const changed: string[] = [];
  const isNested = options?.isNested === true;
  const executionSeed = options?.seed
    || buildWorkflowExecutionSeed({
      workflowId: workflow.id,
      actor,
      actionId: options?.actionId,
      checkpointRunId: options?.checkpointRunId,
      nested: isNested,
    });
  const checkpointRunId = isNested
    ? options?.checkpointRunId ??
      context.workflowRunId ??
      startWorkflowCheckpoint({
        workflowId: workflow.id,
        domain: workflow.domain || 'food',
        actor,
        seed: executionSeed,
        changedRecords: Array.from(context.visitedRecords),
      })
    : options?.checkpointRunId ??
      startWorkflowCheckpoint({
        workflowId: workflow.id,
        domain: workflow.domain || 'food',
        actor,
        seed: executionSeed,
        changedRecords: Array.from(context.visitedRecords),
      });
  context.workflowRunId = checkpointRunId;

  const steps = workflow.steps.slice(0, WORKFLOW_MAX_STEPS);
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex] as Record<string, unknown>;
    const normalizedTool = ensureTool((step as { tool?: unknown }).tool || (step as { action?: unknown }).action);
    const parsed = parseWorkflowStepInput(
      step,
      buildWorkflowStepSeed({
        workflowId: workflow.id,
        stepIndex,
        tool: normalizedTool,
        checkpointRunId,
        contextSeed: executionSeed,
      }),
    );
    const binding = bindWorkflowStepInput(parsed, completedOutputs);
    const parsedWithBindings: ParsedWorkflowStepInput = {
      ...parsed,
      input: binding.input,
    };
    const startedAt = new Date().toISOString();
    const stepSeed = buildWorkflowStepSeed({
      workflowId: workflow.id,
      stepIndex,
      tool: normalizedTool,
      checkpointRunId,
      contextSeed: executionSeed,
    });
    const resolved = binding.ok
      ? await runWorkflowStep(parsedWithBindings, actor, workflow, context, {
          checkpointRunId,
          isNested: true,
          signal: options?.signal,
          seed: stepSeed,
        })
      : {
          status: 'failed' as const,
          tool: parsed.tool,
          stepResult: {
            error: `workflow dependencies missing: ${binding.missing.join(', ')}`,
            missing_dependencies: binding.missing,
          },
          changedRecords: [],
        };
    const finishedAt = new Date().toISOString();
    markWorkflowStep({
      runId: checkpointRunId,
      id: parsed.id,
      tool: parsed.tool,
      status: resolved.status,
      changedRecords: resolved.changedRecords,
      result: resolved.stepResult,
      error: getWorkflowStepError(parsed.tool, resolved.stepResult),
      startedAt,
      finishedAt,
    });

    stepReports.push({
      id: parsed.id,
      tool: parsed.tool,
      status: resolved.status,
      result: resolved.stepResult,
      ...(typeof parsed.output === 'string' && parsed.output.trim() ? { output: parsed.output.trim() } : {}),
    });
    if (resolved.status === 'ok') {
      completedOutputs.push({
        step_id: parsed.id,
        ...(typeof parsed.output === 'string' && parsed.output.trim() ? { output: parsed.output.trim() } : {}),
        result: resolved.stepResult,
      });
    }
    for (const id of resolved.changedRecords) {
      changed.push(id);
      context.visitedRecords.add(id);
    }

    if (resolved.status === 'cancelled') {
      if (!isNested) {
        completeWorkflowCheckpoint(checkpointRunId, {
          status: 'cancelled',
          error: getWorkflowStepError(parsed.tool, resolved.stepResult),
          changedRecords: dedupeIds(changed),
        });
      }
      return {
        status: 'cancelled',
        tool: 'run_workflow',
        stepResult: {
          status: 'cancelled',
          details: stepReports,
          changedRecords: dedupeIds(changed),
          error: getWorkflowStepError(parsed.tool, resolved.stepResult),
          source_snapshot: buildWorkflowRunSourceSnapshot({
            workflowRunId: checkpointRunId,
            changedRecords: dedupeIds(changed),
          }),
        },
        details: stepReports,
        changedRecords: dedupeIds(changed),
        checkpointRunId,
        error: getWorkflowStepError(parsed.tool, resolved.stepResult),
      };
    }

    if (resolved.status !== 'ok' && resolved.status !== 'skipped' && parsed.required !== false) {
      completeWorkflowCheckpoint(checkpointRunId, {
        status: 'failed',
        error: getWorkflowStepError(parsed.tool, resolved.stepResult),
        changedRecords: dedupeIds(changed),
      });

      if (!isNested) {
        const compensation = runWorkflowCompensation(
          buildWorkflowCompensation({
            workflowRunId: checkpointRunId,
            workflowId: workflow.id,
            changedRecords: dedupeIds(changed),
            details: stepReports,
          }),
        );
        finalizeWorkflowCompensated(checkpointRunId, compensation.errors.length > 0 ? compensation.errors[0].error : undefined);
        return {
          status: 'failed',
          tool: 'run_workflow',
          stepResult: {
            status: 'failed',
            details: stepReports,
            changedRecords: dedupeIds(changed),
            error: getWorkflowStepError(parsed.tool, resolved.stepResult),
            source_snapshot: buildWorkflowRunSourceSnapshot({
              workflowRunId: checkpointRunId,
              changedRecords: dedupeIds(changed),
            }),
          },
          details: stepReports,
          changedRecords: dedupeIds(changed),
          checkpointRunId,
          compensation,
          error: getWorkflowStepError(parsed.tool, resolved.stepResult),
        };
      }

      return {
        status: 'failed',
        tool: 'run_workflow',
        stepResult: {
          status: 'failed',
          details: stepReports,
          changedRecords: changed,
          error: getWorkflowStepError(parsed.tool, resolved.stepResult),
          source_snapshot: buildWorkflowRunSourceSnapshot({
            workflowRunId: checkpointRunId,
            changedRecords: dedupeIds(changed),
          }),
        },
        details: stepReports,
        changedRecords: changed,
        checkpointRunId,
        error: getWorkflowStepError(parsed.tool, resolved.stepResult),
      };
    }
  }

  if (options?.signal?.aborted) {
    if (!isNested) {
      completeWorkflowCheckpoint(checkpointRunId, {
        status: 'cancelled',
        changedRecords: dedupeIds(changed),
      });
    }
    return {
      status: 'cancelled',
      tool: 'run_workflow',
      stepResult: {
        status: 'cancelled',
        error: 'workflow cancelled',
        source_snapshot: buildWorkflowRunSourceSnapshot({
          workflowRunId: checkpointRunId,
          changedRecords: dedupeIds(changed),
        }),
      },
      changedRecords: dedupeIds(changed),
    };
  }

  if (!isNested) {
    completeWorkflowCheckpoint(checkpointRunId, {
      status: 'completed',
      changedRecords: dedupeIds(changed),
    });
  }

  return {
    status: 'ok',
    tool: 'run_workflow',
    stepResult: {
      status: 'ok',
      details: stepReports,
      outputs: Object.fromEntries(
        completedOutputs
          .filter((entry) => Boolean(entry.output))
          .map((entry) => [entry.output!, entry.result]),
      ),
      changedRecords: dedupeIds(changed),
      source_snapshot: buildWorkflowRunSourceSnapshot({
        workflowRunId: checkpointRunId,
        changedRecords: dedupeIds(changed),
      }),
    },
    details: stepReports,
    changedRecords: dedupeIds(changed),
    checkpointRunId,
  };
}

function createRunWorkflowAction({
  workflow,
  domain,
  actor,
  command,
  idempotencyKey,
  conversationId,
  actionId,
}: {
  workflow: WorkflowDocument;
  domain: string;
  actor: string;
  command: string;
  idempotencyKey?: string;
  conversationId?: string | null;
  actionId?: string;
}) {
  const existing = idempotencyKey ? findActionByIdempotencyKey(idempotencyKey) : null;
  if (existing) {
    return existing;
  }

  const action = createActionEvent({
    id: actionId || makeActionId(`workflow:${workflow.id}`, {
      operation: 'run_workflow',
      workflowId: workflow.id,
      actor,
      domain,
      idempotencyKey,
    }),
    actor,
    domain,
    tool: RECORD_TOOLS.runWorkflow,
    risk: 'standard',
    recordIds: [],
    idempotencyKey,
    command,
    before: {
      workflow: workflow.id,
      steps: workflow.steps.length,
    },
    undoPayload: {
      operation: 'undo_workflow_checkpoint',
      workflow_id: workflow.id,
    },
    conversationId,
  });
  return action;
}

export function listMcpTools(): McpToolDefinition[] {
  const toolSet = [
    {
      name: ACTION_TOOLS.status,
      description: 'Show Utopia MCP capabilities, resources, and safety posture.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: ACTION_TOOLS.getResource,
      description: 'Read a Utopia skill, schema, or app command contract resource.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['uri'],
        properties: {
          uri: { type: 'string' },
        },
      },
    },
    {
      name: ACTION_TOOLS.validateCommandEnvelope,
      description: 'Validate a command envelope shape and policy context.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['envelope'],
        properties: {
          envelope: { type: 'object', additionalProperties: true },
        },
      },
    },
    {
      name: ACTION_TOOLS.proposeAppLink,
      description: 'Create a review-only Utopia action link for one or more supported app actions.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['requestId', 'actions'],
        properties: {
          requestId: { type: 'string', minLength: 1 },
          actions: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_ACTIONS_PER_REQUEST,
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['type'],
            },
          },
          scheme: { type: 'string', enum: [SCHEME_HTTPS, SCHEME_WONDERFOOD] },
          actor: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      name: ACTION_TOOLS.wrapProposalPackage,
      description: 'Wrap a validated command envelope in proposal-package format.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['proposal_id', 'producer', 'command_envelope'],
        properties: {
          proposal_id: { type: 'string', minLength: 1 },
          producer: { type: 'string', minLength: 1 },
          command_envelope: { type: 'object', additionalProperties: true },
        },
      },
    },
    {
      name: RECORD_TOOLS.searchRecords,
      description: 'Search canonical records by collection/query.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['domain', 'collection'],
        properties: {
          domain: { type: 'string', minLength: 1 },
          collection: { type: 'string', minLength: 1 },
          query: { type: 'string' },
          includeArchived: { type: 'boolean' },
          limit: { type: 'number', minimum: 1, maximum: MAX_RECORD_SEARCH_RESULTS },
        },
      },
    },
    {
      name: RECORD_TOOLS.readRecord,
      description: 'Read one canonical record by id.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      name: RECORD_TOOLS.createRecord,
      description: 'Create one canonical record.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['domain', 'collection'],
        properties: {
          actor: { type: 'string' },
          domain: { type: 'string', minLength: 1 },
          collection: { type: 'string', minLength: 1 },
          data_home: { type: 'string', enum: WRITE_DATA_HOME },
          id: { type: 'string' },
          title: { type: 'string' },
          properties: { type: 'object' },
          relations: { type: 'array' },
          source: { type: 'object' },
          idempotency_key: { type: 'string' },
          action_id: { type: 'string' },
          conversation_id: { type: 'string' },
          approval_receipt: { type: 'object', additionalProperties: true },
        },
      },
    },
    {
      name: RECORD_TOOLS.updateRecord,
      description: 'Update one canonical record.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'patch'],
        properties: {
          actor: { type: 'string' },
          id: { type: 'string', minLength: 1 },
          data_home: { type: 'string', enum: WRITE_DATA_HOME },
          patch: { type: 'object', additionalProperties: true },
          domain: { type: 'string', minLength: 1 },
          idempotency_key: { type: 'string' },
          action_id: { type: 'string' },
          conversation_id: { type: 'string' },
          approval_receipt: { type: 'object', additionalProperties: true },
        },
      },
    },
    {
      name: RECORD_TOOLS.archiveRecord,
      description: 'Archive one canonical record.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          actor: { type: 'string' },
          id: { type: 'string', minLength: 1 },
          data_home: { type: 'string', enum: WRITE_DATA_HOME },
          domain: { type: 'string', minLength: 1 },
          idempotency_key: { type: 'string' },
          action_id: { type: 'string' },
          conversation_id: { type: 'string' },
          approval_receipt: { type: 'object', additionalProperties: true },
        },
      },
    },
    {
      name: RECORD_TOOLS.runWorkflow,
      description: 'Run a declared workflow with checkpoints.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['workflow'],
        properties: {
          actor: { type: 'string' },
          workflow: { type: 'string', minLength: 1 },
          domain: { type: 'string', minLength: 1 },
          idempotency_key: { type: 'string' },
          action_id: { type: 'string' },
          conversation_id: { type: 'string' },
          approval_receipt: { type: 'object', additionalProperties: true },
        },
      },
    },
    {
      name: RECORD_TOOLS.undoAction,
      description: 'Undo a completed reversible action.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['actionId'],
        properties: {
          actor: { type: 'string' },
          actionId: { type: 'string', minLength: 1 },
          idempotency_key: { type: 'string' },
          action_id: { type: 'string' },
          approval_receipt: { type: 'object', additionalProperties: true },
        },
      },
    },
  ];

  return toolSet;
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const typedArgs = args;

  if (name === ACTION_TOOLS.status) {
    return resolveToolResult({
      server: {
        name: 'utopia-server',
        version: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
      },
      safety: 'review-only; no direct writes; generated links/packages must be accepted in app',
      dataHomes: DATA_HOME,
      tools: listMcpTools().map((tool) => tool.name),
      resources: ['utopia://domain-catalog', 'utopia://domain-catalog-v1'],
    });
  }

  if (name === ACTION_TOOLS.getResource) {
    const uri = makeText(typedArgs.uri);
    if (!uri) {
      throw new Error('uri is required');
    }
    return resolveToolResult({ uri, text: readMcpResource(uri) }, false, 'read-only');
  }

  if (name === ACTION_TOOLS.validateCommandEnvelope) {
    const envelope = typedArgs.envelope;
    if (!envelope || !isObject(envelope)) {
      throw new Error('envelope must be an object');
    }
    return resolveToolResult(validateCommandEnvelopeLite(envelope), true, 'validation-only');
  }

  if (name === ACTION_TOOLS.proposeAppLink) {
    const requestId = makeText(typedArgs.requestId);
    const actor = ensureActor(typedArgs.actor);
    const actionsRaw = Array.isArray((typedArgs as { actions?: unknown }).actions)
      ? ((typedArgs as { actions: unknown[] }).actions)
      : [];
    const actions = [...actionsRaw];
    const scheme = makeText(typedArgs.scheme) || SCHEME_HTTPS;
    if (!requestId) {
      throw new Error('requestId is required');
    }
    if (actions.length === 0) {
      throw new Error('actions must be a non-empty list');
    }
    if (actions.length > MAX_ACTIONS_PER_REQUEST) {
      throw new Error(`At most ${MAX_ACTIONS_PER_REQUEST} actions are supported per request`);
    }
    const cleanActions = actions.map((entry) => {
      if (!isObject(entry)) {
        throw new Error('each action must be an object');
      }
      const candidate: CandidateAction = { ...entry };
      const type = makeText(candidate.type);
      if (!type) {
        throw new Error('each action must include type');
      }
      const normalizedType = type.includes('.') ? type : `inventory.${type}`;
      candidate.type = normalizedType;
      return candidate;
    });

    const base = scheme === SCHEME_WONDERFOOD ? 'utopia://action' : 'https://utopia.app/action';
    const query = new URLSearchParams({ requestId, actor });
    if (cleanActions.length === 1) {
      const action = cleanActions[0];
      for (const [key, value] of Object.entries(action)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          query.set(key, String(value));
        }
      }
    } else {
      query.set('actions', JSON.stringify(cleanActions));
    }

    return resolveToolResult({
      reviewOnly: true,
      url: `${base}?${query.toString()}`,
      actionCount: cleanActions.length,
      actor,
    }, true, 'review-only');
  }

  if (name === ACTION_TOOLS.wrapProposalPackage) {
    const proposalId = makeText(typedArgs.proposal_id);
    const producer = makeText(typedArgs.producer);
    const commandEnvelope = typedArgs.command_envelope;
    if (!proposalId || !producer) {
      throw new Error('proposal_id and producer are required');
    }
    if (!commandEnvelope || !isObject(commandEnvelope)) {
      throw new Error('command_envelope must be an object');
    }
    const validation = validateCommandEnvelopeLite(commandEnvelope);
    if (!validation.valid) {
      return resolveToolResult({
        valid: false,
        errors: validation.errors,
        reviewOnly: true,
      }, true, 'invalid-envelope');
    }

    const now = new Date();
    const packagePayload = {
      schema_version: 'wf.proposal-package.v1',
      proposal_id: proposalId,
      origin: { kind: 'gpt_skill', producer },
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      command_envelope: commandEnvelope,
      signature: null,
    };

    return resolveToolResult({ valid: true, reviewOnly: true, package: packagePayload }, true, 'review-only');
  }

  if (name === RECORD_TOOLS.searchRecords) {
    const domain = ensureDomain(typedArgs.domain);
    const collection = ensureCollection(typedArgs.collection);
    const query = normalizeQuery(typedArgs.query);
    const limit = typeof typedArgs.limit === 'number' && typedArgs.limit > 0
      ? typedArgs.limit
      : MAX_RECORD_SEARCH_RESULTS;

    const records = listRecords({
      domain,
      collection,
      query,
      includeArchived: Boolean(typedArgs.includeArchived),
      limit: Math.min(limit, MAX_RECORD_SEARCH_RESULTS),
    });
    return resolveToolResult(
      {
        count: records.length,
        domain,
        collection,
        includeArchived: Boolean(typedArgs.includeArchived),
        records,
      },
      true,
      'read-only',
    );
  }

  if (name === RECORD_TOOLS.readRecord) {
    const id = makeText(typedArgs.id);
    if (!id) {
      throw new Error('id is required');
    }
    const record = findRecord(id);
    if (!record) {
      throw new Error(`record ${id} not found`);
    }
    return resolveToolResult({ record }, true, 'read-only');
  }

  if (name === RECORD_TOOLS.createRecord) {
    const actor = ensureActor(typedArgs.actor);
    const domain = ensureDomain(typedArgs.domain);
    const collection = ensureCollection(typedArgs.collection);
    const dataHome = ensureDataHome(makeText((typedArgs as Record<string, unknown>).data_home || (typedArgs as { dataHome?: unknown }).dataHome));
    const idempotencyKey = makeText(typedArgs.idempotency_key) || undefined;
    const actionId = makeText(typedArgs.action_id)
      || makeActionId('create_record', {
        operation: 'create_record',
        actor,
        domain,
        collection,
        dataHome,
        idempotencyKey,
      });
    const conversationId = ensureConversationId(typedArgs.conversation_id);

    const recordInput = {
      ...asRecord(typedArgs),
      ...asRecord(typedArgs.record),
    };
    const title = makeText(recordInput.title);
    const properties = isObject(recordInput.properties)
      ? (recordInput.properties as Record<string, unknown>)
      : {};
    const relations = Array.isArray(recordInput.relations)
      ? (recordInput.relations as unknown[])
      : [];

    const policy = actionToolPolicy({
      tool: name,
      domain,
      command: `create ${collection} ${title || 'record'}`,
      actor,
    });
    if (policyBlocksExecution(policy)) {
      return resolveToolResult({ allowed: false, policy }, true, policy.safety);
    }

    const recordId = ensureId(recordInput.id || actionId);
    const resolvedIdempotencyKey = idempotencyKey
      || buildDeterministicIdempotencyKey({
        operation: 'create_record',
        dataHome,
        recordId,
        domain,
        collection,
        payload: {
          title,
          properties,
          externalId: makeText((recordInput as { external_id?: unknown }).external_id),
          relations,
          dataHome,
        },
      });
    const existing = resolvedIdempotencyKey ? findActionByIdempotencyKey(resolvedIdempotencyKey) : null;
    if (existing && existing.status === 'completed') {
      const replayRecord = existing.record_ids[0] ? findRecord(existing.record_ids[0]) : null;
      return resolveToolResult({
        action: existing,
        replayed: true,
        record: replayRecord,
      }, false, 'write', {
        action: existing,
        sourceSnapshot: getActionSourceSnapshot(existing),
      });
    }
    const idempotencyKeyWithDefault = resolvedIdempotencyKey;

    const reviewGate = policyNeedsReview(policy)
      ? requireDurableReviewApproval({
        approval: typedArgs.approval_receipt,
        tool: name,
        domain,
        actor,
        policy,
        command: `create_record:${collection}`,
        idempotencyKey: idempotencyKeyWithDefault,
        actionId,
        recordIds: [recordId],
        conversationId,
        requestedOperation: {
          tool: name,
          domain,
          collection,
          dataHome,
          recordId,
          title,
          properties,
          relations,
          externalId: makeText((recordInput as { external_id?: unknown }).external_id),
        },
        existingAction: existing,
      })
      : null;
    if (reviewGate && !reviewGate.ok) {
      return reviewGate.result;
    }
    let notionWriteResult: {
      success?: boolean;
      provider_record_id?: string | null;
      action_receipt?: unknown;
      source_snapshot?: Record<string, unknown>;
    } | null = null;
    let source = providerSourceFromWrite({
      dataHome,
      operation: 'create_record',
      recordId,
      domain,
      collection,
      title,
      externalId: makeText((recordInput as { external_id?: unknown }).external_id),
    });

    if (!source.ok) {
      return resolveToolResult({
        allowed: false,
        policy,
        provider: dataHome,
        message: source.reason,
        requiredConfig: source.requiredConfig,
        source_snapshot: source.source_snapshot,
      }, true, policy.safety);
    }

    if (dataHome === 'notion') {
      const notionWrite = await writeNotionRecord({
        operation: 'create_record',
        recordId,
        domain,
        collection,
        title,
        properties: properties,
        externalId: makeText((recordInput as { external_id?: unknown }).external_id),
      });
      notionWriteResult = notionWrite;
      const notionSource = notionSourceFromResponse({
        ok: notionWrite.ok,
        source: notionWrite.source,
        source_snapshot: notionWrite.source_snapshot,
        operation: 'create_record',
      });
      if (!notionSource) {
        return resolveToolResult({
          allowed: false,
          policy,
          provider: dataHome,
          message: notionWrite.error || 'Notion write failed.',
          source_snapshot: notionWrite.source_snapshot,
          requiredConfig: source.requiredConfig,
        }, true, policy.safety);
      }
      source = notionSource;
      source.source_snapshot = notionWrite.source_snapshot || source.source_snapshot;
    }

    if (dataHome === 'google_sheets') {
      const sheetWrite = await writeSheetsRecord({
        operation: 'create_record',
        record: {
          id: recordId,
          domain,
          collection,
          title,
          properties,
          archived: false,
          externalId: makeText((recordInput as { external_id?: unknown }).external_id),
        },
      });
      if (!sheetWrite.ok) {
        return resolveToolResult({
          allowed: false,
          policy,
          provider: dataHome,
          message: sheetWrite.error || 'Sheets write failed.',
          requiredConfig: source.requiredConfig,
          source_snapshot: sheetWrite.source_snapshot,
        }, true, policy.safety);
      }
      source = sheetsSourceFromResponse({
        ok: sheetWrite.ok,
        source: sheetWrite.source,
        source_snapshot: sheetWrite.source_snapshot,
      }) || source;
      if (!source.ok) {
        return resolveToolResult({
          allowed: false,
          policy,
          provider: dataHome,
          message: sheetWrite.error || 'Sheets write failed.',
          source_snapshot: sheetWrite.source_snapshot,
          requiredConfig: source.requiredConfig,
        }, true, policy.safety);
      }
    }

    const created = createRecordWithAction({
      actionId: (reviewGate && reviewGate.ok ? reviewGate.action.id : existing?.id) ?? actionId,
      actor,
      domain,
      tool: name,
      risk: policy.risk,
      command: `create_record:${collection}`,
      idempotencyKey: idempotencyKeyWithDefault,
      sourceIds: existing ? existing.source_ids : [],
      conversationId,
      record: {
        id: recordId,
        domain,
        collection,
        title,
        properties,
        relations: relations as McpRecord['relations'],
        source: source.source,
        archived_at: null,
      },
      undoPayload: { operation: 'delete_record', record_id: recordId, provider_snapshot: source.source_snapshot },
      operationId: reviewGate && reviewGate.ok ? reviewGate.action.operation_id : undefined,
      causeId: reviewGate && reviewGate.ok ? reviewGate.action.cause_id : undefined,
    });
    if (created.action.status === 'failed' || !created.record) {
      return resolveToolResult({
        allowed: false,
        policy,
        action: created.action,
        message: 'record could not be created through the canonical writer.',
      }, true, policy.safety, {
        action: created.action,
        sourceSnapshot: source.source_snapshot,
      });
    }
    const completed = markActionCompleted(created.action.id, created.action.command, {
      record: created.record,
      source_snapshot: source.source_snapshot,
    });
    return resolveWriteResult({
      action: completed || created.action,
      record: created.record,
      source_snapshot: source.source_snapshot,
      ...(notionWriteResult
        ? {
            success: notionWriteResult.success,
            provider_record_id: notionWriteResult.provider_record_id,
            action_receipt: notionWriteResult.action_receipt,
          }
        : {}),
    }, completed || created.action);
  }

  if (name === RECORD_TOOLS.updateRecord) {
    const actor = ensureActor(typedArgs.actor);
  const id = makeText(typedArgs.id);
    const dataHome = ensureDataHome(makeText((typedArgs as Record<string, unknown>).data_home || (typedArgs as { dataHome?: unknown }).dataHome));
    const patch = isObject(typedArgs.patch) ? (typedArgs.patch as Record<string, unknown>) : null;
    if (!id || !patch) {
      throw new Error('id and patch are required');
    }
    const existing = findRecord(id);
    if (!existing) {
      throw new Error(`record ${id} not found`);
    }
    const domain = ensureDomain(typedArgs.domain || existing.domain);
    const idempotencyKey = makeText(typedArgs.idempotency_key) || undefined;
    const actionId = makeText(typedArgs.action_id)
      || makeActionId(`update:${id}`, {
        operation: 'update_record',
        actor,
        id,
        domain,
      });
    const conversationId = ensureConversationId(typedArgs.conversation_id);
    const policy = actionToolPolicy({
      tool: name,
      domain,
      command: `update ${existing.collection} ${id}`,
      actor,
    });
    const externalId = makeText((existing.source as { external_id?: unknown })?.external_id);
    if (dataHome !== 'local_sqlite' && existing.source?.provider !== dataHome) {
      return resolveToolResult({
        allowed: false,
        policy,
        provider: dataHome,
        message: `record ${id} is stored on ${existing.source?.provider}; route writes using matching data_home.`,
      }, true, 'review-only');
    }

    if (dataHome !== 'local_sqlite' && !externalId) {
      return resolveToolResult({
        allowed: false,
        policy,
        provider: dataHome,
        message: `record ${id} is missing external_id for ${dataHome} mutation.`,
      }, true, 'review-only');
    }

  const updatedTitle = typeof patch.title === 'string' && patch.title.trim().length > 0
    ? patch.title.trim()
    : existing.title;
  const updatedDomain = makeText((patch as { domain?: unknown }).domain) || existing.domain;
  const updatedCollection = makeText((patch as { collection?: unknown }).collection) || existing.collection;
  const updatedProperties = notionPropertiesForWrite(existing, patch as Partial<McpRecord>);
  const updatedArchivedAt = (patch as { archived_at?: unknown }).archived_at;
    const normalizedArchived = updatedArchivedAt === null
      ? false
      : typeof updatedArchivedAt === 'string'
        ? true
        : Boolean(existing.archived_at);
    const resolvedIdempotencyKey = idempotencyKey
      || buildDeterministicIdempotencyKey({
        operation: 'update_record',
        dataHome,
        recordId: id,
        domain,
        collection: updatedCollection,
        payload: {
          title: updatedTitle,
          domain: updatedDomain,
          collection: updatedCollection,
          archived: normalizedArchived,
          properties: updatedProperties,
          patch,
          dataHome,
        },
      });
    if (policyBlocksExecution(policy)) {
      return getOrCreateActionFromPolicy({
        tool: name,
        domain,
        actor,
        command: `update_record:${id}`,
        policy,
        idempotencyKey: resolvedIdempotencyKey,
        actionId,
        recordIds: [id],
        before: existing,
        conversationId,
      });
    }
    const repeated = resolvedIdempotencyKey ? findActionByIdempotencyKey(resolvedIdempotencyKey) : null;
    if (repeated && repeated.status === 'completed') {
      return resolveWriteResult({
        action: repeated,
        replayed: true,
        record: findRecord(id),
        source_snapshot: getActionSourceSnapshot(repeated),
      }, repeated);
    }
    const reviewGate = policyNeedsReview(policy)
      ? requireDurableReviewApproval({
        approval: typedArgs.approval_receipt,
        tool: name,
        domain,
        actor,
        policy,
        command: `update_record:${id}`,
        idempotencyKey: resolvedIdempotencyKey,
        actionId,
        recordIds: [id],
        conversationId,
        before: existing,
        requestedOperation: {
          tool: name,
          domain,
          dataHome,
          recordId: id,
          expectedRevision: existing.revision ?? null,
          patch,
          next: {
            title: updatedTitle,
            domain: updatedDomain,
            collection: updatedCollection,
            properties: updatedProperties,
            archived: normalizedArchived,
          },
        },
        existingAction: repeated,
      })
      : null;
    if (reviewGate && !reviewGate.ok) {
      return reviewGate.result;
    }

  let notionWriteResult: {
    success?: boolean;
    provider_record_id?: string | null;
    action_receipt?: unknown;
    source_snapshot?: Record<string, unknown>;
  } | null = null;
  let source = providerSourceFromWrite({
    dataHome,
    operation: 'update_record',
    recordId: id,
    domain: updatedDomain,
    collection: updatedCollection,
    title: updatedTitle,
    externalId: makeText((existing.source as { external_id?: unknown })?.external_id),
  });

  if (dataHome === 'notion' && existing.source?.provider === 'notion') {
    const notionWrite = await writeNotionRecord({
      operation: 'update_record',
      recordId: id,
      pageId: externalId,
      domain: updatedDomain,
      collection: updatedCollection,
      title: updatedTitle,
      properties: updatedProperties,
    });
    const notionSource = notionSourceFromResponse({
      ok: notionWrite.ok,
      source: notionWrite.source,
      source_snapshot: notionWrite.source_snapshot,
      operation: 'update_record',
    });
    if (!notionSource) {
      return resolveToolResult({
        allowed: false,
        policy,
        provider: dataHome,
        message: notionWrite.error || 'Notion write failed.',
        source_snapshot: notionWrite.source_snapshot,
      }, true, policy.safety);
    }
    notionWriteResult = {
      success: notionWrite.success,
      provider_record_id: notionWrite.provider_record_id,
      action_receipt: notionWrite.action_receipt,
      source_snapshot: notionWrite.source_snapshot,
    };
    source = notionSource;
  }

  if (dataHome === 'google_sheets') {
    const sheetWrite = await writeSheetsRecord({
      operation: 'update_record',
      record: {
        id,
        title: updatedTitle,
        domain: updatedDomain,
        collection: updatedCollection,
        properties: updatedProperties,
        archived: normalizedArchived,
        externalId: makeText((existing.source as { external_id?: unknown })?.external_id),
        expectedDigest: expectedSheetsDigest(existing),
      },
    });
    if (!sheetWrite.ok) {
      return resolveToolResult({
        allowed: false,
        policy,
        provider: dataHome,
        message: sheetWrite.error || 'Google Sheets write failed.',
        source_snapshot: sheetWrite.source_snapshot,
      }, true, policy.safety);
    }
    if (sheetWrite.noChange) {
      return resolveWriteResult({
        message: 'No changes detected; local record is already up to date.',
        record: existing,
        source_snapshot: sheetWrite.source_snapshot,
      }, undefined);
    }
    source = sheetsSourceFromResponse({
      ok: sheetWrite.ok,
      source: sheetWrite.source,
      source_snapshot: sheetWrite.source_snapshot,
    }) || source;
    if (!source.ok) {
      return resolveToolResult({
        allowed: false,
        policy,
        provider: dataHome,
        message: sheetWrite.error || 'Google Sheets write failed.',
        source_snapshot: sheetWrite.source_snapshot,
        requiredConfig: source.requiredConfig,
      }, true, policy.safety);
    }
  }

  if (dataHome === 'notion' && !source.ok) {
    return resolveToolResult({
      allowed: false,
      policy,
      provider: dataHome,
      message: source.reason ?? 'Notion mutation returned invalid source snapshot.',
      source_snapshot: source.source_snapshot,
    }, true, policy.safety);
  }

  if (dataHome !== 'notion' && !source.ok) {
    return resolveToolResult({
      allowed: false,
      policy,
      provider: dataHome,
      message: source.reason,
      requiredConfig: source.requiredConfig,
      source_snapshot: source.source_snapshot,
    }, true, policy.safety);
  }

  const updated = updateRecordWithAction({
    actionId: reviewGate && reviewGate.ok ? reviewGate.action.id : actionId,
    actor,
    domain,
    tool: name,
    risk: policy.risk,
    command: `update_record:${id}`,
    id,
    patch: {
      ...patch,
      title: updatedTitle,
      domain: updatedDomain,
      collection: updatedCollection,
      properties: updatedProperties,
      ...(updatedArchivedAt === null ? { archived_at: null } : {}),
    },
    idempotencyKey: resolvedIdempotencyKey,
    sourceIds: repeated ? repeated.source_ids : [],
    conversationId,
    ...(dataHome === 'local_sqlite' ? {} : { source: source.source }),
    undoPayload: {
      operation: 'restore_after_update',
      before: existing,
      record_id: id,
      provider_snapshot: source.source_snapshot,
    },
    expectedRevision: existing.revision,
    operationId: reviewGate && reviewGate.ok ? reviewGate.action.operation_id : undefined,
    causeId: reviewGate && reviewGate.ok ? reviewGate.action.cause_id : undefined,
  });
  if (updated.action.status === 'failed' || !updated.record) {
    return resolveToolResult({
      allowed: false,
      policy,
      action: updated.action,
      message: 'record could not be updated through the canonical writer.',
      source_snapshot: source.source_snapshot,
    }, true, policy.safety, {
      action: updated.action,
      sourceSnapshot: source.source_snapshot,
    });
  }
  const completed = markActionCompleted(updated.action.id, updated.action.command, {
    record: updated.record,
    source_snapshot: source.source_snapshot,
  });
  return resolveWriteResult(
    {
      action: completed || updated.action,
      record: updated.record,
      source_snapshot: source.source_snapshot,
      ...(notionWriteResult
        ? {
            success: notionWriteResult.success,
            provider_record_id: notionWriteResult.provider_record_id,
            action_receipt: notionWriteResult.action_receipt,
          }
        : {}),
    },
    completed || updated.action,
  );
}


  if (name === RECORD_TOOLS.archiveRecord) {
    const actor = ensureActor(typedArgs.actor);
    const id = makeText(typedArgs.id);
    const dataHome = ensureDataHome(makeText((typedArgs as Record<string, unknown>).data_home || (typedArgs as { dataHome?: unknown }).dataHome));
    if (!id) {
      throw new Error('id is required');
    }
    const existing = findRecord(id);
    if (!existing) {
      throw new Error(`record ${id} not found`);
    }
    const domain = ensureDomain(typedArgs.domain || existing.domain);
    const idempotencyKey = makeText(typedArgs.idempotency_key) || undefined;
    const actionId = makeText(typedArgs.action_id)
      || makeActionId(`archive:${id}`, {
        operation: 'archive_record',
        actor,
        id,
      });
    const conversationId = ensureConversationId(typedArgs.conversation_id);
    const policy = actionToolPolicy({
      tool: name,
      domain,
      command: `archive ${existing.collection} ${id}`,
      actor,
    });
    if (policyBlocksExecution(policy)) {
      return getOrCreateActionFromPolicy({
        tool: name,
        domain,
        actor,
        command: `archive_record:${id}`,
        policy,
        idempotencyKey: idempotencyKey || buildDeterministicIdempotencyKey({
          operation: 'archive_record',
          dataHome,
          recordId: id,
          domain,
          collection: existing.collection,
          payload: {
            title: existing.title,
            collection: existing.collection,
            archived: true,
            dataHome,
          },
        }),
        recordIds: [id],
        before: existing,
        conversationId,
      });
    }

    const resolvedIdempotencyKey = idempotencyKey
      || buildDeterministicIdempotencyKey({
        operation: 'archive_record',
        dataHome,
        recordId: id,
        domain,
        collection: existing.collection,
        payload: {
          title: existing.title,
          collection: existing.collection,
          archived: true,
          dataHome,
        },
      });
    const repeated = resolvedIdempotencyKey ? findActionByIdempotencyKey(resolvedIdempotencyKey) : null;
    if (repeated && repeated.status === 'completed') {
      return resolveWriteResult({
        action: repeated,
        replayed: true,
        record: findRecord(id),
        source_snapshot: getActionSourceSnapshot(repeated),
      }, repeated);
    }
    const reviewGate = policyNeedsReview(policy)
      ? requireDurableReviewApproval({
        approval: typedArgs.approval_receipt,
        tool: name,
        domain,
        actor,
        policy,
        command: `archive_record:${id}`,
        idempotencyKey: resolvedIdempotencyKey,
        actionId,
        recordIds: [id],
        conversationId,
        before: existing,
        requestedOperation: {
          tool: name,
          domain,
          dataHome,
          recordId: id,
          expectedRevision: existing.revision ?? null,
          sourceProvider: existing.source?.provider ?? null,
          externalId: existing.source?.external_id ?? null,
          archived: true,
        },
        existingAction: repeated,
      })
      : null;
    if (reviewGate && !reviewGate.ok) {
      return reviewGate.result;
    }

    if (dataHome !== 'local_sqlite' && existing.source?.provider !== dataHome) {
      return resolveToolResult({
        allowed: false,
        policy,
        provider: dataHome,
        message: `record ${id} is stored on ${existing.source?.provider}; route writes using matching data_home.`,
      }, true, 'review-only');
    }

  const notionId = makeText((existing.source as { external_id?: unknown })?.external_id);
    if (dataHome !== 'local_sqlite' && !notionId) {
      return resolveToolResult({
        allowed: false,
        policy,
        provider: dataHome,
        message: `record ${id} is missing external_id for ${dataHome} archive mutation.`,
      }, true, 'review-only');
    }

  let source = providerSourceFromWrite({
      dataHome,
      operation: 'archive_record',
      recordId: existing.id,
      domain,
      collection: existing.collection,
      title: existing.title,
      externalId: existing.source?.external_id,
    });

  let notionWriteResult: {
        success?: boolean;
        provider_record_id?: string | null;
        action_receipt?: unknown;
        source_snapshot?: Record<string, unknown>;
      } | null = null;
  if (dataHome === 'notion' && existing.source?.provider === 'notion') {
      const notionWrite = await writeNotionRecord({
        operation: 'archive_record',
        recordId: id,
        pageId: notionId,
        domain: existing.domain,
        collection: existing.collection,
        title: existing.title,
        archived: true,
      });
      const notionSource = notionSourceFromResponse({
        ok: notionWrite.ok,
        source: notionWrite.source,
        source_snapshot: notionWrite.source_snapshot,
        operation: 'archive_record',
      });
      if (!notionSource) {
        return resolveToolResult({
          allowed: false,
          policy,
          provider: dataHome,
          message: notionWrite.error || 'Notion write failed.',
          source_snapshot: notionWrite.source_snapshot,
        }, true, policy.safety);
      }
      notionWriteResult = {
        success: notionWrite.success,
        provider_record_id: notionWrite.provider_record_id,
        action_receipt: notionWrite.action_receipt,
        source_snapshot: notionWrite.source_snapshot,
      };
      source = notionSource;
    }

    if (dataHome === 'google_sheets') {
      const sheetWrite = await writeSheetsRecord({
        operation: 'archive_record',
        record: {
          id,
          title: existing.title,
          domain: existing.domain,
          collection: existing.collection,
          properties: existing.properties,
          archived: true,
          externalId: makeText((existing.source as { external_id?: unknown })?.external_id),
          expectedDigest: expectedSheetsDigest(existing),
        },
      });
      if (!sheetWrite.ok) {
        return resolveToolResult({
          allowed: false,
          policy,
          provider: dataHome,
          message: sheetWrite.error || 'Google Sheets write failed.',
          source_snapshot: sheetWrite.source_snapshot,
        }, true, 'review-only');
      }
      source = sheetsSourceFromResponse({
        ok: sheetWrite.ok,
        source: sheetWrite.source,
        source_snapshot: sheetWrite.source_snapshot,
      }) || source;
      if (!source.ok) {
        return resolveToolResult({
          allowed: false,
          policy,
          provider: dataHome,
          message: sheetWrite.error || 'Google Sheets write failed.',
          source_snapshot: sheetWrite.source_snapshot,
          requiredConfig: source.requiredConfig,
        }, true, policy.safety);
      }
    }

    if (!source.ok) {
      return resolveToolResult({
        allowed: false,
        policy,
        provider: dataHome,
        message: source.reason,
        requiredConfig: source.requiredConfig,
        source_snapshot: source.source_snapshot,
      }, true, policy.safety);
    }

    const archived = archiveRecordWithAction({
      actionId: reviewGate && reviewGate.ok ? reviewGate.action.id : actionId,
      actor,
      domain,
      tool: name,
      risk: policy.risk,
      command: `archive_record:${id}`,
      id,
      idempotencyKey: resolvedIdempotencyKey,
      sourceIds: repeated ? repeated.source_ids : [],
      conversationId,
      ...(dataHome === 'local_sqlite' ? {} : { source: source.source }),
      undoPayload: { operation: 'restore_after_archive', record: existing, provider_snapshot: source.source_snapshot },
      expectedRevision: existing.revision,
      operationId: reviewGate && reviewGate.ok ? reviewGate.action.operation_id : undefined,
      causeId: reviewGate && reviewGate.ok ? reviewGate.action.cause_id : undefined,
    });
    if (archived.action.status === 'failed' || !archived.record) {
      return resolveToolResult({
        allowed: false,
        policy,
        action: archived.action,
        message: 'record could not be archived through the canonical writer.',
        source_snapshot: source.source_snapshot,
      }, true, policy.safety, {
        action: archived.action,
        sourceSnapshot: source.source_snapshot,
      });
    }
    const completed = markActionCompleted(archived.action.id, archived.action.command, {
      record: archived.record,
      source_snapshot: source.source_snapshot,
    });
  return resolveWriteResult(
      {
        action: completed || archived.action,
        record: archived.record,
        source_snapshot: source.source_snapshot,
        ...(notionWriteResult
          ? {
              success: notionWriteResult.success,
              provider_record_id: notionWriteResult.provider_record_id,
              action_receipt: notionWriteResult.action_receipt,
            }
          : {}),
      },
      completed || archived.action,
    );
  }

  if (name === RECORD_TOOLS.runWorkflow) {
    const actor = ensureActor(typedArgs.actor);
    const workflowId = makeText(typedArgs.workflow);
    if (!workflowId) {
      throw new Error('workflow is required');
    }
    const domain = ensureDomain(typedArgs.domain);
    const idempotencyKey = makeText(typedArgs.idempotency_key) || undefined;
    const actionId = makeText(typedArgs.action_id)
      || makeActionId(`workflow:${workflowId}`, {
        workflowId,
        actor,
        domain,
        operation: 'run_workflow',
      });
    const conversationId = ensureConversationId(typedArgs.conversation_id);
    const policy = actionToolPolicy({
      tool: name,
      domain,
      command: `run_workflow ${workflowId}`,
      actor,
    });
    const resolvedIdempotencyKey = idempotencyKey || buildWorkflowIdempotencyKey({
      workflowId,
      actor,
      domain,
      actionId,
    });
    const preexisting = resolvedIdempotencyKey ? findActionByIdempotencyKey(resolvedIdempotencyKey) : null;
    if (preexisting && preexisting.status === 'completed') {
      return resolveToolResult({
        action: preexisting,
        replayed: true,
      }, false, 'write', {
        action: preexisting,
        sourceSnapshot: getActionSourceSnapshot(preexisting),
      });
    }
    if (policyBlocksExecution(policy)) {
      return resolveToolResult({
        allowed: false,
        policy,
        message: 'workflow run blocked by policy',
      }, true, policy.safety);
    }
    const reviewGate = policyNeedsReview(policy)
      ? requireDurableReviewApproval({
        approval: typedArgs.approval_receipt,
        tool: name,
        domain,
        actor,
        policy,
        command: `run_workflow:${workflowId}`,
        idempotencyKey: resolvedIdempotencyKey,
        actionId,
        recordIds: [],
        conversationId,
        requestedOperation: {
          tool: name,
          domain,
          workflowId,
        },
        existingAction: preexisting,
      })
      : null;
    if (reviewGate && !reviewGate.ok) {
      return reviewGate.result;
    }

    const workflow = findWorkflow(workflowId);
    if (!workflow) {
      return resolveToolResult({
        found: false,
        status: 'failed',
        message: `workflow not found: ${workflowId}`,
        workflows: listWorkflows().map((entry) => entry.id),
      }, false, 'review-only');
    }

    const action = preexisting
      || createRunWorkflowAction({
        workflow,
        domain,
        actor,
        command: `run_workflow:${workflowId}`,
        idempotencyKey: resolvedIdempotencyKey,
        conversationId,
        actionId: reviewGate && reviewGate.ok ? reviewGate.action.id : undefined,
      });
    if (action.status === 'completed') {
      return resolveToolResult(
        { action, replayed: true },
        false,
        'write',
        {
          action,
          sourceSnapshot: getActionSourceSnapshot(action),
        },
      );
    }

    const execution = await runWorkflow(
      workflow,
      actor,
      { seenWorkflows: new Set([workflowId]), visitedRecords: new Set() },
      {
        actionId,
        seed: buildWorkflowExecutionSeed({
          workflowId,
          actor,
          actionId,
          checkpointRunId: asRecord(preexisting?.after_json).checkpoint_run_id as string | undefined,
        }),
      },
    );
    const recordIds = execution.changedRecords;
    if (execution.status !== 'ok') {
      const failureReason = execution.error ? execution.error : `workflow ${workflowId} failed`;
      const failedAction = markActionFailed(action.id, failureReason) ?? action;
      if (execution.compensation) {
        (failedAction as ActionEvent & { compensation?: unknown }).compensation = execution.compensation;
      }
      return resolveToolResult({
        status: 'failed',
        message: failureReason,
        action: failedAction,
        details: execution.details,
        checkpoint: {
          runId: execution.checkpointRunId,
          changed_records: recordIds,
          compensation: execution.compensation,
        },
      }, false, 'review-only', {
        action: failedAction,
        sourceSnapshot: buildWorkflowRunSourceSnapshot({
          workflowRunId: execution.checkpointRunId,
          changedRecords: recordIds,
        }),
      });
    }
    const completed = markActionCompleted(action.id, action.command, {
      workflow: workflowId,
      steps: execution.details,
      changed_records: recordIds,
      checkpoint_run_id: execution.checkpointRunId,
    });
    return resolveToolResult({
      status: 'completed',
      action: completed || action,
      workflow: workflowId,
      checkpoint: {
        runId: execution.checkpointRunId,
      },
      changed_records: recordIds,
    }, false, 'write', {
      action: completed || action,
      sourceSnapshot: buildWorkflowRunSourceSnapshot({
        workflowRunId: execution.checkpointRunId,
        changedRecords: recordIds,
      }),
    });
  }

  if (name === RECORD_TOOLS.undoAction) {
    const actor = ensureActor(typedArgs.actor);
    const actionId = makeText(typedArgs.actionId);
    if (!actionId) {
      throw new Error('actionId is required');
    }
    const idempotencyKey = makeText(typedArgs.idempotency_key) || undefined;
    const action = getActionEvent(actionId);
    if (!action) {
      throw new Error(`action not found: ${actionId}`);
    }
    const policy = actionToolPolicy({
      tool: name,
      domain: action.domain,
      command: `undo ${actionId}`,
      actor,
    });
    if (policyBlocksExecution(policy)) {
      return resolveToolResult({ allowed: false, policy }, true, policy.safety);
    }

    const resolvedUndoIdempotencyKey = idempotencyKey
      || buildDeterministicIdempotencyKey({
        operation: 'undo_action',
        dataHome: 'local_sqlite',
        recordId: actionId,
        domain: action.domain,
        collection: 'actions',
        payload: { targetActionId: actionId },
      });
    const existing = findActionByIdempotencyKey(resolvedUndoIdempotencyKey);
    if (existing) {
      const snapshot = getActionSourceSnapshot(existing) ?? getActionSourceSnapshot(action);
      return resolveToolResult({ action: existing, replayed: true }, false, 'write', {
        action: existing,
        sourceSnapshot: snapshot,
      });
    }
    const reviewGate = policyNeedsReview(policy)
      ? requireDurableReviewApproval({
        approval: typedArgs.approval_receipt,
        tool: name,
        domain: action.domain,
        actor,
        policy,
        command: `undo_action:${actionId}`,
        idempotencyKey: resolvedUndoIdempotencyKey,
        actionId: makeActionId('undo', {
          operation: 'undo_action',
          actor,
          actionId,
        }),
        recordIds: action.record_ids,
        conversationId: action.conversation_id,
        before: action,
        requestedOperation: {
          tool: name,
          domain: action.domain,
          targetActionId: actionId,
          targetOperationId: action.operation_id,
          targetRecordIds: action.record_ids,
        },
      })
      : null;
    if (reviewGate && !reviewGate.ok) {
      return reviewGate.result;
    }

    const undoPayload = { actionId, actor };
    const undoAction = createActionEvent({
      id: reviewGate && reviewGate.ok ? reviewGate.action.id : makeActionId('undo', {
        operation: 'undo_action',
        actor,
        actionId,
      }),
      actor,
      domain: action.domain,
      tool: name,
      risk: action.risk,
      recordIds: action.record_ids,
      idempotencyKey: resolvedUndoIdempotencyKey,
      command: `undo_action:${actionId}`,
      before: action,
      undoPayload,
      conversationId: action.conversation_id,
      operationId: reviewGate && reviewGate.ok ? reviewGate.action.operation_id : undefined,
      causeId: reviewGate && reviewGate.ok ? reviewGate.action.cause_id : undefined,
    });

    const undoResult = runUndo(actionId);
    if (!undoResult.success) {
      const failedUndoAction = markActionFailed(undoAction.id, undoResult.message) ?? undoAction;
      return resolveToolResult({ status: 'failed', action: failedUndoAction, undoResult }, false, 'review-only', {
        action: failedUndoAction,
        sourceSnapshot: getActionSourceSnapshot(undoResult.action ?? action),
      });
    }

    const completed = markActionCompleted(undoAction.id, undoAction.command, { undoResult });
    return resolveToolResult({
      status: 'completed',
      action: completed || undoAction,
      undoResult,
    }, false, 'write', {
      action: completed || undoAction,
      sourceSnapshot: getActionSourceSnapshot(completed || undoAction) ?? getActionSourceSnapshot(action),
    });
  }

  throw new Error(`Unknown tool: ${name}`);
}

export function validateCommandEnvelopeLite(raw: unknown): ValidationResult {
  const envelope = isObject(raw) ? (raw as Record<string, unknown>) : {};
  const required = [
    'schema_version',
    'catalog_version',
    'skill_id',
    'skill_version',
    'envelope_id',
    'idempotency_key',
    'status',
    'evidence',
    'commands',
    'confidence',
    'confirmation',
    'warnings',
    'unsupported',
  ];
  const errors: string[] = [];

  if (!isObject(raw)) {
    return {
      valid: false,
      errors: ['envelope must be an object'],
      reviewOnly: true,
      nextStep: 'Share this package into Utopia; user review is required before writes.',
    };
  }

  for (const key of required) {
    if (!(key in envelope)) {
      errors.push(`missing ${key}`);
    }
  }

  if (envelope.schema_version !== 'wf.ai.command-envelope.v1') {
    errors.push('schema_version must be wf.ai.command-envelope.v1');
  }
  if (envelope.catalog_version !== 'wf.ai.skill-catalog.v1') {
    errors.push('catalog_version must be wf.ai.skill-catalog.v1');
  }
  if (typeof envelope.skill_version !== 'string' || envelope.skill_version !== '1.0.0') {
    errors.push('skill_version must be 1.0.0');
  }
  if (!Array.isArray(envelope.evidence)) {
    errors.push('evidence must be an array');
  }
  if (!Array.isArray(envelope.commands)) {
    errors.push('commands must be an array');
  }
  if (typeof envelope.status !== 'string' || !['commands', 'needs_confirmation', 'needs_clarification', 'unsupported'].includes(envelope.status)) {
    errors.push('status invalid');
  }
  if (typeof envelope.idempotency_key !== 'string' || envelope.idempotency_key.trim().length === 0) {
    errors.push('idempotency_key required');
  }

  return {
    valid: errors.length === 0,
    errors,
    reviewOnly: true,
    nextStep: 'Share this package into Utopia; user review is required before writes.',
  };
}
