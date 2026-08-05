import * as ed from '@noble/ed25519';
import { canonicalize } from 'json-canonicalize';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { PackageSchema } from '../src/kernel/schema';

type R2Bucket = { get(key: string): Promise<{ text(): Promise<string> } | null>; put(key: string, value: string, options?: { httpMetadata?: { contentType: string } }): Promise<unknown> };
export type UtopiaRegistryEnv = { PACKAGES: R2Bucket; REGISTRY_HOST?: string; REGISTRY_WRITE_MODE?: 'disabled' | 'signed'; REGISTRY_PUBLISHER_KEYS_JSON?: string; REGISTRY_WRITE_ALLOWED_ORIGINS?: string };

const env = { INDEX_KEY: 'registry/index.json', MAX_BYTES: 256 * 1024, HEADER: 'content-type' } as const;
const CORS = { read: 'GET,HEAD,OPTIONS', write: 'POST,PUT,PATCH,DELETE,OPTIONS' } as const;
const secretFields = /(?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|password|private[_-]?key|refresh[_-]?token|session[_-]?token)/i;
const origins = (value = '') => value.split(',').map((item) => item.trim()).filter(Boolean);
const isWrite = (method: string) => method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, '0')).join('');

const Entry = z.object({ id: z.string().min(1), url: z.string().url(), checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/), publisher: z.string().min(1), signature: z.string().regex(/^[a-f0-9]{128}$/) }).strict();
const Manifest = z.object({ schemaVersion: z.literal('utopia.registry.v1'), packages: z.array(Entry) }).strict();
const Publish = z.object({ package: PackageSchema, publisher: z.string().regex(/^[a-z0-9_.-]{1,64}$/i), signature: z.string().regex(/^[a-f0-9]{128}$/) }).strict();

const app = new Hono<{ Bindings: UtopiaRegistryEnv }>();
app.use('*', secureHeaders());
app.use('*', async (ctx, next) => {
  const method = ctx.req.method;
  const origin = ctx.req.header('origin');
  if (method === 'OPTIONS') return options(ctx);

  const writeMode = ctx.env.REGISTRY_WRITE_MODE;
  if (isWrite(method) && writeMode === 'signed') {
    const allowed = origins(ctx.env.REGISTRY_WRITE_ALLOWED_ORIGINS);
    if (origin && !allowed.includes(origin)) return jsonError(ctx, 403, 'registry_write_origin_denied');
  }

  await next();
  if (method === 'GET' || method === 'HEAD') {
    ctx.header('access-control-allow-origin', '*');
    ctx.header('access-control-allow-methods', CORS.read);
  } else if (origin) {
    const allowed = origins(ctx.env.REGISTRY_WRITE_ALLOWED_ORIGINS);
    if (writeMode === 'signed' && !allowed.includes(origin)) return;
    ctx.header('access-control-allow-origin', origin);
    ctx.header('access-control-allow-methods', CORS.write);
    ctx.header('access-control-allow-credentials', 'false');
  }

  ctx.header('access-control-allow-headers', env.HEADER);
  ctx.header('vary', 'Origin');
});

app.get('/health', (ctx) => ctx.json({ ok: true, service: 'utopia-registry-v3' }));
app.get('/v1/registry.json', async (ctx) => ctx.json(await loadManifest(ctx.env.PACKAGES)));
app.get('/v1/packages/:id', async (ctx) => {
  const manifest = await loadManifest(ctx.env.PACKAGES);
  const found = manifest.packages.find((entry) => entry.id === ctx.req.param('id'));
  return found ? ctx.json(found) : jsonError(ctx, 404, 'package_not_found');
});
app.get('/p/:file', async (ctx) => {
  const file = ctx.req.param('file').replace(/\.json$/, '');
  if (!/^[a-f0-9]{64}$/.test(file)) return jsonError(ctx, 400, 'invalid_digest');
  const object = await ctx.env.PACKAGES.get(`packages/${file}.json`);
  return object ? ctx.body(await object.text(), 200, { 'content-type': 'application/json; charset=utf-8' }) : jsonError(ctx, 404, 'package_not_found');
});

