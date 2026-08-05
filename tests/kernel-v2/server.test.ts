import { describe, expect, it, vi } from 'vitest';

import { createHash } from 'node:crypto';

import { createApp, memoryChatStore } from '@/server/index';

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
const homes = {
  'tenant-a:app-a:notebook': {
    pull: vi.fn(async () => ({ records: [], cursor: undefined })),
    push: vi.fn(async () => ({ cursor: 'ok' })),
  },
};
const appWithHomes = createApp(async (input) => `You said: ${input.messages.at(-1)?.content ?? ''}`, homes, { keys });

describe('compact server', () => {
  it('reports health', async () => {
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });
  });

  it('sends deterministic, idempotent chat responses', async () => {
    const body = { requestId: 'same', messages: [{ role: 'user', content: 'hello' }] };
    const first = await (await app.request('/chat', { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
    const second = await (await app.request('/chat', { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
    expect(first).toEqual({ text: 'You said: hello', toolCalls: [] });
    expect(second).toEqual(first);
  });

  it('rejects messages without an idempotency key', async () => {
    const response = await app.request('/chat', { method: 'POST', headers: auth, body: JSON.stringify({ messages: [] }) });
    expect(response.status).toBe(400);
  });

  it('fails closed on credentials, tenant/app scope, and key reuse', async () => {
    const body = JSON.stringify({ requestId: 'scoped', messages: [{ role: 'user', content: 'hello' }] });
    expect((await app.request('/chat', { method: 'POST', body })).status).toBe(401);
    expect((await app.request('/chat', { method: 'POST', headers: { ...auth, 'x-utopia-tenant': 'tenant-b' }, body })).status).toBe(403);
    await app.request('/chat', { method: 'POST', headers: auth, body });
    const conflict = await app.request('/chat', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ requestId: 'scoped', messages: [{ role: 'user', content: 'changed' }] }),
    });
    expect(conflict.status).toBe(409);
  });

  it('replays durable results after app restart', async () => {
    const store = memoryChatStore();
    let calls = 0;
    const responder = async () => `call-${++calls}`;
    const body = JSON.stringify({ requestId: 'restart', messages: [] });
    const first = createApp(responder, {}, { keys, store });
    const second = createApp(responder, {}, { keys, store });
    expect(await (await first.request('/chat', { method: 'POST', headers: auth, body })).json()).toMatchObject({ text: 'call-1' });
    expect(await (await second.request('/chat', { method: 'POST', headers: auth, body })).json()).toMatchObject({ text: 'call-1' });
    expect(calls).toBe(1);
  });

  it('denies data-home access when requested provider scope is outside tenant/app', async () => {
    const scopedHome = `/data/${encodeURIComponent('tenant-a:app-a:notebook')}/pull`;
    const crossTenant = await appWithHomes.request('/data/tenant-a%3Aother%3Anotebook/pull', { method: 'POST', headers: auth, body: JSON.stringify({}) });
    const crossApp = await appWithHomes.request('/data/tenant-a%3Aapp-b%3Anotebook/pull', { method: 'POST', headers: { ...auth, 'x-utopia-app': 'app-b' }, body: JSON.stringify({}) });
    const allowed = await appWithHomes.request(scopedHome, { method: 'POST', headers: auth, body: JSON.stringify({}) });
    expect(crossTenant.status).toBe(403);
    expect(crossApp.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(homes['tenant-a:app-a:notebook'].pull).toHaveBeenCalledTimes(1);
  });
});
