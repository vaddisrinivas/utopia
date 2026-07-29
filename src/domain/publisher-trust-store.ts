import { canonicalJson } from '@/packages/shared/contracts/canonical-json';
import type { UtopiaRegistryPublisher, UtopiaRegistrySignature } from '@/packages/shared/contracts/package-install';
import type { UtopiaPublisherTrustPersistence, UtopiaPublisherTrustSnapshotFloor } from './publisher-trust-persistence';

export const UTOPIA_PUBLISHER_TRUST_SNAPSHOT_SCHEMA_VERSION = 'utopia.publisher-trust-snapshot.v1' as const;
export const UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256' as const;

export type UtopiaPublisherTrustRoot = Readonly<{
  rootKeyId: string;
  algorithm: typeof UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM;
  publicKey: string;
  status: 'trusted' | 'revoked';
  notBefore?: string;
  revokedAt?: string;
}>;

export type UtopiaPublisherTrustKey = Readonly<{
  rootKeyId: string;
  publisherId: string;
  keyId: string;
  algorithm: string;
  publicKey: string;
  status: 'trusted' | 'revoked';
  notBefore?: string;
  revokedAt?: string;
}>;

export type UtopiaPinnedRootSignedPublisherTrustSnapshotPayload = Readonly<{
  schemaVersion: typeof UTOPIA_PUBLISHER_TRUST_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  snapshotVersion: number;
  createdAt: string;
  expiresAt: string;
  minimumAlgorithm: typeof UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM;
  publisherKeys: readonly UtopiaPublisherTrustKey[];
}>;

export type UtopiaPinnedRootSignedPublisherTrustSnapshotSignatureEnvelope = Readonly<{
  rootKeyId: string;
  algorithm: typeof UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM;
  signedAt: string;
  value: string;
}>;

export type UtopiaPinnedRootSignedPublisherTrustSnapshot = UtopiaPinnedRootSignedPublisherTrustSnapshotPayload & Readonly<{
  rootSignature: UtopiaPinnedRootSignedPublisherTrustSnapshotSignatureEnvelope;
}>;

export type PublisherTrustSnapshotRefreshDecision = Readonly<{
  snapshotId: string;
  snapshotVersion: number;
} & (
  | {
      status: 'accepted';
      rootKeyId: string;
    }
  | {
      status: 'rejected';
      reason:
        | 'snapshot_schema_invalid'
        | 'unknown_root'
        | 'bad_snapshot_signature'
        | 'algorithm_mismatch'
        | 'snapshot_rollback'
        | 'future_dated'
        | 'snapshot_window_invalid'
        | 'persistence_failure'
        | 'malformed_timestamp'
        | 'duplicate_key_id'
        | 'duplicate_root'
        | 'invalid_key_window'
        | 'expired'
        | 'revoked';
      details: string;
      rootKeyId?: string;
    }
)>;

export type PublisherTrustSignatureDecision = Readonly<{
  snapshotId: string;
  snapshotVersion: number;
} & (
  | {
      status: 'trusted';
      reason: 'trusted';
      keyId: string;
      rootKeyId: string;
      publisherId: string;
      publicKey: string;
    }
  | {
      status: 'rejected';
      reason:
        | 'missing_signature_metadata'
        | 'unknown_key'
        | 'unknown_root'
        | 'wrong_publisher'
        | 'revoked'
        | 'expired'
        | 'unsupported_algorithm'
        | 'bad_public_key'
        | 'signature_time_missing'
        | 'signature_time_invalid'
        | 'invalid_key_window';
      details: string;
      keyId?: string;
      rootKeyId?: string;
      publisherId?: string;
    }
)>;

