import { loadCatalog } from '../../../src/domain/catalog';
import {
  ActionRisk,
  evaluateCommandPolicy,
  PolicyDecision,
  policyCanExecute,
  policyNeedsClarification,
} from '@/src/actions/policy';
import { createHash } from 'node:crypto';
import {
  ActionEvent,
  archiveRecordWithAction,
  createActionEvent,
  createRecordWithAction,
  findActionByIdempotencyKey,
  getActionEvent,
  findRecord,
  listRecords,
  markActionCompleted,
  markActionFailed,
  updateRecordWithAction,
} from '../runtime/state';
import { callMcpTool, type ToolResult } from '../tools/catalog';
import { readNotionConfig } from '../providers/notion/client';
import { readSheetsConfig } from '../providers/sheets/client';

export type AgentStep = {
  id: string;
  action: string;
  required: boolean;
};

export type ActionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'undone' | 'undo_failed';

export type ActionReceipt = {
  id: string;
  actor: string;
  domain: string;
  tool: string;
  schema_version: 'utopia.action-event.v1';
  risk: ActionRisk;
  status: ActionStatus;
  record_ids: string[];
  source_ids: string[];
  conversation_id: string;
  created_at: string;
  updated_at: string;
  idempotency_key?: string;
  undo_deadline_at?: string;
};

type ParsedIntent = {
  type: 'create' | 'update' | 'archive' | 'noop';
  collection?: string;
  recordId?: string;
  title?: string;
  patch?: Record<string, unknown>;
  needsClarification: boolean;
  reason?: string;
};

const ACTIONS_BY_ALIAS = [
  { key: 'inventory', aliases: ['inventory', 'inventories', 'stock'] },
  { key: 'ingredient', aliases: ['ingredient', 'ingredients'] },
  { key: 'recipe', aliases: ['recipe', 'recipes'] },
  { key: 'meal_plan', aliases: ['meal plan', 'meal_plan', 'mealplan', 'meal'] },
  { key: 'meal_log', aliases: ['meal log', 'meal_log'] },
  { key: 'shopping_item', aliases: ['shopping item', 'shopping items', 'item', 'items'] },
  { key: 'purchase', aliases: ['purchase', 'purchases'] },
  { key: 'purchase_line', aliases: ['purchase line', 'purchase_line'] },
  { key: 'store', aliases: ['store', 'stores', 'market'] },
  { key: 'preference', aliases: ['preference', 'preferences'] },
  { key: 'nutrition_observation', aliases: ['nutrition observation', 'observation', 'nutrition'] },
  { key: 'source_record', aliases: ['source record', 'source_record', 'source'] },
] as const;

const ACTION_TOOL_BY_INTENT: Record<ParsedIntent['type'], string> = {
  create: 'utopia.create_record',
  update: 'utopia.update_record',
  archive: 'utopia.archive_record',
  noop: 'chat_reply',
};

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

function hashSeed(input: unknown): string {
  return createHash('sha256').update(stringifyForHash(input)).digest('hex');
}

function toReceipt(action: ActionEvent): ActionReceipt {
  return {
    id: action.id,
    actor: action.actor,
    domain: action.domain,
    tool: action.tool,
    schema_version: action.schema_version,
    risk: action.risk,
    status: action.status,
    record_ids: action.record_ids,
    conversation_id: action.conversation_id || '',
    source_ids: action.source_ids,
    created_at: action.created_at,
    updated_at: action.updated_at,
    idempotency_key: action.idempotency_key ?? undefined,
    undo_deadline_at: action.undo_deadline_at ?? undefined,
  };
}

function toActionResult(action: ActionEvent): { state: ActionStatus; receipt: ActionReceipt } {
  return {
    state: action.status as ActionStatus,
    receipt: toReceipt(action),
  };
}

function localSourceSnapshot(input: {
  operation: 'create_record' | 'update_record' | 'archive_record';
  domain: string;
  collection: string;
}) {
  return {
    provider: 'sqlite',
    mode: 'authoritative_local',
    operation: input.operation,
    domain: input.domain,
    collection: input.collection,
    timestamp: new Date().toISOString(),
  };
}

