import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

const root = process.cwd();
const stateDir = mkdtempSync(join(tmpdir(), `utopia-chat-isolation-${randomBytes(4).toString('hex')}-`));
const alphaToken = 'chat-isolation-alpha-token';
const betaToken = 'chat-isolation-beta-token';
const port = 19144;
const base = `http://127.0.0.1:${port}`;

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

async function waitForServerReady() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('server did not become ready');
}

async function postJson<T>(path: string, body: unknown, principal: string) {
  const token = principal === 'tenant-alpha' ? alphaToken : betaToken;
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-utopia-principal': principal,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as T : null,
  };
}

async function getJson<T>(path: string, principal: string) {
  const token = principal === 'tenant-alpha' ? alphaToken : betaToken;
  const response = await fetch(`${base}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-utopia-principal': principal,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as T : null,
  };
}

type ChatRunResponse = {
  conversation_id?: string;
  messages?: Array<{ id: string; role: 'user' | 'assistant'; text: string }>;
  warnings?: string[];
};

(async () => {
  const tsxBinary = join(root, 'server', 'node_modules', '.bin', 'tsx');
  const serverEntry = join(root, 'server', 'src', 'index.ts');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    LIFEOS_SERVER_TRUSTED_TOKENS_JSON: JSON.stringify([
      { token: alphaToken, principal: 'tenant-alpha' },
      { token: betaToken, principal: 'tenant-beta' },
    ]),
    LIFEOS_CHAT_CONVERSATIONS_PATH: join(stateDir, 'conversations.json'),
    LIFEOS_CHAT_RUNTIME_STATE_PATH: join(stateDir, 'chat-runtime-state.json'),
    WONDER_RUNTIME_STATE_PATH: join(stateDir, 'wonder-runtime.json'),
    LIFEOS_WORKFLOW_CHECKPOINT_PATH: join(stateDir, 'workflow-runs.json'),
  };
  delete env.LIFEOS_SERVER_TOKEN;
  delete env.OPENAI_API_KEY;

  const server = spawn(tsxBinary, ['--tsconfig', join(root, 'tsconfig.json'), serverEntry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForServerReady();

    const alphaRequest = {
      thread_id: 'shared-thread',
      message: {
        id: 'alpha-user-1',
        text: 'What should I cook tonight?',
      },
      idempotency_key: 'shared-idem',
      plan_hint: 'What should I cook tonight?',
    };

    const alphaFirst = await postJson<ChatRunResponse>('/chat/send', alphaRequest, 'tenant-alpha');
    assert(alphaFirst.status === 200, `tenant alpha send failed: ${alphaFirst.status} ${JSON.stringify(alphaFirst.body)}`);
    const alphaMessageId = alphaFirst.body?.messages?.at(-1)?.id;
    assert(alphaMessageId, 'tenant alpha send did not return assistant message id');

    const alphaReplay = await postJson<ChatRunResponse>('/chat/send', alphaRequest, 'tenant-alpha');
    assert(alphaReplay.status === 200, `tenant alpha replay failed: ${alphaReplay.status}`);
    assert(alphaReplay.body?.messages?.at(-1)?.id === alphaMessageId, 'same tenant replay did not return cached assistant message');

    const betaSame = await postJson<ChatRunResponse>('/chat/send', alphaRequest, 'tenant-beta');
    assert(betaSame.status === 200, `tenant beta send failed: ${betaSame.status}`);
    assert(betaSame.body?.messages?.at(-1)?.id !== alphaMessageId, 'cross-tenant send leaked replayed assistant message');

    const alphaOtherConversation = await postJson<ChatRunResponse>('/chat/send', {
      ...alphaRequest,
      thread_id: 'other-thread',
      message: {
        id: 'alpha-user-2',
        text: 'What should I cook tonight?',
      },
    }, 'tenant-alpha');
    assert(alphaOtherConversation.status === 200, `cross-conversation send failed: ${alphaOtherConversation.status}`);
    assert(alphaOtherConversation.body?.messages?.at(-1)?.id !== alphaMessageId, 'cross-conversation send leaked replayed assistant message');

    const alphaConflict = await postJson<{ message?: string }>('/chat/send', {
      ...alphaRequest,
      message: {
        id: 'alpha-user-3',
        text: 'Create a pasta recipe tonight',
      },
      plan_hint: 'Create a pasta recipe tonight',
    }, 'tenant-alpha');
    assert(alphaConflict.status === 409, `expected idempotency conflict, got ${alphaConflict.status}`);
    assert(String(alphaConflict.body?.message).includes('Idempotency key already used'), 'expected idempotency conflict explanation');

    const alphaOnly = await postJson<ChatRunResponse>('/chat/send', {
      thread_id: 'alpha-only-thread',
      message: {
        id: 'alpha-user-4',
        text: 'Need a lunch idea',
      },
      idempotency_key: 'alpha-only-idem',
      plan_hint: 'Need a lunch idea',
    }, 'tenant-alpha');
    assert(alphaOnly.status === 200, 'tenant alpha only thread failed');

    const alphaThread = await getJson<{ id?: string }>('/chat/threads/alpha-only-thread', 'tenant-alpha');
    assert(alphaThread.status === 200, `tenant alpha thread lookup failed: ${alphaThread.status}`);
    assert(alphaThread.body?.id === 'alpha-only-thread', 'tenant alpha thread lookup returned wrong thread');

    const betaThread = await getJson<{ message?: string }>('/chat/threads/alpha-only-thread', 'tenant-beta');
    assert(betaThread.status === 400, `tenant beta should not read tenant alpha thread, got ${betaThread.status}`);
    assert(String(betaThread.body?.message).includes('thread not found'), 'expected owner-scoped thread miss');

    const forgedAlphaThread = await fetch(`${base}/chat/threads/alpha-only-thread`, {
      headers: {
        authorization: `Bearer ${betaToken}`,
        'x-utopia-principal': 'tenant-alpha',
        'x-utopia-principal-scope': 'tenant-alpha',
      },
    });
    assert(forgedAlphaThread.status === 400, `caller principal headers must not override beta token identity, got ${forgedAlphaThread.status}`);

    const alphaThreads = await getJson<{ threads?: Array<{ id?: string }> }>('/chat/threads', 'tenant-alpha');
    const betaThreads = await getJson<{ threads?: Array<{ id?: string }> }>('/chat/threads', 'tenant-beta');
    assert(alphaThreads.body?.threads?.some((thread) => thread.id === 'alpha-only-thread') === true, 'tenant alpha thread list missing owned thread');
    assert(betaThreads.body?.threads?.some((thread) => thread.id === 'alpha-only-thread') !== true, 'tenant beta thread list leaked foreign thread');

    console.log('PASS server/test/chat-isolation-contract.ts');
  } finally {
    server.kill('SIGTERM');
    rmSync(stateDir, { recursive: true, force: true });
  }

  if (stderr.includes('Error:') || stderr.includes('Unhandled')) {
    fail(`server stderr contained runtime error: ${stderr.slice(0, 500)}`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
