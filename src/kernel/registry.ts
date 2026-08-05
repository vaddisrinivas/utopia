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

export async function checksum(value: unknown): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonicalize(value));
  return `sha256:${digest}`;
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

export async function trustPublisher(publisher: string, publicKey: string) {
  z.string().regex(/^[a-f0-9]{64}$/).parse(publicKey);
  await storage.setItem(`utopia:publisher:${publisher}`, publicKey);
}

export async function install(entry: RegistryEntry): Promise<AppPackage> {
  const value = await json(entry.url);
  if (await checksum(value) !== entry.checksum) throw new Error('Package checksum mismatch');
  const publicKey = await storage.getItem(`utopia:publisher:${entry.publisher}`);
  if (!publicKey) throw new Error(`Publisher not trusted: ${entry.publisher}`);
  ed.hashes.sha512Async = async (message) => new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA512, Uint8Array.from(message)));
  const valid = await ed.verifyAsync(ed.etc.hexToBytes(entry.signature), new TextEncoder().encode(canonicalize(value)), ed.etc.hexToBytes(publicKey), { zip215: false });
  if (!valid) throw new Error('Package signature mismatch');
  const pkg = parsePackage(value);
  if (pkg.id !== entry.id) throw new Error('Package identity mismatch');
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