function buildFailureReceipt(input: {
  actionId: string;
  actor: string;
  domain: string;
  tool: string;
  now: string;
  idempotencyKey?: string;
  command: string;
  reason?: string;
  records?: string[];
  sourceIds?: string[];
}): ActionReceipt {
  const event = createActionEvent({
    id: input.actionId,
    actor: input.actor,
    domain: input.domain,
    tool: input.tool,
    risk: 'restricted',
    recordIds: input.records ?? [],
    idempotencyKey: input.idempotencyKey,
    command: input.command,
    sourceIds: input.sourceIds,
    before: null,
    after: null,
    undoPayload: null,
  });
  const failed = markActionFailed(event.id, input.reason);
  return toReceipt(failed ?? event);
}

function normalizeCollectionFromCatalog(input: string) {
  const lower = input.toLowerCase().trim();
  const { activeManifest } = loadCatalog();
  const knownCatalog = activeManifest.collections;

  for (const entry of ACTIONS_BY_ALIAS) {
    for (const alias of entry.aliases) {
      if (lower === alias || lower.startsWith(`${alias} `)) {
        return entry.key;
      }
    }
  }

  return knownCatalog.find((collection: string) => lower === collection || lower.startsWith(`${collection} `));
}

function parseCollectionHint(input: string): { collection?: string; rest: string } {
  const lower = input.toLowerCase();

  for (const entry of ACTIONS_BY_ALIAS) {
    const alias = entry.aliases.find((item) => lower === item || lower.startsWith(`${item} `));
    if (!alias) {
      continue;
    }
    return {
      collection: entry.key,
      rest: input.slice(alias.length).trim(),
    };
  }

  const known = normalizeCollectionFromCatalog(input);
  if (!known) {
    return { rest: input.trim() };
  }

  const escaped = known.replace(/_/g, '\\_');
  return {
    collection: known,
    rest: input.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim(),
  };
}

function resolveRecordFromHint(input: string, domain: string, collection?: string): { recordId?: string; needsClarification: boolean; reason?: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { needsClarification: true, reason: 'Missing record target.' };
  }

  if (trimmed.startsWith('id:')) {
    const candidate = trimmed.replace(/^id:\s*/, '').trim();
    if (!candidate) {
      return { needsClarification: true, reason: 'Record id was empty.' };
    }
    const record = findRecord(candidate);
    if (!record) {
      return { needsClarification: true, reason: `No record found for id ${candidate}.` };
    }
    if (collection && record.collection !== collection) {
      return { needsClarification: true, reason: `Found ${candidate}, but it is not a ${collection}.` };
    }
    return { recordId: record.id, needsClarification: false };
  }

  const exact = listRecords({
    domain,
    collection,
    includeArchived: false,
    query: trimmed,
    limit: 20,
  }).filter((record) => record.title.toLowerCase() === trimmed.toLowerCase());

  if (exact.length === 1) {
    return { recordId: exact[0].id, needsClarification: false };
  }
  if (exact.length > 1) {
    return { needsClarification: true, reason: 'I found multiple matching records. Please include a full title or id.' };
  }

  const fuzzy = listRecords({
    domain,
    collection,
    includeArchived: false,
    query: trimmed,
    limit: 20,
  });
  if (fuzzy.length === 1) {
    return { recordId: fuzzy[0].id, needsClarification: false };
  }
  if (fuzzy.length > 1) {
    return { needsClarification: true, reason: 'I found multiple matching records. Please include a full title or id.' };
  }

  return { needsClarification: true, reason: 'No matching record found.' };
}

