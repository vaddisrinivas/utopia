import { createHash } from 'node:crypto';
import { toCitationsFromSnapshots } from './provenance';
import { runChatRuntime } from './chat-runtime';
import { ensureCitations } from '@/src/chat/citations';
import { getConversation } from './chat-storage';
import { ActionEvent } from './runtime/state';

export type ChatCitationTone = 'moss' | 'blue' | 'amber' | 'plum' | 'neutral';

export type ChatStructuredAnswer = {
  title: string;
  intro: string;
  rows: Array<{ meal: string; use: string; next: string }>;
  sourceCards?: Array<{
    id: string;
    label: string;
    detail: string;
    quote: string;
    href: string;
    tone: ChatCitationTone;
    fields?: string[];
  }>;
  citations: Array<{ label: string; detail: string; href: string; tone: ChatCitationTone }>;
};

type RawMessage = {
  id?: unknown;
  text?: unknown;
  role?: unknown;
};

export type ChatMessageInput = {
  id?: string;
  text: string;
};

export type ChatSendRequest = {
  thread_id?: string;
  conversation_id?: string;
  message?: string | RawMessage;
  plan_hint?: string;
  domain_id?: string;
  idempotency_key?: string;
  previous_response_id?: string;
  retry_of?: string;
  mode?: 'send' | 'stream' | 'preview';
  preview?: boolean;
};

export type ChatSendMode = 'send' | 'stream' | 'preview';

export type NormalizedChatSend = {
  threadId: string;
  message: ChatMessageInput;
  domainId: string;
  idempotencyKey: string;
  previousResponseId?: string;
  retryOfMessageId?: string;
  planHint: string;
  mode: ChatSendMode;
  preview: boolean;
  userMessageId: string;
};

export type ChatOperationFingerprintInput = {
  operation: 'send' | 'stream' | 'retry';
  message: string;
  domainId: string;
  retryOfMessageId?: string;
  preview: boolean;
};

export function buildChatOperationFingerprint(input: ChatOperationFingerprintInput): string {
  const logicalOperation = input.operation === 'stream' ? 'send' : input.operation;
  return createHash('sha256')
    .update(JSON.stringify({
      operation: logicalOperation,
      message: input.message.trim(),
      domainId: input.domainId.trim(),
      retryOfMessageId: input.retryOfMessageId?.trim() || null,
      preview: input.preview === true,
    }))
    .digest('hex');
}

export function scopeChatIdempotencyNamespace(input: {
  principalId: string;
  conversationId: string;
  idempotencyKey: string;
}): string {
  return createHash('sha256')
    .update(`${input.principalId}\u0000${input.conversationId}\u0000${input.idempotencyKey}`)
    .digest('hex');
}

export function scopeChatOperationIdempotencyKey(input: {
  principalId: string;
  conversationId: string;
  idempotencyKey: string;
  operationFingerprint: string;
}): string {
  return `${scopeChatIdempotencyNamespace(input)}:${input.operationFingerprint.slice(0, 24)}`;
}

export function resolveStoredPreviousResponseId(input: {
  storedConversationResponseId?: string;
  cachedConversationResponseId?: string;
}): string | undefined {
  const cached =
    typeof input.cachedConversationResponseId === 'string' && input.cachedConversationResponseId.trim().length > 0
      ? input.cachedConversationResponseId.trim()
      : undefined;
  if (cached) {
    return cached;
  }
  return typeof input.storedConversationResponseId === 'string' && input.storedConversationResponseId.trim().length > 0
    ? input.storedConversationResponseId.trim()
    : undefined;
}

function normalizeMessage(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input && typeof input === 'object') {
    const raw = input as RawMessage;
    if (typeof raw.text === 'string') {
      return raw.text;
    }
  }
  return '';
}

function normalizeMessageId(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined;
}

