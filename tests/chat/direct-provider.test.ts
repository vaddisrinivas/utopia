import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendDirectModelMessage } from '@/src/chat/direct-provider';

const azureProfile = {
  id: 'primary' as const,
  enabled: true,
  provider: 'azure_openai' as const,
  baseUrl: 'https://example.openai.azure.com',
  apiKey: 'test-key',
  model: 'gpt-chat-latest',
  apiVersion: '2025-04-01-preview',
};

describe('direct Azure provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('omits unsupported sampling controls for current Azure deployments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Connected' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendDirectModelMessage({
      profile: azureProfile,
      messages: [{ role: 'user', content: 'Test' }],
    })).resolves.toMatchObject({ text: 'Connected' });

    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request.body));
    expect(body).toEqual({
      messages: [{ role: 'user', content: 'Test' }],
    });
  });
});