function parseCreateIntent(commandText: string): ParsedIntent {
  const body = commandText.replace(/^(?:add|create|log|track)\s+/i, '').trim();
  if (!body) {
    return { type: 'create', needsClarification: true, reason: 'Missing create target.' };
  }

  const { collection, rest } = parseCollectionHint(body);
  if (!collection) {
    return {
      type: 'create',
      needsClarification: true,
      reason: 'I need one specific target such as "create recipe …" or "create shopping item …".',
    };
  }

  if (!rest) {
    return {
      type: 'create',
      collection,
      needsClarification: true,
      reason: `I can create a ${collection}, but I need a title.`,
    };
  }

  return {
    type: 'create',
    collection,
    title: rest,
    needsClarification: false,
  };
}

function parseUpdateIntent(commandText: string): ParsedIntent {
  const body = commandText.replace(/^(?:update|edit|change|rename)\s+/i, '').trim();
  if (!body) {
    return { type: 'update', needsClarification: true, reason: 'Missing update target.' };
  }

  const { collection, rest } = parseCollectionHint(body);
  const [targetText, ...restParts] = rest.split(/\s+to\s+/i);
  const patchText = (restParts.join(' to ') || '').trim();

  if (!targetText) {
    return { type: 'update', collection, needsClarification: true, reason: 'Missing record to update.' };
  }

  const target = resolveRecordFromHint(targetText, 'food', collection);
  if (target.needsClarification) {
    return {
      type: 'update',
      collection,
      needsClarification: true,
      reason: target.reason,
    };
  }

  const title = patchText || targetText;
  return {
    type: 'update',
    collection,
    recordId: target.recordId,
    title,
    patch: { title },
    needsClarification: false,
  };
}

function parseArchiveIntent(commandText: string): ParsedIntent {
  const body = commandText.replace(/^(?:archive|remove|delete|cancel)\s+/i, '').trim();
  if (!body) {
    return { type: 'archive', needsClarification: true, reason: 'Missing archive target.' };
  }

  const { collection, rest } = parseCollectionHint(body);
  const record = resolveRecordFromHint(rest, 'food', collection);
  if (record.needsClarification) {
    return {
      type: 'archive',
      collection,
      needsClarification: true,
      reason: record.reason,
    };
  }

  return {
    type: 'archive',
    collection,
    recordId: record.recordId,
    needsClarification: false,
  };
}

function parseCommand(commandText: string): ParsedIntent {
  if (/^(?:add|create|log|track)\s+/i.test(commandText)) {
    return parseCreateIntent(commandText);
  }
  if (/^(?:update|edit|change|rename)\s+/i.test(commandText)) {
    return parseUpdateIntent(commandText);
  }
  if (/^(?:archive|remove|delete|cancel)\s+/i.test(commandText)) {
    return parseArchiveIntent(commandText);
  }

  return {
    type: 'noop',
    needsClarification: true,
    reason: 'No supported mutating verb found.',
  };
}

function createBaseAction(input: {
  actionId: string;
  actor: string;
  domain: string;
  tool: string;
  command: string;
  policy: PolicyDecision;
  idempotencyKey?: string;
  recordIds: string[];
  undoPayload?: unknown;
  before?: unknown;
  after?: unknown;
  conversationId?: string | null;
  sourceIds?: string[];
}) {
  return createActionEvent({
    id: input.actionId,
    actor: input.actor,
    domain: input.domain,
    tool: input.tool,
    risk: input.policy.risk as ActionRisk,
    recordIds: input.recordIds,
    idempotencyKey: input.idempotencyKey,
    command: input.command,
    sourceIds: input.sourceIds,
    before: input.before ?? null,
    after: input.after ?? null,
    undoPayload: input.undoPayload ?? null,
    conversationId: input.conversationId ?? null,
  });
}

type ExecutorDataHome = 'local_sqlite' | 'notion' | 'google_sheets';

function authorityDataHome(): ExecutorDataHome {
  const authority = process.env.LIFEOS_AUTHORITY_PROVIDER?.trim();
  return authority === 'notion' || authority === 'google_sheets' ? authority : 'local_sqlite';
}

