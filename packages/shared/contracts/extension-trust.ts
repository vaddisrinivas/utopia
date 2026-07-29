import { canonicalJson, sha256Canonical } from './canonical-json';

export const UTOPIA_EXTENSION_MANIFEST_SCHEMA_VERSION = 'utopia.extension-manifest.v1' as const;
export const UTOPIA_EXTENSION_SIGNED_PAYLOAD_SCHEMA_VERSION = 'utopia.extension-signed-payload.v1' as const;
export const UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION = 'utopia.extension-trust-policy.v1' as const;

export const EXTENSION_ABI_PATTERN = /^\d+\.\d+\.\d+$/;
export const EXTENSION_ARTIFACT_CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const MAX_EXTENSION_ARTIFACT_BYTES = 100 * 1024 * 1024;

export type UtopiaExtensionCapabilityLevel = 'read' | 'write' | 'admin';

export type UtopiaExtensionCapabilityDeclaration = {
  id: string;
  level: UtopiaExtensionCapabilityLevel;
  required: boolean;
};

export type UtopiaExtensionPublisher = Readonly<{
  id: string;
  name?: string;
  homepage?: string;
  verified?: boolean;
}>;

export type UtopiaExtensionSignature = Readonly<{
  algorithm: string;
  value: string;
  keyId: string;
  publicKey?: string;
  signedAt?: string;
}>;

export type UtopiaExtensionArtifact = Readonly<{
  kind: 'wasm' | 'native-bundle';
  sha256: string;
  sizeBytes: number;
  entrypoint: string;
}>;

export type UtopiaExtensionManifest = Readonly<{
  schemaVersion: typeof UTOPIA_EXTENSION_MANIFEST_SCHEMA_VERSION;
  id: string;
  abi: string;
  version: string;
  publisher: UtopiaExtensionPublisher;
  artifact: UtopiaExtensionArtifact;
  capabilities: readonly UtopiaExtensionCapabilityDeclaration[];
  signature: UtopiaExtensionSignature;
}>;

export type UtopiaExtensionPayloadEntry = {
  id: string;
  level: UtopiaExtensionCapabilityLevel;
  required: boolean;
};

export type UtopiaExtensionSignedPayload = Readonly<{
  schemaVersion: typeof UTOPIA_EXTENSION_SIGNED_PAYLOAD_SCHEMA_VERSION;
  extensionId: string;
  extensionVersion: string;
  abi: string;
  publisherId: string;
  artifact: UtopiaExtensionArtifact;
  capabilities: readonly UtopiaExtensionPayloadEntry[];
}>;

export type UtopiaTrustedExtensionKey = Readonly<{
  publisherId: string;
  keyId: string;
  algorithm: 'ecdsa-p256-sha256';
  publicKey: string;
  status: 'trusted' | 'revoked';
  notBefore?: string;
  revokedAt?: string;
  label?: string;
}>;

export type UtopiaExtensionTrustPolicy = Readonly<{
  schemaVersion: typeof UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION;
  name: string;
  trustedKeys: readonly UtopiaTrustedExtensionKey[];
}>;

export type UtopiaTrustedExtensionDecision =
  | Readonly<{ trusted: true; publicKey: string }>
  | Readonly<{ trusted: false; error: string }>;

export type UtopiaExtensionSignatureVerifierResult = Readonly<{
  verified: boolean;
  error?: string;
}>;

