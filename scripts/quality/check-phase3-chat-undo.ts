import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

type SendResult = {
  conversation_id?: string;
  action?: {
    receipt?: {
      id?: string;
      status?: 'completed' | 'failed' | 'cancelled' | 'running';
      record_ids?: string[];
    };
    verification?: unknown;
  };
  messages?: Array<{ id: string; role: 'assistant' | 'user'; text: string }>;
};

type UndoResult = {
  status?: 'completed' | 'failed';
  action_id?: string;
  action?: { status?: string };
  undo_result?: {
    success?: boolean;
    message?: string;
    replayed?: boolean;
  };
};

type MpRuntime = {
  actions?: Record<string, unknown>;
  records?: Record<string, unknown>;
};

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'phase3-chat-undo');
mkdirSync(outDir, { recursive: true });

const stateDir = mkdtempSync(join(tmpdir(), `wf-chat-undo-${randomBytes(4).toString('hex')}-`));
const runtimeStatePath = join(stateDir, 'wonder-runtime.json');
const conversationPath = join(stateDir, 'conversations.json');
const token = 'chat-undo-test-token';
const port = 19124;
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

function readRuntime(path: string): MpRuntime {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as MpRuntime;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    await wait(250);
  }
  fail(`server did not become ready at ${base}/health`);
}

async function postJson<T>(path: string, body: unknown, includeAuth = false): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(includeAuth ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    fail(`${path} failed with ${response.status}: ${text || 'no response'}`);
  }
  return (await response.json()) as T;
}

(async () => {
  let serverFailure = '';
  const outPath = join(outDir, 'phase3-chat-undo-proof.json');

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

  const cleanup = () => {
    if (!server.killed) {
      server.kill('SIGTERM');
    }
    rmSync(stateDir, { recursive: true, force: true });
  };

  server.on('exit', (code) => {
    if (code && code !== 0) {
      serverFailure = `server exited with code ${String(code)}`;
    }
  });

  try {
    await waitForServerReady();

    const sendResult = await postJson<SendResult>('/chat/send', {
      conversation_id: `${runId}-thread`,
      domain_id: 'food',
      message: {
        id: `${runId}-user`,
        role: 'user',
        text: 'create recipe undo smoke test pasta',
      },
      idempotency_key: `${runId}-msg`,
    }, true);

    const actionReceipt = sendResult.action?.receipt;
    assert(actionReceipt?.id, 'chat/send did not include action.receipt.id');
    assert(actionReceipt?.status === 'completed', `chat/send action status was ${String(actionReceipt?.status)}; expected completed`);
    const createdRecords = actionReceipt.record_ids ?? [];
    assert(createdRecords.length > 0, 'chat/send action did not record changed record ids');

    const runtimeBefore = readRuntime(runtimeStatePath);
    for (const recordId of createdRecords) {
      assert(
        typeof recordId === 'string' && recordId.length > 0,
        `record id ${String(recordId)} invalid`,
      );
      assert((runtimeBefore.records ?? {})[recordId], `created record ${recordId} missing before undo`);
    }

    const undoResult = await postJson<UndoResult>('/chat/undo', {
      action_id: actionReceipt.id,
      actor: 'hearth',
      idempotency_key: `${runId}-undo`,
    }, true);

    assert(undoResult.status === 'completed', `chat/undo returned status ${String(undoResult.status)}`);
    assert(undoResult.undo_result?.success === true, `chat/undo reported failure: ${undoResult.undo_result?.message || 'no details'}`);

    const runtimeAfter = readRuntime(runtimeStatePath);
    for (const recordId of createdRecords) {
      assert(!(recordId in (runtimeAfter.records ?? {})), `record ${recordId} still present after undo`);
    }

    const evidence = {
      proof: 'phase3_chat_undo_http',
      checks: {
        action_id: actionReceipt.id,
        created_records: createdRecords,
        undo_status: undoResult.status,
        undo_success: undoResult.undo_result?.success,
        action_replayed: undoResult.undo_result?.replayed === true,
      },
      paths: {
        mcp_runtime: runtimeStatePath,
        conversations: conversationPath,
      },
      all_passed: true,
    };

    writeFileSync(outPath, JSON.stringify(evidence, null, 2), 'utf-8');
    console.log(`PASS ${outPath}`);
    process.stdout.write(JSON.stringify(evidence, null, 2));
  } finally {
    if (serverFailure) {
      fail(serverFailure);
    }
    cleanup();
  }
})();
