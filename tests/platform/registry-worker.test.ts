import { beforeAll, describe, expect, it } from 'vitest';

import { handleRequest, type UtopiaRegistryEnv } from '@/cloudflare/utopia-registry-worker';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { canonicalJson } from '@/packages/shared/contracts/canonical-json';

const nativeCapabilities = {
  schemaVersion: 'wonder.app-package-native-capabilities.v1',
  platform: 'expo',
  packages: [],
} as const;
const contractLock = {
  schemaVersion: 'wonder.package-contract-lock.v1',
  algorithm: 'sha256',
  pinnedAt: '2026-07-29T00:00:00.000Z',
  dependencyPins: [],
  nativeCapabilities,
} as const;
const validPackage = {
  schemaVersion: 'wonder.app-package.v3',
  id: 'launch-demo',
  version: '1.0.0',
  collections: {
    task: {
      id: 'task',
      fields: {
        title: { type: 'text', required: true },
        done: { type: 'boolean' },
      },
    },
  },
  queries: {
    tasks: { from: 'task', orderBy: [{ field: 'title', direction: 'asc' }] },
  },
  views: {
    home: { id: 'home', query: 'tasks', mode: 'list', fields: ['title', 'done'] },
  },
  presentation: {
    label: 'Launch Demo',
    homeSurface: 'home',
    surfaces: [{ id: 'home', label: 'Home', collections: ['task'] }],
    ui: {
      schemaVersion: 'a2ui.v0_9',
      defaultScreen: 'home',
      screens: {
        home: {
          title: 'Launch Demo',
          components: [{ kind: 'widget', widget: 'recordList', props: { collection: 'task' } }],
        },
      },
    },
  },
  rules: [],
  capabilities: [],
  acceptanceTests: ['launch-demo'],
  dependencyPins: [],
  nativeCapabilities,
  contractLock: {
    ...contractLock,
    checksum: sha256Canonical(contractLock),
  },
};
const testToken = 'test-token-'.padEnd(120, 'x');
const testSigningKeyId = 'utopia-test-publisher';
let testSigningPrivateKey: CryptoKey;
let testSigningPublicKey: string;

