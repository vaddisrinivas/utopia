import { describe, expect, it, vi } from 'vitest';

import { checksum, loadRegistry } from '@/src/kernel/registry';
import { applyStatePatch, chat, compilePackage, httpProvider, mergeState, statePatch, syncDataHome } from '@/src/kernel/services';
import * as dataHomes from '@/src/kernel/data-home';
import type { AppState, JsonRecord } from '@/src/kernel/runtime';

import { fixtureActivePackage } from './v3-fixtures';

const record = (id: string, updatedAt: string, title = id): JsonRecord => ({ id, collection: 'item', createdAt: updatedAt, updatedAt, values: { title } });
const pkg = fixtureActivePackage();

describe('compiler and trust', () => {
  it('compiles V3 and rejects removed schemas', () => {
    expect(compilePackage(pkg).schemaVersion).toBe('wonder.app-package.v3');
    expect(() => compilePackage({ ...pkg, schemaVersion: 'wonder.app-package.v2' })).toThrow();
  });

  it('produces stable SHA-256 checksums', async () => {
    expect(await checksum({ b: 2, a: 1 })).toBe(await checksum({ a: 1, b: 2 }));
    expect(await checksum({ a: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('fails closed on malformed registries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ packages: [] }), { status: 200 })));
    await expect(loadRegistry('https://example.com/registry.json')).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});

describe('sync providers', () => {
  it('merges deterministically by latest timestamp', () => {
    const local: AppState = { records: [record('one', '2026-01-01', 'old'), record('local', '2026-01-01')] };
    const remote: AppState = { records: [record('one', '2026-02-01', 'new'), record('remote', '2026-01-01')] };
    const merged = mergeState(local, remote);
    expect(merged.records).toHaveLength(3);
    expect(merged.records.find((item) => item.id === 'one')?.values.title).toBe('new');
  });

  it('round-trips state patches', () => {
    const before: AppState = { records: [record('one', '2026-01-01')] };
    const after: AppState = { records: [record('one', '2026-02-01', 'changed'), record('two', '2026-02-01')] };
    expect(applyStatePatch(before, statePatch(before, after))).toStrictEqual(after);
  });

  it('uses one provider transport contract', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ records: [record('one', '2026-01-01')], cursor: 'next' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const provider = httpProvider('https://provider.example/sync', { authorization: 'private' });
    expect(await provider.pull('old')).toMatchObject({ cursor: 'next' });
    await provider.push([], 'next');
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('retries transient provider failures and rejects plaintext remotes', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(httpProvider('https://provider.example/sync').pull()).resolves.toEqual({ records: [], cursor: undefined });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(() => httpProvider('http://provider.example/sync')).toThrow('HTTPS required');
    vi.unstubAllGlobals();
  });

  it('runs pull, push, and sync modes against the configured data home', async () => {
    const remote = record('remote', '2026-02-01');
    const configured = { ...pkg, dataHomes: [{ id: 'cloud', kind: 'notion' as const, mode: 'sync' as const, resource: 'resource', secretRef: 'UTOPIA_NOTION' }], defaultDataHome: 'cloud' };
    vi.spyOn(dataHomes, 'createDataHome').mockReturnValue({
      pull: vi.fn().mockResolvedValue({ records: [remote], cursor: undefined, hasMore: false }),
      push: vi.fn().mockResolvedValue({ cursor: remote.updatedAt }),
    });
    const secrets = {
      UTOPIA_TENANT_ID: 'tenant-a',
      UTOPIA_NOTION: 'token',
    };
    const result = await syncDataHome(configured, { records: [record('local', '2026-01-01')] }, 'https://sync.example', undefined, undefined, secrets);
    expect(result.records.map((item) => item.id).sort()).toEqual(['local', 'remote']);
  });
});

describe('chat', () => {
  it('validates deterministic model responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: 'ok', toolCalls: [] }), { status: 200 })));
    await expect(chat('https://example.com/chat', [{ role: 'user', content: 'hello' }])).resolves.toEqual({ text: 'ok', toolCalls: [] });
    vi.unstubAllGlobals();
  });

  it('rejects malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ answer: 'no contract' }), { status: 200 })));
    await expect(chat('https://example.com/chat', [])).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it('rejects plaintext production chat endpoints', async () => {
    await expect(chat('http://example.com/chat', [])).rejects.toThrow('HTTPS required');
  });
});
