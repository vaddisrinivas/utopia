import { createHash } from 'node:crypto';

import * as ed from '@noble/ed25519';
import { canonicalize } from 'json-canonicalize';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checksum, contractChecksum, install, installedPackage, restorePackage, revokePublisherKey, trustPublisher, uninstallPackage } from '@/src/kernel/registry';

import { fixtureActivePackage } from './v3-fixtures';

const storage = new Map<string, string>();
const publisher = 'test-publisher';
const secretKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

vi.mock('expo-sqlite/kv-store', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
  },
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256', SHA512: 'SHA-512' },
  digestStringAsync: async (_algorithm: string, value: string) => createHash('sha256').update(value).digest('hex'),
  digest: async (_algorithm: string, value: Uint8Array) => {
    const digest = createHash('sha512').update(value).digest();
    return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
  },
}));

ed.hashes.sha512Async = async (message) => new Uint8Array(createHash('sha512').update(message).digest());

beforeEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});

async function signedEntry(value: unknown, overrides: Record<string, unknown> = {}) {
  const pkg = value as ReturnType<typeof fixtureActivePackage>;
  pkg.contractLock.checksum = await contractChecksum(pkg);
  const message = new TextEncoder().encode(canonicalize(value));
  const signature = await ed.signAsync(message, secretKey);
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  return {
    id: (value as { id: string }).id,
    url: 'https://example.com/package.json',
    checksum: await checksum(value),
    publisher,
    signature: ed.etc.bytesToHex(signature),
    publicKey: ed.etc.bytesToHex(publicKey),
    ...overrides,
  };
}

async function trust(value: ReturnType<typeof fixtureActivePackage>, publicKey: string, overrides = {}) {
  await trustPublisher(publisher, publicKey, {
    capabilities: [
      ...value.capabilities,
      ...value.nativeCapabilities.packages.map((item) => `native:${item}`),
      ...(value.nativeCapabilities.permissions ?? []).map((item) => `permission:${canonicalize(item)}`),
    ],
    ...overrides,
  });
}

describe('signed remote registry trust', () => {
  const value = fixtureActivePackage();

  it('rejects a package whose checksum does not match', async () => {
    const entry = await signedEntry(value, { checksum: `sha256:${'0'.repeat(64)}` });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })));

    await expect(install(entry)).rejects.toThrow('Package checksum mismatch');
  });

  it('rejects a valid package from an untrusted publisher', async () => {
    const entry = await signedEntry(value);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })));

    await expect(install(entry)).rejects.toThrow('Publisher not trusted: test-publisher');
  });

  it('rejects a package with an invalid signature', async () => {
    const entry = await signedEntry(value, { signature: `${'0'.repeat(127)}1` });
    await trust(value, entry.publicKey as string);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })));

    await expect(install(entry)).rejects.toThrow('Package signature mismatch');
  });

  it('installs a package with a matching checksum, trusted publisher, and signature', async () => {
    const entry = await signedEntry(value);
    await trust(value, entry.publicKey as string);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })));

    await expect(install(entry)).resolves.toStrictEqual(value);
  });

  it('updates, restores, and uninstalls without losing the previous package', async () => {
    const value = fixtureActivePackage();
    const next = { ...value, version: '2.0.0' };
    for (const candidate of [value, next]) {
      const entry = await signedEntry(candidate);
      await trust(candidate, entry.publicKey as string);
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(candidate), { status: 200 })));
      await install(entry);
    }
    expect((await installedPackage(value.id))?.version).toBe('2.0.0');
    expect((await restorePackage(value.id))?.version).toBe(value.version);
    await uninstallPackage(value.id);
    expect(await installedPackage(value.id)).toBeUndefined();
  });

  it('rejects tampered locks, rollback, and unapproved capability escalation', async () => {
    const entry = await signedEntry(value);
    await trust(value, entry.publicKey as string, { rollbackFloor: '2.0.0' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })));
    await expect(install(entry)).rejects.toThrow('rollback floor');

    await trust(value, entry.publicKey as string, { rollbackFloor: '0.0.0', capabilities: [] });
    await expect(install(entry)).rejects.toThrow('Capability approval required');

    const tampered = structuredClone(value);
    tampered.presentation.label = 'Tampered';
    const tamperedEntry = await signedEntry(tampered);
    tampered.contractLock.checksum = value.contractLock.checksum;
    tamperedEntry.checksum = await checksum(tampered);
    tamperedEntry.signature = ed.etc.bytesToHex(await ed.signAsync(new TextEncoder().encode(canonicalize(tampered)), secretKey));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(tampered), { status: 200 })));
    await expect(install(tamperedEntry)).rejects.toThrow('contract lock mismatch');
  });

  it('supports key rotation while rejecting expired and revoked keys', async () => {
    const entry = await signedEntry(value);
    await trust(value, entry.publicKey as string);
    await revokePublisherKey(publisher, entry.publicKey as string);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })));
    await expect(install(entry)).rejects.toThrow('no active signing key');

    await expect(trustPublisher(publisher, entry.publicKey as string, {
      expiresAt: '2020-01-01T00:00:00.000Z',
    })).rejects.toThrow('expiry must be future');

    const rotatedSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 2);
    const rotatedKey = ed.etc.bytesToHex(await ed.getPublicKeyAsync(rotatedSecret));
    await trust(value, rotatedKey);
    const rotatedEntry = {
      ...entry,
      signature: ed.etc.bytesToHex(await ed.signAsync(new TextEncoder().encode(canonicalize(value)), rotatedSecret)),
    };
    await expect(install(rotatedEntry)).resolves.toMatchObject({ id: value.id });
  });
});
