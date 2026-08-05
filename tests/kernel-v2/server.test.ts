import { describe, expect, it } from 'vitest';

import { createApp } from '@/server/index';

const app = createApp(async (input) => `You said: ${input.messages.at(-1)?.content ?? ''}`);

describe('compact server', () => {
  it('reports health', async () => {
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });
  });

  it('sends deterministic, idempotent chat responses', async () => {
    const body = { requestId: 'same', messages: [{ role: 'user', content: 'hello' }] };
    const first = await (await app.request('/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const second = await (await app.request('/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, messages: [{ role: 'user', content: 'changed' }] }) })).json();
    expect(first).toEqual({ text: 'You said: hello', toolCalls: [] });
    expect(second).toEqual(first);
  });

  it('rejects messages without an idempotency key', async () => {
    const response = await app.request('/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }) });
    expect(response.status).toBe(400);
  });
});