export type PublisherTrustStore = Readonly<{
  pinnedRoots: readonly UtopiaPublisherTrustRoot[];
  snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot;
  refreshSnapshot: (next: UtopiaPinnedRootSignedPublisherTrustSnapshot) => Promise<PublisherTrustSnapshotRefreshDecision>;
  resolvePackageSignatureDecision: (input: {
    signature?: UtopiaRegistrySignature;
    publisher?: UtopiaRegistryPublisher;
  }) => PublisherTrustSignatureDecision;
}>;

export async function createPublisherTrustStore(input: {
  pinnedRoots: readonly UtopiaPublisherTrustRoot[];
  snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot;
  persistence?: UtopiaPublisherTrustPersistence;
  now?: () => number;
}): Promise<PublisherTrustStore> {
  const now = input.now ?? Date.now;
  const pinnedRoots = validatePinnedRoots(input.pinnedRoots);
  const authenticated = await authenticatePinnedRootSignedSnapshot({
    pinnedRoots,
    snapshot: input.snapshot,
    nowMs: now(),
  });
  if (authenticated.status === 'rejected') {
    throw new Error(`publisher_trust_snapshot_invalid:${authenticated.reason}:${authenticated.details}`);
  }

  const persistedFloor = input.persistence ? await loadPersistedSnapshotFloor(input.persistence) : null;
  const floorConflict = persistedFloor ? snapshotFloorConflict(authenticated.snapshot, persistedFloor) : null;
  if (floorConflict) {
    throw new Error(
      `publisher_trust_snapshot_rollback:${floorConflict}`,
    );
  }

  if (input.persistence && (!persistedFloor || authenticated.snapshot.snapshotVersion > persistedFloor.minimumAcceptedSnapshotVersion)) {
    const persistenceDecision = await persistSnapshotFloor(input.persistence, authenticated.snapshot);
    if (persistenceDecision.status === 'rejected') {
      throw new Error(`publisher_trust_persistence_failed:${persistenceDecision.details}`);
    }
  }

  let currentSnapshot = authenticated.snapshot;
  return {
    pinnedRoots,
    get snapshot() {
      return currentSnapshot;
    },
    async refreshSnapshot(next) {
      const decision = await authenticatePinnedRootSignedSnapshot({
        pinnedRoots,
        snapshot: next,
        previousVersion: currentSnapshot.snapshotVersion,
        nowMs: now(),
      });
      if (decision.status === 'accepted') {
        let persistedFloor: UtopiaPublisherTrustSnapshotFloor | null = null;
        if (input.persistence) {
          try {
            persistedFloor = await loadPersistedSnapshotFloor(input.persistence);
          } catch (error) {
            return {
              status: 'rejected',
              reason: 'persistence_failure',
              details: error instanceof Error ? error.message : 'publisher trust snapshot persistence failed',
              snapshotId: decision.snapshotId,
              snapshotVersion: decision.snapshotVersion,
              rootKeyId: decision.rootKeyId,
            };
          }
        }
        const floorConflict = persistedFloor ? snapshotFloorConflict(decision.snapshot, persistedFloor) : null;
        if (floorConflict) {
          return {
            status: 'rejected',
            reason: 'snapshot_rollback',
            details: floorConflict,
            snapshotId: decision.snapshotId,
            snapshotVersion: decision.snapshotVersion,
            rootKeyId: decision.rootKeyId,
          };
        }

        if (input.persistence && (!persistedFloor || decision.snapshotVersion > persistedFloor.minimumAcceptedSnapshotVersion)) {
          const persistenceDecision = await persistSnapshotFloor(input.persistence, decision.snapshot);
          if (persistenceDecision.status === 'rejected') {
            return persistenceDecision;
          }
        }

        currentSnapshot = decision.snapshot;
        return {
          status: 'accepted',
          snapshotId: decision.snapshotId,
          snapshotVersion: decision.snapshotVersion,
          rootKeyId: decision.rootKeyId,
        };
      }
      return decision;
    },
    resolvePackageSignatureDecision({ signature, publisher }) {
      return resolvePublisherSignatureTrust({
        pinnedRoots,
        snapshot: currentSnapshot,
        signature,
        publisher,
      });
    },
  };
}

