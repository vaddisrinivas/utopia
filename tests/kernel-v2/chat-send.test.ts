import { describe, expect, it } from 'vitest';

import { createHash } from 'node:crypto';

import { createApp } from '@/server/index';

const token = 'test-secret';
const key = `sha256:${createHash('sha256').update(token).digest('hex')}`;
const keys = { [key]: { tenant: 'tenant-a', apps: ['app-a'] } };
const auth = {
  authorization: `Bearer ${token}`,
  'x-utopia-tenant': 'tenant-a',
  'x-utopia-app': 'app-a',
  'content-type': 'application/json',
};
const app = createApp(async (input) => `You said: ${input.messages.at(-1)?.content ?? ''}`, {}, { keys });

describe('chat-send', () => {
  it('reports health', async () => {
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });
  });

  it('sends deterministic chat responses', async () => {
    const body = JSON.stringify({ requestId: 'same', messages: [{ role: 'user', content: 'hello' }] });
    const first = await (await app.request('/chat', { method: 'POST', headers: auth, body })).json();
    const second = await (await app.request('/chat', { method: 'POST', headers: auth, body })).json();
    expect(first).toEqual({ text: 'You said: hello', toolCalls: [] });
    expect(second).toEqual(first);
  });

  it('rejects messages with invalid tenant and app scope', async () => {
    const body = JSON.stringify({ requestId: 'scoped', messages: [{ role: 'user', content: 'hello' }] });
    expect((await app.request('/chat', { method: 'POST', body })).status).toBe(401);
    expect((await app.request('/chat', { method: 'POST', headers: { ...auth, 'x-utopia-tenant': 'tenant-b' }, body })).status).toBe(403);
  });
});
