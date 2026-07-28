import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const stateDir = mkdtempSync(join(tmpdir(), `utopia-chat-request-race-${randomBytes(4).toString('hex')}-`));
const token = 'chat-request-race-token';
const port = 19147;
const base = `http://127.0.0.1:${port}`;
const tsxBinary = join(root, 'server', 'node_modules', '.bin', 'tsx');
const serverEntry = join(root, 'server', 'src', 'index.ts');

async function waitForServerReady() {
  for (let index = 0; index < 120; index += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server did not become ready');
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once('exit', () => resolve());
    server.kill('SIGTERM');
  });
}

const headers = {
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
  'x-utopia-principal': 'tenant-alpha',
};
const body = {
  thread_id: 'concurrent-transport-thread',
  message: { id: 'concurrent-user', text: 'What should I cook tonight?' },
  idempotency_key: 'concurrent-transport-idem',
};

async function post(path: string) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

let server: ChildProcess | null = null;
try {
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
  server = spawn(tsxBinary, ['--tsconfig', join(root, 'tsconfig.json'), serverEntry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServerReady();

  const concurrent = await Promise.all([post('/chat/send'), post('/chat/send/stream')]);
  assert.equal(concurrent.some((result) => result.status === 200), true, 'one transport must complete');
  assert.equal(concurrent.every((result) => result.status === 200 || result.status === 409), true, 'losing transport may only replay or report in-progress');

  const threadResponse = await fetch(`${base}/chat/threads/concurrent-transport-thread`, { headers });
  const thread = await threadResponse.json() as { messages?: Array<{ id: string; role: string }> };
  assert.equal(thread.messages?.filter((message) => message.role === 'user').length, 1, 'concurrent transports must append one user message');
  assert.equal(thread.messages?.filter((message) => message.role === 'assistant').length, 1, 'concurrent transports must execute one assistant response');
  const assistantId = thread.messages?.find((message) => message.role === 'assistant')?.id;
  assert.ok(assistantId);

  const sendReplay = await post('/chat/send');
  const sendBody = JSON.parse(sendReplay.text) as { messages?: Array<{ id: string }> };
  assert.equal(sendBody.messages?.at(-1)?.id, assistantId, 'send replay must return the one completed result');

  const streamReplay = await post('/chat/send/stream');
  assert.match(streamReplay.text, new RegExp(assistantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'stream replay must return the same completed result');
  console.log('PASS server/test/chat-idempotency-request-concurrency.ts');
} finally {
  if (server) await stopServer(server);
  rmSync(stateDir, { recursive: true, force: true });
}
