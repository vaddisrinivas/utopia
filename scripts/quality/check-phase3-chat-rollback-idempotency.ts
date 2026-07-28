import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

type SendResult = {
  action?: {
    receipt?: {
      id?: string;
      status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      record_ids?: string[];
    };
  };
};

type UndoResult = {
  status?: 'completed' | 'failed';
  action_id?: string;
  action?: {
    status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'undone' | 'undo_failed';
  };
  undo_result?: {
    success?: boolean;
    message?: string;
    replayed?: boolean;
  };
};

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'phase3-chat-rollback-idempotency');
mkdirSync(outDir, { recursive: true });

const stateDir = mkdtempSync(join(tmpdir(), `wf-chat-rollback-${randomBytes(4).toString('hex')}-`));
const runtimeStatePath = join(stateDir, 'wonder-runtime.json');
const conversationPath = join(stateDir, 'conversations.json');
const token = 'chat-rollback-test-token';
const port = 19126;
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

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function postJson<T>(path: string, body: unknown, includeAuth = true): Promise<T> {
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
  const outPath = join(outDir, 'phase3-chat-rollback-idempotency-proof.json');

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
      thread_id: `${runId}-thread`,
      message: {
        id: `${runId}-user`,
        text: 'create recipe rollback idempotency test pasta',
      },
      idempotency_key: `${runId}-send`,
      plan_hint: 'create recipe rollback idempotency test pasta',
    });

    const actionId = sendResult.action?.receipt?.id;
    assert(actionId, 'chat/send did not return action.receipt.id');

    const undoKey = `${runId}-undo`;
    const firstUndo = await postJson<UndoResult>('/chat/undo', {
      action_id: actionId,
      actor: 'hearth',
      idempotency_key: undoKey,
    });

    assert(firstUndo.status === 'completed', `first undo failed: ${String(firstUndo.undo_result?.message)}`);
    assert(firstUndo.undo_result?.success === true, 'first undo did not report success');
    assert(firstUndo.action?.status === 'undone', 'first undo did not persist the undone lifecycle');

    const secondUndo = await postJson<UndoResult>('/chat/undo', {
      action_id: actionId,
      actor: 'hearth',
      idempotency_key: undoKey,
    });

    assert(secondUndo.status === 'completed', `second undo failed: ${String(secondUndo.undo_result?.message)}`);
    assert(
      secondUndo.undo_result?.replayed === true,
      'second undo was not idempotent',
    );
    assert(secondUndo.action?.status === 'undone', 'idempotent undo replay lost the undone lifecycle');

    const proof = {
      proof: 'phase3_chat_rollback_idempotency',
      action_id: actionId,
      first: {
        success: firstUndo.undo_result?.success,
        message: firstUndo.undo_result?.message,
        replayed: firstUndo.undo_result?.replayed ?? false,
      },
      second: {
        success: secondUndo.undo_result?.success,
        message: secondUndo.undo_result?.message,
        replayed: secondUndo.undo_result?.replayed ?? false,
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
    cleanup();
  }
})();