function providerConfigured(dataHome: ExecutorDataHome) {
  if (dataHome === 'notion') {
    const config = readNotionConfig();
    return Boolean(config?.token && config.dataSourceId);
  }
  if (dataHome === 'google_sheets') {
    const config = readSheetsConfig();
    return Boolean(config?.accessToken && config.spreadsheetId);
  }
  return true;
}

function providerConfigReason(dataHome: ExecutorDataHome) {
  if (dataHome === 'notion') {
    return 'Notion is the configured authority, but NOTION_TOKEN or NOTION_DATA_SOURCE_ID is missing.';
  }
  if (dataHome === 'google_sheets') {
    return 'Google Sheets is the configured authority, but GOOGLE_SHEETS_ACCESS_TOKEN or GOOGLE_SHEETS_SPREADSHEET_ID is missing.';
  }
  return 'Provider configuration is missing.';
}

function recordDataHome(record: ReturnType<typeof findRecord>): ExecutorDataHome {
  if (record?.source.provider === 'notion' || record?.source.provider === 'google_sheets') {
    return record.source.provider;
  }
  return 'local_sqlite';
}

function actionIdFromToolResult(result: ToolResult): string {
  if (typeof result.undo_token === 'string' && result.undo_token.length > 0) {
    return result.undo_token;
  }
  const action = result.json.action;
  if (action && typeof action === 'object' && typeof (action as { id?: unknown }).id === 'string') {
    return String((action as { id: string }).id);
  }
  const receiptActionId = Array.isArray(result.receipts) ? result.receipts[0]?.action_id : '';
  return typeof receiptActionId === 'string' ? receiptActionId : '';
}

async function executeViaMcpTool(input: {
  actionId: string;
  actor: string;
  domain: string;
  command: string;
  actionTool: string;
  idempotencyKey?: string;
  conversationId?: string | null;
  sourceIds?: string[];
  args: Record<string, unknown>;
}): Promise<{ state: ActionStatus; receipt: ActionReceipt }> {
  const result = await callMcpTool(input.actionTool, input.args);
  const actionId = actionIdFromToolResult(result);
  if (actionId) {
    const action = getActionEvent(actionId);
    if (action) {
      return {
        state: action.status,
        receipt: toReceipt(action),
      };
    }
  }

  const message = typeof result.json.message === 'string'
    ? result.json.message
    : typeof result.json.error === 'string'
      ? result.json.error
      : 'Mutation completed without a durable action receipt.';

  const isNoop = /no changes detected|already up to date/i.test(message);
  if (isNoop) {
    const action = createBaseAction({
      actionId: input.actionId,
      actor: input.actor,
      domain: input.domain,
      tool: input.actionTool,
      policy: evaluateCommandPolicy({
        domain: input.domain,
        tool: input.actionTool,
        command: input.command,
        actor: input.actor,
      }),
      idempotencyKey: input.idempotencyKey,
      command: input.command,
      sourceIds: input.sourceIds,
      recordIds: [],
      before: null,
      after: result.json.record ?? null,
      undoPayload: null,
      conversationId: input.conversationId,
    });
    const completed = markActionCompleted(action.id, action.command, result.json.record ?? null);
    return {
      state: (completed ?? action).status,
      receipt: toReceipt(completed ?? action),
    };
  }

  const receipt = buildFailureReceipt({
    actionId: input.actionId,
    actor: input.actor,
    domain: input.domain,
    tool: input.actionTool,
    now: new Date().toISOString(),
    idempotencyKey: input.idempotencyKey,
    command: input.command,
    reason: message,
    sourceIds: input.sourceIds,
  });
  return { state: receipt.status, receipt };
}