export function collectExtensionManifestValidationErrors(value: unknown, path = ''): string[] {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be an object`];
  }

  const manifest = value as Partial<UtopiaExtensionManifest>;
  const errors: string[] = [];

  if (manifest.schemaVersion !== UTOPIA_EXTENSION_MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${UTOPIA_EXTENSION_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!isText(manifest.id)) {
    errors.push(`${path}.id is required`);
  }
  if (!isText(manifest.version)) {
    errors.push(`${path}.version is required`);
  } else if (!EXTENSION_ABI_PATTERN.test(manifest.version)) {
    errors.push(`${path}.version must be semantic version`);
  }
  if (!isText(manifest.abi) || !EXTENSION_ABI_PATTERN.test(manifest.abi)) {
    errors.push(`${path}.abi must be semantic version`);
  }
  if (manifest.capabilities === undefined) {
    errors.push(`${path}.capabilities is required`);
  } else if (!Array.isArray(manifest.capabilities)) {
    errors.push(`${path}.capabilities must be an array`);
  } else {
    const capabilityIds = new Set<string>();
    for (const [index, item] of manifest.capabilities.entries()) {
      const capabilityPath = `${path}.capabilities[${index}]`;
      if (!isRecord(item)) {
        errors.push(`${capabilityPath} must be an object`);
        continue;
      }
      if (!isText(item.id)) {
        errors.push(`${capabilityPath}.id is required`);
      }
      if (!isCapabilityLevel(item.level)) {
        errors.push(`${capabilityPath}.level is required`);
      }
      if (typeof item.required !== 'boolean') {
        errors.push(`${capabilityPath}.required must be boolean`);
      }
      if (isText(item.id) && item.required !== undefined) {
        if (capabilityIds.has(item.id)) {
          errors.push(`${capabilityPath}.id duplicate ${item.id}`);
        }
        capabilityIds.add(item.id);
      }
    }
  }

  errors.push(...collectArtifactValidationErrors(manifest.artifact, `${path}.artifact`));
  errors.push(...collectPublisherValidationErrors(manifest.publisher, `${path}.publisher`));
  errors.push(...collectSignatureValidationErrors(manifest.signature, `${path}.signature`));

  return errors;
}

export function validateExtensionManifest(input: unknown): UtopiaExtensionManifest {
  const errors = collectExtensionManifestValidationErrors(input);
  if (errors.length) {
    throw new Error(`extension_manifest_invalid:${errors.join('|')}`);
  }
  return input as UtopiaExtensionManifest;
}

export function buildCanonicalExtensionSignedPayload(manifest: UtopiaExtensionManifest): UtopiaExtensionSignedPayload {
  return {
    schemaVersion: UTOPIA_EXTENSION_SIGNED_PAYLOAD_SCHEMA_VERSION,
    extensionId: manifest.id,
    extensionVersion: manifest.version,
    abi: manifest.abi,
    publisherId: manifest.publisher.id,
    artifact: { ...manifest.artifact },
    capabilities: manifest.capabilities
      .map((capability) => ({ ...capability }))
      .sort((a, b) => (a.id === b.id ? a.level.localeCompare(b.level) : a.id.localeCompare(b.id))),
  };
}

export function buildCanonicalExtensionSignedPayloadText(manifest: UtopiaExtensionManifest): string {
  return canonicalJson(buildCanonicalExtensionSignedPayload(manifest));
}

export function buildExtensionSignedPayloadChecksum(manifest: UtopiaExtensionManifest): string {
  return sha256Canonical(buildCanonicalExtensionSignedPayload(manifest));
}

export async function verifyExtensionManifestSignature(input: {
  canonicalPayload: string;
  signature: UtopiaExtensionSignature;
  publicKey: string;
}): Promise<UtopiaExtensionSignatureVerifierResult> {
  if (!isText(input.publicKey)) return { verified: false, error: 'signature publicKey missing' };
  if (!isText(input.signature.value)) return { verified: false, error: 'signature value is required' };
  if (!isSupportedExtensionAlgorithm(input.signature.algorithm)) {
    return { verified: false, error: `signature algorithm unsupported:${input.signature.algorithm}` };
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return { verified: false, error: 'signature verifier unavailable' };

  try {
    return await verifyWithAlgorithm({
      algorithm: input.signature.algorithm,
      canonicalPayload: input.canonicalPayload,
      signature: input.signature.value,
      publicKey: input.publicKey,
      subtle,
    });
  } catch (error) {
    return {
      verified: false,
      error: `signature verification failed:${error instanceof Error ? error.message : 'unknown_error'}`,
    };
  }
}

export function resolveExtensionTrustPolicy(input: {
  policy: UtopiaExtensionTrustPolicy;
  manifest: UtopiaExtensionManifest;
}): UtopiaTrustedExtensionDecision {
  const signature = input.manifest.signature;

  const metadataError = collectExtensionTrustMetadataErrors(input.policy, input.manifest.publisher, signature);
  if (metadataError) return { trusted: false, error: metadataError };

  const key = input.policy.trustedKeys.find((trustedKey) =>
    trustedKey.publisherId === input.manifest.publisher.id
    && trustedKey.keyId === signature.keyId
    && trustedKey.algorithm === signature.algorithm,
  );
  if (!key) return { trusted: false, error: 'extension signing key is not trusted' };

  if (key.status === 'revoked') return { trusted: false, error: 'extension signing key is revoked' };

  if (key.notBefore && signature.signedAt && Date.parse(signature.signedAt) < Date.parse(key.notBefore)) {
    return { trusted: false, error: 'extension signature predates trusted key window' };
  }

  if (key.revokedAt && signature.signedAt && Date.parse(signature.signedAt) >= Date.parse(key.revokedAt)) {
    return { trusted: false, error: 'extension signature made after key revocation' };
  }

  if (signature.publicKey && signature.publicKey !== key.publicKey) {
    return { trusted: false, error: 'extension public key does not match trusted key' };
  }

  return { trusted: true, publicKey: key.publicKey };
}

export function isCapabilityAllowedViolation(
  capability: UtopiaExtensionCapabilityDeclaration,
  policy: UtopiaExtensionCapabilityPolicy,
): string | null {
  if (capability.level === policy.maxLevel) return null;
  if (capability.level === 'write' && policy.maxLevel === 'read') {
    return `extension capability overprivileged:${capability.id}`;
  }
  if (capability.level === 'admin' && (policy.maxLevel === 'read' || policy.maxLevel === 'write')) {
    return `extension capability overprivileged:${capability.id}`;
  }
  return null;
}

export function collectSignedExtensionCapabilityViolations(
  manifest: UtopiaExtensionManifest,
  policy: readonly UtopiaExtensionCapabilityPolicy[],
): string[] {
  const index = new Map(policy.map((entry) => [entry.capability, entry]));
  const violations: string[] = [];

  const sorted = [...manifest.capabilities].sort((a, b) => {
    if (a.id === b.id) return a.level.localeCompare(b.level);
    return a.id.localeCompare(b.id);
  });

  for (const capability of sorted) {
    const declared = index.get(capability.id);
    if (!declared) {
      violations.push(`extension capability unknown:${capability.id}`);
      continue;
    }
    const violation = isCapabilityAllowedViolation(capability, declared);
    if (violation) violations.push(violation);
  }

  return violations;
}

async function verifyWithAlgorithm(input: {
  algorithm: string;
  canonicalPayload: string;
  signature: string;
  publicKey: string;
  subtle: SubtleCrypto;
}): Promise<UtopiaExtensionSignatureVerifierResult> {
  if (!isSupportedExtensionAlgorithm(input.algorithm)) {
    return { verified: false, error: `signature algorithm unsupported:${input.algorithm}` };
  }

  try {
    const verified = await importAndVerify({
      algorithm: 'P-256',
      canonicalPayload: input.canonicalPayload,
      signature: input.signature,
      publicKey: input.publicKey,
      subtle: input.subtle,
    });
    return verified ? { verified: true } : { verified: false, error: 'signature verification failed' };
  } catch (error) {
    return {
      verified: false,
      error: `signature verification failed:${error instanceof Error ? error.message : 'unknown_error'}`,
    };
  }
}

function importAndVerify(input: {
  algorithm: 'P-256';
  canonicalPayload: string;
  signature: string;
  publicKey: string;
  subtle: SubtleCrypto;
}): Promise<boolean> {
  const bytes = new TextEncoder().encode(input.canonicalPayload);
  const signatureBytes = decodeSignatureBytes(input.signature);

  return input.subtle.importKey(
    'spki',
    decodePublicKey(input.publicKey),
    { name: 'ECDSA', namedCurve: input.algorithm },
    false,
    ['verify'],
  ).then((key) => input.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signatureBytes,
    bytes,
  ));
}

function collectPublisherValidationErrors(value: unknown, path: string): string[] {
  if (value === undefined) return [`${path}.publisher required`];
  if (!isRecord(value)) return [`${path} must be an object`];
  if (!isText(value.id)) return [`${path}.id is required`];
  if (value.homepage !== undefined) {
    if (!isText(value.homepage)) {
      return [`${path}.homepage must be text`];
    }
    try {
      requireHttpsUrl(value.homepage);
    } catch (error) {
      return [`${path}.homepage ${error instanceof Error ? error.message : 'invalid'}`];
    }
  }
  return [];
}

function collectArtifactValidationErrors(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const errors: string[] = [];
  if (value.kind !== 'wasm' && value.kind !== 'native-bundle') {
    errors.push(`${path}.kind must be wasm or native-bundle`);
  }
  if (!isText(value.sha256) || !EXTENSION_ARTIFACT_CHECKSUM_PATTERN.test(value.sha256)) {
    errors.push(`${path}.sha256 must be a canonical sha256 checksum`);
  }
  if (!Number.isInteger(value.sizeBytes) || Number(value.sizeBytes) <= 0 || Number(value.sizeBytes) > MAX_EXTENSION_ARTIFACT_BYTES) {
    errors.push(`${path}.sizeBytes must be between 1 and ${MAX_EXTENSION_ARTIFACT_BYTES}`);
  }
  if (!isText(value.entrypoint)) errors.push(`${path}.entrypoint is required`);
  return errors;
}

function collectSignatureValidationErrors(value: unknown, path: string): string[] {
  if (!isText(value)) {
    if (!value) return [`${path} is required`];
  }
  if (!isRecord(value)) return [`${path} must be an object`];

  const signature = value as Partial<UtopiaExtensionSignature>;
  const errors: string[] = [];

  if (!isText(signature.algorithm)) errors.push(`${path}.algorithm is required`);
  if (!isText(signature.keyId)) errors.push(`${path}.keyId is required`);
  if (!isText(signature.value)) errors.push(`${path}.value is required`);
  if (signature.publicKey !== undefined && !isText(signature.publicKey)) errors.push(`${path}.publicKey must be text`);
  if (signature.signedAt !== undefined) {
    if (!isText(signature.signedAt)) {
      errors.push(`${path}.signedAt must be text`);
    } else if (Number.isNaN(Date.parse(signature.signedAt))) {
      errors.push(`${path}.signedAt must be ISO date`);
    }
  }

  return errors;
}

function collectExtensionTrustMetadataErrors(
  policy: UtopiaExtensionTrustPolicy,
  publisher: UtopiaExtensionPublisher | undefined,
  signature: UtopiaExtensionSignature | undefined,
): string | null {
  if (policy.schemaVersion !== UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION) return 'extension trust policy schemaVersion is invalid';
  if (!publisher?.id) return 'publisher is required for trusted extensions';
  if (!signature) return 'signature is required for trusted extensions';
  if (signature.algorithm !== 'ecdsa-p256-sha256') return `signature algorithm unsupported:${signature.algorithm}`;
  if (!signature.keyId) return 'signature keyId is required for trusted extensions';
  if (!signature.value) return 'signature value is required for trusted extensions';
  if (signature.signedAt && Number.isNaN(Date.parse(signature.signedAt))) return 'signature signedAt is invalid';
  return null;
}

function isSupportedExtensionAlgorithm(algorithm: string): boolean {
  return algorithm.trim().toLowerCase() === 'ecdsa-p256-sha256';
}

function isCapabilityLevel(value: unknown): value is UtopiaExtensionCapabilityLevel {
  return value === 'read' || value === 'write' || value === 'admin';
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
    return toArrayBuffer(Uint8Array.from(trimmed.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []));
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

function requireHttpsUrl(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('must be HTTPS');
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type UtopiaExtensionCapabilityPolicy = Readonly<{
  capability: string;
  maxLevel: UtopiaExtensionCapabilityLevel;
}>;