export function normalizeChatSendRequest(payload: ChatSendRequest): NormalizedChatSend {
  const threadId = normalizeMessageId(payload.thread_id) || normalizeMessageId(payload.conversation_id) || `server-${Date.now()}`;

  const messageText = normalizeMessage(payload.message);
  const text = messageText.trim();
  if (!text) {
    throw new Error('message is required');
  }

  const userMessageId = normalizeMessageId(typeof payload.message === 'object' ? payload.message?.id : undefined) || `user-${Date.now()}`;

  const idempotencyKey =
    normalizeMessageId(payload.idempotency_key) || `${threadId}:${userMessageId}`;

  const mode =
    payload.mode === 'stream' || payload.mode === 'preview'
      ? payload.mode
      : payload.mode === 'send'
        ? payload.mode
        : 'send';

  const preview = payload.preview === true || mode === 'preview';

  const planHint = text;

  const domainId =
    typeof payload.domain_id === 'string' && payload.domain_id.trim().length > 0
      ? payload.domain_id.trim()
      : 'food';

  const previousResponseId =
    typeof payload.previous_response_id === 'string' && payload.previous_response_id.trim().length > 0
      ? payload.previous_response_id
      : undefined;

  const retryOfMessageId =
    typeof payload.retry_of === 'string' && payload.retry_of.trim().length > 0
      ? payload.retry_of.trim()
      : undefined;

  return {
    threadId,
    message: { id: userMessageId, text },
    domainId,
    idempotencyKey,
    previousResponseId,
    retryOfMessageId,
    planHint,
    mode,
    preview,
    userMessageId,
  };
}

type ChatActionVerification = {
  actionId: string;
  expected: string;
  status: 'verified' | 'denied';
  checks: string[];
  reason?: string;
};

export type ChatActionReceipt = Pick<
  ActionEvent,
  | 'schema_version'
  | 'id'
  | 'actor'
  | 'domain'
  | 'tool'
  | 'risk'
  | 'status'
  | 'record_ids'
  | 'idempotency_key'
  | 'created_at'
  | 'updated_at'
  | 'undo_deadline_at'
  | 'conversation_id'
  | 'source_ids'
> & {
  source_citations?: ChatStructuredAnswer['citations'];
};

export type ChatActionHint = {
  receipt: ChatActionReceipt;
  verification: ChatActionVerification | null;
  source_citations: ChatStructuredAnswer['citations'];
};

export type ServerChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  answer?: ChatStructuredAnswer;
  actionReceipt?: ChatActionReceipt;
};

export type ServerChatResponse = {
  conversation_id: string;
  messages: ServerChatMessage[];
  thread: {
    id: string;
    title: string;
    detail: string;
  };
  agent_handoffs?: Array<{ role: string; status: 'ok' | 'blocked'; reason?: string }>;
  warnings?: string[];
  run?: {
    id: string;
    status: 'running' | 'completed' | 'canceled' | 'failed';
    needs_retry: boolean;
    aborted: boolean;
    previous_response_id?: string;
  };
  action?: ChatActionHint;
  action_hints?: string[];
  provenance?: {
    sources: ChatStructuredAnswer['citations'];
    generated_at: string;
  };
};

export function buildConversationContext(conversation: ReturnType<typeof getConversation>): string {
  if (!conversation) {
    return '';
  }
  return conversation.messages
    .slice(-8)
    .map((message: ServerChatMessage) => {
      const answerText = message.answer
        ? [
          message.answer.intro,
          ...message.answer.rows.map((row) => `${row.meal}: ${row.use} (${row.next})`),
        ].filter(Boolean).join('\n')
        : '';
      const sourceText = message.answer?.citations?.length
        ? `Sources: ${message.answer.citations.map((citation) => citation.label).join(', ')}`
        : '';
      return `${message.role.toUpperCase()}: ${[message.text, answerText, sourceText].filter(Boolean).join('\n')}`;
    })
    .join('\n')
    .slice(-12000);
}

