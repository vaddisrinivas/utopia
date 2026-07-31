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
const TRUST_FLOOR_KEY = 'registry/trust/version-floor.json';
const TRUST_METADATA_MAX_BYTES = 64 * 1024;
const TRUST_PUBLISHER_ID_PATTERN = /^[a-z0-9_.-]+$/i;
const TRUST_PUBLISHER_ID_MAX_LENGTH = 64;
const HOSTED_REGISTRY_INDEX_MAX_PACKAGES = 1000;
const GENERATED_METADATA_LABEL = 'generated';
const UNLISTED_METADATA_LABEL = 'unlisted';
const TELEMETRY_RATE_WINDOW_MS = 60_000;
const TELEMETRY_MAX_RATE = 5;
const TELEMETRY_TOKEN_HEADER = 'x-utopia-telemetry-token';
const REGISTRY_PACKAGE_SIGNATURE_MAX_AGE_MS = 15 * 60 * 1000;
const REGISTRY_PUBLISH_RATE_WINDOW_MS = 60_000;
const REGISTRY_MAX_PUBLISH_RATE = 10;
const REGISTRY_SECRET_SCAN_MAX_DEPTH = 20;
const REGISTRY_SECRET_SCAN_MAX_NODES = 2_000;
const REGISTRY_SECRET_SCAN_MAX_STRING_BYTES = 16 * 1024;
const REGISTRY_SIGNATURE_KEY_ID_PATTERN = /^[a-z0-9._-]+$/i;
const REGISTRY_SIGNATURE_KEY_ID_MAX_LENGTH = 128;
const REGISTRY_SIGNATURE_VALUE_ALLOWED_CHARS = /^[A-Za-z0-9+/=_-]+$/;
const REGISTRY_SIGNATURE_VALUE_MAX_BYTES = 4096;
const REGISTRY_PUBLISHER_KEY_MIN_BYTES = 32;
const metadataKey = (id: string) => `registry/packages/${id}.json`;
const signatureKey = (id: string) => `registry/packages/${id}.signature.json`;
const publicationKey = (id: string) => `registry/publications/${id}.json`;
const replayKey = (keyId: string, digest: string) => `registry/replay/${encodeURIComponent(keyId)}/${digest}.json`;
const publishRateKey = (keyId: string, windowStart: number) => `registry/limits/publish/${encodeURIComponent(keyId)}/${windowStart}.json`;
const telemetryRateKey = (installationId: string, windowStart: number) => `registry/limits/telemetry/${sha256Canonical(installationId).slice('sha256:'.length)}/${windowStart}.json`;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

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
  if (body.signature === undefined) throw new Error('package_signature_required');
  if (!isRegistryPackageSignature(body.signature)) throw new Error('package_signature_invalid');
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
    await assertPublishedPackageIsIntact(env, existingMetadata);
    return json(buildPublishPayload(existingMetadata), 200);
  }

  await assertDurablePublishRateLimit(env, body.signature.keyId);
  const replayDigest = sha256Canonical({ checksum, signature: body.signature });
  if (await env.PACKAGES.get(replayKey(body.signature.keyId, replayDigest))) {
    throw new Error('package_signature_replayed');
  }

  const packageJson = JSON.stringify(pkg);
  const metadataJson = JSON.stringify(metadata);
  const signatureJson = JSON.stringify(body.signature);
  await env.PACKAGES.put(key, packageJson, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      checksum,
      visibility,
      source,
      labels: metadata.labels.join(','),
    },
  });
  await env.PACKAGES.put(metadataKey(id), metadataJson, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  await env.PACKAGES.put(signatureKey(id), signatureJson, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  // Readers only accept a publication after this final marker exists and all component checksums match.
  await env.PACKAGES.put(publicationKey(id), JSON.stringify({
    schemaVersion: 'utopia.registry-publication.v1',
    id,
    packageKey: key,
    metadataKey: metadataKey(id),
    signatureKey: signatureKey(id),
    packageChecksum: checksum,
    metadataChecksum: sha256Canonical(metadata),
    signatureChecksum: sha256Canonical(body.signature),
    publishedAt: createdAt,
  } satisfies RegistryPublication), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  await env.PACKAGES.put(replayKey(body.signature.keyId, replayDigest), JSON.stringify({ createdAt }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  await upsertRegistryIndex(env, metadata);

  writeAnalytics(env, 'package_created', [id, preview.packageId ?? 'unknown', source]);

  return json(buildPublishPayload(metadata), 201);
}

async function packageBlob(id: string, env: UtopiaRegistryEnv): Promise<Response> {
  const metadata = await readJson<HostedPackageMetadata | null>(env, metadataKey(id), null);
  if (!metadata || !isHostedPackageMetadata(metadata)) return withSecurityHeaders(json({ error: 'package_not_found' }, 404));
  const publication = await assertPublishedPackageIsIntact(env, metadata);
  const object = await env.PACKAGES.get(publication.packageKey);
  if (!object) return withSecurityHeaders(json({ error: 'package_not_found' }, 404));
  return withSecurityHeaders(new Response(await object.text(), {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=31536000, immutable' },
  }));
}

async function packageMetadata(id: string, env: UtopiaRegistryEnv): Promise<Response> {
  const row = await readJson<HostedPackageMetadata | null>(env, metadataKey(id), null);
  if (!row) return json({ error: 'package_not_found' }, 404);
  if (!isHostedPackageMetadata(row)) return json({ error: 'package_metadata_invalid' }, 400);
  await assertPublishedPackageIsIntact(env, row);
  return json(row);
}

async function registryManifest(env: UtopiaRegistryEnv): Promise<Response> {
  const index = await readRegistryIndex(env);
  const published = await Promise.all(index.packages.map(async (row) => {
    try {
      await assertPublishedPackageIsIntact(env, row);
      return row;
    } catch {
      return null;
    }
  }));
  const packages = published
    .filter((row): row is HostedPackageMetadata => row !== null && row.visibility === 'public')
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
    signature: row.signature,
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
    { kind: 'root' },
  );
  if (metadata === null) return json({ error: 'trust_root_not_found' }, 404);
  return json(metadata);
}

async function trustMetadataTargets(url: URL, env: UtopiaRegistryEnv): Promise<Response> {
  const publisher = url.searchParams.get('publisher');
  if (!publisher) return json({ error: 'publisher_required_for_targets' }, 400);
  if (publisher.length > TRUST_PUBLISHER_ID_MAX_LENGTH || !TRUST_PUBLISHER_ID_PATTERN.test(publisher)) {
    return json({ error: 'invalid_trust_targets_publisher' }, 400);
  }
  const metadata = await readTrustMetadata(
    env,
    `${TRUST_TARGETS_KEY_PREFIX}${publisher}.json`,
    (value) => collectExtensionTrustTargetsMetadataValidationErrors(value, 'trustTargets'),
    'invalid_trust_targets_metadata',
    { kind: 'targets', publisher },
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
  await assertTelemetryRateLimit(env, String(event.anonymousInstallationId));
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
  if (env.TELEMETRY_INGEST_ENABLED !== 'true') return;
  env.TELEMETRY?.writeDataPoint({ indexes: [event], blobs: [event, ...blobs], doubles });
}

function host(env: UtopiaRegistryEnv, request?: Request): string {
  const configured = env.REGISTRY_HOST?.trim();
  if (configured && isPublicHost(configured)) return configured;
  if (request) {
    const candidate = new URL(request.url).host;
    if (isPublicHost(candidate)) return candidate;
  }
  return DEFAULT_REGISTRY_HOST;
}

function isPublicHost(value: string): boolean {
  try {
    const parsed = new URL(`https://${value}`);
    if (parsed.hostname !== value.split(':')[0]) return false;
    if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(parsed.hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(parsed.hostname)) return false;
    return parsed.hostname.includes('.') && !parsed.username && !parsed.password && !parsed.pathname.slice(1);
  } catch {
    return false;
  }
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

type RegistryPublication = Readonly<{
  schemaVersion: 'utopia.registry-publication.v1';
  id: string;
  packageKey: string;
  metadataKey: string;
  signatureKey: string;
  packageChecksum: string;
  metadataChecksum: string;
  signatureChecksum: string;
  publishedAt: string;
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

async function assertPublishedPackageIsIntact(env: UtopiaRegistryEnv, metadata: HostedPackageMetadata): Promise<RegistryPublication> {
  const publication = await readJson<unknown>(env, publicationKey(metadata.id), null);
  if (!isRegistryPublication(publication) || publication.id !== metadata.id) throw new Error('package_publication_incomplete');
  if (publication.packageKey !== metadata.object_key || publication.metadataKey !== metadataKey(metadata.id) || publication.signatureKey !== signatureKey(metadata.id)) {
    throw new Error('package_publication_invalid');
  }
  const metadataObject = await env.PACKAGES.get(publication.metadataKey);
  const signatureObject = await env.PACKAGES.get(publication.signatureKey);
  const packageObject = await env.PACKAGES.get(publication.packageKey);
  if (!metadataObject || !signatureObject || !packageObject) throw new Error('package_publication_incomplete');
  let storedMetadata: unknown;
  let storedSignature: unknown;
  let storedPackage: unknown;
  try {
    storedMetadata = JSON.parse(await metadataObject.text());
    storedSignature = JSON.parse(await signatureObject.text());
    storedPackage = JSON.parse(await packageObject.text());
  } catch {
    throw new Error('package_publication_invalid');
  }
  if (!isHostedPackageMetadata(storedMetadata) || !isRegistryPackageSignature(storedSignature) || !isObject(storedPackage)) {
    throw new Error('package_publication_invalid');
  }
  if (!isEquivalentHostedPackageMetadata(storedMetadata, metadata)
    || canonicalJson(storedMetadata.signature) !== canonicalJson(storedSignature)
    || sha256Canonical(storedMetadata) !== publication.metadataChecksum
    || sha256Canonical(storedSignature) !== publication.signatureChecksum
    || sha256Canonical(storedPackage) !== publication.packageChecksum
    || publication.packageChecksum !== metadata.checksum) {
    throw new Error('package_checksum_mismatch');
  }
  return publication;
}

async function assertDurablePublishRateLimit(env: UtopiaRegistryEnv, keyId: string): Promise<void> {
  const windowStart = Math.floor(Date.now() / REGISTRY_PUBLISH_RATE_WINDOW_MS) * REGISTRY_PUBLISH_RATE_WINDOW_MS;
  const key = publishRateKey(keyId, windowStart);
  const current = await readJson<{ count?: unknown } | null>(env, key, null);
  const count = typeof current?.count === 'number' && Number.isInteger(current.count) && current.count >= 0 ? current.count : 0;
  if (count >= REGISTRY_MAX_PUBLISH_RATE) throw new Error('registry_publish_rate_limit_exceeded');
  await env.PACKAGES.put(key, JSON.stringify({ count: count + 1, windowStart }), {
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
  lifecycle: { kind: 'root' } | { kind: 'targets'; publisher: string },
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
  await enforceTrustMetadataLifecycle(env, payload, lifecycle, invalidError);
  return payload;
}

type TrustVersionFloor = Readonly<{
  rootVersion?: number;
  rootKeyId?: string;
  rootDigest?: string;
  targetsVersions?: Readonly<Record<string, number>>;
  targetsDigests?: Readonly<Record<string, string>>;
}>;

async function enforceTrustMetadataLifecycle(
  env: UtopiaRegistryEnv,
  metadata: unknown,
  lifecycle: { kind: 'root' } | { kind: 'targets'; publisher: string },
  invalidError: string,
): Promise<void> {
  if (!isObject(metadata) || typeof metadata.version !== 'number' || !Number.isInteger(metadata.version) || metadata.version <= 0) {
    throw new Error(`${invalidError}:version_invalid`);
  }
  if (typeof metadata.expires !== 'string' || Number.isNaN(Date.parse(metadata.expires))) {
    throw new Error(`${invalidError}:expiry_invalid`);
  }
  if (Date.parse(metadata.expires) <= Date.now()) {
    throw new Error(`${invalidError}:expired`);
  }

  const floor = await readJson<TrustVersionFloor | null>(env, TRUST_FLOOR_KEY, null);
  if (floor !== null && !isObject(floor)) throw new Error(`${invalidError}:version_floor_invalid`);
  if (lifecycle.kind === 'root') {
    const currentVersion = floor?.rootVersion;
    const digest = sha256Canonical(metadata);
    if (currentVersion !== undefined && metadata.version < currentVersion) {
      throw new Error(`${invalidError}:version_rollback`);
    }
    if (currentVersion !== undefined && metadata.version === currentVersion && floor?.rootKeyId && floor.rootKeyId !== metadata.rootKeyId) {
      throw new Error(`${invalidError}:root_rotation_without_version_bump`);
    }
    if (currentVersion === metadata.version && floor?.rootDigest && floor.rootDigest !== digest) {
      throw new Error(`${invalidError}:version_rewrite`);
    }
    if (currentVersion === metadata.version && floor?.rootKeyId === metadata.rootKeyId) return;
    await env.PACKAGES.put(TRUST_FLOOR_KEY, JSON.stringify({
      rootVersion: metadata.version,
      rootKeyId: metadata.rootKeyId,
      rootDigest: digest,
      targetsVersions: floor?.targetsVersions ?? {},
      targetsDigests: floor?.targetsDigests ?? {},
    }), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
    return;
  }

  if (metadata.publisherId !== lifecycle.publisher) throw new Error(`${invalidError}:publisher_mismatch`);
  const currentVersion = floor?.targetsVersions?.[lifecycle.publisher];
  const digest = sha256Canonical(metadata);
  if (currentVersion !== undefined && metadata.version < currentVersion) {
    throw new Error(`${invalidError}:version_rollback`);
  }
  if (currentVersion === metadata.version && floor?.targetsDigests?.[lifecycle.publisher] !== digest) {
    throw new Error(`${invalidError}:version_rewrite`);
  }
  if (currentVersion === metadata.version) return;
  await env.PACKAGES.put(TRUST_FLOOR_KEY, JSON.stringify({
    rootVersion: floor?.rootVersion,
    rootKeyId: floor?.rootKeyId,
    rootDigest: floor?.rootDigest,
    targetsVersions: {
      ...(floor?.targetsVersions ?? {}),
      [lifecycle.publisher]: metadata.version,
    },
    targetsDigests: {
      ...(floor?.targetsDigests ?? {}),
      [lifecycle.publisher]: digest,
    },
  }), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
}

function assertNoSecrets(value: unknown, path = '$'): void {
  let nodes = 0;
  const visit = (current: unknown, currentPath: string, depth: number): void => {
    if (++nodes > REGISTRY_SECRET_SCAN_MAX_NODES) throw new Error('package_secret_scan_limit');
    if (depth > REGISTRY_SECRET_SCAN_MAX_DEPTH) throw new Error('package_secret_scan_limit');
    if (typeof current === 'string') {
      if (new TextEncoder().encode(current).byteLength > REGISTRY_SECRET_SCAN_MAX_STRING_BYTES) throw new Error('package_secret_scan_limit');
      if (looksLikeSecret(current)) throw new Error(`package_secret_content:${currentPath}`);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}[${index}]`, depth + 1));
      return;
    }
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) visit(child, `${currentPath}.${key}`, depth + 1);
  };
  visit(value, path, 0);
}

function looksLikeSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(trimmed)
    || /^(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+$/.test(trimmed)
    || /^(?:sk-|gh[pousr]_|github_pat_|AKIA[0-9A-Z]{16}|xox[baprs]-)[A-Za-z0-9_-]{12,}$/i.test(trimmed)
    || /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|credential)\s*[:=]\s*[^\s,}"']{16,}/i.test(trimmed);
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
    if (!isObject(parsed) || Object.values(parsed).length === 0) {
      throw new Error('invalid');
    }
    const normalized = {} as Record<string, string>;
    for (const [keyId, keyValue] of Object.entries(parsed)) {
      if (!isSupportedRegistrySignatureKeyId(keyId) || typeof keyValue !== 'string' || !isSupportedRegistryPublicKey(keyValue)) throw new Error('invalid');
      normalized[keyId] = keyValue.trim();
    }
    return normalized;
  } catch {
    throw new Error('registry_publisher_keys_invalid');
  }
}

function isRegistryPackageSignature(value: unknown): value is RegistryPackageSignature {
  if (!isObject(value)) return false;
  const signature = value as Partial<RegistryPackageSignature>;
  return signature.algorithm === 'ecdsa-p256-sha256'
    && isSupportedRegistrySignatureKeyId(signature.keyId)
    && isSupportedRegistrySignatureValue(signature.value)
    && typeof signature.signedAt === 'string'
    && !Number.isNaN(Date.parse(signature.signedAt));
}

function decodeBase64(value: string): ArrayBuffer {
  const bytes = decodeBase64Bytes(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function decodeBase64Bytes(value: string): Uint8Array {
  const normalized = normalizePublicKeyValue(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`;
  const runtimeBuffer = (globalThis as { Buffer?: { from(value: string, encoding: 'base64'): Uint8Array } }).Buffer;
  if (runtimeBuffer) return new Uint8Array(runtimeBuffer.from(padded, 'base64'));
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizePublicKeyValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('BEGIN PUBLIC KEY')) return trimmed;
  return trimmed.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, '').trim();
}

function isSupportedRegistrySignatureKeyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= REGISTRY_SIGNATURE_KEY_ID_MAX_LENGTH && REGISTRY_SIGNATURE_KEY_ID_PATTERN.test(value);
}

function isSupportedRegistrySignatureValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > REGISTRY_SIGNATURE_VALUE_MAX_BYTES) return false;
  if (!REGISTRY_SIGNATURE_VALUE_ALLOWED_CHARS.test(normalized)) return false;
  if (/^(?:[a-f0-9]{2})+$/i.test(normalized)) return normalized.length % 2 === 0;
  return true;
}

function isSupportedRegistryPublicKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizePublicKeyValue(value);
  if (!isSupportedRegistrySignatureValue(normalized)) return false;
  try { return decodeBase64Bytes(normalized).byteLength >= REGISTRY_PUBLISHER_KEY_MIN_BYTES; } catch { return false; }
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

async function assertTelemetryRateLimit(env: UtopiaRegistryEnv, anonymousInstallationId: string): Promise<void> {
  const now = Date.now();
  const windowStart = Math.floor(now / TELEMETRY_RATE_WINDOW_MS) * TELEMETRY_RATE_WINDOW_MS;
  const key = telemetryRateKey(anonymousInstallationId, windowStart);
  const current = await readJson<{ count?: unknown } | null>(env, key, null);
  const count = typeof current?.count === 'number' && Number.isInteger(current.count) && current.count >= 0 ? current.count : 0;
  if (count >= TELEMETRY_MAX_RATE) throw new Error('telemetry_rate_limit_exceeded');
  await env.PACKAGES.put(key, JSON.stringify({ count: count + 1, windowStart }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

function isRegistryPublication(value: unknown): value is RegistryPublication {
  return isObject(value)
    && value.schemaVersion === 'utopia.registry-publication.v1'
    && typeof value.id === 'string'
    && typeof value.packageKey === 'string'
    && typeof value.metadataKey === 'string'
    && typeof value.signatureKey === 'string'
    && typeof value.packageChecksum === 'string'
    && typeof value.metadataChecksum === 'string'
    && typeof value.signatureChecksum === 'string'
    && typeof value.publishedAt === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
