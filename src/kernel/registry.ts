import * as Crypto from 'expo-crypto';
import * as ed from '@noble/ed25519';
import { canonicalize } from 'json-canonicalize';
import { z } from 'zod';

import { parsePackage, type AppPackage } from './schema';
import storage from './storage';

const HttpsUrl = z.string().url().refine((url) => new URL(url).protocol === 'https:', 'HTTPS required');
const Entry = z.object({
  id: z.string().min(1),
  url: HttpsUrl,
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  publisher: z.string().min(1),
  signature: z.string().regex(/^[a-f0-9]{128}$/),
});
const Registry = z.object({ schemaVersion: z.literal('utopia.registry.v1'), packages: z.array(Entry) });
export type RegistryEntry = z.infer<typeof Entry>;
const Trust = z.object({
  keys: z.array(z.object({
    publicKey: z.string().regex(/^[a-f0-9]{64}$/),
    validFrom: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().optional(),
  })),
  rollbackFloor: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).default('0.0.0'),
  capabilities: z.array(z.string()).default([]),
});
type TrustPolicy = { expiresAt?: string; rollbackFloor?: string; capabilities?: string[] };

export async function checksum(value: unknown): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonicalize(value));
  return `sha256:${digest}`;
}

export async function contractChecksum(pkg: AppPackage): Promise<string> {
  const { contractLock, ...body } = pkg;
  return checksum({ ...body, contractLock: {
    schemaVersion: contractLock.schemaVersion,
    algorithm: contractLock.algorithm,
    pinnedAt: contractLock.pinnedAt,
  } });
}

async function json(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function loadRegistry(url: string): Promise<RegistryEntry[]> {
  HttpsUrl.parse(url);
  return Registry.parse(await json(url)).packages;
}

export async function trustPublisher(publisher: string, publicKey: string, policy: TrustPolicy = {}) {
  const key = z.string().regex(/^[a-f0-9]{64}$/).parse(publicKey);
  const storageKey = `utopia:publisher:${publisher}`;
  const previous = await storage.getItem(storageKey);
  const trust = previous ? Trust.parse(JSON.parse(previous)) : Trust.parse({ keys: [] });
  const now = new Date();
  const expiresAt = policy.expiresAt ?? new Date(now.getTime() + 365 * 864e5).toISOString();
  if (new Date(expiresAt) <= now) throw new Error('Publisher key expiry must be future');
  trust.keys = trust.keys.filter((item) => item.publicKey !== key);
  trust.keys.push({ publicKey: key, validFrom: now.toISOString(), expiresAt });
  if (policy.rollbackFloor) trust.rollbackFloor = policy.rollbackFloor;
  if (policy.capabilities) trust.capabilities = [...new Set(policy.capabilities)].sort();
  await storage.setItem(storageKey, JSON.stringify(Trust.parse(trust)));
}

export async function revokePublisherKey(publisher: string, publicKey: string) {
  const storageKey = `utopia:publisher:${publisher}`;
  const value = await storage.getItem(storageKey);
  if (!value) throw new Error(`Publisher not trusted: ${publisher}`);
  const trust = Trust.parse(JSON.parse(value));
  const key = trust.keys.find((item) => item.publicKey === publicKey);
  if (!key) throw new Error('Publisher key not trusted');
  key.revokedAt = new Date().toISOString();
  await storage.setItem(storageKey, JSON.stringify(trust));
}

export async function install(entry: RegistryEntry): Promise<AppPackage> {
  entry = Entry.parse(entry);
  const value = await json(entry.url);
  if (await checksum(value) !== entry.checksum) throw new Error('Package checksum mismatch');
  const storedTrust = await storage.getItem(`utopia:publisher:${entry.publisher}`);
  if (!storedTrust) throw new Error(`Publisher not trusted: ${entry.publisher}`);
  const trust = Trust.parse(JSON.parse(storedTrust));
  const now = Date.now();
  const keys = trust.keys.filter((key) => !key.revokedAt && Date.parse(key.validFrom) <= now && Date.parse(key.expiresAt) > now);
  if (!keys.length) throw new Error('Publisher has no active signing key');
  ed.hashes.sha512Async = async (message) => new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA512, Uint8Array.from(message)));
  const valid = (await Promise.all(keys.map((key) => ed.verifyAsync(
    ed.etc.hexToBytes(entry.signature),
    new TextEncoder().encode(canonicalize(value)),
    ed.etc.hexToBytes(key.publicKey),
    { zip215: false },
  )))).some(Boolean);
  if (!valid) throw new Error('Package signature mismatch');
  const pkg = parsePackage(value);
  if (pkg.id !== entry.id) throw new Error('Package identity mismatch');
  if (await contractChecksum(pkg) !== pkg.contractLock.checksum) throw new Error('Package contract lock mismatch');
  if (pkg.version.localeCompare(trust.rollbackFloor, undefined, { numeric: true }) < 0) throw new Error('Package below rollback floor');
  const requested = [
    ...pkg.capabilities,
    ...pkg.nativeCapabilities.packages.map((item) => `native:${item}`),
    ...(pkg.nativeCapabilities.permissions ?? []).map((item) => `permission:${canonicalize(item)}`),
  ];
  const denied = requested.filter((item) => !trust.capabilities.includes(item));
  if (denied.length) throw new Error(`Capability approval required: ${denied.join(', ')}`);
  const key = `utopia:package:${pkg.id}`;
  const previous = await storage.getItem(key);
  if (previous) await storage.setItem(`${key}:previous`, previous);
  await storage.setItem(key, JSON.stringify(pkg));
  return pkg;
}

export async function installedPackage(id: string): Promise<AppPackage | undefined> {
  const value = await storage.getItem(`utopia:package:${id}`);
  return value ? parsePackage(JSON.parse(value)) : undefined;
}

export async function restorePackage(id: string): Promise<AppPackage | undefined> {
  const key = `utopia:package:${id}`;
  const previous = await storage.getItem(`${key}:previous`);
  if (!previous) return undefined;
  const current = await storage.getItem(key);
  await storage.setItem(key, previous);
  if (current) await storage.setItem(`${key}:previous`, current);
  return parsePackage(JSON.parse(previous));
}

export async function uninstallPackage(id: string): Promise<void> {
  await storage.removeItem(`utopia:package:${id}`);
  await storage.removeItem(`utopia:package:${id}:previous`);
}