app.post('/v1/packages', async (ctx) => {
  if (ctx.env.REGISTRY_WRITE_MODE !== 'signed') return jsonError(ctx, 403, 'registry_writes_disabled');
  const body = await ctx.req.text();
  const bytes = new TextEncoder().encode(body);
  if (Number(ctx.req.header('content-length') ?? 0) > env.MAX_BYTES || bytes.byteLength > env.MAX_BYTES) return jsonError(ctx, 413, 'package_too_large');

  const payload = Publish.parse(JSON.parse(body));
  rejectSecrets(payload.package);
  const canonical = canonicalize(payload.package);
  const checksum = `sha256:${hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))}`;
  const publishers = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).parse(JSON.parse(ctx.env.REGISTRY_PUBLISHER_KEYS_JSON ?? '{}'));
  const publicKey = publishers[payload.publisher];
  if (!publicKey) return jsonError(ctx, 403, 'publisher_not_trusted');

  ed.hashes.sha512Async = async (message) => new Uint8Array(await crypto.subtle.digest('SHA-512', message as BufferSource));
  if (!await ed.verifyAsync(ed.etc.hexToBytes(payload.signature), new TextEncoder().encode(canonical), ed.etc.hexToBytes(publicKey), { zip215: false })) {
    return jsonError(ctx, 403, 'signature_invalid');
  }

  const host = ctx.env.REGISTRY_HOST?.trim() || new URL(ctx.req.url).host;
  const manifest = await loadManifest(ctx.env.PACKAGES);
  const entry = Entry.parse({ id: String(payload.package.id), url: `https://${host}/p/${checksum.replace('sha256:', '')}.json`, checksum, publisher: payload.publisher, signature: payload.signature });
  manifest.packages = [...manifest.packages.filter((item) => item.id !== entry.id), entry].sort((left, right) => left.id.localeCompare(right.id));
  await ctx.env.PACKAGES.put(env.INDEX_KEY, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  await ctx.env.PACKAGES.put(`packages/${checksum.replace('sha256:', '')}.json`, canonical, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return ctx.json(entry, 201);
});

app.onError((error, ctx) => {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return jsonError(ctx, 400, 'invalid_request');
  console.error(error instanceof Error ? error.message : 'registry_error');
  return jsonError(ctx, 500, 'registry_error');
});

export async function handleRequest(req: Request, env: UtopiaRegistryEnv): Promise<Response> { return app.fetch(req, env); }
export default { fetch: handleRequest };

async function loadManifest(bucket: R2Bucket): Promise<z.infer<typeof Manifest>> {
  const object = await bucket.get(env.INDEX_KEY);
  return object ? Manifest.parse(JSON.parse(await object.text())) : { schemaVersion: 'utopia.registry.v1', packages: [] };
}

function rejectSecrets(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error('package_too_deep');
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((entry) => rejectSecrets(entry, depth + 1));
  for (const [key, child] of Object.entries(value)) {
    if (secretFields.test(key)) throw new Error('package_contains_secret');
    rejectSecrets(child, depth + 1);
  }
}

function options(ctx: Context<{ Bindings: UtopiaRegistryEnv }>): Response {
  const method = (ctx.req.header('access-control-request-method') ?? '').toUpperCase();
  const origin = ctx.req.header('origin');
  const writeRequest = isWrite(method);
  if (writeRequest && (ctx.env.REGISTRY_WRITE_MODE !== 'signed' || !origin || !origins(ctx.env.REGISTRY_WRITE_ALLOWED_ORIGINS).includes(origin))) {
    return jsonError(ctx, 403, 'registry_write_origin_denied');
  }
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': writeRequest ? (origin ?? '*') : '*',
      'access-control-allow-methods': writeRequest ? CORS.write : CORS.read,
      'access-control-allow-headers': ctx.req.header('access-control-request-headers') ?? env.HEADER,
      'access-control-allow-credentials': 'false',
      'access-control-max-age': '600',
      vary: 'Origin',
    },
  });
}

function jsonError(ctx: Context<{ Bindings: UtopiaRegistryEnv }>, status: 400 | 403 | 404 | 413 | 500, error: string): Response { return ctx.json({ error }, status); }
