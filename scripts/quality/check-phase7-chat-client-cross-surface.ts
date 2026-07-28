import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const root = process.cwd();
const port = 19125;
const token = 'phase7-cross-surface-token';
const stateDir = mkdtempSync(join(tmpdir(), `wf-phase7-${randomBytes(4).toString('hex')}-`));
const runtimeStatePath = join(stateDir, 'wonder-runtime.json');
const conversationPath = join(stateDir, 'conversations.json');
const baseUrl = `http://127.0.0.1:${port}`;
const tsxBinary = join(root, 'server', 'node_modules', '.bin', 'tsx');
const serverEntry = join(root, 'server', 'src', 'index.ts');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readRuntime() {
  return JSON.parse(readFileSync(runtimeStatePath, 'utf8')) as {
    records?: Record<string, unknown>;
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not become ready');
}

(async () => {
  const server = spawn(tsxBinary, ['--tsconfig', join(root, 'tsconfig.json'), serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      LIFEOS_SERVER_TOKEN: token,
      WONDER_RUNTIME_STATE_PATH: runtimeStatePath,
      LIFEOS_CHAT_CONVERSATIONS_PATH: conversationPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer();

    const { sendChatMessage, undoServerAction } = await import('../../src/chat/client');
    const result = await sendChatMessage({
      db: null,
      text: 'create recipe phase7 cross surface pasta',
      domainId: 'food',
      conversationId: `phase7-${Date.now()}`,
      serverUrl: baseUrl,
      serverToken: token,
    });

    assert(result.mode === 'server', `client returned ${result.mode}, expected server`);
    const receipt = result.action?.receipt;
    assert(receipt?.id, 'client result missing action receipt id');
    assert(receipt.status === 'completed', 'client action receipt is not completed');
    assert(receipt.record_ids.length > 0, 'client action receipt has no changed records');
    assert(receipt.tool, 'client action receipt missing tool');

    const before = readRuntime();
    for (const id of receipt.record_ids) {
      assert(before.records?.[id], `client-created record ${id} missing from canonical runtime`);
    }

    const undone = await undoServerAction({
      actionId: receipt.id,
      baseUrl,
      token,
      actor: 'hearth',
      idempotencyKey: `phase7-undo-${receipt.id}`,
    });
    const undoResult = undone?.undo_result;
    assert(undoResult?.success === true, 'client-created action Undo failed');

    const after = readRuntime();
    for (const id of receipt.record_ids) {
      assert(!after.records?.[id], `record ${id} remained after client-path Undo`);
    }

    const evidence = {
      proof: 'phase7_chat_client_cross_surface',
      client_mode: result.mode,
      action_id: receipt.id,
      record_ids: receipt.record_ids,
      undo_success: undoResult?.success === true,
      all_passed: true,
    };
    const evidencePath = join(root, 'app', 'build', 'evidence', 'phase7-chat-client-cross-surface-proof.json');
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`PASS ${evidencePath}`);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('close', resolve));
    rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
