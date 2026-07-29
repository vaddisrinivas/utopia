import { badRequest, handleBodyReadError, ok } from '../http-utils';
import { type RequestAuthorizationResult } from '../security/auth';

type ChatRunState = {
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  conversationId: string;
  principalId: string;
};

type ChatControlRoutesContext = {
  assertAuth: (req: any, res: any) => RequestAuthorizationResult | null;
  readJsonBody: (req: any, maxBytes: number) => Promise<Record<string, unknown>>;
  getAuthenticatedPrincipalId: (auth: RequestAuthorizationResult) => string;
  getRunState: (runId: string) => ChatRunState | null;
  setRunState: (
    runId: string,
    state: { status: ChatRunState['status']; conversationId: string; principalId: string },
  ) => ChatRunState;
  getRunController: (runId: string) => AbortController | undefined;
  clearRunController: (runId: string) => void;
  chatControlBodyLimitBytes: number;
};

function sendStopReply(res: any, runId: string, run: ChatRunState) {
  ok(res, {
    run_id: runId,
    status: 'cancelled',
    conversation_id: run.conversationId,
    run_status: 'cancelled',
  });
}

export async function handleChatControlRoutes(
  req: any,
  res: any,
  path: string,
  context: ChatControlRoutesContext,
): Promise<boolean> {
  if (req.method !== 'POST' || path !== '/chat/stop') {
    return false;
  }

  const auth = context.assertAuth(req, res);
  if (!auth) {
    return true;
  }

  let payload: { run_id?: string };
  try {
    payload = (await context.readJsonBody(req, context.chatControlBodyLimitBytes)) as typeof payload;
  } catch (error) {
    if (handleBodyReadError(res, error)) return true;
    badRequest(res, 'Invalid JSON');
    return true;
  }

  if (!payload.run_id) {
    badRequest(res, 'run_id required');
    return true;
  }

  const run = context.getRunState(payload.run_id);
  if (!run) {
    badRequest(res, 'Unknown run');
    return true;
  }

  const principalId = context.getAuthenticatedPrincipalId(auth);
  if (run.principalId !== principalId) {
    badRequest(res, 'Unknown run');
    return true;
  }

  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    ok(res, { run_id: payload.run_id, status: run.status });
    return true;
  }

  context.getRunController(payload.run_id)?.abort();
  context.setRunState(payload.run_id, {
    status: 'cancelled',
    conversationId: run.conversationId,
    principalId: run.principalId,
  });
  context.clearRunController(payload.run_id);
  sendStopReply(res, payload.run_id, run);
  return true;
}
