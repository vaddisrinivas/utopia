import type { SQLiteDatabase } from 'expo-sqlite';
import {
  DEFAULT_APP_INSTALLATION_ID,
  DEFAULT_WORKSPACE_ID,
} from '@/packages/shared/contracts/app-installation';

export type ConversationRole = 'user' | 'assistant';

export type Message = {
  id: string;
  role: ConversationRole;
  sort_index: number;
  body: string;
  answer_payload: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  workspace_id: string;
  app_installation_id: string;
  package_id: string | null;
  package_version: string | null;
  domain: string;
  title: string;
  detail: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ConversationEnvelope = Conversation & {
  messages: Message[];
};

type ConversationRow = Omit<Conversation, 'messages'>;
type MessageRow = Message;
type ConversationScope = {
  workspaceId?: string | null;
  installationId?: string | null;
  packageId?: string | null;
  packageVersion?: string | null;
};

function normalizeScope(scope?: ConversationScope | null) {
  return {
    workspaceId: scope?.workspaceId?.trim() || DEFAULT_WORKSPACE_ID,
    installationId: scope?.installationId?.trim() || DEFAULT_APP_INSTALLATION_ID,
    packageId: scope?.packageId?.trim() || null,
    packageVersion: scope?.packageVersion?.trim() || null,
  };
}

export async function listConversations(
  db: SQLiteDatabase,
  domain: string,
  includeArchived = false,
  scope?: ConversationScope | null,
): Promise<Conversation[]> {
  const scoped = normalizeScope(scope);
  const whereClause = includeArchived
    ? 'app_installation_id = ? AND domain = ? ORDER BY updated_at DESC'
    : 'app_installation_id = ? AND domain = ? AND archived_at IS NULL ORDER BY updated_at DESC';
  return db.getAllAsync<ConversationRow>(`SELECT * FROM conversations WHERE ${whereClause}`, [scoped.installationId, domain]);
}

export async function getConversation(
  db: SQLiteDatabase,
  conversationId: string,
  scope?: ConversationScope | null,
): Promise<ConversationEnvelope | null> {
  const scoped = normalizeScope(scope);
  const conversation = await db.getFirstAsync<ConversationRow>(
    'SELECT * FROM conversations WHERE app_installation_id = ? AND id = ?',
    [scoped.installationId, conversationId],
  );
  if (!conversation) return null;

  const messages = await db.getAllAsync<MessageRow>(
    'SELECT id, role, sort_index, body, answer_payload, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY sort_index ASC',
    [conversationId]
  );

  return {
    ...conversation,
    messages,
  };
}

export async function createConversation(
  db: SQLiteDatabase,
  input: {
    id: string;
    workspaceId?: string | null;
    installationId?: string | null;
    packageId?: string | null;
    packageVersion?: string | null;
    domain: string;
    title: string;
    detail: string;
  }
): Promise<Conversation> {
  const scoped = normalizeScope(input);
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO conversations (
        id, workspace_id, app_installation_id, package_id, package_version, domain, title, detail, created_at, updated_at, archived_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    [input.id, scoped.workspaceId, scoped.installationId, scoped.packageId, scoped.packageVersion, input.domain, input.title, input.detail, now, now]
  );
  return {
    id: input.id,
    workspace_id: scoped.workspaceId,
    app_installation_id: scoped.installationId,
    package_id: scoped.packageId,
    package_version: scoped.packageVersion,
    domain: input.domain,
    title: input.title,
    detail: input.detail,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
}

export async function upsertConversation(
  db: SQLiteDatabase,
  input: {
    id: string;
    workspaceId?: string | null;
    installationId?: string | null;
    packageId?: string | null;
    packageVersion?: string | null;
    domain: string;
    title: string;
    detail: string;
  }
): Promise<Conversation> {
  const scoped = normalizeScope(input);
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO conversations (
        id, workspace_id, app_installation_id, package_id, package_version, domain, title, detail, created_at, updated_at, archived_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        app_installation_id = excluded.app_installation_id,
        package_id = excluded.package_id,
        package_version = excluded.package_version,
        title = excluded.title,
        detail = excluded.detail,
        updated_at = excluded.updated_at,
        domain = excluded.domain
    `,
    [input.id, scoped.workspaceId, scoped.installationId, scoped.packageId, scoped.packageVersion, input.domain, input.title, input.detail, now, now]
  );

  return {
    id: input.id,
    workspace_id: scoped.workspaceId,
    app_installation_id: scoped.installationId,
    package_id: scoped.packageId,
    package_version: scoped.packageVersion,
    domain: input.domain,
    title: input.title,
    detail: input.detail,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
}

export async function appendMessage(
  db: SQLiteDatabase,
  input: {
    id: string;
    conversation_id: string;
    role: ConversationRole;
    sort_index: number;
    body: string;
    answer_payload?: unknown;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const answerPayload = input.answer_payload ? JSON.stringify(input.answer_payload) : null;
  await db.runAsync(
    `
      INSERT INTO conversation_messages (id, conversation_id, role, sort_index, body, answer_payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [input.id, input.conversation_id, input.role, input.sort_index, input.body, answerPayload, now]
  );
  await db.runAsync(
    'UPDATE conversations SET updated_at = ? WHERE id = ?',
    [now, input.conversation_id]
  );
}
