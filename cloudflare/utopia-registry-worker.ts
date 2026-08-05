import * as ed from '@noble/ed25519';
import { canonicalize } from 'json-canonicalize';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';

import { PackageSchema } from '../src/kernel/schema';

type R2Object = { text(): Promise<string> };
type R2Bucket = {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType: string } }): Promise<unknown>;
};

export type UtopiaRegistryEnv = {
  PACKAGES: R2Bucket;
  REGISTRY_HOST?: string;
  REGISTRY_WRITE_MODE?: 'disabled' | 'signed';
  REGISTRY_PUBLISHER_KEYS_JSON?: string;
};

const Entry = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  publisher: z.string().min(1),
  signature: z.string().regex(/^[a-f0-9]{128}$/),
}).strict();
const Manifest = z.object({
  schemaVersion: z.literal('utopia.registry.v1'),
  packages: z.array(Entry),
}).strict();
const Publish = z.object({
  package: PackageSchema,
  publisher: z.string().regex(/^[a-z0-9_.-]{1,64}$/i),
  signature: z.string().regex(/^[a-f0-9]{128}$/),
}).strict();
const MAX_PACKAGE_BYTES = 256 * 1024;
const INDEX = 'registry/index.json';
const secret = /(?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|password|private[_-]?key|refresh[_-]?token|session[_-]?token)/i;

const app = new Hono<{ Bindings: UtopiaRegistryEnv }>();
app.use('*', secureHeaders());
app.use('/v1/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));
app.use('/p/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));

app.get('/health', (context) => context.json({ ok: true, service: 'utopia-registry-v3' }));

app.get('/v1/registry.json', async (context) => {
  return context.json(await readManifest(context.env.PACKAGES));
});

app.get('/v1/packages/:id', async (context) => {
  const manifest = await readManifest(context.env.PACKAGES);
  const entry = manifest.packages.find(({ id }) => id === context.req.param('id'));
  return entry ? context.json(entry) : context.json({ error: 'package_not_found' }, 404);
});

app.get('/p/:file', async (context) => {
  const digest = (context.req.param('file') ?? '').replace(/\.json$/, '');
  if (!/^[a-f0-9]{64}$/.test(digest)) return context.json({ error: 'invalid_digest' }, 400);
  const object = await context.env.PACKAGES.get(`packages/${digest}.json`);
  if (!object) return context.json({ error: 'package_not_found' }, 404);
  return context.body(await object.text(), 200, { 'content-type': 'application/json; charset=utf-8' });
});

app.post('/v1/packages', async (context) => {
  if (context.env.REGISTRY_WRITE_MODE !== 'signed') return context.json({ error: 'registry_writes_disabled' }, 403);
  const length = Number(context.req.header('content-length') ?? 0);
  if (length > MAX_PACKAGE_BYTES) return context.json({ error: 'package_too_large' }, 413);
  const raw = await context.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_PACKAGE_BYTES) return context.json({ error: 'package_too_large' }, 413);

  const published = Publish.parse(JSON.parse(raw));
  rejectSecrets(published.package);
  const canonical = canonicalize(published.package);
  const digest = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  const publicKey = publisherKeys(context.env)[published.publisher];
  if (!publicKey) return context.json({ error: 'publisher_not_trusted' }, 403);

  ed.hashes.sha512Async = async (message) => new Uint8Array(await crypto.subtle.digest('SHA-512', message as BufferSource));
  const valid = await ed.verifyAsync(
    ed.etc.hexToBytes(published.signature),
    new TextEncoder().encode(canonical),
    ed.etc.hexToBytes(publicKey),
    { zip215: false },
  );
  if (!valid) return context.json({ error: 'signature_invalid' }, 403);

  const host = context.env.REGISTRY_HOST?.trim() || new URL(context.req.url).host;
  const entry = Entry.parse({
    id: published.package.id,
    url: `https://${host}/p/${digest}.json`,
    checksum: `sha256:${digest}`,
    publisher: published.publisher,
    signature: published.signature,
  });
  await context.env.PACKAGES.put(`packages/${digest}.json`, canonical, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  const manifest = await readManifest(context.env.PACKAGES);
  manifest.packages = [...manifest.packages.filter(({ id }) => id !== entry.id), entry]
    .sort((left, right) => left.id.localeCompare(right.id));
  await context.env.PACKAGES.put(INDEX, JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return context.json(entry, 201);
});

app.onError((error, context) => {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return context.json({ error: 'invalid_request' }, 400);
  }
  console.error(error instanceof Error ? error.message : 'registry_error');
  return context.json({ error: 'registry_error' }, 500);
});

export async function handleRequest(request: Request, env: UtopiaRegistryEnv): Promise<Response> {
  return app.fetch(request, env);
}

export default { fetch: handleRequest };

async function readManifest(bucket: R2Bucket): Promise<z.infer<typeof Manifest>> {
  const object = await bucket.get(INDEX);
  return object ? Manifest.parse(JSON.parse(await object.text())) : { schemaVersion: 'utopia.registry.v1', packages: [] };
}

function publisherKeys(env: UtopiaRegistryEnv): Record<string, string> {
  const keys = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
    .parse(JSON.parse(env.REGISTRY_PUBLISHER_KEYS_JSON ?? '{}'));
  return keys;
}

function rejectSecrets(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error('package_too_deep');
  if (Array.isArray(value)) return value.forEach((item) => rejectSecrets(item, depth + 1));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (secret.test(key)) throw new Error('package_contains_secret');
    rejectSecrets(child, depth + 1);
  }
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
