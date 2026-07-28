import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'utopia-state-persistence-'));

try {
  const conversationsPath = join(tempDir, 'conversations.json');
  writeFileSync(conversationsPath, '{"broken":', 'utf-8');
  process.env.LIFEOS_CHAT_CONVERSATIONS_PATH = conversationsPath;

  const conversations = await import('../src/conversations');
  const recovered = conversations.ensureConversation('conversation-after-quarantine', 'food', 'Recovered conversation');
  assert.equal(recovered.id, 'conversation-after-quarantine');
  assert.equal(
    readdirSync(tempDir).some((name) => /^conversations\.corrupt-/.test(name)),
    true,
    'corrupt conversations state should be quarantined',
  );
  const conversationPayload = JSON.parse(readFileSync(conversationsPath, 'utf-8')) as { conversations?: Array<{ id?: string }> };
  assert.equal(
    conversationPayload.conversations?.some((row) => row.id === 'conversation-after-quarantine'),
    true,
    'conversation state should recover onto a fresh file after quarantine',
  );

  const reactiveRuntimePath = join(tempDir, 'reactive-runtime.json');
  writeFileSync(reactiveRuntimePath, '{"runtime":', 'utf-8');
  process.env.LIFEOS_REACTIVE_RUNTIME_PATH = reactiveRuntimePath;

  const { drainReactiveRuntimeOutbox } = await import('../src/kernel/install-reactive-runtime');
  const drained = await drainReactiveRuntimeOutbox({
    path: reactiveRuntimePath,
    executeProposal: () => ({ ok: true }),
  });
  assert.deepEqual(drained.attempted, [], 'corrupt reactive runtime should recover to an empty outbox');
  assert.equal(
    readdirSync(tempDir).some((name) => /^reactive-runtime\.corrupt-/.test(name)),
    true,
    'corrupt reactive runtime should be quarantined',
  );
  const reactivePayload = JSON.parse(readFileSync(reactiveRuntimePath, 'utf-8')) as { schemaVersion?: string };
  assert.equal(reactivePayload.schemaVersion, 'wonder.reactive-runtime.v1');

  console.log('PASS server/test/state-persistence-contract.ts');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