function parseStructuredModel(inputText: string, modelText: string): ChatStructuredAnswer | undefined {
  if (!modelText) {
    return undefined;
  }

  const hasStructuredHint = /\{\s*"title"\s*:/m.test(modelText);
  if (!hasStructuredHint) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(modelText);
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.rows)
    ) {
      return {
        title: cleanMarkdown(String(parsed.title ?? 'Utopia response')),
        intro: cleanMarkdownBlock(String(parsed.intro ?? '')),
        rows: dedupeRows(parsed.rows.slice(0, 12).map((row: { meal?: unknown; use?: unknown; next?: unknown }) => ({
          meal: cleanMarkdown(String(row.meal ?? '—')),
          use: cleanMarkdown(String(row.use ?? '—')),
          next: cleanMarkdown(String(row.next ?? '—')),
        }))),
        citations: Array.isArray(parsed.citations) ? ensureCitations(parsed.citations) : toCitationsFromSnapshots([]),
      };
    }
  } catch {
    // ignore non-JSON model output
  }

  return undefined;
}

/**
 * Keep the API contract structured even when a model ignores the JSON hint and
 * answers in ordinary Markdown. The client can then render a calm answer card
 * instead of exposing pipes, heading markers, and emphasis syntax.
 */
function parseMarkdownModel(modelText: string, citations: ChatStructuredAnswer['citations']): ChatStructuredAnswer | undefined {
  const source = modelText.trim();
  if (!source) {
    return undefined;
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const titleLine = lines.find((line) => /^\s{0,3}#{1,3}\s+\S/.test(line));
  const title = titleLine
    ? titleLine.replace(/^\s{0,3}#{1,3}\s+/, '').replace(/[\*_`]/g, '').trim()
    : 'Utopia response';

  const rows: ChatStructuredAnswer['rows'] = [];
  const prose: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const current = lines[index]?.trim() ?? '';
    const next = lines[index + 1]?.trim() ?? '';
    if (current.includes('|') && /^\|?\s*:?-{3,}/.test(next)) {
      index += 2;
      while (index < lines.length) {
        const row = lines[index]?.trim() ?? '';
        if (!row || !row.includes('|')) {
          break;
        }
        const cells = row
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cleanMarkdown(cell));
        if (cells.some(Boolean)) {
          rows.push({
            meal: cells[0] || '—',
            use: cells[1] || '—',
            next: cells[2] || '—',
          });
        }
        index += 1;
      }
      continue;
    }

    if (!/^\s{0,3}#{1,3}\s+\S/.test(current)) {
      const cleaned = cleanMarkdown(current);
      if (cleaned) {
        prose.push(cleaned);
      }
    }
    index += 1;
  }

  const intro = cleanMarkdownBlock(prose.join('\n').trim());
  if (!rows.length && !citations.length && !intro) {
    return undefined;
  }
  return { title, intro, rows: dedupeRows(rows.slice(0, 12)), citations };
}

function sourceCardsFromSnapshots(snapshots: Array<{ id: string; label: string; detail: string; url: string; tone: 'moss' | 'blue' | 'amber'; excerpt?: string }>): NonNullable<ChatStructuredAnswer['sourceCards']> {
  return snapshots
    .filter((snapshot) => snapshot.label && snapshot.url)
    .slice(0, 6)
    .map((snapshot) => ({
      id: snapshot.id,
      label: snapshot.label,
      detail: snapshot.detail,
      quote: snapshot.excerpt || 'No excerpt was available from this source snapshot.',
      href: snapshot.url,
      tone: snapshot.tone,
      fields: snapshot.excerpt
        ? snapshot.excerpt.split(';').map((part) => part.split(':')[0]?.trim()).filter(Boolean).slice(0, 5)
        : [],
    }));
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/^\s*[-*+]\s+/, '• ')
    .replace(/^\s*\d+[.)]\s+/, '• ')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .trim();
}

