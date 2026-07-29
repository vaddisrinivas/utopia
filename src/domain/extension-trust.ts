import {
  buildCanonicalExtensionSignedPayloadText,
  buildExtensionSignedPayloadChecksum,
  collectSignedExtensionCapabilityViolations,
  resolveExtensionTrustPolicy,
  type UtopiaExtensionCapabilityPolicy,
  type UtopiaExtensionManifest,
  type UtopiaExtensionTrustPolicy,
  type UtopiaExtensionSignatureVerifierResult,
  validateExtensionManifest,
  verifyExtensionManifestSignature,
} from '@/packages/shared/contracts/extension-trust';

export type ExtensionTrustReview = Readonly<{
  status: 'accepted' | 'refused';
  manifestId: string | null;
  manifestVersion: string | null;
  payloadChecksum: string;
  signatureStatus: 'verified' | 'missing' | 'invalid' | 'untrusted';
  reasons: readonly string[];
  manifest: UtopiaExtensionManifest | null;
}>;

export async function evaluateSignedExtensionManifest(input: {
  manifest: unknown;
  artifactChecksum: string;
  trustPolicy: UtopiaExtensionTrustPolicy;
  capabilityPolicy: readonly UtopiaExtensionCapabilityPolicy[];
}): Promise<ExtensionTrustReview> {
  const reasons: string[] = [];
  let manifest: UtopiaExtensionManifest;

  try {
    manifest = validateExtensionManifest(input.manifest);
  } catch (error) {
    return {
      status: 'refused',
      manifestId: null,
      manifestVersion: null,
      payloadChecksum: '',
      signatureStatus: 'invalid',
      reasons: [error instanceof Error ? error.message : 'extension manifest invalid'],
      manifest: null,
    };
  }

  const payloadChecksum = buildExtensionSignedPayloadChecksum(manifest);
  const canonicalPayload = buildCanonicalExtensionSignedPayloadText(manifest);

  const trust = resolveExtensionTrustPolicy({ policy: input.trustPolicy, manifest });
  if (!trust.trusted) {
    return {
      status: 'refused',
      manifestId: manifest.id,
      manifestVersion: manifest.version,
      payloadChecksum,
      signatureStatus: 'untrusted',
      reasons: [trust.error ?? 'extension trust policy failed'],
      manifest,
    };
  }

  const signature = manifest.signature;
  const verification: UtopiaExtensionSignatureVerifierResult = await verifyExtensionManifestSignature({
    canonicalPayload,
    signature,
    publicKey: trust.publicKey,
  });

  const signatureStatus: ExtensionTrustReview['signatureStatus'] = verification.verified ? 'verified' : 'invalid';

  if (signatureStatus === 'invalid') {
    reasons.push(verification.error ?? 'signature verification failed');
    return {
      status: 'refused',
      manifestId: manifest.id,
      manifestVersion: manifest.version,
      payloadChecksum,
      signatureStatus,
      reasons,
      manifest,
    };
  }

  if (input.artifactChecksum !== manifest.artifact.sha256) {
    return {
      status: 'refused',
      manifestId: manifest.id,
      manifestVersion: manifest.version,
      payloadChecksum,
      signatureStatus,
      reasons: ['extension artifact checksum mismatch'],
      manifest,
    };
  }

  const capabilityErrors = collectSignedExtensionCapabilityViolations(manifest, input.capabilityPolicy);
  if (capabilityErrors.length) {
    return {
      status: 'refused',
      manifestId: manifest.id,
      manifestVersion: manifest.version,
      payloadChecksum,
      signatureStatus,
      reasons: [...capabilityErrors],
      manifest,
    };
  }

  return {
    status: 'accepted',
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    payloadChecksum,
    signatureStatus,
    reasons: [],
    manifest,
  };
}
