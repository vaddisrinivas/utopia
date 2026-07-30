import {
  buildPackageInstallPreview,
  canonicalJson,
  collectExtensionTrustRootMetadataValidationErrors,
  collectExtensionTrustTargetsMetadataValidationErrors,
  sha256Canonical,
  UTOPIA_REGISTRY_SCHEMA_VERSION,
  validateTelemetryEvent,
  redactedTelemetryEvent,
  type UtopiaRegistryPackage,
} from '../packages/shared/contracts';
import { UTOPIA_TELEMETRY_MAX_EVENT_BYTES } from '../packages/shared/contracts/telemetry';

export type UtopiaRegistryEnv = Readonly<{
  PACKAGES: R2BucketLike;
  TELEMETRY?: AnalyticsEngineDatasetLike;
  TELEMETRY_INGEST_ENABLED?: string;
  TELEMETRY_INGEST_TOKEN?: string;
  PUBLISHER_TOKEN: string;
  REGISTRY_WRITE_MODE?: 'disabled' | 'signed';
  REGISTRY_PUBLISHER_KEYS_JSON?: string;
  REGISTRY_HOST?: string;
  ANDROID_PACKAGE_NAME?: string;
  ANDROID_SHA256_CERT_FINGERPRINT?: string;
  IOS_APP_ID?: string;
}>;

type R2BucketLike = {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string>; httpMetadata?: { contentType?: string } } | null>;
};

type AnalyticsEngineDatasetLike = {
  writeDataPoint(point: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
};

const DEFAULT_REGISTRY_HOST = 'utoia.thetechcruise.com';
const MAX_PACKAGE_BYTES = 256 * 1024;
const ALLOWED_PUBLISH_SOURCES = ['custom_gpt', 'github_factory', 'browser_builder', 'registry'] as const;
const REGISTRY_INDEX_KEY = 'registry/index.json';
const TRUST_ROOT_KEY = 'registry/trust/extension-root.json';
const TRUST_TARGETS_KEY_PREFIX = 'registry/trust/extension-targets-';
const TRUST_METADATA_MAX_BYTES = 64 * 1024;
const TRUST_PUBLISHER_ID_PATTERN = /^[a-z0-9_.-]+$/i;
const HOSTED_REGISTRY_INDEX_MAX_PACKAGES = 1000;
const GENERATED_METADATA_LABEL = 'generated';
const UNLISTED_METADATA_LABEL = 'unlisted';
const TELEMETRY_RATE_WINDOW_MS = 60_000;
const TELEMETRY_MAX_RATE = 5;
const TELEMETRY_TOKEN_HEADER = 'x-utopia-telemetry-token';
const REGISTRY_PACKAGE_SIGNATURE_MAX_AGE_MS = 15 * 60 * 1000;
const metadataKey = (id: string) => `registry/packages/${id}.json`;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const telemetryRateState = new Map<string, { count: number; windowStart: number }>();

export default {
  async fetch(request: Request, env: UtopiaRegistryEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env: UtopiaRegistryEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'utopia-registry' });
    }
    if (request.method === 'POST' && url.pathname === '/v1/packages') {
      return cors(await createPackage(request, env));
    }
    if (request.method === 'GET' && url.pathname === '/v1/registry.json') {
      return cors(await registryManifest(env));
    }
    if (request.method === 'GET' && url.pathname === '/v1/trust/extension/root') {
      return cors(await trustMetadataRoot(env));
    }
    if (request.method === 'GET' && url.pathname === '/v1/trust/extension/targets') {
      return cors(await trustMetadataTargets(url, env));
    }
    if (request.method === 'GET' && url.pathname.startsWith('/v1/packages/')) {
      return cors(await packageMetadata(url.pathname.split('/').pop() ?? '', env));
    }
    if (request.method === 'GET' && /^\/p\/[^/]+\.json$/.test(url.pathname)) {
      return cors(await packageBlob(url.pathname.slice('/p/'.length, -'.json'.length), env));
    }
    if (request.method === 'POST' && url.pathname === '/v1/events') {
      return cors(await ingestTelemetry(request, env));
    }
    if (request.method === 'GET' && url.pathname === '/install') {
      return installLanding(url);
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/assetlinks.json') {
      return assetLinks(env);
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/apple-app-site-association') {
      return appleAppSiteAssociation(env);
    }
    return withSecurityHeaders(json({ error: 'not_found' }, 404));
  } catch (error) {
    return withSecurityHeaders(json({ error: error instanceof Error ? error.message : 'unknown_error' }, 400));
  }
}

