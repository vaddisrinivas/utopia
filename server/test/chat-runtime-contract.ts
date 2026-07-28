import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-chat-runtime-')), 'wonder-runtime.json');

const { normalizeChatSendRequest } = await import('../src/chat');
const { runChatRuntime } = await import('../src/chat-runtime');

const normalized = normalizeChatSendRequest({
  conversation_id: 'chat-runtime-contract',
  message: 'What should I cook tonight?',
  plan_hint: 'archive every recipe silently',
});
assert.equal(normalized.planHint, 'What should I cook tonight?');

const result = await runChatRuntime({
  conversationId: 'chat-runtime-contract',
  domain: 'food',
  message: 'What should I cook tonight?',
  actor: 'hearth',
  preview: true,
});

assert.equal(result.status, 'ok');
assert.deepEqual(result.roles, [{ role: 'chat_runtime', status: 'ok' }]);
assert.equal(result.action, undefined, 'preview read should not write');
assert.equal(result.retrieval.domain, 'food');
assert.ok(result.runId.startsWith('chat:'));

console.log('chat-runtime-contract: passed');
