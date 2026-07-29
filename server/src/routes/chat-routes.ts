import { badRequest, ok } from '../http-utils';
import { type RequestAuthorizationResult } from '../security/auth';

type ChatConversationSummary = {
  id: string;
  domain: string;
  title: string;
  detail: string;
};

type ChatThread = ChatConversationSummary & {
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant';
    text: string;
  }>;
  last_response_id?: string;
};

type RunningConversationRun = {
  run: {
    status: string;
  };
  runId: string;
};

type ChatRoutesContext = {
  assertAuth: (req: any, res: any) => RequestAuthorizationResult | null;
  getAuthenticatedPrincipalId: (auth: RequestAuthorizationResult) => string;
  listConversations: (principalId: string) => ChatConversationSummary[];
  getConversation: (threadId: string, principalId: string) => ChatThread | null | undefined;
  findRunningConversationRun: (
    principalId: string,
    conversationId: string,
    runId?: string,
  ) => RunningConversationRun | null;
};

function getQuery(req: any) {
  return new URL(req.url ?? '/', 'http://127.0.0.1');
}

export async function handleChatQueryRoutes(
  req: any,
  res: any,
  path: string,
  context: ChatRoutesContext,
): Promise<boolean> {
  if (!path.startsWith('/chat')) {
    return false;
  }

  if (req.method === 'GET' && path === '/chat/threads') {
    const auth = context.assertAuth(req, res);
    if (!auth) {
      return true;
    }
    const query = getQuery(req);
    const domain = query.searchParams.get('domain');
    const principalId = context.getAuthenticatedPrincipalId(auth);
    const rows = context.listConversations(principalId);
    const filtered = domain ? rows.filter((row) => row.domain === domain) : rows;
    ok(res, {
      threads: filtered.map((thread) => ({
        id: thread.id,
        domain: thread.domain,
        title: thread.title,
        detail: thread.detail,
        updated_at: new Date().toISOString(),
      })),
    });
    return true;
  }

  if (req.method === 'GET' && path === '/chat/run') {
    const auth = context.assertAuth(req, res);
    if (!auth) {
      return true;
    }
    const query = getQuery(req);
    const conversationId = query.searchParams.get('conversation_id');
    if (!conversationId) {
      badRequest(res, 'conversation_id required');
      return true;
    }
    const principalId = context.getAuthenticatedPrincipalId(auth);
    const activeRun = context.findRunningConversationRun(principalId, conversationId);
    if (!activeRun) {
      ok(res, {
        conversation_id: conversationId,
        active: false,
        status: 'idle',
        run_id: null,
      });
      return true;
    }
    ok(res, {
      conversation_id: conversationId,
      active: true,
      status: activeRun.run.status,
      run_id: activeRun.runId,
    });
    return true;
  }

  if (req.method === 'GET' && path.startsWith('/chat/threads/')) {
    const auth = context.assertAuth(req, res);
    if (!auth) {
      return true;
    }
    const parts = path.split('/');
    const threadId = parts[parts.length - 1];
    const principalId = context.getAuthenticatedPrincipalId(auth);
    const thread = context.getConversation(threadId, principalId);
    if (!thread) {
      badRequest(res, 'thread not found');
      return true;
    }
    ok(res, thread);
    return true;
  }

  return false;
}