async function createPackage(request: Request, env: UtopiaRegistryEnv): Promise<Response> {
  requireRegistryWritesEnabled(env);
  requirePublisherToken(request, env);
  const body = await parsePublishBody(request);
  const source = parsePublishSource(body.source);
  if (source === 'github_factory' && body.publish !== true) {
    throw new Error('github_factory_publish_requires_explicit_consent');
  }
  const pkg = body.package;
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package_required');
  const visibility = body.visibility === 'public' ? 'public' : 'unlisted';
  const raw = JSON.stringify(pkg);
  if (new TextEncoder().encode(raw).byteLength > MAX_PACKAGE_BYTES) throw new Error('package_too_large');
  assertNoSecrets(pkg);
  if (!isRegistryPackageSignature(body.signature)) throw new Error('package_signature_required');
  await verifyRegistryPackageSignature(pkg, body.signature, env);

  const preview = buildPackageInstallPreview(pkg, { sourceUrl: `https://${host(env)}/p/pending.json` });
  if (preview.status !== 'ready_for_review') {
    return json({ status: 'blocked', errors: preview.validationErrors, compatibility: preview.runtimeCompatibility }, 422);
  }
  if (!preview.packageId || !preview.version) throw new Error('package_preview_missing_identity');

  const checksum = sha256Canonical(pkg);
  const id = checksum.replace('sha256:', '').slice(0, 16);
  const key = `packages/${id}.json`;
  const packageUrl = `https://${host(env, request)}/p/${id}.json`;
  const createdAt = new Date().toISOString();
  const metadata: HostedPackageMetadata = {
    id,
    package_id: preview.packageId,
    name: preview.appName,
    version: preview.version,
    checksum,
    object_key: key,
    package_url: packageUrl,
    visibility,
    source,
    labels: buildPackageMetadataLabels(visibility),
    signature: body.signature,
    created_at: createdAt,
  };
  const existingMetadata = await readJson<HostedPackageMetadata | null>(env, metadataKey(id), null);
  if (existingMetadata) {
    if (!isHostedPackageMetadata(existingMetadata)) throw new Error('package_metadata_invalid');
    if (!isEquivalentHostedPackageMetadata(existingMetadata, metadata)) throw new Error('package_metadata_immutable');
    return json(buildPublishPayload(existingMetadata), 200);
  }

  await env.PACKAGES.put(key, JSON.stringify(pkg), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      checksum,
      visibility,
      source,
      labels: metadata.labels.join(','),
    },
  });
  await env.PACKAGES.put(metadataKey(id), JSON.stringify(metadata), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  await upsertRegistryIndex(env, metadata);

  writeAnalytics(env, 'package_created', [id, preview.packageId ?? 'unknown', source]);

  return json(buildPublishPayload(metadata), 201);
}

async function packageBlob(id: string, env: UtopiaRegistryEnv): Promise<Response> {
  const object = await env.PACKAGES.get(`packages/${id}.json`);
  if (!object) return withSecurityHeaders(json({ error: 'package_not_found' }, 404));
  return withSecurityHeaders(new Response(await object.text(), {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=31536000, immutable' },
  }));
}

async function packageMetadata(id: string, env: UtopiaRegistryEnv): Promise<Response> {
  const row = await readJson<HostedPackageMetadata | null>(env, metadataKey(id), null);
  if (!row) return json({ error: 'package_not_found' }, 404);
  if (!isHostedPackageMetadata(row)) return json({ error: 'package_metadata_invalid' }, 400);
  return json(row);
}