beforeAll(async () => {
  const keys = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  testSigningPrivateKey = keys.privateKey;
  testSigningPublicKey = Buffer.from(await globalThis.crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64');
});

describe('Cloudflare registry worker', () => {
  it('permits the telemetry token header during CORS preflight', async () => {
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/events', {
      method: 'OPTIONS',
    }), fakeEnv());

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('x-utopia-telemetry-token');
  });

  it('publishes an unlisted package and returns Utopia install links', async () => {
    const env = fakeEnv();
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(await signedPublishBody(validPackage)),
    }), env);
    const payload = await response.json() as Record<string, string>;

    expect(response.status).toBe(201);
    expect(payload.install_url).toMatch(/^utopia:\/\/install\?url=/);
    expect(payload.web_url).toMatch(/^https:\/\/utoia\.thetechcruise\.com\/install\?url=/);
    expect(payload.package_url).toBe(`https://utoia.thetechcruise.com/p/${payload.id}.json`);

    const packageResponse = await handleRequest(new Request(payload.package_url), env);
    expect(packageResponse.status).toBe(200);
    expect(await packageResponse.json()).toMatchObject({ id: 'launch-demo' });

    const metadataResponse = await handleRequest(new Request(`https://utoia.thetechcruise.com/v1/packages/${payload.id}`), env);
    expect(metadataResponse.status).toBe(200);
    expect(await metadataResponse.json()).toMatchObject({
      visibility: 'unlisted',
      labels: ['generated', 'unlisted'],
    });
  });

  it('keeps staging writes disabled until signed mode is explicitly enabled', async () => {
    const env = fakeEnv({ REGISTRY_WRITE_MODE: 'disabled' });
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(validPackage)),
    }), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'registry_writes_disabled' });
  });

  it('rejects a package signature that does not match the package', async () => {
    const env = fakeEnv();
    const body = await signedPublishBody(validPackage);
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, package: { ...validPackage, version: '9.9.9' } }),
    }), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'package_signature_invalid' });
  });

  it('rejects immutable republish attempts with lifecycle mismatch', async () => {
    const env = fakeEnv();
    const request = {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(validPackage)),
    };

    const first = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', request), env);
    expect(first.status).toBe(201);

    const second = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(await signedPublishBody(validPackage, { visibility: 'public' })),
    }), env);
    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({ error: 'package_metadata_immutable' });
  });

  it('rejects publish without token and blocks secret-shaped package fields', async () => {
    const env = fakeEnv();
    const unauthorized = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      body: JSON.stringify({ package: validPackage }),
    }), env);
    expect(unauthorized.status).toBe(400);
    expect(await unauthorized.json()).toMatchObject({ error: 'unauthorized' });

    const registryManifest = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/registry.json'), env);
    expect(registryManifest.status).toBe(200);
    expect(await registryManifest.json()).toMatchObject({ packages: [] });

    const secretPackage = {
      ...validPackage,
      presentation: {
        ...validPackage.presentation,
        providerTemplateFields: { apiKey: 'nope' },
      },
    };
    const rejected = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(secretPackage)),
    }), env);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: expect.stringContaining('$.presentation.providerTemplateFields.apiKey') });
  });

  it('accepts only redacted telemetry events', async () => {
    const env = fakeEnv({
      TELEMETRY_INGEST_ENABLED: 'true',
      TELEMETRY_INGEST_TOKEN: 'telemetry-token-1234567890',
    });
    const ok = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-utopia-telemetry-token': 'telemetry-token-1234567890' },
      body: JSON.stringify({
        schemaVersion: 'utopia.telemetry-event.v1',
        event: 'package_opened',
        anonymousInstallationId: 'anon-1',
        occurredAt: '2026-07-29T00:00:00.000Z',
        packageId: 'launch-demo',
        source: 'app',
      }),
    }), env);
    expect(ok.status, await ok.text()).toBe(200);
    expect(env.analytics).toHaveLength(1);

    const bad = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-utopia-telemetry-token': 'telemetry-token-1234567890' },
      body: JSON.stringify({
        schemaVersion: 'utopia.telemetry-event.v1',
        event: 'package_opened',
        anonymousInstallationId: 'anon-1',
        occurredAt: '2026-07-29T00:00:00.000Z',
        records: [{ title: 'private' }],
      }),
    }), env);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: expect.stringContaining('forbidden telemetry field:record') });
  });

  it('rejects malformed package metadata as hostile tamper', async () => {
    const env = fakeEnv();
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(validPackage)),
    }), env);
    const payload = await response.json() as { id: string };
    await env.PACKAGES.put(`registry/packages/${payload.id}.json`, JSON.stringify({ package_id: 'launch-demo' }));

    const metadata = await handleRequest(new Request(`https://utoia.thetechcruise.com/v1/packages/${payload.id}`), env);
    expect(metadata.status).toBe(400);
    expect(await metadata.json()).toMatchObject({ error: 'package_metadata_invalid' });
  });

  it('skips malformed registry index entries from hostile tampering', async () => {
    const env = fakeEnv();
    await env.PACKAGES.put('registry/index.json', JSON.stringify({
      schemaVersion: 'utopia.hosted-registry-index.v1',
      updatedAt: '2026-07-29T00:00:00.000Z',
      packages: [
        {
          id: 'attack',
          package_id: 'attack-app',
          name: 'attack',
          version: '1.0.0',
          checksum: 'sha256:bad',
          object_key: 'packages/bad.json',
          package_url: 'https://utoia.thetechcruise.com/p/bad.json',
          visibility: 'public',
          source: 'custom_gpt',
        },
      ],
    }));

    const manifest = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/registry.json'), env);
    expect(manifest.status).toBe(200);
    expect(await manifest.json()).toMatchObject({ packages: [] });
  });

  it('serves mobile app-link metadata from configured release values', async () => {
    const env = fakeEnv({
      ANDROID_SHA256_CERT_FINGERPRINT: 'AA:BB',
      IOS_APP_ID: 'TEAMID.app.utopia',
    });

    const assetLinks = await handleRequest(new Request('https://utoia.thetechcruise.com/.well-known/assetlinks.json'), env);
    expect(await assetLinks.json()).toEqual([expect.objectContaining({
      target: expect.objectContaining({
        package_name: 'app.utopia',
        sha256_cert_fingerprints: ['AA:BB'],
      }),
    })]);

    const apple = await handleRequest(new Request('https://utoia.thetechcruise.com/.well-known/apple-app-site-association'), env);
    expect(await apple.json()).toMatchObject({
      applinks: { details: [{ appID: 'TEAMID.app.utopia', paths: ['/install*'] }] },
    });
  });

  it('serves only well-formed extension trust metadata', async () => {
    const env = fakeEnv();
    await env.PACKAGES.put('registry/trust/extension-root.json', JSON.stringify({
      schemaVersion: 'utopia.extension-trust-root.v1',
      version: 12,
      expires: '2026-08-01T00:00:00.000Z',
      rootKeyId: 'root-key',
      delegatedPublishers: [{ publisherId: 'io.utopia', extensionIdPatterns: ['io.utopia.*'], delegatedSigningKeyIds: ['lane-b-key'] }],
    }));
    await env.PACKAGES.put('registry/trust/extension-targets-io.utopia.json', JSON.stringify({
      schemaVersion: 'utopia.extension-trust-targets.v1',
      publisherId: 'io.utopia',
      version: 4,
      expires: '2026-08-01T00:00:00.000Z',
      delegatedSigningKeyIds: ['lane-b-key'],
    }));

    const root = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/root'), env);
    expect(root.status).toBe(200);
    expect(await root.json()).toMatchObject({ schemaVersion: 'utopia.extension-trust-root.v1' });

    const targets = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/targets?publisher=io.utopia'), env);
    expect(targets.status).toBe(200);
    expect(await targets.json()).toMatchObject({ schemaVersion: 'utopia.extension-trust-targets.v1' });

    await env.PACKAGES.put('registry/trust/extension-root.json', '{ invalid json }');
    const malformed = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/root'), env);
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: 'invalid_trust_metadata_payload' });
  });

  it('rejects malformed trust publisher identifiers', async () => {
    const env = fakeEnv();
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/targets?publisher=../bad::id'), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_trust_targets_publisher' });
  });
});