async function authenticatePinnedRootSignedSnapshot(input: {
  pinnedRoots: readonly UtopiaPublisherTrustRoot[];
  snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot;
  previousVersion?: number;
  nowMs: number;
}): Promise<
  | Readonly<{
      status: 'accepted';
      snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot;
      snapshotId: string;
      snapshotVersion: number;
      rootKeyId: string;
    }>
  | Extract<PublisherTrustSnapshotRefreshDecision, { status: 'rejected' }>
> {
  const structureError = validateSignedSnapshotStructure(input.snapshot, input.pinnedRoots);
  if (structureError) {
    return {
      status: 'rejected',
      reason: structureError.reason,
      details: structureError.details,
      snapshotId: input.snapshot?.snapshotId ?? 'invalid',
      snapshotVersion: input.snapshot?.snapshotVersion ?? 0,
      rootKeyId: structureError.rootKeyId,
    };
  }

  const snapshotRootKeyId = input.snapshot.rootSignature.rootKeyId;
  const pinnedRoot = input.pinnedRoots.find((root) => root.rootKeyId === snapshotRootKeyId);
  if (!pinnedRoot) {
    return {
      status: 'rejected',
      reason: 'unknown_root',
      details: `pinned root ${snapshotRootKeyId} is not trusted`,
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      rootKeyId: snapshotRootKeyId,
    };
  }

  if (normalizeAlgorithm(pinnedRoot.algorithm) !== UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM
    || normalizeAlgorithm(input.snapshot.minimumAlgorithm) !== UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM
    || normalizeAlgorithm(input.snapshot.rootSignature.algorithm) !== UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM) {
    return {
      status: 'rejected',
      reason: 'algorithm_mismatch',
      details: 'snapshot must be signed with ECDSA P-256 SHA-256',
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      rootKeyId: snapshotRootKeyId,
    };
  }

  const rootSignedAt = Date.parse(input.snapshot.rootSignature.signedAt);
  if (Number.isNaN(rootSignedAt)) {
    return {
      status: 'rejected',
      reason: 'malformed_timestamp',
      details: 'rootSignature.signedAt must be an ISO timestamp',
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      rootKeyId: snapshotRootKeyId,
    };
  }

  const rootWindow = evaluateTimeWindow(pinnedRoot, rootSignedAt);
  if (!rootWindow.allowed) {
    return {
      status: 'rejected',
      reason: rootWindow.reason,
      details: rootWindow.details,
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      rootKeyId: snapshotRootKeyId,
    };
  }

  const freshnessError = validateSnapshotFreshness(input.snapshot, input.nowMs);
  if (freshnessError) {
    return {
      status: 'rejected',
      reason: freshnessError.reason,
      details: freshnessError.details,
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      rootKeyId: snapshotRootKeyId,
    };
  }

  const canonicalPayload = canonicalJson(stripRootSignature(input.snapshot));
  const verification = await verifyEcdsaSignature({
    canonicalPayload,
    publicKey: pinnedRoot.publicKey,
    signature: input.snapshot.rootSignature.value,
  });

  if (!verification) {
    return {
      status: 'rejected',
      reason: 'bad_snapshot_signature',
      details: 'pinned-root signed snapshot verification failed',
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      rootKeyId: snapshotRootKeyId,
    };
  }

  if (input.previousVersion !== undefined && input.snapshot.snapshotVersion <= input.previousVersion) {
    return {
      status: 'rejected',
      reason: 'snapshot_rollback',
      details: `snapshotVersion ${input.snapshot.snapshotVersion} must be greater than ${input.previousVersion}`,
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      rootKeyId: snapshotRootKeyId,
    };
  }

  return {
    status: 'accepted',
    snapshot: input.snapshot,
    snapshotId: input.snapshot.snapshotId,
    snapshotVersion: input.snapshot.snapshotVersion,
    rootKeyId: snapshotRootKeyId,
  };
}

