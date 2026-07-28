import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

type ChatRunResponse = {
  conversation_id?: string;
  messages?: Array<{
    id: string;
    role: 'assistant' | 'user';
    text: string;
  }>;
  action?: {
    receipt?: {
      id: string;
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      source_ids?: string[];
      record_ids?: string[];
    };
    source_citations?: unknown[];
    verification?: unknown;
  };
  action_hints?: string[];
  run?: {
    id: string;
    status: 'running' | 'completed' | 'canceled' | 'failed';
    needs_retry: boolean;
  };
};

type StreamEvent = { type: string } & Record<string, unknown>;

type ChatMessage = {
  id?: string;
  text: string;
};

type ChatEnvelope = {
  thread_id: string;
  message: ChatMessage | string;
};

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'phase3-chat-send');
mkdirSync(outDir, { recursive: true });

const stateDir = mkdtempSync(join(tmpdir(), `wf-chat-send-${randomBytes(4).toString('hex')}-`));
const runtimeStatePath = join(stateDir, 'wonder-runtime.json');
const conversationPath = join(stateDir, 'conversations.json');
const token = 'chat-send-test-token';
const port = 19125;
const base = `http://127.0.0.1:${port}`;
const tsxBinary = join(root, 'server', 'node_modules', '.bin', 'tsx');
const serverEntry = join(root, 'server', 'src', 'index.ts');

const runId = `phase3-${Date.now()}`;

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

async function waitForServerReady(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${base}/health`, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`server did not become ready at ${base}/health`);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    fail(`${path} failed with ${response.status}: ${text || 'no response'}`);
  }
  return (await response.json()) as T;
}

async function openStream(path: string, body: unknown): Promise<StreamEvent[]> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    fail(`${path} failed with ${response.status}: ${text || 'no response'}`);
  }
  assert(response.body, `${path} has no stream body`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  const events: StreamEvent[] = [];

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    raw += decoder.decode(chunk.value, { stream: true });
    const frames = raw.split('\n\n');
    raw = frames.pop() ?? '';

    for (const frame of frames) {
      const eventLine = frame
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('data:'));
      if (!eventLine) {
        continue;
      }

      const rawText = eventLine.replace(/^data:\s*/, '');
      if (!rawText) {
        continue;
      }

      try {
        const event = JSON.parse(rawText) as StreamEvent;
        events.push(event);
      } catch {
        // ignore malformed stream lines
      }
    }
  }

  return events;
}

(async () => {
  let serverFailure = '';
  let serverStopping = false;
  let serverStderr = '';
  const outPath = join(outDir, 'phase3-chat-send-proof.json');

  const env = {
    ...process.env,
    PORT: String(port),
    LIFEOS_SERVER_TOKEN: token,
    WONDER_RUNTIME_STATE_PATH: runtimeStatePath,
    LIFEOS_CHAT_CONVERSATIONS_PATH: conversationPath,
  };

  const server = spawn(tsxBinary, ['--tsconfig', join(root, 'tsconfig.json'), serverEntry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const cleanup = async () => {
    if (server.exitCode === null && server.signalCode === null) {
      serverStopping = true;
      await new Promise<void>((resolve) => {
        const forceTimer = setTimeout(() => {
          if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
        }, 5_000);
        (forceTimer as unknown as { unref?: () => void }).unref?.();
        server.once('exit', () => {
          clearTimeout(forceTimer);
          resolve();
        });
        server.kill('SIGTERM');
      });
    }
    rmSync(stateDir, { recursive: true, force: true });
  };

  server.stderr.on('data', (chunk) => {
    serverStderr += String(chunk);
  });

  server.on('exit', (code) => {
    if (!serverStopping && code && code !== 0) {
      const detail = serverStderr.trim();
      serverFailure = `server exited with code ${String(code)}${detail ? `: ${detail}` : ''}`;
    }
  });

  try {
    await waitForServerReady();

    const threadId = `${runId}-thread-send`;
    const userMessageId = `${runId}-user`;
    const idempotencyKey = `${runId}-idem`;
    const sendPath = '/chat/send';

    const sendRequest: ChatEnvelope = {
      thread_id: threadId,
      message: {
        id: userMessageId,
        text: 'create recipe smoke send test soup',
      },
    };
    (sendRequest as ChatEnvelope & { idempotency_key: string; plan_hint: string }).idempotency_key =
      idempotencyKey;
    (sendRequest as ChatEnvelope & { idempotency_key: string; plan_hint: string }).plan_hint =
      'create recipe smoke send test soup';

    const first = await postJson<ChatRunResponse>(sendPath, sendRequest);
    assert(first.conversation_id === threadId, `chat/send returned unexpected conversation id ${String(first.conversation_id)}`);
    const firstMessage = first.messages?.at(-1);
    assert(firstMessage?.role === 'assistant', 'chat/send final message missing');

    const replay = await postJson<ChatRunResponse>(sendPath, sendRequest);
    const replayMessage = replay.messages?.at(-1);
    assert(replayMessage?.id === firstMessage.id, 'chat/send idempotent key did not replay prior message');
    if (first.action?.receipt && replay.action?.receipt) {
      assert(replay.action.receipt.id === first.action.receipt.id, 'action receipt was not replayed');
    }

    const streamEvents = await openStream('/chat/send/stream', {
      ...sendRequest,
      thread_id: `${runId}-thread-stream`,
      message: {
        id: `${runId}-stream-user`,
        text: 'create recipe smoke stream test pasta',
      } as ChatMessage,
      idempotency_key: `${runId}-stream-idem`,
      mode: 'stream',
      plan_hint: 'create recipe smoke stream test pasta',
    });

    const streamTypes = streamEvents.map((event) => event.type);
    assert(streamTypes.includes('run.start'), 'stream did not emit run.start');
    assert(streamTypes.includes('run.end'), 'stream did not emit run.end');

    const proof = {
      proof: 'phase3_chat_send',
      send: {
        conversation_id: first.conversation_id,
        action_receipt_id: first.action?.receipt?.id,
        action_source_ids: first.action?.receipt?.source_ids ?? [],
        action_record_ids: first.action?.receipt?.record_ids ?? [],
      },
      replay: {
        message_id: replayMessage?.id,
      },
      stream: {
        event_count: streamEvents.length,
        types: streamTypes,
      },
      all_passed: true,
    };
    writeFileSync(outPath, JSON.stringify(proof, null, 2), 'utf-8');
    console.log(`PASS ${outPath}`);
    process.stdout.write(JSON.stringify(proof, null, 2));
  } finally {
    if (serverFailure) {
      fail(serverFailure);
    }
    await cleanup();
  }
})();
