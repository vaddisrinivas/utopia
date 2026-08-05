import * as ed from '@noble/ed25519';
import { canonicalize } from 'json-canonicalize';
import { describe, expect, test } from 'vitest';

import { handleRequest, type UtopiaRegistryEnv } from '../../cloudflare/utopia-registry-worker';
import { fixturePackages } from './v3-fixtures';

class MemoryBucket {
  readonly values = new Map<string, string>();
  async get(key: string) {
    const value = this.values.get(key);
    return value === undefined ? null : { text: async () => value };
  }
  async put(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('V3 registry worker', () => {
  test('fails closed when writes are disabled', async () => {
    const response = await handleRequest(new Request('https://registry.test/v1/packages', {
      method: 'POST',
      body: '{}',
    }), { PACKAGES: new MemoryBucket(), REGISTRY_WRITE_MODE: 'disabled' });
    expect(response.status).toBe(403);
  });

  test('publishes and serves a signed V3 package', async () => {
    const bucket = new MemoryBucket();
    const privateKey = crypto.getRandomValues(new Uint8Array(32));
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const pkg = fixturePackages().find(({ catalog }) => catalog.status === 'active')!;
    const message = new TextEncoder().encode(canonicalize(pkg));
    const signature = await ed.signAsync(message, privateKey);
    const env: UtopiaRegistryEnv = {
      PACKAGES: bucket,
      REGISTRY_HOST: 'registry.test',
      REGISTRY_WRITE_MODE: 'signed',
      REGISTRY_PUBLISHER_KEYS_JSON: JSON.stringify({ test: ed.etc.bytesToHex(publicKey) }),
    };
    const publish = await handleRequest(new Request('https://registry.test/v1/packages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: pkg, publisher: 'test', signature: ed.etc.bytesToHex(signature) }),
    }), env);
    expect(publish.status).toBe(201);
    const entry = await publish.json() as { url: string };

    const manifest = await handleRequest(new Request('https://registry.test/v1/registry.json'), env);
    expect(await manifest.json()).toMatchObject({ schemaVersion: 'utopia.registry.v1', packages: [{ id: pkg.id }] });
    const download = await handleRequest(new Request(entry.url), env);
    expect(download.status).toBe(200);
    expect(await download.json()).toMatchObject({ schemaVersion: 'wonder.app-package.v3', id: pkg.id });
  });
});