function resolvePublisherSignatureTrust(input: {
  pinnedRoots: readonly UtopiaPublisherTrustRoot[];
  snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot;
  signature?: UtopiaRegistrySignature;
  publisher?: UtopiaRegistryPublisher;
}): PublisherTrustSignatureDecision {
  if (!input.signature || !input.signature.keyId || !input.publisher?.id) {
    return {
      status: 'rejected',
      reason: 'missing_signature_metadata',
      details: 'signature and publisher binding are required',
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
    };
  }

  const signature = input.signature;
  const publisher = input.publisher;

  if (!isText(signature.algorithm) || normalizeAlgorithm(signature.algorithm) !== UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM) {
    return {
      status: 'rejected',
      reason: 'unsupported_algorithm',
      details: `signature algorithm must be ${UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM}`,
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      keyId: signature.keyId,
      publisherId: publisher.id,
    };
  }

  const keyCandidates = input.snapshot.publisherKeys.filter((key) => key.keyId === signature.keyId);
  const matchedKey = keyCandidates.find((key) => key.publisherId === publisher.id);
  if (!matchedKey) {
    return {
      status: 'rejected',
      reason: keyCandidates.length ? 'wrong_publisher' : 'unknown_key',
      details: keyCandidates.length
        ? 'signature key is not bound to this publisher'
        : 'publisher key is not trusted',
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      keyId: signature.keyId,
      publisherId: publisher.id,
    };
  }

  if (!input.pinnedRoots.some((root) => root.rootKeyId === matchedKey.rootKeyId)) {
    return {
      status: 'rejected',
      reason: 'unknown_root',
      details: `pinned root ${matchedKey.rootKeyId} is not trusted`,
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      keyId: matchedKey.keyId,
      rootKeyId: matchedKey.rootKeyId,
      publisherId: publisher.id,
    };
  }

  const keyWindow = validatePublisherKeyWindow(matchedKey);
  if (!keyWindow.allowed) {
    return {
      status: 'rejected',
      reason: keyWindow.reason,
      details: keyWindow.details,
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      keyId: matchedKey.keyId,
      rootKeyId: matchedKey.rootKeyId,
      publisherId: publisher.id,
    };
  }

  const signatureTimeText = signature.signedAt?.trim();
  const signatureTime = signatureTimeText ? Date.parse(signatureTimeText) : NaN;

  if ((matchedKey.notBefore || matchedKey.revokedAt) && !signatureTimeText) {
    return {
      status: 'rejected',
      reason: 'signature_time_missing',
      details: 'signature timestamp required for key window checks',
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      keyId: matchedKey.keyId,
      rootKeyId: matchedKey.rootKeyId,
      publisherId: publisher.id,
    };
  }

  if (signatureTimeText && Number.isNaN(signatureTime)) {
    return {
      status: 'rejected',
      reason: 'signature_time_invalid',
      details: 'signature.signedAt must be an ISO timestamp',
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      keyId: matchedKey.keyId,
      rootKeyId: matchedKey.rootKeyId,
      publisherId: publisher.id,
    };
  }

  if (signatureTimeText) {
    const keyTimeWindow = evaluateTimeWindow(matchedKey, signatureTime);
    if (!keyTimeWindow.allowed) {
      return {
        status: 'rejected',
        reason: keyTimeWindow.reason,
        details: keyTimeWindow.details,
        snapshotId: input.snapshot.snapshotId,
        snapshotVersion: input.snapshot.snapshotVersion,
        keyId: matchedKey.keyId,
        rootKeyId: matchedKey.rootKeyId,
        publisherId: publisher.id,
      };
    }
  }

  if (signature.publicKey && signature.publicKey !== matchedKey.publicKey) {
    return {
      status: 'rejected',
      reason: 'bad_public_key',
      details: 'signature publicKey does not match trusted key',
      snapshotId: input.snapshot.snapshotId,
      snapshotVersion: input.snapshot.snapshotVersion,
      keyId: matchedKey.keyId,
      rootKeyId: matchedKey.rootKeyId,
      publisherId: publisher.id,
    };
  }

  return {
    status: 'trusted',
    reason: 'trusted',
    snapshotId: input.snapshot.snapshotId,
    snapshotVersion: input.snapshot.snapshotVersion,
    keyId: matchedKey.keyId,
    rootKeyId: matchedKey.rootKeyId,
    publisherId: publisher.id,
    publicKey: matchedKey.publicKey,
  };
}

