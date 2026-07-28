import assert from 'node:assert/strict';

import { extractResponseId, readChatAgentConfig, runChatAgent } from '../src/agents/chat-agent';

const previousEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS,
  OPENAI_WEB_SEARCH_ENABLED: process.env.OPENAI_WEB_SEARCH_ENABLED,
  OPENAI_WEB_SEARCH_CONTEXT_SIZE: process.env.OPENAI_WEB_SEARCH_CONTEXT_SIZE,
  OPENAI_WEB_SEARCH_TIMEOUT_MS: process.env.OPENAI_WEB_SEARCH_TIMEOUT_MS,
};

process.env.OPENAI_API_KEY = 'chat-agent-contract-test-key';
process.env.OPENAI_MODEL = 'gpt-4.1-mini';
process.env.OPENAI_TIMEOUT_MS = '25';
process.env.OPENAI_WEB_SEARCH_ENABLED = 'true';
process.env.OPENAI_WEB_SEARCH_CONTEXT_SIZE = 'high';
process.env.OPENAI_WEB_SEARCH_TIMEOUT_MS = '40';

try {
  const config = readChatAgentConfig();
  assert.equal(config.model, 'gpt-4.1-mini');
  assert.equal(config.requestTimeoutMs, 25);
  assert.equal(config.webSearchTimeoutMs, 40);
  assert.equal(config.webSearchEnabled, true);
  assert.equal(config.webSearchContextSize, 'high');

  assert.equal(
    extractResponseId({
      id: 'fallback-id',
      providerMetadata: { openai: { responseId: 'resp-provider-id' } },
    }),
    'resp-provider-id',
  );

  const generated = await runChatAgent(
    {
      prompt: 'hello',
      enableLocalQuery: true,
      webSearch: true,
      previousResponseId: 'resp-prev',
    },
    {
      async generate(input: any) {
        assert.equal(input.options.enableLocalQuery, true);
        assert.equal(input.options.enableWebSearch, true);
        assert.equal(input.options.previousResponseId, 'resp-prev');
        return {
          finalStep: { finishReason: 'stop' },
          response: Promise.resolve({
            id: 'fallback-id',
            providerMetadata: { openai: { responseId: 'resp-generated' } },
          }),
          sources: Promise.resolve([{ url: 'https://example.com/test', title: 'Example' }]),
          steps: Promise.resolve([
            {
              toolCalls: [
                { toolCallId: 'call-1', toolName: 'localQuery', input: { schemaVersion: 'wonder.local-query.v1' } },
                { toolCallId: 'call-1', toolName: 'localQuery', input: { schemaVersion: 'wonder.local-query.v1' } },
              ],
            },
          ]),
          text: Promise.resolve('model-output'),
        };
      },
      async stream() {
        throw new Error('stream should not be called in generate test');
      },
    },
  );

  assert.equal(generated.status, 'ok');
  assert.equal(generated.responseId, 'resp-generated');
  assert.equal(generated.toolCalls.length, 1);
  assert.deepEqual(generated.duplicateToolCallIds, ['call-1']);
  assert.deepEqual(generated.webCitations, [{ url: 'https://example.com/test', title: 'Example' }]);

  const abortedController = new AbortController();
  abortedController.abort();
  const aborted = await runChatAgent(
    {
      prompt: 'cancel me',
      signal: abortedController.signal,
    },
    {
      async generate() {
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      },
      async stream() {
        throw new Error('stream should not be called in abort test');
      },
    },
  );
  assert.equal(aborted.status, 'aborted');
  assert.equal(aborted.text, 'Request was cancelled.');

  const timedOut = await runChatAgent(
    {
      prompt: 'timeout me',
    },
    {
      async generate(input: any) {
        await new Promise((_, reject) => {
          input.abortSignal.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'AbortError')),
            { once: true },
          );
        });
        throw new Error('unreachable');
      },
      async stream() {
        throw new Error('stream should not be called in timeout test');
      },
    },
  );
  assert.equal(timedOut.status, 'aborted');
  assert.equal(timedOut.text, 'Request timed out.');

  console.log('PASS server/test/chat-agent-contract.ts');
} finally {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