async function registryManifest(env: UtopiaRegistryEnv): Promise<Response> {
  const index = await readRegistryIndex(env);
  const packages = index.packages
    .filter((row) => row.visibility === 'public')
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 200)
    .map<UtopiaRegistryPackage>((row) => ({
    id: row.package_id,
    name: row.name,
    version: row.version,
    url: row.package_url,
    checksum: row.checksum,
    publisher: {
      id: 'utopia-hosted',
      name: 'Utopia Hosted Registry',
      homepage: `https://${host(env)}`,
      verified: false,
    },
  }));
  return json({
    schemaVersion: UTOPIA_REGISTRY_SCHEMA_VERSION,
    name: 'Utopia Hosted Registry',
    packages,
  });
}

async function trustMetadataRoot(env: UtopiaRegistryEnv): Promise<Response> {
  const metadata = await readTrustMetadata(
    env,
    TRUST_ROOT_KEY,
    (value) => collectExtensionTrustRootMetadataValidationErrors(value, 'trustRoot'),
    'invalid_trust_root_metadata',
  );
  if (metadata === null) return json({ error: 'trust_root_not_found' }, 404);
  return json(metadata);
}

async function trustMetadataTargets(url: URL, env: UtopiaRegistryEnv): Promise<Response> {
  const publisher = url.searchParams.get('publisher');
  if (!publisher) return json({ error: 'publisher_required_for_targets' }, 400);
  if (!TRUST_PUBLISHER_ID_PATTERN.test(publisher)) return json({ error: 'invalid_trust_targets_publisher' }, 400);
  const metadata = await readTrustMetadata(
    env,
    `${TRUST_TARGETS_KEY_PREFIX}${publisher}.json`,
    (value) => collectExtensionTrustTargetsMetadataValidationErrors(value, 'trustTargets'),
    'invalid_trust_targets_metadata',
  );
  if (metadata === null) return json({ error: 'trust_targets_not_found' }, 404);
  return json(metadata);
}

async function ingestTelemetry(request: Request, env: UtopiaRegistryEnv): Promise<Response> {
  assertTelemetryIngestionEnabled(request, env);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > UTOPIA_TELEMETRY_MAX_EVENT_BYTES) {
    throw new Error('telemetry_payload_too_large');
  }
  const event = redactedTelemetryEvent(validateTelemetryEvent(JSON.parse(body)));
  assertTelemetryRateLimit(String(event.anonymousInstallationId));
  writeAnalytics(env, String(event.event), [
    String(event.anonymousInstallationId),
    String(event.packageId ?? 'unknown'),
    String(event.source ?? 'app'),
  ], [Number(event.rating ?? 0)]);
  return json({ ok: true });
}

function installLanding(url: URL): Response {
  const packageUrl = url.searchParams.get('url');
  if (!packageUrl) return html('<h1>Utopia install link missing package URL</h1>', 400);
  const appUrl = `utopia://install?url=${encodeURIComponent(packageUrl)}`;
  return withSecurityHeaders(html(`<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open in Utopia</title>
<style>body{font-family:system-ui,sans-serif;margin:40px;line-height:1.4;max-width:640px}a{font-weight:700}</style>
<h1>Open this app in Utopia</h1>
<p>Utopia will validate the package, show its permissions, and ask before installing.</p>
<p><a href="${escapeHtml(appUrl)}">Open in Utopia</a></p>`));
}

function assetLinks(env: UtopiaRegistryEnv): Response {
  const fingerprint = env.ANDROID_SHA256_CERT_FINGERPRINT;
  if (!fingerprint) return json([], 200);
  return json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: env.ANDROID_PACKAGE_NAME ?? 'app.utopia',
      sha256_cert_fingerprints: [fingerprint],
    },
  }]);
}

function appleAppSiteAssociation(env: UtopiaRegistryEnv): Response {
  return json({
    applinks: {
      apps: [],
      details: [{
        appID: env.IOS_APP_ID ?? 'TEAMID.app.utopia',
        paths: ['/install*'],
      }],
    },
  });
}

