import * as ed from '@noble/ed25519';
import { canonicalize } from 'json-canonicalize';
import { describe, expect, test } from 'vitest';
import { handleRequest, type UtopiaRegistryEnv } from '../../cloudflare/utopia-registry-worker';
import { fixturePackages } from './v3-fixtures';

const fixture = fixturePackages().find(({ catalog }) => catalog.status === 'active')!;
const env = (overrides: Partial<UtopiaRegistryEnv> = {}): UtopiaRegistryEnv => ({
  PACKAGES: { values: new Map<string, string>(), async get(key) { const value = this.values.get(key); return value === undefined ? null : { text: async () => value }; }, async put(key, value) { this.values.set(key, value); } },
  REGISTRY_WRITE_MODE: 'disabled', ...overrides
} as UtopiaRegistryEnv);

const request = (url: string, init: RequestInit, base: UtopiaRegistryEnv) => handleRequest(new Request(`https://registry.test/${url}`, init), base);

describe('V3 registry worker', () => {
  test('CORS + write origin gate', async () => {
    const read = await request('v1/registry.json', { method: 'GET', headers: { Origin: 'https://app.example' } }, env());
    expect(read.headers.get('access-control-allow-origin')).toBe('*');

    const badWrite = await request('v1/packages', { method: 'POST', headers: { Origin: 'https://bad.example', 'content-type': 'application/json' }, body: '{}' }, env({ REGISTRY_WRITE_MODE: 'signed', REGISTRY_WRITE_ALLOWED_ORIGINS: 'https://good.example', PACKAGES: { values: new Map() } as never }));
    expect((await badWrite.json()) as { error: string }).toMatchObject({ error: 'registry_write_origin_denied' });
  });

  test('preflight write gate', async () => {
    const denied = await request('v1/packages', { method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' } }, env({ REGISTRY_WRITE_MODE: 'signed', REGISTRY_HOST: 'registry.test' }));
    expect(denied.status).toBe(403);

    const allowed = await request('v1/packages', { method: 'OPTIONS', headers: { Origin: 'https://trusted.example', 'Access-Control-Request-Method': 'POST' } }, env({ REGISTRY_WRITE_MODE: 'signed', REGISTRY_HOST: 'registry.test', REGISTRY_WRITE_ALLOWED_ORIGINS: 'https://trusted.example', PACKAGES: { values: new Map() } as never }));
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://trusted.example');
  });

  test('publish and fetch flow', async () => {
    const bucket = env({ PACKAGES: { values: new Map<string, string>(), async get(key) { return this.values.get(key) === undefined ? null : { text: async () => this.values.get(key)! }; }, async put(key, value) { this.values.set(key, value); } } as never, REGISTRY_WRITE_MODE: 'signed', REGISTRY_HOST: 'registry.test' } as Partial<UtopiaRegistryEnv>);
    const privateKey = crypto.getRandomValues(new Uint8Array(32));
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const signature = await ed.signAsync(new TextEncoder().encode(canonicalize(fixture)), privateKey);

    const published = await request('v1/packages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ package: fixture, publisher: 'test', signature: ed.etc.bytesToHex(signature) }) }, { ...bucket, REGISTRY_PUBLISHER_KEYS_JSON: JSON.stringify({ test: ed.etc.bytesToHex(publicKey) }) });
    expect(published.status).toBe(201);

    const manifest = await request('v1/registry.json', { method: 'GET' }, { ...bucket, REGISTRY_PUBLISHER_KEYS_JSON: JSON.stringify({ test: ed.etc.bytesToHex(publicKey) }) });
    expect(await manifest.json()).toMatchObject({ schemaVersion: 'utopia.registry.v1', packages: [{ id: fixture.id }] });

    const publishedPkg = (await published.json()) as { url: string };
    const downloaded = await request(publishedPkg.url.replace('https://registry.test/', ''), { method: 'GET' }, bucket);
    expect(await downloaded.json()).toMatchObject({ id: fixture.id, schemaVersion: 'wonder.app-package.v3' });
  });

  test('reject invalid signature and disabled writes', async () => {
    const noWrite = await request('v1/packages', { method: 'POST', body: '{}' }, env());
    expect(noWrite.status).toBe(403);

    const badSignature = await request('v1/packages', { method: 'POST', body: JSON.stringify({ package: fixture, publisher: 'test', signature: '00'.repeat(64) }) },
      env({ REGISTRY_WRITE_MODE: 'signed', REGISTRY_HOST: 'registry.test', REGISTRY_PUBLISHER_KEYS_JSON: JSON.stringify({ test: 'a'.repeat(64) }) }));
    expect(badSignature.status).toBe(403);
  });
});