function validatePinnedRoots(pinnedRoots: readonly UtopiaPublisherTrustRoot[]): readonly UtopiaPublisherTrustRoot[] {
  if (!Array.isArray(pinnedRoots) || pinnedRoots.length === 0) {
    throw new Error('publisher_trust_roots_invalid:pinned roots are required');
  }

  const seen = new Set<string>();
  const normalizedRoots: UtopiaPublisherTrustRoot[] = [];
  for (const root of pinnedRoots) {
    const rootError = validatePinnedRoot(root);
    if (rootError) {
      throw new Error(`publisher_trust_roots_invalid:${rootError}`);
    }

    if (seen.has(root.rootKeyId)) {
      throw new Error(`publisher_trust_roots_invalid:duplicate_root:${root.rootKeyId}`);
    }
    seen.add(root.rootKeyId);
    normalizedRoots.push(root);
  }

  return normalizedRoots;
}

function validatePinnedRoot(root: UtopiaPublisherTrustRoot): string | null {
  if (!isRecord(root)) return 'root must be an object';
  if (!isText(root.rootKeyId)) return 'rootKeyId is required';
  if (!isText(root.publicKey)) return `root ${root.rootKeyId} publicKey is required`;
  if (normalizeAlgorithm(root.algorithm) !== UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM) {
    return `root ${root.rootKeyId} algorithm must be ${UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM}`;
  }
  if (root.status !== 'trusted' && root.status !== 'revoked') return `root ${root.rootKeyId} status is invalid`;
  if (root.notBefore && !isIsoTimestamp(root.notBefore)) return `root ${root.rootKeyId} notBefore must be an ISO timestamp`;
  if (root.revokedAt && !isIsoTimestamp(root.revokedAt)) return `root ${root.rootKeyId} revokedAt must be an ISO timestamp`;
  if (root.notBefore && root.revokedAt && Date.parse(root.notBefore) > Date.parse(root.revokedAt)) {
    return `root ${root.rootKeyId} window is invalid`;
  }
  return null;
}