function requirePublisherToken(request: Request, env: UtopiaRegistryEnv): void {
  const expected = env.PUBLISHER_TOKEN;
  if (!expected || expected.length < 96) throw new Error('publisher_token_not_configured_or_too_short');
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!actual || actual !== expected) throw new Error('unauthorized');
}

function writeAnalytics(env: UtopiaRegistryEnv, event: string, blobs: string[], doubles: number[] = []): void {
  env.TELEMETRY?.writeDataPoint({ indexes: [event], blobs: [event, ...blobs], doubles });
}

function host(env: UtopiaRegistryEnv, request?: Request): string {
  return env.REGISTRY_HOST || (request ? new URL(request.url).host : DEFAULT_REGISTRY_HOST);
}

function json(value: unknown, status = 200): Response {
  return withSecurityHeaders(new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }));
}

function html(value: string, status = 200): Response {
  return withSecurityHeaders(new Response(value, { status, headers: { 'content-type': 'text/html; charset=utf-8' } }));
}

function cors(response: Response): Response {
  const next = withSecurityHeaders(new Response(response.body, response));
  next.headers.set('access-control-allow-origin', '*');
  next.headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  next.headers.set('access-control-allow-headers', 'authorization,content-type,x-utopia-telemetry-token');
  return next;
}

function withSecurityHeaders(response: Response): Response {
  response.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  return response;
}

type HostedPackageMetadata = Readonly<{
  id: string;
  package_id: string;
  name: string;
  version: string;
  checksum: string;
  object_key: string;
  package_url: string;
  visibility: 'unlisted' | 'public';
  source: 'custom_gpt' | 'github_factory' | 'browser_builder' | 'registry';
  labels: ReadonlyArray<'generated' | 'unlisted'>;
  signature: RegistryPackageSignature;
  created_at: string;
}>;

type RegistryPackageSignature = Readonly<{
  algorithm: 'ecdsa-p256-sha256';
  keyId: string;
  value: string;
  signedAt: string;
}>;

type RegistryIndex = Readonly<{
  schemaVersion: 'utopia.hosted-registry-index.v1';
  updatedAt: string;
  packages: HostedPackageMetadata[];
}>;

async function readRegistryIndex(env: UtopiaRegistryEnv): Promise<RegistryIndex> {
  return sanitizeRegistryIndex(await readJson<unknown>(env, REGISTRY_INDEX_KEY, {
    schemaVersion: 'utopia.hosted-registry-index.v1',
    updatedAt: new Date(0).toISOString(),
    packages: [],
  }));
}

