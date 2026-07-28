import type { ServerChatMessage } from './chat';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mutateJsonStateFile, readJsonStateFile } from './providers/json-state';

const DEFAULT_CONVERSATION_OWNER = 'server';

type PersistedConversationEnvelope = {
  id: string;
  owner?: string;
  domain: string;
  messages: ServerChatMessage[];
  title: string;
  detail: string;
  last_response_id?: string;
};

type PersistedFile = {
  version: 1;
  updated_at: string;
  conversations: PersistedConversationEnvelope[];
};

const STORAGE_PATH =
  process.env.LIFEOS_CHAT_CONVERSATIONS_PATH ??
  join(process.cwd(), 'server-data', 'conversations.json');

const STORE_VERSION = 1;
const FILE_ENCODING = 'utf-8';

type ConversationEnvelope = {
  id: string;
  domain: string;
  messages: ServerChatMessage[];
  title: string;
  detail: string;
  last_response_id?: string;
};

type StoredConversationEnvelope = ConversationEnvelope & {
  owner: string;
};

const conversations = new Map<string, StoredConversationEnvelope>();
let isLoaded = false;

function ensureDir() {
  return;
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function storageKey(id: string, owner: string) {
  return `${owner}\u0000${id}`;
}

function normalizeOwner(owner?: string): string {
  return typeof owner === 'string' && owner.trim().length > 0
    ? owner.trim()
    : DEFAULT_CONVERSATION_OWNER;
}

function cloneConversation(conversation: StoredConversationEnvelope): ConversationEnvelope {
  return {
    id: conversation.id,
    domain: conversation.domain,
    messages: deepClone(conversation.messages),
    title: conversation.title,
    detail: conversation.detail,
    ...(conversation.last_response_id ? { last_response_id: conversation.last_response_id } : {}),
  };
}

function createPersistedFile(
  source: Iterable<StoredConversationEnvelope> = conversations.values(),
): PersistedFile {
  return {
    version: STORE_VERSION,
    updated_at: new Date().toISOString(),
    conversations: [...source].map((conversation) => ({
      id: conversation.id,
      owner: conversation.owner,
      domain: conversation.domain,
      messages: deepClone(conversation.messages),
      title: conversation.title,
      detail: conversation.detail,
      ...(conversation.last_response_id ? { last_response_id: conversation.last_response_id } : {}),
    })),
  };
}

function hydrateFromPayload(payload: PersistedFile) {
  conversations.clear();
  for (const row of payload.conversations) {
    if (!isConversationRow(row)) {
      continue;
    }
    const owner = normalizeOwner(row.owner);
    conversations.set(storageKey(row.id, owner), {
      id: row.id,
      owner,
      domain: row.domain,
      messages: deepClone(row.messages ?? []),
      title: row.title,
      detail: row.detail,
      ...(row.last_response_id ? { last_response_id: row.last_response_id } : {}),
    });
  }
}

function withPersistedConversations<T>(mutate: (draft: Map<string, StoredConversationEnvelope>) => T): T {
  ensureDir();
  let result: T | undefined;
  const payload = mutateJsonStateFile(STORAGE_PATH, {
    label: 'conversation state',
    validate: isValidPersistedFile,
    createDefault: () => createPersistedFile([]),
    mutate: (current) => {
      const draft = new Map<string, StoredConversationEnvelope>();
      for (const row of current.conversations) {
        if (!isConversationRow(row)) {
          continue;
        }
        const owner = normalizeOwner(row.owner);
        draft.set(storageKey(row.id, owner), {
          id: row.id,
          owner,
          domain: row.domain,
          messages: deepClone(row.messages ?? []),
          title: row.title,
          detail: row.detail,
          ...(row.last_response_id ? { last_response_id: row.last_response_id } : {}),
        });
      }
      result = mutate(draft);
      return createPersistedFile(draft.values());
    },
  });
  hydrateFromPayload(payload);
  return result as T;
}

function load() {
  if (isLoaded) {
    return;
  }
  isLoaded = true;

  if (!existsSync(STORAGE_PATH)) {
    return;
  }

  try {
    hydrateFromPayload(readJsonStateFile(STORAGE_PATH, {
      label: 'conversation state',
      validate: isValidPersistedFile,
    }));
  } catch {
    return;
  }
}

function isConversationRow(value: unknown): value is PersistedConversationEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string'
    && typeof row.domain === 'string'
    && typeof row.title === 'string'
    && typeof row.detail === 'string'
    && (Array.isArray(row.messages))
  );
}

function isValidPersistedFile(value: unknown): value is PersistedFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const parsed = value as { version?: number; conversations?: unknown };
  return (
    (typeof parsed.version === 'undefined' || parsed.version === STORE_VERSION)
    && Array.isArray(parsed.conversations)
  );
}

function getStoredConversation(id: string, owner?: string): StoredConversationEnvelope | null {
  load();
  return conversations.get(storageKey(id, normalizeOwner(owner))) ?? null;
}

export function getConversation(id: string, owner?: string): ConversationEnvelope | null {
  load();
  const conversation = getStoredConversation(id, owner);
  return conversation ? cloneConversation(conversation) : null;
}

export function upsertConversation(
  conversation: Omit<ConversationEnvelope, 'messages'>,
  owner?: string,
): ConversationEnvelope {
  load();
  return withPersistedConversations((draft) => {
    const normalizedOwner = normalizeOwner(owner);
    const key = storageKey(conversation.id, normalizedOwner);
    const existing = draft.get(key);
    const next: StoredConversationEnvelope = existing
      ? {
        ...existing,
        ...conversation,
      }
      : {
        ...conversation,
        owner: normalizedOwner,
        messages: [],
      };
    draft.set(key, next);
    return cloneConversation(next);
  });
}

export function appendServerMessage(id: string, message: ServerChatMessage, owner?: string): ConversationEnvelope {
  load();
  return withPersistedConversations((draft) => {
    const conversation = draft.get(storageKey(id, normalizeOwner(owner)));
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    conversation.messages.push(deepClone(message));
    draft.set(storageKey(id, conversation.owner), conversation);
    return cloneConversation(conversation);
  });
}

export function setConversationResponseId(id: string, responseId: string, owner?: string) {
  load();
  if (!responseId.trim()) {
    return;
  }
  withPersistedConversations((draft) => {
    const conversation = draft.get(storageKey(id, normalizeOwner(owner)));
    if (!conversation) {
      return;
    }
    conversation.last_response_id = responseId.trim();
    draft.set(storageKey(id, conversation.owner), conversation);
  });
}

export function listConversations(owner?: string) {
  load();
  const normalizedOwner = normalizeOwner(owner);
  return [...conversations.values()]
    .filter((conversation) => conversation.owner === normalizedOwner)
    .map(cloneConversation);
}

export function ensureConversation(
  id: string,
  domain: string,
  fallbackTitle: string,
  owner?: string,
): ConversationEnvelope {
  load();
  const existing = getConversation(id, owner);
  if (existing) {
    return existing;
  }

  return upsertConversation({
    id,
    domain,
    title: fallbackTitle || 'New conversation',
    detail: `${domain} context`,
  }, owner);
}
