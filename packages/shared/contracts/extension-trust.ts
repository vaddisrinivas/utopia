import { canonicalJson, sha256Canonical } from './canonical-json';

export const UTOPIA_EXTENSION_MANIFEST_SCHEMA_VERSION = 'utopia.extension-manifest.v1' as const;
export const UTOPIA_EXTENSION_SIGNED_PAYLOAD_SCHEMA_VERSION = 'utopia.extension-signed-payload.v1' as const;
export const UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION = 'utopia.extension-trust-policy.v1' as const;
export const UTOPIA_EXTENSION_TRUST_ROOT_SCHEMA_VERSION = 'utopia.extension-trust-root.v1' as const;
export const UTOPIA_EXTENSION_TRUST_TARGETS_SCHEMA_VERSION = 'utopia.extension-trust-targets.v1' as const;

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

export type UtopiaExtensionTrustPublisherDelegation = Readonly<{
  publisherId: string;
  extensionIdPatterns: readonly string[];
  delegatedSigningKeyIds: readonly string[];
  minimumTargetsVersion?: number;
}>;

export type UtopiaExtensionTrustRootMetadata = Readonly<{
  schemaVersion: typeof UTOPIA_EXTENSION_TRUST_ROOT_SCHEMA_VERSION;
  version: number;
  expires: string;
  rootKeyId: string;
  delegatedPublishers: readonly UtopiaExtensionTrustPublisherDelegation[];
  signature?: UtopiaExtensionSignature;
}>;

export type UtopiaExtensionTrustTargetsMetadata = Readonly<{
  schemaVersion: typeof UTOPIA_EXTENSION_TRUST_TARGETS_SCHEMA_VERSION;
  publisherId: string;
  version: number;
  expires: string;
  delegatedSigningKeyIds: readonly string[];
  signature?: UtopiaExtensionSignature;
}>;

export type UtopiaExtensionTrustMetadataFloor = Readonly<{
  minimumAcceptedRootVersion?: number;
  minimumAcceptedTargetsVersionByPublisher?: Readonly<Record<string, number>>;
}>;

export type UtopiaExtensionTrustPolicy = Readonly<{
  schemaVersion: typeof UTOPIA_EXTENSION_TRUST_POLICY_SCHEMA_VERSION;
  name: string;
  trustedKeys: readonly UtopiaTrustedExtensionKey[];
}>;

export type UtopiaTrustedExtensionDecision =
  | Readonly<{ trusted: true; publicKey: string }>
  | Readonly<{ trusted: false; error: string }>;

export type UtopiaTrustedExtensionTufDecision = UtopiaTrustedExtensionDecision & Readonly<{
  rootVersion: number;
  targetsVersion: number;
}>;

export type UtopiaExtensionSignatureVerifierResult = Readonly<{
  verified: boolean;
  error?: string;
}>;

