import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

const root = process.cwd();
const stateDir = mkdtempSync(join(tmpdir(), `utopia-chat-restart-${randomBytes(4).toString('hex')}-`));
const token = 'chat-restart-test-token';
const port = 19145;
const base = `http://127.0.0.1:${port}`;
const tsxBinary = join(root, 'server', 'node_modules', '.bin', 'tsx');
const serverEntry = join(root, 'server', 'src', 'index.ts');

function fail(message: string): never {
  throw new Error(message);
}

async function waitForServerReady() {
  for (let index = 0; index < 120; index += 1) {
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

function startServer(): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    LIFEOS_SERVER_TOKEN: token,
    LIFEOS_CHAT_CONVERSATIONS_PATH: join(stateDir, 'conversations.json'),
    LIFEOS_CHAT_RUNTIME_STATE_PATH: join(stateDir, 'chat-runtime-state.json'),
    WONDER_RUNTIME_STATE_PATH: join(stateDir, 'wonder-runtime.json'),
    LIFEOS_WORKFLOW_CHECKPOINT_PATH: join(stateDir, 'workflow-runs.json'),
    LIFEOS_REACTIVE_RUNTIME_PATH: join(stateDir, 'reactive-runtime.json'),
  };
  delete env.OPENAI_API_KEY;
  return spawn(tsxBinary, ['--tsconfig', join(root, 'tsconfig.json'), serverEntry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function stopServer(server: ChildProcess) {
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    server.once('exit', () => resolve());
  });
}

async function postChat() {
  const response = await fetch(`${base}/chat/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-utopia-principal': 'tenant-alpha',
    },
    body: JSON.stringify({
      thread_id: 'restart-thread',
      message: {
        id: 'restart-user-1',
        text: 'What should I cook after a restart?',
      },
      idempotency_key: 'restart-idem',
      plan_hint: 'What should I cook after a restart?',
    }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as {
      messages?: Array<{ id: string }>;
      warnings?: string[];
      run?: { id?: string; status?: string };
    } : null,
  };
}

let server: ChildProcess | null = null;

try {
  server = startServer();
  await waitForServerReady();
  const first = await postChat();
  assert.equal(first.status, 200, `initial send failed: ${first.status}`);
  const firstMessageId = first.body?.messages?.at(-1)?.id;
  assert.ok(firstMessageId, 'initial send should return an assistant message id');
  await stopServer(server);

  server = startServer();
  await waitForServerReady();
  const replay = await postChat();
  assert.equal(replay.status, 200, `restart replay failed: ${replay.status}`);
  assert.equal(replay.body?.messages?.at(-1)?.id, firstMessageId, 'restart replay should return the original assistant message');
  assert.equal(
    replay.body?.warnings?.some((warning) => warning.includes('Idempotency key replayed')),
    true,
    'restart replay should explain cached replay behavior',
  );

  console.log('PASS server/test/chat-restart-replay.ts');
} finally {
  if (server) {
    try {
      await stopServer(server);
    } catch {
      // ignore cleanup failures
    }
  }
  rmSync(stateDir, { recursive: true, force: true });
}
