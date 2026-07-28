import type { SQLiteDatabase } from 'expo-sqlite';

export type ChatRole = 'assistant' | 'user';

export type CitationTone = 'moss' | 'blue' | 'amber' | 'plum' | 'neutral';

export type ChatCitation = {
  label: string;
  detail: string;
  href: string;
  tone: CitationTone;
};

export type ChatAnswerRow = {
  meal?: string;
  use?: string;
  next?: string;
  cells?: string[];
};

export type ChatAnswer = {
  title: string;
  intro: string;
  columns?: string[];
  rows: ChatAnswerRow[];
  sourceCards?: Array<{
    id: string;
    label: string;
    detail: string;
    quote: string;
    href: string;
    tone: CitationTone;
    fields?: string[];
  }>;
  recordCards?: Array<{
    id: string;
    title: string;
    collection: string;
    status: string;
    detail: string;
    source: string;
    bullets?: string[];
  }>;
  citations: ChatCitation[];
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  answer?: ChatAnswer;
  actionReceipt?: {
    id: string;
    actor?: string;
    domain?: string;
    tool?: string;
    risk?: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'undone';
    record_ids: string[];
    source_ids?: string[];
    source_citations?: ChatCitation[];
    conversation_id?: string;
    schema_version?: string;
    created_at: string;
    updated_at: string;
    undo_deadline_at?: string;
    idempotency_key?: string;
    operation_id?: string;
    operation_ids?: string[];
  };
};

export type ChatThread = {
  id: string;
  title: string;
  detail: string;
  messages: ChatMessage[];
};

export type ChatSendInput = {
  db: SQLiteDatabase | null;
  text: string;
  conversationId?: string;
  domainId: string;
  workspaceId?: string;
  installationId?: string;
  packageId?: string;
  packageVersion?: string;
  actor?: string;
  serverUrl?: string;
  serverToken?: string;
  sortIndex?: number;
  serverRunId?: string;
  retryOfMessageId?: string;
  onModelToken?: (token: string) => void;
};

export type ChatSendResult = {
  thread: ChatThread;
  conversationId: string;
  mode: 'offline' | 'direct' | 'server';
  action?: {
    receipt?: ChatMessage['actionReceipt'];
  };
  warnings?: string[];
  serverError?: string;
  serverRunId?: string;
  retryable?: boolean;
};

export type ChatListInput = {
  db: SQLiteDatabase | null;
  domainId: string;
  installationId?: string;
};