export async function resolveExtensionTrustPolicyWithTufMetadata(input: {
  policy: UtopiaExtensionTrustPolicy;
  manifest: UtopiaExtensionManifest;
  root: UtopiaExtensionTrustRootMetadata;
  targets: UtopiaExtensionTrustTargetsMetadata;
  floor?: UtopiaExtensionTrustMetadataFloor;
  now?: string;
}): Promise<UtopiaTrustedExtensionTufDecision> {
  const nowTimestamp = input.now ? parseIsoTimestamp(input.now) : Date.now();
  if (Number.isNaN(nowTimestamp)) {
    return { trusted: false, error: 'trust metadata now must be ISO date', rootVersion: 0, targetsVersion: 0 };
  }

  const metadataError = collectExtensionTrustMetadataErrors(input.policy, input.manifest.publisher, input.manifest.signature);
  if (metadataError) return { trusted: false, error: metadataError, rootVersion: 0, targetsVersion: 0 };

  const rootErrors = collectExtensionTrustRootMetadataValidationErrors(input.root, 'root');
  if (rootErrors.length) return { trusted: false, error: rootErrors.join('|'), rootVersion: 0, targetsVersion: 0 };
  const targetsErrors = collectExtensionTrustTargetsMetadataValidationErrors(input.targets, 'targets');
  if (targetsErrors.length) return { trusted: false, error: targetsErrors.join('|'), rootVersion: input.root.version, targetsVersion: 0 };

  const rootSignatureError = await verifySignedTrustMetadata({
    metadataType: 'root',
    metadata: input.root,
    policy: input.policy,
    nowTimestamp,
    requiredKeyId: input.root.rootKeyId,
    requireSignature: true,
    delegatedSigningKeyIds: undefined,
  });
  if (rootSignatureError) return {
    trusted: false,
    error: rootSignatureError,
    rootVersion: input.root.version,
    targetsVersion: input.targets.version,
  };

  const targetsSignatureError = await verifySignedTrustMetadata({
    metadataType: 'targets',
    metadata: input.targets,
    policy: input.policy,
    nowTimestamp,
    requireSignature: true,
    delegatedSigningKeyIds: input.targets.delegatedSigningKeyIds,
  });
  if (targetsSignatureError) return {
    trusted: false,
    error: targetsSignatureError,
    rootVersion: input.root.version,
    targetsVersion: input.targets.version,
  };

  if (Date.parse(input.root.expires) < nowTimestamp) return { trusted: false, error: 'extension trust root metadata expired', rootVersion: input.root.version, targetsVersion: input.targets.version };
  if (Date.parse(input.targets.expires) < nowTimestamp) return { trusted: false, error: 'extension trust targets metadata expired', rootVersion: input.root.version, targetsVersion: input.targets.version };

  if (input.floor?.minimumAcceptedRootVersion !== undefined && input.root.version < input.floor.minimumAcceptedRootVersion) {
    return { trusted: false, error: 'extension trust root version rollback', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }

  const floorTargetsVersion = input.floor?.minimumAcceptedTargetsVersionByPublisher?.[input.manifest.publisher.id];
  if (floorTargetsVersion !== undefined && input.targets.version < floorTargetsVersion) {
    return { trusted: false, error: 'extension trust targets version rollback', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }

  const delegation = input.root.delegatedPublishers.find((entry) => entry.publisherId === input.manifest.publisher.id);
  if (!delegation) return { trusted: false, error: 'extension publisher is not delegated', rootVersion: input.root.version, targetsVersion: input.targets.version };

  if (!input.targets.publisherId) return { trusted: false, error: 'extension targets metadata publisherId is required', rootVersion: input.root.version, targetsVersion: input.targets.version };
  if (input.targets.publisherId !== input.manifest.publisher.id) {
    return { trusted: false, error: 'extension targets publisher mismatch', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }

  if (!extensionIdMatchesPattern(input.manifest.id, delegation.extensionIdPatterns)) {
    return { trusted: false, error: 'extension id is outside delegated trust constraints', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }

  if (!delegation.delegatedSigningKeyIds.includes(input.manifest.signature.keyId)) {
    return { trusted: false, error: 'extension signing key is not delegated', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }
  if (!input.targets.delegatedSigningKeyIds.includes(input.manifest.signature.keyId)) {
    return { trusted: false, error: 'extension signing key is not in targets metadata', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }
  if (delegation.minimumTargetsVersion !== undefined && input.targets.version < delegation.minimumTargetsVersion) {
    return { trusted: false, error: 'extension targets version is below publisher floor', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }

  const pinnedRootKey = input.policy.trustedKeys.find((trusted) =>
    trusted.keyId === input.root.rootKeyId
    && trusted.algorithm === 'ecdsa-p256-sha256',
  );
  if (!pinnedRootKey) {
    return { trusted: false, error: 'extension trust root key is not trusted', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }
  if (pinnedRootKey.status === 'revoked') {
    return { trusted: false, error: 'extension trust root key is revoked', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }
  if (pinnedRootKey.notBefore && nowTimestamp < Date.parse(pinnedRootKey.notBefore)) {
    return { trusted: false, error: 'extension trust root key not active yet', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }
  if (pinnedRootKey.revokedAt && nowTimestamp >= Date.parse(pinnedRootKey.revokedAt)) {
    return { trusted: false, error: 'extension trust root key expired', rootVersion: input.root.version, targetsVersion: input.targets.version };
  }

  const trust = resolveExtensionTrustPolicy({
    policy: input.policy,
    manifest: input.manifest,
  });
  if (!trust.trusted) return { trusted: false, error: trust.error ?? 'extension trust policy failed', rootVersion: input.root.version, targetsVersion: input.targets.version };

  return { trusted: true, publicKey: trust.publicKey, rootVersion: input.root.version, targetsVersion: input.targets.version };
}

export function collectExtensionTrustRootMetadataValidationErrors(value: unknown, path = '', requireSignature = false): string[] {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be an object`];
  }

  const root = value as Partial<UtopiaExtensionTrustRootMetadata>;
  const errors: string[] = [];

  if (root.schemaVersion !== UTOPIA_EXTENSION_TRUST_ROOT_SCHEMA_VERSION) {
    errors.push(`${path}.schemaVersion must be ${UTOPIA_EXTENSION_TRUST_ROOT_SCHEMA_VERSION}`);
  }
  if (typeof root.version !== 'number' || !Number.isInteger(root.version) || root.version <= 0) {
    errors.push(`${path}.version must be a positive integer`);
  }
  const rootExpires = root.expires;
  if (!isText(rootExpires)) {
    errors.push(`${path}.expires is required`);
  } else if (Number.isNaN(Date.parse(rootExpires))) {
    errors.push(`${path}.expires must be ISO date`);
  }
  if (!isText(root.rootKeyId)) errors.push(`${path}.rootKeyId is required`);
  if (!Array.isArray(root.delegatedPublishers)) {
    errors.push(`${path}.delegatedPublishers must be an array`);
    return errors;
  }
  if (root.delegatedPublishers.length === 0) errors.push(`${path}.delegatedPublishers is required`);

  root.delegatedPublishers.forEach((delegation, index) => {
    errors.push(...collectExtensionTrustPublisherDelegationValidationErrors(delegation, `${path}.delegatedPublishers[${index}]`));
  });

  if (requireSignature) {
    errors.push(...collectSignatureValidationErrors(root.signature, `${path}.signature`));
  } else if (root.signature !== undefined) {
    errors.push(...collectSignatureValidationErrors(root.signature, `${path}.signature`));
  }

  return errors;
}

export function collectExtensionTrustTargetsMetadataValidationErrors(value: unknown, path = '', requireSignature = false): string[] {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be an object`];
  }

  const targets = value as Partial<UtopiaExtensionTrustTargetsMetadata>;
  const errors: string[] = [];

  if (targets.schemaVersion !== UTOPIA_EXTENSION_TRUST_TARGETS_SCHEMA_VERSION) {
    errors.push(`${path}.schemaVersion must be ${UTOPIA_EXTENSION_TRUST_TARGETS_SCHEMA_VERSION}`);
  }
  if (!isText(targets.publisherId)) errors.push(`${path}.publisherId is required`);
  if (typeof targets.version !== 'number' || !Number.isInteger(targets.version) || targets.version <= 0) {
    errors.push(`${path}.version must be a positive integer`);
  }
  if (!isText(targets.expires)) {
    errors.push(`${path}.expires is required`);
  } else if (Number.isNaN(Date.parse(targets.expires))) {
    errors.push(`${path}.expires must be ISO date`);
  }
  if (!Array.isArray(targets.delegatedSigningKeyIds) || targets.delegatedSigningKeyIds.length === 0) {
    errors.push(`${path}.delegatedSigningKeyIds must be a non-empty array`);
    return errors;
  }
  for (const [index, keyId] of targets.delegatedSigningKeyIds.entries()) {
    if (!isText(keyId)) errors.push(`${path}.delegatedSigningKeyIds[${index}] is required`);
  }

  if (requireSignature) {
    errors.push(...collectSignatureValidationErrors(targets.signature, `${path}.signature`));
  } else if (targets.signature !== undefined) {
    errors.push(...collectSignatureValidationErrors(targets.signature, `${path}.signature`));
  }

  return errors;
}

export function collectExtensionTrustPublisherDelegationValidationErrors(
  value: unknown,
  path = '',
): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} must be an object`];
  const delegation = value as Partial<UtopiaExtensionTrustPublisherDelegation>;
  const errors: string[] = [];

  if (!isText(delegation.publisherId)) errors.push(`${path}.publisherId is required`);
  if (!Array.isArray(delegation.extensionIdPatterns) || delegation.extensionIdPatterns.length === 0) {
    errors.push(`${path}.extensionIdPatterns must be a non-empty array`);
  } else {
    for (const [index, pattern] of delegation.extensionIdPatterns.entries()) {
      if (!isText(pattern)) errors.push(`${path}.extensionIdPatterns[${index}] is required`);
    }
  }
  if (!Array.isArray(delegation.delegatedSigningKeyIds) || delegation.delegatedSigningKeyIds.length === 0) {
    errors.push(`${path}.delegatedSigningKeyIds must be a non-empty array`);
  } else {
    for (const [index, keyId] of delegation.delegatedSigningKeyIds.entries()) {
      if (!isText(keyId)) errors.push(`${path}.delegatedSigningKeyIds[${index}] is required`);
    }
  }
  if (delegation.minimumTargetsVersion !== undefined
    && (!Number.isInteger(delegation.minimumTargetsVersion) || delegation.minimumTargetsVersion < 1)
  ) {
    errors.push(`${path}.minimumTargetsVersion must be a positive integer`);
  }

  return errors;
}

function extensionIdMatchesPattern(extensionId: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern.endsWith('.*')) return extensionId.startsWith(pattern.slice(0, -2));
    return extensionId === pattern;
  });
}

function parseIsoTimestamp(input: string): number {
  return Date.parse(input);
}

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

async function verifySignedTrustMetadata(input: {
  metadataType: 'root' | 'targets';
  metadata: UtopiaExtensionTrustRootMetadata | UtopiaExtensionTrustTargetsMetadata;
  policy: UtopiaExtensionTrustPolicy;
  nowTimestamp: number;
  requiredKeyId?: string;
  delegatedSigningKeyIds?: readonly string[];
  requireSignature: boolean;
}): Promise<string | null> {
  const metadataSignature = (input.metadata as { signature?: UtopiaExtensionSignature }).signature;
  const metadataErrors = input.requireSignature && !metadataSignature
    ? [`extension trust ${input.metadataType} metadata signature is required`]
    : collectSignatureValidationErrors(metadataSignature, `${input.metadataType}.signature`);

  if (metadataErrors.length) return metadataErrors.join('|');
  if (!metadataSignature) return null;

  if (input.metadataType === 'root' && input.requiredKeyId && metadataSignature.keyId !== input.requiredKeyId) {
    return 'extension trust root signature key does not match root key id';
  }
  if (input.metadataType === 'targets' && input.delegatedSigningKeyIds !== undefined) {
    if (!input.delegatedSigningKeyIds.includes(metadataSignature.keyId)) {
      return 'extension trust targets signing key is not delegated';
    }
  }

  const trustedKey = input.policy.trustedKeys.find((candidate) =>
    candidate.keyId === metadataSignature.keyId
    && candidate.algorithm === metadataSignature.algorithm
    && candidate.status === 'trusted'
    && (input.metadataType === 'root'
      || candidate.publisherId === (input.metadata as UtopiaExtensionTrustTargetsMetadata).publisherId)
  );
  if (!trustedKey) return `extension trust ${input.metadataType} signature key is not trusted`;

  if (trustedKey.notBefore && metadataSignature.signedAt && input.nowTimestamp < Date.parse(trustedKey.notBefore)) {
    return `extension trust ${input.metadataType} signature key is not active yet`;
  }
  if (trustedKey.revokedAt && metadataSignature.signedAt && input.nowTimestamp >= Date.parse(trustedKey.revokedAt)) {
    return `extension trust ${input.metadataType} signature key is revoked`;
  }

  const result = await verifyExtensionManifestSignature({
    canonicalPayload: buildCanonicalTrustMetadataPayloadText(input.metadata),
    signature: metadataSignature,
    publicKey: trustedKey.publicKey,
  });
  if (!result.verified) return result.error ?? 'extension trust metadata signature verification failed';

  return null;
}

function buildCanonicalTrustMetadataPayloadText(metadata: UtopiaExtensionTrustRootMetadata | UtopiaExtensionTrustTargetsMetadata): string {
  const { signature: _signature, ...unsignedMetadata } = metadata as Record<string, unknown>;
  return canonicalJson(unsignedMetadata);
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
