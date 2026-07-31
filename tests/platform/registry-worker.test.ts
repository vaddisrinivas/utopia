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
    expect(response.headers.get('access-control-allow-headers')).not.toContain('x-utopia-admin-token');
  });

  it('does not expose admin endpoints through cross-origin preflight', async () => {
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/admin/publications/reconcile', {
      method: 'OPTIONS',
    }), fakeEnv());

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-headers')).toBeNull();
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });

  it('applies strict install-page security headers and rejects credential-bearing targets', async () => {
    const env = fakeEnv();
    const published = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(validPackage)),
    }), env);
    const packageUrl = (await published.json() as { package_url: string }).package_url;
    const valid = await handleRequest(new Request(
      `https://utoia.thetechcruise.com/install?url=${encodeURIComponent(packageUrl)}`,
    ), env);

    expect(valid.status).toBe(200);
    expect(valid.headers.get('cache-control')).toBe('no-store');
    expect(valid.headers.get('content-security-policy')).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; font-src 'none'; style-src 'unsafe-inline'",
    );
    expect(valid.headers.get('x-frame-options')).toBe('DENY');
    expect(valid.headers.get('referrer-policy')).toBe('no-referrer');
    expect(valid.headers.get('permissions-policy')).toContain('microphone=()');
    expect(valid.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(valid.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(await valid.text()).toContain('utopia://install?url=');

    const secret = 'do-not-echo-this-token';
    const rejected = await handleRequest(new Request(
      `https://utoia.thetechcruise.com/install?url=${encodeURIComponent(`${packageUrl}?access_token=${secret}`)}`,
    ), env);
    expect(rejected.status).toBe(400);
    const rejectedBody = await rejected.text();
    expect(rejectedBody).toBe('<h1>Utopia install link is invalid</h1>');
    expect(rejectedBody).not.toContain(secret);

    const extraQuery = await handleRequest(new Request(
      `https://utoia.thetechcruise.com/install?url=${encodeURIComponent(packageUrl)}&token=${secret}`,
    ), env);
    expect(extraQuery.status).toBe(400);
    expect(await extraQuery.text()).not.toContain(secret);
  });

  it('keeps public API CORS credential-free and separates cache classes', async () => {
    const env = fakeEnv();
    const manifest = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/registry.json'), env);
    expect(manifest.headers.get('access-control-allow-origin')).toBe('*');
    expect(manifest.headers.get('access-control-allow-credentials')).toBeNull();
    expect(manifest.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(manifest.headers.get('cache-control')).toBe('no-store');

    const health = await handleRequest(new Request('https://utoia.thetechcruise.com/health'), env);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(await health.text()).not.toContain(testToken);
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
    expect(packageResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await packageResponse.json()).toMatchObject({ id: 'launch-demo' });

    const metadataResponse = await handleRequest(new Request(`https://utoia.thetechcruise.com/v1/packages/${payload.id}`), env);
    expect(metadataResponse.status).toBe(200);
    const metadata = await metadataResponse.json();
    expect(metadata).toMatchObject({
      visibility: 'unlisted',
      labels: ['generated', 'unlisted'],
    });

  });

  it('does not derive public package URLs from private request or registry hosts', async () => {
    const env = fakeEnv({ REGISTRY_HOST: '127.0.0.1:8787' });
    const response = await handleRequest(new Request('http://127.0.0.1:8787/v1/packages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(await signedPublishBody({ ...validPackage, id: 'public-url-check' })),
    }), env);
    const payload = await response.json() as Record<string, string>;

    expect(response.status).toBe(201);
    expect(payload.package_url).toMatch(/^https:\/\/utoia\.thetechcruise\.com\/p\//);
    expect(payload.package_url).not.toContain('127.0.0.1');
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

  it('propagates registry signature metadata into public install descriptors', async () => {
    const env = fakeEnv({ REGISTRY_PUBLIC_WRITES_ENABLED: 'true' });
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(await signedPublishBody(validPackage, { visibility: 'public' })),
    }), env);

    expect(response.status).toBe(201);
    const manifestResponse = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/registry.json'), env);
    expect(manifestResponse.status).toBe(200);
    const manifest = await manifestResponse.json() as { packages: Array<{ signature?: unknown }> };
    expect(manifest.packages[0]?.signature).toMatchObject({
      algorithm: 'ecdsa-p256-sha256',
      keyId: testSigningKeyId,
    });
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

  it('rejects public writes unless the public lane is explicitly enabled', async () => {
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(validPackage, { visibility: 'public' })),
    }), fakeEnv());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'registry_public_writes_disabled' });
    const manifest = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/registry.json'), fakeEnv());
    expect(await manifest.json()).toMatchObject({ packages: [] });
  });

  it('rejects immutable republish attempts with lifecycle mismatch', async () => {
    const env = fakeEnv({ REGISTRY_PUBLIC_WRITES_ENABLED: 'true' });
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
        providerTemplateFields: { apiKey: 'sk-live-1234567890abcdef1234567890' },
      },
    };
    const rejected = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(secretPackage)),
    }), env);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: expect.stringContaining('package_secret_content:$.presentation.providerTemplateFields.apiKey') });
  });

  it('does not serve staged objects without the final publication marker', async () => {
    const env = fakeEnv();
    const published = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(validPackage)),
    }), env);
    const payload = await published.json() as { id: string };
    await env.PACKAGES.put(`registry/publications/${payload.id}.json`, '{}');

    const blob = await handleRequest(new Request(`https://utoia.thetechcruise.com/p/${payload.id}.json`), env);
    expect(blob.status).toBe(400);
    expect(await blob.json()).toMatchObject({ error: 'package_publication_incomplete' });
  });

  it('records failed publication state and allows a safe retry', async () => {
    const id = sha256Canonical(validPackage).replace('sha256:', '').slice(0, 16);
    const env = fakeEnv({}, { failOnceKey: `registry/packages/${id}.json` });
    const body = await signedPublishBody(validPackage);
    const request = () => handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env);

    const failed = await request();
    expect(failed.status).toBe(400);
    const publication = await env.PACKAGES.get(`registry/publications/${id}.json`);
    expect(JSON.parse(await publication!.text())).toMatchObject({ state: 'failed' });

    const retried = await request();
    expect(retried.status).toBe(201);
    const completed = await env.PACKAGES.get(`registry/publications/${id}.json`);
    expect(JSON.parse(await completed!.text())).toMatchObject({ state: 'complete' });
  });

  it('keeps failed publications invisible through metadata, blob, manifest, and install links', async () => {
    const id = sha256Canonical(validPackage).replace('sha256:', '').slice(0, 16);
    const env = fakeEnv({}, { failOnceKey: `registry/packages/${id}.json` });
    const failed = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(validPackage)),
    }), env);
    expect(failed.status).toBe(400);

    const metadata = await handleRequest(new Request(`https://utoia.thetechcruise.com/v1/packages/${id}`), env);
    expect(metadata.status).toBe(404);
    expect(await metadata.json()).toMatchObject({ error: 'package_not_found' });
    const blob = await handleRequest(new Request(`https://utoia.thetechcruise.com/p/${id}.json`), env);
    expect(blob.status).toBe(404);
    const install = await handleRequest(new Request(`https://utoia.thetechcruise.com/install?url=${encodeURIComponent(`https://utoia.thetechcruise.com/p/${id}.json`)}`), env);
    expect(install.status).toBe(404);
    expect(await (await handleRequest(new Request('https://utoia.thetechcruise.com/v1/registry.json'), env)).json()).toMatchObject({ packages: [] });
  });

  it('rejects a concurrent conflicting reservation and leaves one complete publication', async () => {
    const env = fakeEnv({}, { putDelayMs: 2 });
    const body = await signedPublishBody(validPackage);
    const request = () => handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env);

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
    const loser = responses.find((response) => response.status === 400);
    expect(await loser?.json()).toMatchObject({
      error: expect.stringMatching(/package_publication_(?:in_progress|conflict|already_complete)/),
    });
    const id = sha256Canonical(validPackage).replace('sha256:', '').slice(0, 16);
    const publication = await env.PACKAGES.get(`registry/publications/${id}.json`);
    expect(JSON.parse(await publication!.text())).toMatchObject({ state: 'complete' });
  });

  it('keeps reconciliation and GC admin-protected', async () => {
    const env = fakeEnv({}, { failOnceKey: `registry/packages/${sha256Canonical(validPackage).replace('sha256:', '').slice(0, 16)}.json` });
    const failed = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(validPackage)),
    }), env);
    expect(failed.status).toBe(400);
    const id = sha256Canonical(validPackage).replace('sha256:', '').slice(0, 16);
    const unauthorized = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/admin/publications/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, action: 'gc' }),
    }), env);
    expect(unauthorized.status).toBe(400);
    expect(await unauthorized.json()).toMatchObject({ error: 'registry_admin_token_not_configured_or_too_short' });

    const authorized = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/admin/publications/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-utopia-admin-token': testToken },
      body: JSON.stringify({ id, action: 'gc' }),
    }), { ...env, REGISTRY_ADMIN_TOKEN: testToken });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ id, state: 'deleted', action: 'gc' });
    expect(await env.PACKAGES.get(`registry/publications/${id}.json`)).toBeNull();
  });

  it('rejects signature replay for unknown package metadata', async () => {
    const env = fakeEnv();
    const body = await signedPublishBody(validPackage);
    const packageChecksum = sha256Canonical(body.package as object);
    const replayDigest = sha256Canonical({
      checksum: packageChecksum,
      signature: body.signature,
    });
    await env.PACKAGES.put(`registry/replay/${encodeURIComponent(testSigningKeyId)}/${replayDigest}.json`, '{}');

    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'package_signature_replayed' });
  });

  it('rejects a published blob whose canonical checksum changed', async () => {
    const env = fakeEnv();
    const published = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(validPackage)),
    }), env);
    const payload = await published.json() as { id: string };
    await env.PACKAGES.put(`packages/${payload.id}.json`, JSON.stringify({ ...validPackage, version: '2.0.0' }));

    const blob = await handleRequest(new Request(`https://utoia.thetechcruise.com/p/${payload.id}.json`), env);
    expect(blob.status).toBe(400);
    expect(await blob.json()).toMatchObject({ error: 'package_checksum_mismatch' });
  });

  it('does not reject a secret-named field when its bounded content is harmless', async () => {
    const env = fakeEnv();
    const packageWithPlaceholder = {
      ...validPackage,
      presentation: {
        ...validPackage.presentation,
        providerTemplateFields: { apiKey: 'placeholder' },
      },
    };
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(await signedPublishBody(packageWithPlaceholder)),
    }), env);
    expect(response.status).toBe(201);
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

  it('rejects oversize trust publisher identifiers', async () => {
    const env = fakeEnv();
    const response = await handleRequest(new Request(
      `https://utoia.thetechcruise.com/v1/trust/extension/targets?publisher=${'io'.padEnd(70, '.')}utopia`,
      { method: 'GET' },
    ), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_trust_targets_publisher' });
  });

  it('rejects expired trust metadata before serving it', async () => {
    const env = fakeEnv();
    await env.PACKAGES.put('registry/trust/extension-root.json', JSON.stringify({
      schemaVersion: 'utopia.extension-trust-root.v1',
      version: 12,
      expires: '2026-07-29T00:00:00.000Z',
      rootKeyId: 'root-key',
      delegatedPublishers: [{ publisherId: 'io.utopia', extensionIdPatterns: ['io.utopia.*'], delegatedSigningKeyIds: ['publisher-key'] }],
    }));

    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/root'), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_trust_root_metadata:expired' });
  });

  it('requires a version bump when the trust root key rotates', async () => {
    const env = fakeEnv();
    const rootKey = (version: number, rootKeyId: string) => JSON.stringify({
      schemaVersion: 'utopia.extension-trust-root.v1',
      version,
      expires: '2026-08-01T00:00:00.000Z',
      rootKeyId,
      delegatedPublishers: [{ publisherId: 'io.utopia', extensionIdPatterns: ['io.utopia.*'], delegatedSigningKeyIds: ['publisher-key'] }],
    });
    await env.PACKAGES.put('registry/trust/extension-root.json', rootKey(12, 'root-key'));
    expect((await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/root'), env)).status).toBe(200);

    await env.PACKAGES.put('registry/trust/extension-root.json', rootKey(12, 'rotated-root-key'));
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/root'), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_trust_root_metadata:root_rotation_without_version_bump' });
  });

  it('rejects target metadata rollback after a newer version was observed', async () => {
    const env = fakeEnv();
    const targets = (version: number) => JSON.stringify({
      schemaVersion: 'utopia.extension-trust-targets.v1',
      publisherId: 'io.utopia',
      version,
      expires: '2026-08-01T00:00:00.000Z',
      delegatedSigningKeyIds: ['lane-b-key'],
    });
    await env.PACKAGES.put('registry/trust/extension-targets-io.utopia.json', targets(4));
    expect((await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/targets?publisher=io.utopia'), env)).status).toBe(200);

    await env.PACKAGES.put('registry/trust/extension-targets-io.utopia.json', targets(3));
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/targets?publisher=io.utopia'), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_trust_targets_metadata:version_rollback' });
  });

  it('rejects same-version trust metadata rewrites', async () => {
    const env = fakeEnv();
    const root = (delegatedKey: string) => JSON.stringify({
      schemaVersion: 'utopia.extension-trust-root.v1',
      version: 12,
      expires: '2026-08-01T00:00:00.000Z',
      rootKeyId: 'root-key',
      delegatedPublishers: [{ publisherId: 'io.utopia', extensionIdPatterns: ['io.utopia.*'], delegatedSigningKeyIds: [delegatedKey] }],
    });
    await env.PACKAGES.put('registry/trust/extension-root.json', root('publisher-key-a'));
    expect((await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/root'), env)).status).toBe(200);

    await env.PACKAGES.put('registry/trust/extension-root.json', root('publisher-key-b'));
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/trust/extension/root'), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_trust_root_metadata:version_rewrite' });
  });
});

function fakeEnv(
  overrides: Partial<UtopiaRegistryEnv> = {},
  behavior: { failOnceKey?: string; putDelayMs?: number } = {},
): UtopiaRegistryEnv & { analytics: unknown[] } {
  const objects = new Map<string, string>();
  const analytics: unknown[] = [];
  let failedKey: string | undefined;
  return {
    PUBLISHER_TOKEN: testToken,
    REGISTRY_WRITE_MODE: 'signed',
    REGISTRY_PUBLISHER_KEYS_JSON: JSON.stringify({ [testSigningKeyId]: testSigningPublicKey }),
    REGISTRY_HOST: 'utoia.thetechcruise.com',
    ANDROID_PACKAGE_NAME: 'app.utopia',
    PACKAGES: {
      async put(key, value) {
        if (behavior.putDelayMs) await new Promise((resolve) => setTimeout(resolve, behavior.putDelayMs));
        if (behavior.failOnceKey === key && failedKey !== key) {
          failedKey = key;
          throw new Error('injected_r2_put_failure');
        }
        objects.set(key, value);
      },
      async get(key) {
        const value = objects.get(key);
        return value ? { async text() { return value; } } : null;
      },
      async delete(key) {
        objects.delete(key);
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