export async function executeCommand(input: {
  actionId: string;
  actor: string;
  domain: string;
  tool: string;
  commandText: string;
  record_ids: string[];
  conversationId?: string | null;
  step?: AgentStep;
  idempotencyKey?: string;
  sourceIds?: string[];
}): Promise<{
  state: ActionStatus;
  receipt: ActionReceipt;
  step: AgentStep | undefined;
}> {
  const command = input.commandText.trim();
  const now = new Date().toISOString();
  const existing = input.idempotencyKey ? findActionByIdempotencyKey(input.idempotencyKey) : null;

  if (existing) {
    return {
      state: existing.status,
      receipt: toReceipt(existing),
      step: input.step,
    };
  }

  const policy: PolicyDecision = evaluateCommandPolicy({
    domain: input.domain,
    tool: input.tool,
    command,
    actor: input.actor,
  });

  if (!policyCanExecute(policy)) {
    const clarifyingQuestion = policyNeedsClarification(policy) ? policy.clarifyingQuestion : undefined;
    const receipt = buildFailureReceipt({
      actionId: input.actionId,
      actor: input.actor,
      domain: input.domain,
      tool: input.tool,
      now,
      idempotencyKey: input.idempotencyKey,
      command,
      reason: policyNeedsClarification(policy) ? clarifyingQuestion ?? policy.reason : policy.reason,
      records: input.record_ids,
      sourceIds: input.sourceIds,
    });
    return { state: receipt.status, receipt, step: input.step };
  }

  const intent = parseCommand(command);
  if (intent.needsClarification) {
    const receipt = buildFailureReceipt({
      actionId: input.actionId,
      actor: input.actor,
      domain: input.domain,
      tool: input.tool,
      now,
      idempotencyKey: input.idempotencyKey,
      command,
      reason: intent.reason,
      records: input.record_ids,
      sourceIds: input.sourceIds,
    });
    return { state: receipt.status, receipt, step: input.step };
  }

  const domain = input.domain || 'food';
  const actionTool = ACTION_TOOL_BY_INTENT[intent.type] ?? input.tool;
  const authorityHome = authorityDataHome();

  if (intent.type === 'create') {
    const collection = intent.collection ?? 'recipe';
    const title = intent.title?.trim() ?? '';
    if (!title) {
      const receipt = buildFailureReceipt({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        tool: actionTool,
        now,
        idempotencyKey: input.idempotencyKey,
        command,
        reason: `I can create a ${collection}, but I need a title.`,
        sourceIds: input.sourceIds,
      });
      return { state: receipt.status, receipt, step: input.step };
    }

    if (authorityHome !== 'local_sqlite') {
      if (!providerConfigured(authorityHome)) {
        const receipt = buildFailureReceipt({
          actionId: input.actionId,
          actor: input.actor,
          domain,
          tool: actionTool,
          now,
          idempotencyKey: input.idempotencyKey,
          command,
          reason: providerConfigReason(authorityHome),
          sourceIds: input.sourceIds,
        });
        return { state: receipt.status, receipt, step: input.step };
      }
      const createdId = `utopia-${hashSeed({ actionId: input.actionId, domain, collection, title }).slice(0, 20)}`;
      const providerResult = await executeViaMcpTool({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        command,
        actionTool,
        idempotencyKey: input.idempotencyKey,
        conversationId: input.conversationId,
        sourceIds: input.sourceIds,
        args: {
          actor: input.actor,
          domain,
          collection,
          data_home: authorityHome,
          id: createdId,
          title,
          action_id: input.actionId,
          idempotency_key: input.idempotencyKey,
          conversation_id: input.conversationId ?? undefined,
        },
      });
      return { state: providerResult.state, receipt: providerResult.receipt, step: input.step };
    }

    const createdId = `utopia-${hashSeed({ actionId: input.actionId, domain, collection, title }).slice(0, 20)}`;
    const created = createRecordWithAction({
      actionId: input.actionId,
      actor: input.actor,
      domain,
      tool: actionTool,
      risk: policy.risk,
      command,
      idempotencyKey: input.idempotencyKey,
      sourceIds: input.sourceIds,
      conversationId: input.conversationId,
      record: {
        id: createdId,
        domain,
        collection,
        title,
        properties: {},
        relations: [],
        source: {
          provider: 'sqlite',
          external_id: createdId,
          url: null,
          observed_at: now,
          content_hash: null,
        },
        archived_at: null,
      },
    });
    const completed = created.record
      ? markActionCompleted(created.action.id, created.action.command, {
        record: created.record,
        source_snapshot: localSourceSnapshot({
          operation: 'create_record',
          domain,
          collection,
        }),
      })
      : null;

    return {
      ...toActionResult(completed ?? created.action),
      step: input.step,
    };
  }

  if (intent.type === 'update' && intent.recordId) {
    const target = findRecord(intent.recordId);
    if (!target) {
      const receipt = buildFailureReceipt({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        tool: actionTool,
        now,
        idempotencyKey: input.idempotencyKey,
        command,
        reason: `Record ${intent.recordId} was not found before apply.`,
        sourceIds: input.sourceIds,
      });
      return { state: receipt.status, receipt, step: input.step };
    }

    const targetHome = recordDataHome(target);
    if (targetHome !== 'local_sqlite') {
      if (authorityHome !== 'local_sqlite' && authorityHome !== targetHome) {
        const receipt = buildFailureReceipt({
          actionId: input.actionId,
          actor: input.actor,
          domain,
          tool: actionTool,
          now,
          idempotencyKey: input.idempotencyKey,
          command,
          reason: `${targetHome} owns ${intent.recordId}; configured authority is ${authorityHome}.`,
          sourceIds: input.sourceIds,
        });
        return { state: receipt.status, receipt, step: input.step };
      }
      if (!providerConfigured(targetHome)) {
        const receipt = buildFailureReceipt({
          actionId: input.actionId,
          actor: input.actor,
          domain,
          tool: actionTool,
          now,
          idempotencyKey: input.idempotencyKey,
          command,
          reason: providerConfigReason(targetHome),
          sourceIds: input.sourceIds,
        });
        return { state: receipt.status, receipt, step: input.step };
      }
      const providerResult = await executeViaMcpTool({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        command,
        actionTool,
        idempotencyKey: input.idempotencyKey,
        conversationId: input.conversationId,
        sourceIds: input.sourceIds,
        args: {
          actor: input.actor,
          id: intent.recordId,
          data_home: targetHome,
          patch: { title: intent.title ?? target.title },
          action_id: input.actionId,
          idempotency_key: input.idempotencyKey,
          conversation_id: input.conversationId ?? undefined,
        },
      });
      return { state: providerResult.state, receipt: providerResult.receipt, step: input.step };
    }

    if (authorityHome !== 'local_sqlite') {
      const receipt = buildFailureReceipt({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        tool: actionTool,
        now,
        idempotencyKey: input.idempotencyKey,
        command,
        reason: `${authorityHome} is the configured authority; local-only record ${intent.recordId} has no provider binding.`,
        sourceIds: input.sourceIds,
      });
      return { state: receipt.status, receipt, step: input.step };
    }

    const updated = updateRecordWithAction({
      actionId: input.actionId,
      actor: input.actor,
      domain,
      tool: actionTool,
      risk: policy.risk,
      command,
      id: intent.recordId,
      patch: { title: intent.title ?? target.title },
      idempotencyKey: input.idempotencyKey,
      sourceIds: input.sourceIds,
      conversationId: input.conversationId,
      expectedRevision: target.revision,
    });
    if (updated.action.status === 'failed') {
      const receipt = buildFailureReceipt({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        tool: actionTool,
        now,
        idempotencyKey: input.idempotencyKey,
        command,
        reason: 'Unable to update local record through canonical writer.',
        sourceIds: input.sourceIds,
      });
      return { state: receipt.status, receipt, step: input.step };
    }
    const completed = updated.record
      ? markActionCompleted(updated.action.id, updated.action.command, {
        record: updated.record,
        source_snapshot: localSourceSnapshot({
          operation: 'update_record',
          domain,
          collection: target.collection,
        }),
      })
      : null;
    return {
      ...toActionResult(completed ?? updated.action),
      step: input.step,
    };
  }

  if (intent.type === 'archive' && intent.recordId) {
    const target = findRecord(intent.recordId);
    if (!target) {
      const receipt = buildFailureReceipt({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        tool: actionTool,
        now,
        idempotencyKey: input.idempotencyKey,
        command,
        reason: `Record ${intent.recordId} was not found before archive.`,
        sourceIds: input.sourceIds,
      });
      return { state: receipt.status, receipt, step: input.step };
    }

    const targetHome = recordDataHome(target);
    if (targetHome !== 'local_sqlite') {
      if (authorityHome !== 'local_sqlite' && authorityHome !== targetHome) {
        const receipt = buildFailureReceipt({
          actionId: input.actionId,
          actor: input.actor,
          domain,
          tool: actionTool,
          now,
          idempotencyKey: input.idempotencyKey,
          command,
          reason: `${targetHome} owns ${intent.recordId}; configured authority is ${authorityHome}.`,
          sourceIds: input.sourceIds,
        });
        return { state: receipt.status, receipt, step: input.step };
      }
      if (!providerConfigured(targetHome)) {
        const receipt = buildFailureReceipt({
          actionId: input.actionId,
          actor: input.actor,
          domain,
          tool: actionTool,
          now,
          idempotencyKey: input.idempotencyKey,
          command,
          reason: providerConfigReason(targetHome),
          sourceIds: input.sourceIds,
        });
        return { state: receipt.status, receipt, step: input.step };
      }
      const providerResult = await executeViaMcpTool({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        command,
        actionTool,
        idempotencyKey: input.idempotencyKey,
        conversationId: input.conversationId,
        sourceIds: input.sourceIds,
        args: {
          actor: input.actor,
          id: intent.recordId,
          data_home: targetHome,
          action_id: input.actionId,
          idempotency_key: input.idempotencyKey,
          conversation_id: input.conversationId ?? undefined,
        },
      });
      return { state: providerResult.state, receipt: providerResult.receipt, step: input.step };
    }

    if (authorityHome !== 'local_sqlite') {
      const receipt = buildFailureReceipt({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        tool: actionTool,
        now,
        idempotencyKey: input.idempotencyKey,
        command,
        reason: `${authorityHome} is the configured authority; local-only record ${intent.recordId} has no provider binding.`,
        sourceIds: input.sourceIds,
      });
      return { state: receipt.status, receipt, step: input.step };
    }

    const archived = archiveRecordWithAction({
      actionId: input.actionId,
      actor: input.actor,
      domain,
      tool: actionTool,
      risk: policy.risk,
      command,
      id: intent.recordId,
      idempotencyKey: input.idempotencyKey,
      sourceIds: input.sourceIds,
      conversationId: input.conversationId,
      expectedRevision: target.revision,
    });
    if (archived.action.status === 'failed') {
      const receipt = buildFailureReceipt({
        actionId: input.actionId,
        actor: input.actor,
        domain,
        tool: actionTool,
        now,
        idempotencyKey: input.idempotencyKey,
        command,
        reason: 'Could not archive local record through canonical writer.',
        sourceIds: input.sourceIds,
      });
      return { state: receipt.status, receipt, step: input.step };
    }
    const completed = archived.record
      ? markActionCompleted(archived.action.id, archived.action.command, {
        record: archived.record,
        source_snapshot: localSourceSnapshot({
          operation: 'archive_record',
          domain,
          collection: target.collection,
        }),
      })
      : null;
    return {
      ...toActionResult(completed ?? archived.action),
      step: input.step,
    };
  }

  const receipt = buildFailureReceipt({
    actionId: input.actionId,
    actor: input.actor,
    domain,
    tool: actionTool,
    now,
    idempotencyKey: input.idempotencyKey,
    command,
    reason: 'No supported mutating intent resolved.',
    records: input.record_ids,
    sourceIds: input.sourceIds,
  });
  return { state: receipt.status, receipt, step: input.step };
}