function cleanMarkdownBlock(value: string): string {
  const lines = value
    .replace(/([.!?])(?=[A-Z][A-Za-z][^.!?\n]{2,50}\n?•)/g, '$1\n')
    .replace(/([.!?])(?=(?:Here(?:’|'|)s|Here are|For|Tomato|Nutrition)\b)/g, '$1\n')
    .replace(/\s*#{1,6}\s+/g, '\n')
    .split('\n')
    .map((line) => cleanMarkdown(line))
    .filter(Boolean)
    .filter((line, index, values) => values.indexOf(line) === index);
  const firstSignature = lines[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(' ');
  const repeatedStart = firstSignature
    ? lines.findIndex((line, index) => index > 0 && line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().startsWith(firstSignature))
    : -1;
  const cleaned = (repeatedStart > 0 ? lines.slice(0, repeatedStart) : lines).join('\n');
  return dedupeRepeatedText(cleaned);
}

function dedupeRows(rows: ChatStructuredAnswer['rows']): ChatStructuredAnswer['rows'] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.meal}\u0000${row.use}\u0000${row.next}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeRepeatedText(value: string): string {
  const text = value.trim();
  if (text.length > 40) {
    for (let split = 20; split <= text.length - 20; split += 1) {
      const left = text.slice(0, split).trim();
      const right = text.slice(split).trim();
      if (left === right) {
        return left;
      }
    }
  }
  if (text.length > 1 && text.length % 2 === 0) {
    const midpoint = text.length / 2;
    const left = text.slice(0, midpoint).trim();
    const right = text.slice(midpoint).trim();
    if (left && left === right) {
      return left;
    }
  }
  return value;
}

export async function handleServerChat(input: {
  conversationId: string;
  principalId?: string;
  message: string;
  threadTitle?: string;
  idempotencyKey?: string;
  domainId?: string;
  runId?: string;
  signal?: AbortSignal;
  previousResponseId?: string;
  retryOfMessageId?: string;
  stream?: boolean;
  onModelToken?: (token: string) => void;
  planHint?: string;
  preview?: boolean;
}): Promise<ServerChatResponse> {
  const domain = input.domainId || 'food';
  const conversation = getConversation(input.conversationId, input.principalId);
  const threadContext = buildConversationContext(conversation);

  const orchestrated = await runChatRuntime({
    conversationId: input.conversationId,
    principalId: input.principalId,
    domain,
    message: input.message,
    actor: 'hearth',
    commandHint: input.planHint,
    runId: input.runId,
    signal: input.signal,
    previousResponseId: input.previousResponseId,
    conversationContext: threadContext,
    stream: input.stream,
    onModelToken: input.onModelToken,
    preview: input.preview,
  });

  const needsRetry = orchestrated.ai.status !== 'ok' && orchestrated.ai.status !== 'disabled' && orchestrated.ai.status !== 'aborted';
  const isCanceled = orchestrated.ai.status === 'aborted';
  const status = isCanceled ? 'canceled' : orchestrated.ai.status === 'ok' ? 'completed' : 'failed';
  const inputText = threadContext ? `${input.message}\n${threadContext}` : input.message;
  const sourceSnapshots = orchestrated.retrieval.snapshots;
  const sourceCitations = toCitationsFromSnapshots(sourceSnapshots);
  const sourceCards = sourceCardsFromSnapshots(sourceSnapshots);
  const webCitations = (orchestrated.ai.webCitations ?? []).map((citation) => ({
    label: citation.title,
    detail: 'Internet source',
    href: citation.url,
    tone: 'blue' as const,
  }));
  const combinedSourceCitations = ensureCitations([...sourceCitations, ...webCitations]);

  const warnings: string[] = [];
  if (!orchestrated.policy.allowed) {
    warnings.push(orchestrated.policy.reason);
    if (orchestrated.clarifyingQuestion) {
      warnings.push(orchestrated.clarifyingQuestion);
    }
  }
  if (orchestrated.ai.status !== 'ok') {
    warnings.push(`AI ${orchestrated.ai.status}: ${orchestrated.ai.text}`);
  }
  if (input.preview) {
    warnings.push('Preview mode; actions are not committed.');
  }
  if (input.retryOfMessageId) {
    warnings.push(`Retried from user message: ${input.retryOfMessageId}`);
  }

  const clarifyingText =
    orchestrated.clarifyingQuestion || 'I need one short clarification before I can write.';
  const policyBlockedText = orchestrated.policy.reason || 'Action is not allowed in this mode.';

  const finalText =
    orchestrated.status === 'clarification'
      ? clarifyingText
      : orchestrated.policy.allowed
        ? orchestrated.ai.text || policyBlockedText
        : policyBlockedText;

  const modelAnswer =
    orchestrated.policy.allowed && orchestrated.ai.status === 'ok'
      ? parseStructuredModel(inputText, orchestrated.ai.text)
        ?? parseMarkdownModel(orchestrated.ai.text, combinedSourceCitations)
      : undefined;
  if (modelAnswer && combinedSourceCitations.length > 0) {
    modelAnswer.citations = combinedSourceCitations;
  }
  if (modelAnswer && sourceCards.length > 0) {
    modelAnswer.sourceCards = sourceCards;
  }

  // Keep chat output as a short hand-off so repeated prose is avoided.
  const displayText = modelAnswer
    ? (modelAnswer.rows.length || modelAnswer.citations.length ? 'Here’s the answer.' : modelAnswer.intro || finalText)
    : finalText;

  const actionReceipt = orchestrated.action
    ? ({
      schema_version: orchestrated.action.receipt.schema_version,
      id: orchestrated.action.receipt.id,
      actor: orchestrated.action.receipt.actor,
      domain: orchestrated.action.receipt.domain,
      tool: orchestrated.action.receipt.tool,
      risk: orchestrated.action.receipt.risk,
      status: orchestrated.action.receipt.status,
      record_ids: orchestrated.action.receipt.record_ids,
      idempotency_key: orchestrated.action.receipt.idempotency_key,
      created_at: orchestrated.action.receipt.created_at,
      updated_at: orchestrated.action.receipt.updated_at,
      undo_deadline_at: orchestrated.action.receipt.undo_deadline_at,
      conversation_id: orchestrated.action.receipt.conversation_id,
      source_ids: orchestrated.action.receipt.source_ids ?? [],
      source_citations: combinedSourceCitations,
    } as ChatActionReceipt)
    : undefined;

  const responseMessage: ServerChatMessage = {
    id: `server-${Date.now()}-asst`,
    role: 'assistant',
    text: displayText,
    answer: orchestrated.status === 'clarification'
      ? {
          title: 'Clarification required',
          intro: clarifyingText,
          rows: [],
          sourceCards,
          citations: combinedSourceCitations,
        }
      : modelAnswer,
    actionReceipt,
  };

  const actionHints =
    combinedSourceCitations.length > 0
      ? combinedSourceCitations.map((source) => source.label)
      : ['no source citations'];

  return {
    conversation_id: input.conversationId,
    messages: [responseMessage],
    thread: {
      id: input.conversationId,
      title: input.threadTitle || 'Food context',
      detail: 'live response channel',
    },
    agent_handoffs: orchestrated.roles,
    warnings,
    run: {
      id: orchestrated.runId,
      status,
      needs_retry: needsRetry,
      aborted: isCanceled,
      previous_response_id: orchestrated.ai.responseId,
    },
    action: actionReceipt
      ? {
        receipt: actionReceipt,
        verification: orchestrated.action?.verification ?? null,
        source_citations: combinedSourceCitations,
      }
      : undefined,
    action_hints: actionHints,
    provenance: {
      sources: combinedSourceCitations,
      generated_at: new Date().toISOString(),
    },
  };
}