function fakeEnv(overrides: Partial<UtopiaRegistryEnv> = {}): UtopiaRegistryEnv & { analytics: unknown[] } {
  const objects = new Map<string, string>();
  const analytics: unknown[] = [];
  return {
    PUBLISHER_TOKEN: testToken,
    REGISTRY_WRITE_MODE: 'signed',
    REGISTRY_PUBLISHER_KEYS_JSON: JSON.stringify({ [testSigningKeyId]: testSigningPublicKey }),
    REGISTRY_HOST: 'utoia.thetechcruise.com',
    ANDROID_PACKAGE_NAME: 'app.utopia',
    PACKAGES: {
      async put(key, value) {
        objects.set(key, value);
      },
      async get(key) {
        const value = objects.get(key);
        return value ? { async text() { return value; } } : null;
      },
    },
    TELEMETRY: {
      writeDataPoint(point) {
        analytics.push(point);
      },
    },
    analytics,
    ...overrides,
  };
}

async function signedPublishBody(
  pkg: object,
  overrides: Partial<{ source: 'custom_gpt' | 'github_factory' | 'browser_builder' | 'registry'; visibility: 'public' | 'unlisted'; publish: boolean }> = {},
) {
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    testSigningPrivateKey,
    new TextEncoder().encode(canonicalJson(pkg)),
  );
  return {
    package: pkg,
    source: overrides.source ?? 'custom_gpt',
    ...overrides,
    signature: {
      algorithm: 'ecdsa-p256-sha256' as const,
      keyId: testSigningKeyId,
      value: Buffer.from(signature).toString('base64'),
      signedAt: new Date().toISOString(),
    },
  };
}
