import {
  buildPackageInstallPreview,
  parsePackageInstallTarget,
  validateRegistryManifest,
  type PackageInstallPreview,
  type PackageInstallSignatureVerifierResult,
  type PackageInstallTarget,
  type UtopiaRegistrySignature,
  type UtopiaRegistryManifest,
  type UtopiaRegistryPackage,
} from '@/packages/shared/contracts/package-install';
import { resolveRegistrySignatureTrust, type UtopiaTrustPolicy } from '@/packages/shared/contracts/package-trust';
import { canonicalJson, sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import bundledCalculatorPackageJson from '@/apps/scientific-calculator/scientific-calculator.v1.json';
import bundledAudioLoopPackageJson from '@/apps/audio-loop-108/audio-loop-108.v1.json';

export const BUNDLED_UTOPIA_REGISTRY_URL = 'https://wonder.app/registry/bundled.json';
export const BUNDLED_DEMO_PACKAGE_URL = 'https://wonder.app/bundled/scientific-calculator.package.json';
export const BUNDLED_AUDIO_LOOP_PACKAGE_URL = 'https://wonder.app/bundled/audio-loop-108.package.json';

export type PackageInstallFetchResponse = Readonly<{
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
  };
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export type PackageInstallFetcher = (url: string) => Promise<PackageInstallFetchResponse>;

export type PackageInstallCandidate = Readonly<{
  target: PackageInstallTarget;
  packageJson: unknown;
  preview: PackageInstallPreview;
}>;

export type PackageInstallPreviewRow = Readonly<{
  label: string;
  values: readonly string[];
}>;

export type PackageInstallTrustSummary = Readonly<{
  statusLabel: 'Ready for review' | 'Blocked';
  trustLabel: string;
  trustTone: 'verified' | 'unknown' | 'blocked';
  checksumLabel: string;
  publisherLabel: string;
  signatureLabel: string;
  approvalLabel: 'Review required' | 'Install blocked';
}>;

export function packageInstallPreviewRows(preview: PackageInstallPreview): PackageInstallPreviewRow[] {
  return [
    { label: 'Screens', values: preview.screensIncluded },
    { label: 'Collections', values: preview.dataCollections },
    { label: 'Providers', values: preview.providersRequested },
    { label: 'Native permissions', values: preview.nativePermissionsRequested },
    { label: 'Widgets', values: preview.widgetsRequired },
    { label: 'Plugins', values: preview.pluginsRequired },
    { label: 'Fallbacks', values: preview.fallbacks },
  ];
}

export function packageInstallTrustLabel(preview: PackageInstallPreview): string {
  if (preview.trust.signatureStatus === 'signature_invalid') return 'Publisher signature invalid';
  if (preview.trust.status === 'checksum_verified' && preview.trust.signatureStatus === 'signature_verified') {
    return 'Checksum and signature verified';
  }
  if (preview.trust.signatureStatus === 'signature_verified') return 'Publisher signature verified';
  if (preview.trust.status === 'checksum_verified') return 'Checksum verified';
  if (preview.trust.status === 'checksum_mismatch') return 'Checksum mismatch';
  if (preview.trust.signatureStatus === 'signature_present') return 'Publisher signature present - checksum missing';
  return 'Unknown remote package - review required';
}

export function packageInstallTrustSummary(preview: PackageInstallPreview): PackageInstallTrustSummary {
  const checksum = preview.trust.computedChecksum ?? preview.trust.checksum ?? 'No checksum';
  const publisher = preview.trust.publisher;
  return {
    statusLabel: preview.status === 'ready_for_review' ? 'Ready for review' : 'Blocked',
    trustLabel: packageInstallTrustLabel(preview),
    trustTone: preview.trust.status === 'checksum_mismatch' || preview.trust.signatureStatus === 'signature_invalid'
      ? 'blocked'
      : preview.trust.status === 'checksum_verified' || preview.trust.signatureStatus === 'signature_verified'
        ? 'verified'
        : 'unknown',
    checksumLabel: checksum.length > 28 ? `${checksum.slice(0, 28)}...` : checksum,
    publisherLabel: publisher?.name ?? publisher?.id ?? 'Unknown publisher',
    signatureLabel: packageInstallSignatureLabel(preview),
    approvalLabel: preview.status === 'ready_for_review' ? 'Review required' : 'Install blocked',
  };
}

export function packageInstallSignatureLabel(preview: PackageInstallPreview): string {
  if (preview.trust.signatureStatus === 'signature_verified') {
    const key = preview.trust.signatureKeyId ? ` (${preview.trust.signatureKeyId})` : '';
    return `Signature verified${key}`;
  }
  if (preview.trust.signatureStatus === 'signature_present') {
    const key = preview.trust.signatureKeyId ? ` (${preview.trust.signatureKeyId})` : '';
    return `Signature present${key}`;
  }
  if (preview.trust.signatureStatus === 'signature_invalid') return 'Signature invalid';
  return 'Signature missing';
}

export async function fetchPackageInstallCandidate(
  input: string,
  fetcher: PackageInstallFetcher,
  options: {
    registryPackage?: UtopiaRegistryPackage;
    expectedChecksum?: string;
  } = {},
): Promise<PackageInstallCandidate> {
  const target = parsePackageInstallTarget(input);
  const packageJson = await fetchJson(target.packageUrl, fetcher);
  const preview = await buildPackageInstallPreviewWithSignatureVerification(packageJson, {
    sourceUrl: target.packageUrl,
    registryPackage: options.registryPackage,
    expectedChecksum: options.expectedChecksum,
  });
  assertInstallDescriptorMatchesPreview(options.registryPackage, preview);
  return {
    target,
    packageJson,
    preview,
  };
}

export async function fetchRegistryManifest(url: string, fetcher: PackageInstallFetcher): Promise<UtopiaRegistryManifest> {
  parsePackageInstallTarget(url);
  return validateRegistryManifest(await fetchJson(url, fetcher));
}

export function getBundledDemoPackage(): unknown {
  return bundledCalculatorPackageJson;
}

export function getBundledAudioLoopPackage(): unknown {
  return bundledAudioLoopPackageJson;
}

function getBundledPackages(): Array<{ packageJson: { id: string; version: string; presentation?: { label?: string } }; url: string; description: string }> {
  return [
    {
      packageJson: getBundledDemoPackage() as { id: string; version: string; presentation?: { label?: string } },
      url: BUNDLED_DEMO_PACKAGE_URL,
      description: 'Local bundled calculator app.',
    },
    {
      packageJson: getBundledAudioLoopPackage() as { id: string; version: string; presentation?: { label?: string } },
      url: BUNDLED_AUDIO_LOOP_PACKAGE_URL,
      description: 'Local bundled audio loop app.',
    },
  ];
}

export async function buildPackageInstallPreviewWithSignatureVerification(
  packageJson: unknown,
  options: {
    sourceUrl: string;
    registryPackage?: UtopiaRegistryPackage;
    expectedChecksum?: string;
    trustPolicy?: UtopiaTrustPolicy;
  },
): Promise<PackageInstallPreview> {
  const signature = options.registryPackage?.signature;
  if (!signature) {
    return buildPackageInstallPreview(packageJson, options);
  }

  const canonicalPackage = canonicalJson(packageJson);
  const computedChecksum = sha256Canonical(packageJson);
  const trustedSignature = options.trustPolicy && options.registryPackage
    ? resolveRegistrySignatureTrust({ policy: options.trustPolicy, registryPackage: options.registryPackage })
    : null;
  if (trustedSignature && !trustedSignature.trusted) {
    return buildPackageInstallPreview(packageJson, {
      ...options,
      signatureVerifier: () => ({ verified: false, error: trustedSignature.error ?? 'signature trust policy failed' }),
    });
  }
  const verification = await verifyPackageRegistrySignature({
    canonicalPackage,
    signature: trustedSignature?.publicKey ? { ...signature, publicKey: trustedSignature.publicKey } : signature,
  });

  return buildPackageInstallPreview(packageJson, {
    ...options,
    signatureVerifier: (input) => {
      if (input.canonicalPackage !== canonicalPackage || input.computedChecksum !== computedChecksum) {
        return { verified: false, error: 'signature verification payload mismatch' };
      }
      return verification;
    },
  });
}

export async function verifyPackageRegistrySignature(input: {
  canonicalPackage: string;
  signature: UtopiaRegistrySignature;
}): Promise<PackageInstallSignatureVerifierResult> {
  if (!input.signature.publicKey?.trim()) {
    return { verified: false, error: 'signature publicKey missing' };
  }
  if (!isSupportedSignatureAlgorithm(input.signature.algorithm)) {
    return { verified: false, error: `signature algorithm unsupported:${input.signature.algorithm}` };
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return { verified: false, error: 'signature verifier unavailable' };

  try {
    const publicKey = await subtle.importKey(
      'spki',
      decodePublicKey(input.signature.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const verified = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      decodeSignatureBytes(input.signature.value),
      toArrayBuffer(new TextEncoder().encode(input.canonicalPackage)),
    );
    return verified ? true : { verified: false, error: 'signature verification failed' };
  } catch (error) {
    return { verified: false, error: `signature verification failed:${error instanceof Error ? error.message : 'unknown_error'}` };
  }
}

export function getBundledRegistryManifest(): UtopiaRegistryManifest {
  return {
    schemaVersion: 'utopia.registry.v1',
    name: 'Bundled apps',
    packages: getBundledPackages().map((bundledPackage) => ({
      id: bundledPackage.packageJson.id,
      name: bundledPackage.packageJson.presentation?.label ?? bundledPackage.packageJson.id,
      version: bundledPackage.packageJson.version,
      url: bundledPackage.url,
      checksum: sha256Canonical(bundledPackage.packageJson),
      description: bundledPackage.description,
    })),
  };
}

export function createPackageInstallFetcher(remoteFetch: PackageInstallFetcher = defaultRemoteFetch): PackageInstallFetcher {
  return async (url) => {
    const normalized = parsePackageInstallTarget(url).packageUrl;
    if (normalized === BUNDLED_UTOPIA_REGISTRY_URL) {
      return jsonResponse(getBundledRegistryManifest());
    }
    if (normalized === BUNDLED_DEMO_PACKAGE_URL) {
      return jsonResponse(getBundledDemoPackage());
    }
    if (normalized === BUNDLED_AUDIO_LOOP_PACKAGE_URL) {
      return jsonResponse(getBundledAudioLoopPackage());
    }
    return remoteFetch(normalized);
  };
}

async function fetchJson(url: string, fetcher: PackageInstallFetcher): Promise<unknown> {
  let response: PackageInstallFetchResponse;
  try {
    response = await fetcher(url);
  } catch (error) {
    throw new Error(`package_fetch_failed:${error instanceof Error ? error.message : 'network_error'}`);
  }

  if (!response.ok) throw new Error(`package_fetch_failed:http_${response.status}`);
  const contentType = response.headers?.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('json')) {
    throw new Error('package_fetch_not_json');
  }

  if (response.json) return response.json();
  if (!response.text) throw new Error('package_fetch_no_body_reader');

  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('package_fetch_invalid_json');
  }
}

async function defaultRemoteFetch(url: string): Promise<PackageInstallFetchResponse> {
  if (typeof fetch !== 'function') throw new Error('fetch_unavailable');
  return fetch(url);
}

function isSupportedSignatureAlgorithm(algorithm: string): boolean {
  return ['ecdsa-p256-sha256', 'ecdsa-p256', 'es256'].includes(algorithm.trim().toLowerCase());
}

function decodePublicKey(value: string): ArrayBuffer {
  const trimmed = value.trim();
  const body = trimmed.includes('-----BEGIN')
    ? trimmed.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, '')
    : trimmed;
  return toArrayBuffer(decodeBase64Bytes(body));
}

function decodeSignatureBytes(value: string): ArrayBuffer {
  const trimmed = value.trim();
  if (/^[a-f0-9]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    return toArrayBuffer(new Uint8Array(trimmed.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []));
  }
  return toArrayBuffer(decodeBase64Bytes(trimmed));
}

function decodeBase64Bytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`;
  const runtimeBuffer = (globalThis as { Buffer?: { from(value: string, encoding: 'base64'): Uint8Array } }).Buffer;
  if (runtimeBuffer) return new Uint8Array(runtimeBuffer.from(padded, 'base64'));
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function jsonResponse(value: unknown): PackageInstallFetchResponse {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => value,
  };
}

function assertInstallDescriptorMatchesPreview(
  registryPackage: UtopiaRegistryPackage | undefined,
  preview: PackageInstallPreview,
): void {
  if (!registryPackage) return;
  if (preview.packageId !== registryPackage.id || preview.version !== registryPackage.version) {
    throw new Error(`package_descriptor_identity_mismatch:${registryPackage.id}@${registryPackage.version}`);
  }
}
