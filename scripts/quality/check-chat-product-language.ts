import { sendChatMessage } from '../../src/chat/client';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const result = await sendChatMessage({
    db: null,
    text: 'what can I cook tonight',
    domainId: 'food',
    conversationId: `chat-language-${Date.now()}`,
  });

  const text = JSON.stringify(result);
  const forbidden = ['local demo', 'Offline fallback', 'Server fallback', 'capped offline fallback', 'Offline recipe answer', 'Offline food answer', 'Offline shopping answer'];
  for (const phrase of forbidden) {
    assert(!text.includes(phrase), `Chat product language leaked: ${phrase}`);
  }

  assert(text.includes('Food context · local briefing'), 'Chat local briefing title missing.');
  assert(text.includes('Local source answer'), 'Chat local source answer detail missing.');

  console.log('PASS chat product language');
}

void main().catch((error) => {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
