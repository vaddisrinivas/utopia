import type { UtopiaRegistryPackage, UtopiaRegistryPublisher, UtopiaRegistrySignature } from './package-install';

export const UTOPIA_TRUST_POLICY_SCHEMA_VERSION = 'utopia.trust-policy.v1' as const;
const TRUST_SIGNATURE_KEY_ID_PATTERN = /^[a-z0-9._-]+$/i;
const TRUST_SIGNATURE_KEY_ID_MAX_LENGTH = 128;
const TRUST_SIGNATURE_VALUE_ALLOWED_CHARS = /^[A-Za-z0-9+/=_-]+$/;
const TRUST_SIGNATURE_VALUE_MAX_BYTES = 4096;

export type UtopiaTrustedPublisherKey = Readonly<{
  publisherId: string;
  keyId: string;
  algorithm: 'ecdsa-p256-sha256';
  publicKey: string;
  status: 'trusted' | 'revoked';
  label?: string;
  notBefore?: string;
  revokedAt?: string;
}>;

export type UtopiaTrustPolicy = Readonly<{
  schemaVersion: typeof UTOPIA_TRUST_POLICY_SCHEMA_VERSION;
  name: string;
  trustedKeys: readonly UtopiaTrustedPublisherKey[];
}>;

export type UtopiaSignatureTrustDecision = Readonly<{
  trusted: boolean;
  publicKey?: string;
  error?: string;
}>;

export function resolveRegistrySignatureTrust(input: {
  policy: UtopiaTrustPolicy;
  registryPackage: UtopiaRegistryPackage;
}): UtopiaSignatureTrustDecision {
  const publisher = input.registryPackage.publisher;
  const signature = input.registryPackage.signature;
  const metadataError = validateTrustMetadata(input.policy, publisher, signature);
  if (metadataError) return { trusted: false, error: metadataError };
  if (!publisher || !signature || !signature.keyId) return { trusted: false, error: 'signature trust metadata is incomplete' };

  const match = input.policy.trustedKeys.find((key) =>
    key.publisherId === publisher.id
    && key.keyId === signature.keyId
    && key.algorithm === signature.algorithm
  );
  if (!match) return { trusted: false, error: 'publisher key is not trusted' };
  if (match.status === 'revoked') return { trusted: false, error: 'publisher key is revoked' };
  if (match.notBefore && signature.signedAt && Date.parse(signature.signedAt) < Date.parse(match.notBefore)) {
    return { trusted: false, error: 'signature predates trusted key window' };
  }
  if (match.revokedAt && signature.signedAt && Date.parse(signature.signedAt) >= Date.parse(match.revokedAt)) {
    return { trusted: false, error: 'signature was made after key revocation' };
  }
  if (signature.publicKey && signature.publicKey !== match.publicKey) {
    return { trusted: false, error: 'signature publicKey does not match trusted key' };
  }
  return { trusted: true, publicKey: match.publicKey };
}

function validateTrustMetadata(
  policy: UtopiaTrustPolicy,
  publisher: UtopiaRegistryPublisher | undefined,
  signature: UtopiaRegistrySignature | undefined,
): string | null {
  if (policy.schemaVersion !== UTOPIA_TRUST_POLICY_SCHEMA_VERSION) return 'trust policy schemaVersion is invalid';
  if (!publisher?.id) return 'publisher is required for trusted signatures';
  if (!signature) return 'signature is required for trusted packages';
  if (signature.algorithm !== 'ecdsa-p256-sha256') return `signature algorithm unsupported:${signature.algorithm}`;
  if (!signature.keyId) return 'signature keyId is required for trusted packages';
  if (!TRUST_SIGNATURE_KEY_ID_PATTERN.test(signature.keyId) || signature.keyId.length > TRUST_SIGNATURE_KEY_ID_MAX_LENGTH) {
    return 'signature keyId format is invalid for trusted packages';
  }
  if (!signature.value) return 'signature value is required for trusted packages';
  if (!isDeterministicSignatureValue(signature.value)) return 'signature value has invalid encoding';
  if (signature.publicKey !== undefined && typeof signature.publicKey !== 'string') return 'signature publicKey must be text';
  if (signature.signedAt && Number.isNaN(Date.parse(signature.signedAt))) return 'signature signedAt is invalid';
  return null;
}

function isDeterministicSignatureValue(value: string): boolean {
  if (value.length === 0 || value.length > TRUST_SIGNATURE_VALUE_MAX_BYTES) return false;
  if (!TRUST_SIGNATURE_VALUE_ALLOWED_CHARS.test(value.trim())) return false;
  const normalized = value.trim();
  if (/^(?:[a-f0-9]{2})+$/i.test(normalized)) return normalized.length % 2 === 0;
  return true;
}