function validateSignedSnapshotStructure(
  snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot | undefined | null,
  pinnedRoots: readonly UtopiaPublisherTrustRoot[],
): Readonly<{
  reason:
    | 'snapshot_schema_invalid'
    | 'unknown_root'
    | 'algorithm_mismatch'
    | 'malformed_timestamp'
    | 'snapshot_window_invalid'
    | 'duplicate_key_id'
    | 'invalid_key_window'
    | 'revoked';
  details: string;
  rootKeyId?: string;
} | null> {
  if (!snapshot) {
    return { reason: 'snapshot_schema_invalid', details: 'snapshot is required' };
  }
  if (snapshot.schemaVersion !== UTOPIA_PUBLISHER_TRUST_SNAPSHOT_SCHEMA_VERSION) {
    return { reason: 'snapshot_schema_invalid', details: 'snapshot schemaVersion is invalid' };
  }
  if (!isText(snapshot.snapshotId)) {
    return { reason: 'snapshot_schema_invalid', details: 'snapshotId is required' };
  }
  if (!Number.isInteger(snapshot.snapshotVersion) || snapshot.snapshotVersion <= 0) {
    return { reason: 'snapshot_schema_invalid', details: 'snapshotVersion must be a positive integer' };
  }
  if (!isIsoTimestamp(snapshot.createdAt)) {
    return { reason: 'malformed_timestamp', details: 'createdAt must be an ISO timestamp' };
  }
  if (!isIsoTimestamp(snapshot.expiresAt)) {
    return { reason: 'malformed_timestamp', details: 'expiresAt must be an ISO timestamp' };
  }
  if (Date.parse(snapshot.createdAt) > Date.parse(snapshot.expiresAt)) {
    return { reason: 'snapshot_window_invalid', details: 'snapshot createdAt must be before expiresAt' };
  }
  if (normalizeAlgorithm(snapshot.minimumAlgorithm) !== UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM) {
    return { reason: 'algorithm_mismatch', details: `minimumAlgorithm must be ${UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM}` };
  }
  if (!isRecord(snapshot.rootSignature)) {
    return { reason: 'snapshot_schema_invalid', details: 'rootSignature is required' };
  }
  if (!isText(snapshot.rootSignature.rootKeyId)) {
    return { reason: 'snapshot_schema_invalid', details: 'rootSignature.rootKeyId is required' };
  }
  if (!isText(snapshot.rootSignature.value)) {
    return { reason: 'snapshot_schema_invalid', details: 'rootSignature.value is required' };
  }
  if (!isText(snapshot.rootSignature.algorithm)) {
    return { reason: 'snapshot_schema_invalid', details: 'rootSignature.algorithm is required' };
  }
  if (!isIsoTimestamp(snapshot.rootSignature.signedAt)) {
    return { reason: 'malformed_timestamp', details: 'rootSignature.signedAt must be an ISO timestamp' };
  }
  if (!Array.isArray(snapshot.publisherKeys)) {
    return { reason: 'snapshot_schema_invalid', details: 'publisherKeys must be an array' };
  }

  const pinnedRootIds = new Set(pinnedRoots.map((root) => root.rootKeyId));
  const seenKeyIds = new Set<string>();

  for (const key of snapshot.publisherKeys) {
    const keyError = validatePublisherKey(key, pinnedRootIds);
    if (keyError) return keyError;
    if (seenKeyIds.has(key.keyId)) {
      return {
        reason: 'duplicate_key_id',
        details: `duplicate keyId ${key.keyId}`,
        rootKeyId: key.rootKeyId,
      };
    }
    seenKeyIds.add(key.keyId);
  }

  return null;
}

function validateSnapshotFreshness(
  snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot,
  nowMs: number,
): Readonly<{
  reason: 'future_dated' | 'snapshot_window_invalid' | 'expired';
  details: string;
} | null> {
  const createdAt = Date.parse(snapshot.createdAt);
  const signedAt = Date.parse(snapshot.rootSignature.signedAt);
  const expiresAt = Date.parse(snapshot.expiresAt);
  if (signedAt < createdAt) {
    return { reason: 'snapshot_window_invalid', details: 'rootSignature.signedAt must not precede createdAt' };
  }
  if (signedAt > expiresAt) {
    return { reason: 'snapshot_window_invalid', details: 'rootSignature.signedAt must not exceed expiresAt' };
  }
  if (signedAt > nowMs) {
    return { reason: 'future_dated', details: 'rootSignature.signedAt must not be in the future' };
  }
  if (nowMs >= expiresAt) {
    return { reason: 'expired', details: 'snapshot has expired' };
  }
  return null;
}

