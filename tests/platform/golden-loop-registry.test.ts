import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { handleRequest, type UtopiaRegistryEnv } from '@/cloudflare/utopia-registry-worker';
import {
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
  parsePackageInstallTarget,
} from '@/packages/shared/contracts/package-install';
import { sha256Canonical, canonicalJson } from '@/packages/shared/contracts/canonical-json';
import {
  getActiveAppPackage,
  installApprovedAppPackage,
  rollbackAppPackage,
} from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const testToken = 'test-token-'.padEnd(120, 'x');
const testSigningKeyId = 'utopia-test-publisher';
let testSigningPrivateKey: CryptoKey;
let testSigningPublicKey: string;

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
    schemaVersion: 'a2ui.v0_9',
    defaultScreen: 'home',
    screens: {
      home: {
        title: 'Launch Demo',
        components: [{ kind: 'widget', widget: 'recordList', props: { collection: 'task' } }],
      },
    },
  },
  rules: [],
  capabilities: [],
  acceptanceTests: ['launch-demo'],
  dependencyPins: [],
  nativeCapabilities: {
    schemaVersion: 'wonder.app-package-native-capabilities.v1',
    platform: 'expo',
    packages: [],
  },
  contractLock: {
    schemaVersion: 'wonder.package-contract-lock.v1',
    algorithm: 'sha256',
    pinnedAt: '2026-07-29T00:00:00.000Z',
    dependencyPins: [],
    nativeCapabilities: {
      schemaVersion: 'wonder.app-package-native-capabilities.v1',
      platform: 'expo',
      packages: [],
    },
    checksum: sha256Canonical({
      schemaVersion: 'wonder.package-contract-lock.v1',
      algorithm: 'sha256',
      pinnedAt: '2026-07-29T00:00:00.000Z',
      dependencyPins: [],
      nativeCapabilities: {
        schemaVersion: 'wonder.app-package-native-capabilities.v1',
        platform: 'expo',
        packages: [],
      },
    }),
  },
};

beforeAll(async () => {
  const keys = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  testSigningPrivateKey = keys.privateKey;
  testSigningPublicKey = Buffer.from(await globalThis.crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64');
});

describe('Golden Loop registry contracts', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('requires signed admission and returns install-links', async () => {
    const env = fakeEnv();
    const body = await signedPublishBody(validPackage);
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env);
    const payload = await response.json() as { id: string; checksum: string; install_url: string; web_url: string; package_url: string };

    expect(response.status).toBe(201);
    expect(payload.install_url).toMatch(/^utopia:\/\/install\?url=/);
    expect(payload.web_url).toMatch(/^https:\/\/utoia\.thetechcruise\.com\/install\?url=/);
    expect(payload.package_url).toMatch(/^https:\/\/utoia\.thetechcruise\.com\/p\/[a-f0-9]{16}\.json$/);
    expect(payload.web_url).toBe(`https://utoia.thetechcruise.com/install?url=${encodeURIComponent(payload.package_url)}`);
    expect(payload.checksum).toBe(sha256Canonical(validPackage));
    const parsed = parsePackageInstallTarget(payload.install_url);
    expect(parsed.source).toBe('deep_link');
    expect(parsed.packageUrl).toBe(payload.package_url);
  });

  it('accepts idempotent republish and enforces immutable metadata', async () => {
    const env = fakeEnv();
    const first = await publishPackage(env, validPackage);
    const second = await publishPackage(env, validPackage);
    const third = await publishPackage(env, validPackage, { visibility: 'public' });

    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(200);
    expect(second.payload).toMatchObject({
      id: first.payload.id,
      checksum: first.payload.checksum,
      visibility: 'unlisted',
    });
    expect(second.payload.package_url).toBe(first.payload.package_url);
    expect(third.payload.error).toBe('package_metadata_immutable');
  });

  it('rejects publish while staging writes are disabled', async () => {
    const env = fakeEnv({ REGISTRY_WRITE_MODE: 'disabled' });
    const published = await publishPackage(env, validPackage);

    expect(published.response.status).toBe(400);
    expect(published.payload).toMatchObject({ error: 'registry_writes_disabled' });
  });

  it('detects tamper in registry metadata, and refuses replayed/rolled-back install without history', async () => {
    const env = fakeEnv();
    const published = await publishPackage(env, validPackage);
    const metadata = published.payload.id;

    await env.PACKAGES.put(`registry/packages/${metadata}.json`, '{ invalid json }');
    const metadataResponse = await handleRequest(new Request(`https://utoia.thetechcruise.com/v1/packages/${metadata}`), env);
    expect(metadataResponse.status).toBe(400);
    expect(await metadataResponse.json()).toMatchObject({ error: expect.any(String) });

    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as never);
    const preview = buildPackageInstallPreview(validPackage, {
      sourceUrl: `https://utoia.thetechcruise.com/p/${metadata}.json`,
    });
    const approval = buildPackageInstallApprovalReceipt(preview, 'golden-loop-user', '2026-07-30T00:00:00.000Z');
    await installApprovedAppPackage(db as never, {
      packageJson: validPackage,
      preview,
      approval,
      installationId: 'golden-loop-registry',
      now: '2026-07-30T00:00:01.000Z',
    });
    const rolledBack = await rollbackAppPackage(db as never, 'golden-loop-registry');
    const active = await getActiveAppPackage(db as never, 'golden-loop-registry');
    expect(rolledBack).toBeNull();
    expect(active?.version).toBe('1.0.0');
  });

  it('rejects replayed signed payloads outside freshness window', async () => {
    const env = fakeEnv();
    const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const body = await signedPublishBody(validPackage, { signatureSignedAt: staleAt });
    const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
      method: 'POST',
      headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'package_signature_expired' });
  });
});

async function publishPackage(
  env: UtopiaRegistryEnv,
  pkg: object,
  overrides: Partial<{ visibility: 'public' | 'unlisted' }> = {},
) {
  const body = await signedPublishBody(pkg, overrides);
  const response = await handleRequest(new Request('https://utoia.thetechcruise.com/v1/packages', {
    method: 'POST',
    headers: { authorization: `Bearer ${testToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
  const payload = await response.json() as {
    id: string;
    checksum: string;
    visibility: 'public' | 'unlisted';
    install_url: string;
    web_url: string;
    package_url: string;
    error?: string;
  };
  return { response, body, payload };
}

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
  overrides: Partial<{
    source: 'custom_gpt' | 'github_factory' | 'browser_builder' | 'registry';
    visibility: 'public' | 'unlisted';
    signatureSignedAt: string;
  }> = {},
) {
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    testSigningPrivateKey,
    new TextEncoder().encode(canonicalJson(pkg)),
  );
  return {
    package: pkg,
    source: overrides.source ?? 'custom_gpt',
    visibility: overrides.visibility,
    signature: {
      algorithm: 'ecdsa-p256-sha256' as const,
      keyId: testSigningKeyId,
      value: Buffer.from(signature).toString('base64'),
      signedAt: overrides.signatureSignedAt ?? new Date().toISOString(),
    },
  };
}