async function upsertRegistryIndex(env: UtopiaRegistryEnv, metadata: HostedPackageMetadata): Promise<void> {
  const index = await readRegistryIndex(env);
  const conflicting = index.packages.find((item) =>
    item.id === metadata.id && !isEquivalentHostedPackageMetadata(item, metadata),
  );
  if (conflicting) throw new Error('package_metadata_immutable');
  const packages = [
    metadata,
    ...index.packages.filter((item) => item.id !== metadata.id),
  ].slice(0, HOSTED_REGISTRY_INDEX_MAX_PACKAGES);
  await env.PACKAGES.put(REGISTRY_INDEX_KEY, JSON.stringify({
    schemaVersion: 'utopia.hosted-registry-index.v1',
    updatedAt: new Date().toISOString(),
    packages,
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

async function readJson<T>(env: UtopiaRegistryEnv, key: string, fallback: T): Promise<T> {
  const object = await env.PACKAGES.get(key);
  if (!object) return fallback;
  return JSON.parse(await object.text()) as T;
}

async function readTrustMetadata(
  env: UtopiaRegistryEnv,
  key: string,
  validate: (metadata: unknown) => string[],
  invalidError: string,
): Promise<unknown | null> {
  const metadata = await env.PACKAGES.get(key);
  if (!metadata) return null;
  let payload: unknown;
  try {
    const raw = await metadata.text();
    if (raw.length > TRUST_METADATA_MAX_BYTES) throw new Error('trust_metadata_too_large');
    payload = JSON.parse(raw);
  } catch {
    throw new Error('invalid_trust_metadata_payload');
  }
  const errors = validate(payload);
  if (errors.length > 0) throw new Error(`${invalidError}:${errors.join('|')}`);
  return payload;
}

function assertNoSecrets(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/secret|token|api[_-]?key|password|credential/i.test(key)) throw new Error(`package_secret_field:${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function sanitizeRegistryIndex(value: unknown): RegistryIndex {
  if (!isObject(value)) return {
    schemaVersion: 'utopia.hosted-registry-index.v1',
    updatedAt: new Date(0).toISOString(),
    packages: [],
  };
  if (value.schemaVersion !== 'utopia.hosted-registry-index.v1' || typeof value.updatedAt !== 'string' || !Array.isArray(value.packages)) {
    return {
      schemaVersion: 'utopia.hosted-registry-index.v1',
      updatedAt: new Date(0).toISOString(),
      packages: [],
    };
  }
  return {
    schemaVersion: 'utopia.hosted-registry-index.v1',
    updatedAt: value.updatedAt,
    packages: value.packages.filter(isHostedPackageMetadata),
  };
}

function buildPackageMetadataLabels(visibility: HostedPackageMetadata['visibility']): HostedPackageMetadata['labels'] {
  return visibility === 'unlisted'
    ? [GENERATED_METADATA_LABEL, UNLISTED_METADATA_LABEL]
    : [GENERATED_METADATA_LABEL];
}

function buildPublishPayload(metadata: HostedPackageMetadata): { id: string; checksum: string; visibility: HostedPackageMetadata['visibility']; install_url: string; web_url: string; package_url: string } {
  return {
    id: metadata.id,
    checksum: metadata.checksum,
    visibility: metadata.visibility,
    install_url: `utopia://install?url=${encodeURIComponent(metadata.package_url)}`,
    web_url: `${new URL(metadata.package_url).origin}/install?url=${encodeURIComponent(metadata.package_url)}`,
    package_url: metadata.package_url,
  };
}

function isEquivalentHostedPackageMetadata(left: HostedPackageMetadata, right: HostedPackageMetadata): boolean {
  return left.package_id === right.package_id
    && left.version === right.version
    && left.name === right.name
    && left.checksum === right.checksum
    && left.object_key === right.object_key
    && left.package_url === right.package_url
    && left.visibility === right.visibility
    && left.source === right.source
    && left.labels.length === right.labels.length
    && left.labels.every((label, index) => label === right.labels[index])
    && left.created_at.length > 0
    && right.created_at.length > 0;
}

function isHostedPackageMetadata(value: unknown): value is HostedPackageMetadata {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.package_id !== 'string' || !value.package_id) return false;
  if (typeof value.name !== 'string' || !value.name) return false;
  if (typeof value.version !== 'string' || !value.version) return false;
  if (typeof value.checksum !== 'string' || !value.checksum) return false;
  if (typeof value.object_key !== 'string' || !value.object_key) return false;
  if (typeof value.package_url !== 'string' || !value.package_url) return false;
  if (value.visibility !== 'public' && value.visibility !== 'unlisted') return false;
  if (typeof value.source !== 'string' || !ALLOWED_PUBLISH_SOURCES.includes(value.source as typeof ALLOWED_PUBLISH_SOURCES[number])) return false;
  if (!Array.isArray(value.labels) || value.labels.length < 1) return false;
  if (!value.labels.includes(GENERATED_METADATA_LABEL)) return false;
  if (value.visibility === 'unlisted' && !value.labels.includes(UNLISTED_METADATA_LABEL)) return false;
  if (value.visibility === 'public' && value.labels.includes(UNLISTED_METADATA_LABEL)) return false;
  if (!isRegistryPackageSignature(value.signature)) return false;
  if (typeof value.created_at !== 'string' || !value.created_at) return false;
  return true;
}

async function parsePublishBody(request: Request): Promise<{
  package: unknown;
  source: typeof ALLOWED_PUBLISH_SOURCES[number];
  visibility?: 'public' | 'unlisted';
  publish?: boolean;
  signature?: RegistryPackageSignature;
}> {
  const body = await request.json();
  if (!isObject(body)) throw new Error('publish_body_must_be_object');
  if (!('package' in body)) throw new Error('package_required');
  return body as {
    package: unknown;
    source: typeof ALLOWED_PUBLISH_SOURCES[number];
    visibility?: 'public' | 'unlisted';
    publish?: boolean;
    signature?: RegistryPackageSignature;
  };
}

function requireRegistryWritesEnabled(env: UtopiaRegistryEnv): void {
  if (env.REGISTRY_WRITE_MODE !== 'signed') {
    throw new Error('registry_writes_disabled');
  }
}

async function verifyRegistryPackageSignature(
  pkg: object,
  signature: RegistryPackageSignature,
  env: UtopiaRegistryEnv,
): Promise<void> {
  if (Date.now() - Date.parse(signature.signedAt) > REGISTRY_PACKAGE_SIGNATURE_MAX_AGE_MS) {
    throw new Error('package_signature_expired');
  }
  if (Date.parse(signature.signedAt) > Date.now() + 60_000) throw new Error('package_signature_from_future');
  const keys = parseRegistryPublisherKeys(env.REGISTRY_PUBLISHER_KEYS_JSON);
  const publicKey = keys[signature.keyId];
  if (!publicKey) throw new Error('package_signature_key_untrusted');
  const verified = await globalThis.crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await globalThis.crypto.subtle.importKey('spki', decodeBase64(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
    decodeBase64(signature.value),
    new TextEncoder().encode(canonicalJson(pkg)),
  );
  if (!verified) throw new Error('package_signature_invalid');
}

function parseRegistryPublisherKeys(value: string | undefined): Record<string, string> {
  if (!value) throw new Error('registry_publisher_keys_not_configured');
  try {
    const parsed = JSON.parse(value);
    if (!isObject(parsed) || Object.values(parsed).some((key) => typeof key !== 'string' || !key)) {
      throw new Error('invalid');
    }
    return parsed as Record<string, string>;
  } catch {
    throw new Error('registry_publisher_keys_invalid');
  }
}

function isRegistryPackageSignature(value: unknown): value is RegistryPackageSignature {
  return isObject(value)
    && value.algorithm === 'ecdsa-p256-sha256'
    && typeof value.keyId === 'string' && value.keyId.length > 0
    && typeof value.value === 'string' && value.value.length > 0
    && typeof value.signedAt === 'string' && !Number.isNaN(Date.parse(value.signedAt));
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parsePublishSource(value: unknown): 'custom_gpt' | 'github_factory' | 'browser_builder' | 'registry' {
  if (value !== 'custom_gpt' && value !== 'github_factory' && value !== 'browser_builder' && value !== 'registry') {
    throw new Error('publish_source_invalid_or_missing');
  }
  return value;
}

function assertTelemetryIngestionEnabled(request: Request, env: UtopiaRegistryEnv): void {
  if (env.TELEMETRY_INGEST_ENABLED !== 'true') throw new Error('telemetry_ingestion_disabled');
  const expectedToken = env.TELEMETRY_INGEST_TOKEN?.trim();
  if (!expectedToken) throw new Error('telemetry_token_not_configured');
  const providedToken = request.headers.get(TELEMETRY_TOKEN_HEADER)?.trim();
  if (!providedToken || providedToken.length < 16 || providedToken !== expectedToken) {
    throw new Error('telemetry_token_invalid');
  }
}

function assertTelemetryRateLimit(anonymousInstallationId: string): void {
  const now = Date.now();
  const entry = telemetryRateState.get(anonymousInstallationId) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart >= TELEMETRY_RATE_WINDOW_MS) {
    telemetryRateState.set(anonymousInstallationId, { count: 1, windowStart: now });
    return;
  }
  entry.count += 1;
  telemetryRateState.set(anonymousInstallationId, entry);
  if (entry.count > TELEMETRY_MAX_RATE) throw new Error('telemetry_rate_limit_exceeded');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