function validatePublisherKey(
  key: UtopiaPublisherTrustKey,
  pinnedRootIds: Set<string>,
): Readonly<{
  reason:
    | 'snapshot_schema_invalid'
    | 'unknown_root'
    | 'malformed_timestamp'
    | 'invalid_key_window'
    | 'algorithm_mismatch'
    | 'revoked';
  details: string;
  rootKeyId?: string;
} | null> {
  if (!isRecord(key)) return { reason: 'snapshot_schema_invalid', details: 'publisher key must be an object' };
  if (!isText(key.rootKeyId)) return { reason: 'snapshot_schema_invalid', details: 'publisher key rootKeyId is required' };
  if (!pinnedRootIds.has(key.rootKeyId)) {
    return { reason: 'unknown_root', details: `pinned root ${key.rootKeyId} is not trusted`, rootKeyId: key.rootKeyId };
  }
  if (!isText(key.publisherId)) return { reason: 'snapshot_schema_invalid', details: 'publisherId is required', rootKeyId: key.rootKeyId };
  if (!isText(key.keyId)) return { reason: 'snapshot_schema_invalid', details: 'keyId is required', rootKeyId: key.rootKeyId };
  if (!isText(key.publicKey)) return { reason: 'snapshot_schema_invalid', details: `key ${key.keyId} publicKey is required`, rootKeyId: key.rootKeyId };
  if (!isText(key.algorithm)) return { reason: 'snapshot_schema_invalid', details: `key ${key.keyId} algorithm is required`, rootKeyId: key.rootKeyId };
  if (normalizeAlgorithm(key.algorithm) !== UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM) {
    return {
      reason: 'algorithm_mismatch',
      details: `key ${key.keyId} algorithm must be ${UTOPIA_PUBLISHER_MIN_SIGNATURE_ALGORITHM}`,
      rootKeyId: key.rootKeyId,
    };
  }
  if (key.status !== 'trusted' && key.status !== 'revoked') {
    return { reason: 'snapshot_schema_invalid', details: `key ${key.keyId} status is invalid`, rootKeyId: key.rootKeyId };
  }
  if (key.notBefore && !isIsoTimestamp(key.notBefore)) {
    return { reason: 'malformed_timestamp', details: `key ${key.keyId} notBefore must be an ISO timestamp`, rootKeyId: key.rootKeyId };
  }
  if (key.revokedAt && !isIsoTimestamp(key.revokedAt)) {
    return { reason: 'malformed_timestamp', details: `key ${key.keyId} revokedAt must be an ISO timestamp`, rootKeyId: key.rootKeyId };
  }
  if (key.notBefore && key.revokedAt && Date.parse(key.notBefore) > Date.parse(key.revokedAt)) {
    return { reason: 'invalid_key_window', details: `key ${key.keyId} window is invalid`, rootKeyId: key.rootKeyId };
  }
  return null;
}

function validatePublisherKeyWindow(
  key: UtopiaPublisherTrustKey,
): Readonly<
  | { allowed: true }
  | {
      allowed: false;
      reason: 'revoked' | 'expired' | 'invalid_key_window';
      details: string;
    }
> {
  if (key.status === 'revoked') {
    return { allowed: false, reason: 'revoked', details: 'publisher key is revoked' };
  }
  if (key.notBefore && key.revokedAt && Date.parse(key.notBefore) > Date.parse(key.revokedAt)) {
    return { allowed: false, reason: 'invalid_key_window', details: 'publisher key window is invalid' };
  }
  return { allowed: true };
}

function evaluateTimeWindow(
  input: { status: 'trusted' | 'revoked'; notBefore?: string; revokedAt?: string },
  timestamp: number,
): Readonly<
  | { allowed: true }
  | {
      allowed: false;
      reason: 'revoked' | 'expired' | 'invalid_key_window';
      details: string;
    }
> {
  if (input.status === 'revoked') {
    return { allowed: false, reason: 'revoked', details: 'trusted key is revoked' };
  }
  if (input.notBefore && input.revokedAt && Date.parse(input.notBefore) > Date.parse(input.revokedAt)) {
    return { allowed: false, reason: 'invalid_key_window', details: 'trusted key window is invalid' };
  }
  if (input.notBefore && timestamp < Date.parse(input.notBefore)) {
    return { allowed: false, reason: 'expired', details: 'signature predates trusted key window' };
  }
  if (input.revokedAt && timestamp >= Date.parse(input.revokedAt)) {
    return { allowed: false, reason: 'expired', details: 'signature was made after key revocation' };
  }
  return { allowed: true };
}

async function verifyEcdsaSignature(input: {
  canonicalPayload: string;
  publicKey: string;
  signature: string;
}): Promise<boolean> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return false;
    const publicKey = await subtle.importKey(
      'spki',
      decodePublicKey(input.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      decodeSignatureBytes(input.signature),
      new TextEncoder().encode(input.canonicalPayload),
    );
  } catch {
    return false;
  }
}

function stripRootSignature(snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot): UtopiaPinnedRootSignedPublisherTrustSnapshotPayload {
  const { rootSignature: _rootSignature, ...payload } = snapshot;
  return payload;
}

async function loadPersistedSnapshotFloor(
  persistence: UtopiaPublisherTrustPersistence,
): Promise<UtopiaPublisherTrustSnapshotFloor | null> {
  try {
    const persisted = await persistence.load();
    if (persisted === null) return null;
    if (!isPersistedSnapshotFloor(persisted)) {
      throw new Error('persisted floor is invalid');
    }
    return persisted;
  } catch (error) {
    throw new Error(`publisher_trust_persistence_failed:load:${error instanceof Error ? error.message : 'unknown'}`);
  }
}

async function persistSnapshotFloor(
  persistence: UtopiaPublisherTrustPersistence,
  snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot,
): Promise<
  | Readonly<{ status: 'accepted' }>
  | Extract<PublisherTrustSnapshotRefreshDecision, { status: 'rejected' }>
> {
  try {
    await persistence.save({
      minimumAcceptedSnapshotVersion: snapshot.snapshotVersion,
      snapshotId: snapshot.snapshotId,
      rootKeyId: snapshot.rootSignature.rootKeyId,
    });
    return { status: 'accepted' };
  } catch (error) {
    return {
      status: 'rejected',
      reason: 'persistence_failure',
      details: `publisher trust snapshot floor persistence failed:${error instanceof Error ? error.message : 'unknown'}`,
      snapshotId: snapshot.snapshotId,
      snapshotVersion: snapshot.snapshotVersion,
      rootKeyId: snapshot.rootSignature.rootKeyId,
    };
  }
}

function isPersistedSnapshotFloor(value: unknown): value is UtopiaPublisherTrustSnapshotFloor {
  return isRecord(value)
    && isText((value as UtopiaPublisherTrustSnapshotFloor).snapshotId)
    && isText((value as UtopiaPublisherTrustSnapshotFloor).rootKeyId)
    && Number.isInteger((value as UtopiaPublisherTrustSnapshotFloor).minimumAcceptedSnapshotVersion)
    && (value as UtopiaPublisherTrustSnapshotFloor).minimumAcceptedSnapshotVersion > 0;
}

function snapshotFloorConflict(
  snapshot: UtopiaPinnedRootSignedPublisherTrustSnapshot,
  floor: UtopiaPublisherTrustSnapshotFloor,
): string | null {
  if (snapshot.snapshotVersion < floor.minimumAcceptedSnapshotVersion) {
    return `snapshotVersion ${snapshot.snapshotVersion} is below persisted floor ${floor.minimumAcceptedSnapshotVersion}`;
  }
  if (
    snapshot.snapshotVersion === floor.minimumAcceptedSnapshotVersion
    && (snapshot.snapshotId !== floor.snapshotId || snapshot.rootSignature.rootKeyId !== floor.rootKeyId)
  ) {
    return `snapshotVersion ${snapshot.snapshotVersion} conflicts with persisted snapshot identity`;
  }
  return null;
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

function normalizeAlgorithm(algorithm: string): string {
  return algorithm.trim().toLowerCase();
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: string): boolean {
  return isText(value) && !Number.isNaN(Date.parse(value));
}
