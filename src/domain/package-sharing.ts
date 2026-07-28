import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, webcrypto } from 'node:crypto';

import {
  buildPackageInstallPreview,
  validateRegistryManifest,
  type PackageInstallApprovalReceipt,
  type UtopiaRegistryManifest,
  type UtopiaRegistryPackage,
} from '@/packages/shared/contracts/package-install';
import {
  DEFAULT_WORKSPACE_ID,
  type AppInstallation as LocalAppInstallation,
  type InstallationPackageState,
  type WorkspaceId,
} from '@/packages/shared/contracts/app-installation';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import type { Operation } from '@/packages/shared/contracts/operation';
import type { SQLiteDatabase } from 'expo-sqlite';

import { installApprovedAppPackage } from '@/src/db/app-package-registry';
import { canonicalJson, sha256Canonical } from '@/src/domain/canonical-json';
import { loadAppPackage } from '@/src/domain/package-loader';

export const UTOPIA_VAULT_SCHEMA_VERSION = 'utopia.package-vault.v1' as const;
export const UTOPIA_WORKSPACE_VAULT_PAYLOAD_SCHEMA_VERSION = 'utopia.workspace-vault-payload.v1' as const;
export const UTOPIA_REGISTRY_INDEX_SCHEMA_VERSION = 'utopia.registry-index.v1' as const;
export const UTOPIA_OPERATION_STREAM_SCHEMA_VERSION = 'utopia.operation-stream.v1' as const;
export const UTOPIA_SHARE_INVITE_SCHEMA_VERSION = 'utopia.share-invite.v1' as const;
export const UTOPIA_REGISTRY_DISTRIBUTION_SCHEMA_VERSION = 'utopia.registry-distribution.v1' as const;

const VAULT_ALGORITHM = 'aes-256-gcm';
const VAULT_KDF = 'pbkdf2-sha256' as const;
const VAULT_ITERATIONS = 210_000;
const VAULT_KEY_BYTES = 32;
const VAULT_SALT_BYTES = 16;
const VAULT_IV_BYTES = 12;
const VAULT_AUTH_TAG_BYTES = 16;
const VAULT_MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024;
const VAULT_MAX_JSON_BYTES = 8 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;
const MUTABLE_GITHUB_REFS = new Set(['head', 'latest', 'main', 'master']);

export type RegistryScaleCheck = Readonly<{
  packageCount: number;
  installableCount: number;
  checksumVerifiedCount: number;
}>;

export type RegistryIndexDescriptor = Readonly<{
  id: string;
  name: string;
  url: string;
  checksum?: string;
  packageCount?: number;
  description?: string;
}>;

export type RegistryIndex = Readonly<{
  schemaVersion: typeof UTOPIA_REGISTRY_INDEX_SCHEMA_VERSION;
  name: string;
  registries: readonly RegistryIndexDescriptor[];
}>;

export type GitHubRegistryDistribution = Readonly<{
  schemaVersion: typeof UTOPIA_REGISTRY_DISTRIBUTION_SCHEMA_VERSION;
  sourceRevision: string;
  releaseTag: string;
  assetName: string;
  registryAssetUrl: string;
  pagesIndexUrl: string;
  manifestChecksum: string;
  manifestSize: number;
  packageCount: number;
  integrityLane: 'unsigned_checksum';
  generatedAt: string;
}>;

export type PackageVaultExport = Readonly<{
  schemaVersion: typeof UTOPIA_VAULT_SCHEMA_VERSION;
  algorithm: typeof VAULT_ALGORITHM;
  kdf: typeof VAULT_KDF;
  iterations: number;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  packageChecksum: string;
  createdAt: string;
}>;

export type PackageVaultPayload = Readonly<{
  schemaVersion: 'utopia.package-vault-payload.v1';
  packageJson: unknown;
  installDescriptor: UtopiaRegistryPackage;
  workspaceId: WorkspaceId;
  exportedAt: string;
}>;

export type OperationStreamEntry = Readonly<{
  cursor: string;
  opId: string;
  installationId: string;
  recordId: string;
  createdAt: string;
  checksum: string;
  operation: Operation;
}>;

export type OperationStreamDesign = Readonly<{
  schemaVersion: typeof UTOPIA_OPERATION_STREAM_SCHEMA_VERSION;
  workspaceId: WorkspaceId;
  installationId: string;
  mode: 'append_only';
  ordering: 'cursor_then_created_at';
  cursor: string;
  checkpointChecksum: string;
  conflictPolicy: 'expected_revision_then_manual_review';
  entries: readonly OperationStreamEntry[];
}>;

export type WorkspaceBackupPayload = Readonly<{
  schemaVersion: typeof UTOPIA_WORKSPACE_VAULT_PAYLOAD_SCHEMA_VERSION;
  workspace: {
    id: WorkspaceId;
    label?: string;
    exportedAt: string;
  };
  installations: readonly LocalAppInstallation[];
  packageStates: readonly InstallationPackageState[];
  installDescriptors: readonly UtopiaRegistryPackage[];
  records: readonly CanonicalRecord[];
  operationStreams: readonly OperationStreamDesign[];
  checksums: {
    installations: string;
    packageStates: string;
    installDescriptors: string;
    records: string;
    operationStreams: string;
    payload: string;
  };
}>;

export type WorkspaceRestorePreview = Readonly<{
  schemaVersion: 'utopia.workspace-restore-preview.v1';
  workspaceId: WorkspaceId;
  counts: {
    installations: number;
    packageStates: number;
    installDescriptors: number;
    records: number;
    operationStreams: number;
    operations: number;
  };
  checksums: WorkspaceBackupPayload['checksums'];
  conflicts: readonly RestoreConflict[];
}>;

export type WorkspaceRestoreResult = Readonly<{
  schemaVersion: 'utopia.workspace-restore-result.v1';
  workspaceId: WorkspaceId;
  policy: 'fail_on_conflict' | 'backup_wins';
  counts: WorkspaceRestorePreview['counts'];
  checksums: WorkspaceBackupPayload['checksums'];
  conflicts: readonly RestoreConflict[];
  payload: WorkspaceBackupPayload;
}>;

export type RestoreConflict = Readonly<{
  kind: 'installation' | 'record' | 'operation_stream';
  id: string;
  reason: 'checksum_mismatch' | 'cursor_regression';
  backupChecksum: string;
  currentChecksum: string;
}>;

export type PackageInviteDescriptor = Readonly<{
  schemaVersion: typeof UTOPIA_SHARE_INVITE_SCHEMA_VERSION;
  inviteId: string;
  workspaceId: WorkspaceId;
  workspace: {
    id: WorkspaceId;
    label?: string;
  };
  targetInstallationId: string;
  invitedBy: string;
  invitedAt: string;
  installDescriptor: UtopiaRegistryPackage;
  operationStream: OperationStreamDesign;
}>;

export function serializeVaultExport(vault: PackageVaultExport): string {
  return canonicalJson(validateVaultExport(vault));
}

export function parseVaultExport(input: string): PackageVaultExport {
  if (typeof input !== 'string' || !input.trim()) throw new Error('vault_export_text_required');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('vault_export_json_invalid');
  }
  return validateVaultExport(parsed);
}

export function buildGitHubRawPackageUrl(input: {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}): string {
  const owner = requirePathSegment(input.owner, 'owner');
  const repo = requirePathSegment(input.repo, 'repo');
  const ref = requirePathSegment(input.ref, 'ref');
  const path = input.path.split('/').map((part) => requirePathSegment(part, 'path')).join('/');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

export function buildGitHubReleaseAssetUrl(input: {
  owner: string;
  repo: string;
  tag: string;
  assetName: string;
}): string {
  const owner = requirePathSegment(input.owner, 'owner');
  const repo = requirePathSegment(input.repo, 'repo');
  const tag = requirePathSegment(input.tag, 'tag');
  const assetName = requirePathSegment(input.assetName, 'asset');
  return `https://github.com/${owner}/${repo}/releases/download/${tag}/${assetName}`;
}

export function buildGitHubPagesIndexUrl(input: {
  owner: string;
  repo: string;
  path: string;
}): string {
  const owner = requirePathSegment(input.owner, 'owner');
  const repo = requirePathSegment(input.repo, 'repo');
  const path = input.path.split('/').map((part) => requirePathSegment(part, 'path')).join('/');
  return `https://${owner}.github.io/${repo}/${path}`;
}

export function buildRegistryInstallDescriptor(input: {
  packageJson: unknown;
  name?: string;
  url: string;
  description?: string;
}): UtopiaRegistryPackage {
  const appPackage = loadAppPackage(input.packageJson).activePackage;
  return {
    id: appPackage.id,
    name: input.name?.trim() || appPackage.presentation?.label || appPackage.id,
    version: appPackage.version,
    url: requireHttps(input.url),
    checksum: sha256Canonical(appPackage),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
  };
}

export function buildRegistryManifest(input: {
  name: string;
  packages: readonly UtopiaRegistryPackage[];
}): UtopiaRegistryManifest {
  return validateRegistryManifest({
    schemaVersion: 'utopia.registry.v1',
    name: input.name,
    packages: input.packages,
  });
}

export function buildRegistryIndexDescriptor(input: {
  id: string;
  name: string;
  url: string;
  manifest?: UtopiaRegistryManifest;
  description?: string;
}): RegistryIndexDescriptor {
  const descriptor: RegistryIndexDescriptor = {
    id: requireText(input.id, 'registry_id_required'),
    name: requireText(input.name, 'registry_name_required'),
    url: requireHttps(input.url),
    ...(input.manifest ? {
      checksum: sha256Canonical(validateRegistryManifest(input.manifest)),
      packageCount: input.manifest.packages.length,
    } : {}),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
  };
  return descriptor;
}

export function buildRegistryIndex(input: {
  name: string;
  registries: readonly RegistryIndexDescriptor[];
}): RegistryIndex {
  return validateRegistryIndex({
    schemaVersion: UTOPIA_REGISTRY_INDEX_SCHEMA_VERSION,
    name: input.name,
    registries: input.registries,
  });
}

export function buildGitHubRegistryDistribution(input: {
  owner: string;
  repo: string;
  releaseTag: string;
  assetName: string;
  pagesPath: string;
  sourceRevision: string;
  manifest: UtopiaRegistryManifest;
  generatedAt?: string;
}): GitHubRegistryDistribution {
  const manifest = validateRegistryManifest(input.manifest);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  assertTimestamp(generatedAt, 'registry_distribution_generated_at_invalid');
  const sourceRevision = requireSourceRevision(input.sourceRevision);
  const registryAssetUrl = buildGitHubReleaseAssetUrl({
    owner: input.owner,
    repo: input.repo,
    tag: input.releaseTag,
    assetName: input.assetName,
  });
  const pagesIndexUrl = buildGitHubPagesIndexUrl({
    owner: input.owner,
    repo: input.repo,
    path: input.pagesPath,
  });
  assertImmutableGitHubReleaseAssetUrl(registryAssetUrl);
  return validateGitHubRegistryDistribution({
    schemaVersion: UTOPIA_REGISTRY_DISTRIBUTION_SCHEMA_VERSION,
    sourceRevision,
    releaseTag: requireImmutableGitHubRef(input.releaseTag, 'github_tag_invalid'),
    assetName: requirePathSegment(input.assetName, 'asset'),
    registryAssetUrl,
    pagesIndexUrl,
    manifestChecksum: sha256Canonical(manifest),
    manifestSize: utf8ByteLength(canonicalJson(manifest)),
    packageCount: manifest.packages.length,
    integrityLane: 'unsigned_checksum',
    generatedAt,
  });
}

export function validateRegistryIndex(input: unknown): RegistryIndex {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('registry_index_invalid');
  const index = input as RegistryIndex;
  if (index.schemaVersion !== UTOPIA_REGISTRY_INDEX_SCHEMA_VERSION) throw new Error('registry_index_schema_invalid');
  requireText(index.name, 'registry_index_name_required');
  if (!Array.isArray(index.registries)) throw new Error('registry_index_registries_required');
  const ids = new Set<string>();
  for (const registry of index.registries) {
    requireText(registry.id, 'registry_id_required');
    requireText(registry.name, 'registry_name_required');
    requireHttps(registry.url);
    if (registry.checksum !== undefined && !isSha256(registry.checksum)) throw new Error('registry_checksum_invalid');
    if (registry.packageCount !== undefined && (!Number.isInteger(registry.packageCount) || registry.packageCount < 0)) {
      throw new Error('registry_package_count_invalid');
    }
    if (ids.has(registry.id)) throw new Error(`registry_duplicate:${registry.id}`);
    ids.add(registry.id);
  }
  return index;
}

export function validateGitHubRegistryDistribution(input: unknown): GitHubRegistryDistribution {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('registry_distribution_invalid');
  const distribution = input as GitHubRegistryDistribution;
  if (distribution.schemaVersion !== UTOPIA_REGISTRY_DISTRIBUTION_SCHEMA_VERSION) {
    throw new Error('registry_distribution_schema_invalid');
  }
  requireSourceRevision(distribution.sourceRevision);
  requireImmutableGitHubRef(distribution.releaseTag, 'github_tag_invalid');
  requirePathSegment(distribution.assetName, 'asset');
  assertImmutableGitHubReleaseAssetUrl(distribution.registryAssetUrl);
  assertGitHubPagesIndexUrl(distribution.pagesIndexUrl);
  if (!isSha256(distribution.manifestChecksum)) throw new Error('registry_distribution_checksum_invalid');
  if (!Number.isInteger(distribution.manifestSize) || distribution.manifestSize <= 0 || distribution.manifestSize > VAULT_MAX_JSON_BYTES) {
    throw new Error('registry_distribution_manifest_size_invalid');
  }
  if (!Number.isInteger(distribution.packageCount) || distribution.packageCount < 0) {
    throw new Error('registry_distribution_package_count_invalid');
  }
  if (distribution.integrityLane !== 'unsigned_checksum') throw new Error('registry_distribution_integrity_lane_invalid');
  assertTimestamp(distribution.generatedAt, 'registry_distribution_generated_at_invalid');
  return distribution;
}

export function checkRegistryInstallCompatibility(input: {
  manifest: UtopiaRegistryManifest;
  packagesByUrl: ReadonlyMap<string, unknown> | Record<string, unknown>;
}): RegistryScaleCheck {
  const manifest = validateRegistryManifest(input.manifest);
  let installableCount = 0;
  let checksumVerifiedCount = 0;
  for (const descriptor of manifest.packages) {
    const packageJson = getPackageForUrl(input.packagesByUrl, descriptor.url);
    if (!packageJson) throw new Error(`registry_package_missing:${descriptor.url}`);
    const preview = buildPackageInstallPreview(packageJson, {
      sourceUrl: descriptor.url,
      registryPackage: descriptor,
    });
    if (preview.packageId !== descriptor.id || preview.version !== descriptor.version) {
      throw new Error(`registry_package_identity_mismatch:${descriptor.id}@${descriptor.version}`);
    }
    if (preview.status !== 'ready_for_review') {
      throw new Error(`registry_package_not_installable:${descriptor.id}@${descriptor.version}:${preview.validationErrors.join('|')}`);
    }
    installableCount += 1;
    if (preview.trust.status === 'checksum_verified') checksumVerifiedCount += 1;
  }
  return {
    packageCount: manifest.packages.length,
    installableCount,
    checksumVerifiedCount,
  };
}

export function buildOperationStreamDesign(input: {
  workspaceId?: WorkspaceId;
  installationId: string;
  entries: readonly Omit<OperationStreamEntry, 'checksum' | 'installationId'>[];
  cursor?: string;
}): OperationStreamDesign {
  const installationId = requireText(input.installationId, 'operation_stream_installation_required');
  const entries = input.entries.map((entry) => {
    requireText(entry.cursor, 'operation_stream_cursor_required');
    requireText(entry.opId, 'operation_stream_op_id_required');
    requireText(entry.recordId, 'operation_stream_record_id_required');
    assertTimestamp(entry.createdAt, 'operation_stream_created_at_invalid');
    if (entry.operation.op_id !== entry.opId) throw new Error('operation_stream_op_id_mismatch');
    if (entry.operation.record_id !== entry.recordId) throw new Error('operation_stream_record_id_mismatch');
    return {
      ...entry,
      installationId,
      checksum: sha256Canonical({
        cursor: entry.cursor,
        opId: entry.opId,
        recordId: entry.recordId,
        createdAt: entry.createdAt,
        operation: entry.operation,
      }),
    };
  });
  return validateOperationStreamDesign({
    schemaVersion: UTOPIA_OPERATION_STREAM_SCHEMA_VERSION,
    workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    installationId,
    mode: 'append_only',
    ordering: 'cursor_then_created_at',
    cursor: input.cursor ?? entries.at(-1)?.cursor ?? '0',
    checkpointChecksum: sha256Canonical(entries),
    conflictPolicy: 'expected_revision_then_manual_review',
    entries,
  });
}

export function validateOperationStreamDesign(input: unknown): OperationStreamDesign {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('operation_stream_invalid');
  const stream = input as OperationStreamDesign;
  if (stream.schemaVersion !== UTOPIA_OPERATION_STREAM_SCHEMA_VERSION) throw new Error('operation_stream_schema_invalid');
  requireText(stream.workspaceId, 'operation_stream_workspace_required');
  requireText(stream.installationId, 'operation_stream_installation_required');
  if (stream.mode !== 'append_only') throw new Error('operation_stream_mode_invalid');
  if (stream.ordering !== 'cursor_then_created_at') throw new Error('operation_stream_ordering_invalid');
  requireText(stream.cursor, 'operation_stream_cursor_required');
  if (!isSha256(stream.checkpointChecksum)) throw new Error('operation_stream_checkpoint_invalid');
  if (stream.conflictPolicy !== 'expected_revision_then_manual_review') throw new Error('operation_stream_conflict_policy_invalid');
  if (!Array.isArray(stream.entries)) throw new Error('operation_stream_entries_required');
  const seen = new Set<string>();
  let previousCursor = '';
  for (const entry of stream.entries) {
    if (entry.installationId !== stream.installationId) throw new Error('operation_stream_entry_installation_mismatch');
    requireText(entry.cursor, 'operation_stream_entry_cursor_required');
    requireText(entry.opId, 'operation_stream_entry_op_id_required');
    requireText(entry.recordId, 'operation_stream_entry_record_id_required');
    assertTimestamp(entry.createdAt, 'operation_stream_entry_created_at_invalid');
    if (!isSha256(entry.checksum)) throw new Error('operation_stream_entry_checksum_invalid');
    if (seen.has(entry.opId)) throw new Error(`operation_stream_duplicate:${entry.opId}`);
    if (previousCursor && compareCursor(entry.cursor, previousCursor) <= 0) throw new Error('operation_stream_cursor_regression');
    if (entry.operation.op_id !== entry.opId || entry.operation.record_id !== entry.recordId) throw new Error('operation_stream_entry_operation_mismatch');
    const expectedChecksum = sha256Canonical({
      cursor: entry.cursor,
      opId: entry.opId,
      recordId: entry.recordId,
      createdAt: entry.createdAt,
      operation: entry.operation,
    });
    if (entry.checksum !== expectedChecksum) throw new Error('operation_stream_entry_checksum_mismatch');
    seen.add(entry.opId);
    previousCursor = entry.cursor;
  }
  if (stream.checkpointChecksum !== sha256Canonical(stream.entries)) throw new Error('operation_stream_checkpoint_mismatch');
  return stream;
}

export function exportEncryptedPackageVault(input: {
  packageJson: unknown;
  installDescriptor: UtopiaRegistryPackage;
  passphrase: string;
  workspaceId?: WorkspaceId;
  now?: string;
}): PackageVaultExport {
  const appPackage = loadAppPackage(input.packageJson).activePackage;
  if (sha256Canonical(appPackage) !== input.installDescriptor.checksum) throw new Error('vault_package_checksum_mismatch');
  const now = input.now ?? new Date().toISOString();
  const payload: PackageVaultPayload = {
    schemaVersion: 'utopia.package-vault-payload.v1',
    packageJson: appPackage,
    installDescriptor: input.installDescriptor,
    workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    exportedAt: now,
  };
  return encryptVaultPayload(payload, input.passphrase, input.installDescriptor.checksum, now);
}

export function exportEncryptedWorkspaceVault(input: {
  workspaceId?: WorkspaceId;
  workspaceLabel?: string;
  installations: readonly LocalAppInstallation[];
  packageStates: readonly InstallationPackageState[];
  installDescriptors: readonly UtopiaRegistryPackage[];
  records: readonly CanonicalRecord[];
  operationStreams: readonly OperationStreamDesign[];
  passphrase: string;
  now?: string;
}): PackageVaultExport {
  const now = input.now ?? new Date().toISOString();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const streams = input.operationStreams.map(validateOperationStreamDesign);
  const payloadWithoutChecksum = {
    schemaVersion: UTOPIA_WORKSPACE_VAULT_PAYLOAD_SCHEMA_VERSION,
    workspace: {
      id: workspaceId,
      ...(input.workspaceLabel?.trim() ? { label: input.workspaceLabel.trim() } : {}),
      exportedAt: now,
    },
    installations: [...input.installations],
    packageStates: [...input.packageStates],
    installDescriptors: [...input.installDescriptors],
    records: [...input.records],
    operationStreams: streams,
  };
  const checksums = workspaceBackupChecksums(payloadWithoutChecksum);
  const payload: WorkspaceBackupPayload = {
    ...payloadWithoutChecksum,
    checksums: {
      ...checksums,
      payload: sha256Canonical({ ...payloadWithoutChecksum, checksums }),
    },
  };
  return encryptVaultPayload(payload, input.passphrase, sha256Canonical(payload), now);
}

export function previewEncryptedWorkspaceVault(input: {
  vault: PackageVaultExport;
  passphrase: string;
  current?: {
    installations?: readonly LocalAppInstallation[];
    records?: readonly CanonicalRecord[];
    operationStreams?: readonly OperationStreamDesign[];
  };
}): WorkspaceRestorePreview {
  const payload = parseWorkspaceBackupPayload(decryptAnyVaultPayload(input.vault, input.passphrase));
  if (sha256Canonical(payload) !== input.vault.packageChecksum) throw new Error('vault_workspace_checksum_mismatch');
  const operations = payload.operationStreams.reduce((total, stream) => total + stream.entries.length, 0);
  return {
    schemaVersion: 'utopia.workspace-restore-preview.v1',
    workspaceId: payload.workspace.id,
    counts: {
      installations: payload.installations.length,
      packageStates: payload.packageStates.length,
      installDescriptors: payload.installDescriptors.length,
      records: payload.records.length,
      operationStreams: payload.operationStreams.length,
      operations,
    },
    checksums: payload.checksums,
    conflicts: collectRestoreConflicts(payload, input.current),
  };
}

export function restoreEncryptedWorkspaceVault(input: {
  vault: PackageVaultExport;
  passphrase: string;
  current?: {
    installations?: readonly LocalAppInstallation[];
    records?: readonly CanonicalRecord[];
    operationStreams?: readonly OperationStreamDesign[];
  };
  policy?: 'fail_on_conflict' | 'backup_wins';
}): WorkspaceRestoreResult {
  const payload = parseWorkspaceBackupPayload(decryptAnyVaultPayload(input.vault, input.passphrase));
  if (sha256Canonical(payload) !== input.vault.packageChecksum) throw new Error('vault_workspace_checksum_mismatch');
  const preview = previewEncryptedWorkspaceVault(input);
  const policy = input.policy ?? 'fail_on_conflict';
  if (policy === 'fail_on_conflict' && preview.conflicts.length > 0) throw new Error('vault_restore_conflicts_present');
  return {
    schemaVersion: 'utopia.workspace-restore-result.v1',
    workspaceId: payload.workspace.id,
    policy,
    counts: preview.counts,
    checksums: preview.checksums,
    conflicts: preview.conflicts,
    payload,
  };
}

export function previewEncryptedPackageVault(input: {
  vault: PackageVaultExport;
  passphrase: string;
}): PackageVaultPayload {
  const payload = decryptVaultPayload(input.vault, input.passphrase);
  const appPackage = loadAppPackage(payload.packageJson).activePackage;
  if (sha256Canonical(appPackage) !== input.vault.packageChecksum) throw new Error('vault_package_checksum_mismatch');
  return payload;
}

export function restoreEncryptedPackageVault(input: {
  vault: PackageVaultExport;
  passphrase: string;
}): PackageVaultPayload {
  return previewEncryptedPackageVault(input);
}

export function buildShareInviteDescriptor(input: {
  inviteId: string;
  workspaceId?: WorkspaceId;
  workspaceLabel?: string;
  targetInstallationId: string;
  invitedBy: string;
  invitedAt?: string;
  installDescriptor: UtopiaRegistryPackage;
  operationStream?: OperationStreamDesign;
  operationCursor?: string;
}): PackageInviteDescriptor {
  const invitedAt = input.invitedAt ?? new Date().toISOString();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  if (!input.inviteId.trim()) throw new Error('share_invite_id_required');
  if (!input.targetInstallationId.trim()) throw new Error('share_installation_id_required');
  if (!input.invitedBy.trim()) throw new Error('share_inviter_required');
  if (Number.isNaN(Date.parse(invitedAt))) throw new Error('share_invited_at_invalid');
  const operationStream = input.operationStream
    ? validateOperationStreamDesign(input.operationStream)
    : buildOperationStreamDesign({
      workspaceId,
      installationId: input.targetInstallationId,
      cursor: input.operationCursor ?? '0',
      entries: [],
    });
  return {
    schemaVersion: UTOPIA_SHARE_INVITE_SCHEMA_VERSION,
    inviteId: input.inviteId.trim(),
    workspaceId,
    workspace: {
      id: workspaceId,
      ...(input.workspaceLabel?.trim() ? { label: input.workspaceLabel.trim() } : {}),
    },
    targetInstallationId: input.targetInstallationId.trim(),
    invitedBy: input.invitedBy.trim(),
    invitedAt,
    installDescriptor: input.installDescriptor,
    operationStream,
  };
}

export async function installSharedPackageInvite(
  db: SQLiteDatabase,
  input: {
    invite: PackageInviteDescriptor;
    packageJson: unknown;
    approval: PackageInstallApprovalReceipt;
    now?: string;
  },
): Promise<LocalAppInstallation> {
  const preview = buildPackageInstallPreview(input.packageJson, {
    sourceUrl: input.invite.installDescriptor.url,
    registryPackage: input.invite.installDescriptor,
  });
  if (preview.status !== 'ready_for_review') throw new Error('share_invite_preview_blocked');
  return installApprovedAppPackage(db, {
    packageJson: input.packageJson,
    preview,
    approval: input.approval,
    installationId: input.invite.targetInstallationId,
    workspaceId: input.invite.workspaceId,
    now: input.now,
  });
}

function decryptVaultPayload(vault: PackageVaultExport, passphrase: string): PackageVaultPayload {
  return parseVaultPayload(decryptAnyVaultPayload(vault, passphrase));
}

function decryptAnyVaultPayload(vault: PackageVaultExport, passphrase: string): unknown {
  const validatedVault = validateVaultExport(vault);
  const salt = decodeBase64Fixed(validatedVault.salt, VAULT_SALT_BYTES, 'vault_salt_invalid');
  const iv = decodeBase64Fixed(validatedVault.iv, VAULT_IV_BYTES, 'vault_iv_invalid');
  const authTag = decodeBase64Fixed(validatedVault.authTag, VAULT_AUTH_TAG_BYTES, 'vault_auth_tag_invalid');
  const ciphertext = decodeBase64Bounded(validatedVault.ciphertext, 1, VAULT_MAX_CIPHERTEXT_BYTES, 'vault_ciphertext_invalid');
  const key = deriveVaultKey(passphrase, salt);
  try {
    const decipher = createDecipheriv(VAULT_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length === 0 || plaintext.length > VAULT_MAX_JSON_BYTES) throw new Error('vault_plaintext_bounds_invalid');
    try {
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw new Error('vault_payload_parse_failed');
    }
  } catch (error) {
    if (error instanceof Error && (error.message === 'vault_plaintext_bounds_invalid' || error.message === 'vault_payload_parse_failed')) {
      throw error;
    }
    throw new Error('vault_decrypt_failed');
  }
}

function parseVaultPayload(value: unknown): PackageVaultPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('vault_payload_invalid');
  const payload = value as PackageVaultPayload;
  if (payload.schemaVersion !== 'utopia.package-vault-payload.v1') throw new Error('vault_payload_schema_invalid');
  validateRegistryManifest({
    schemaVersion: 'utopia.registry.v1',
    name: 'vault-preview',
    packages: [payload.installDescriptor],
  });
  return payload;
}

function parseWorkspaceBackupPayload(value: unknown): WorkspaceBackupPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('vault_workspace_payload_invalid');
  const payload = value as WorkspaceBackupPayload;
  if (payload.schemaVersion !== UTOPIA_WORKSPACE_VAULT_PAYLOAD_SCHEMA_VERSION) throw new Error('vault_workspace_payload_schema_invalid');
  requireText(payload.workspace?.id, 'vault_workspace_id_required');
  assertTimestamp(payload.workspace.exportedAt, 'vault_workspace_exported_at_invalid');
  if (!Array.isArray(payload.installations)) throw new Error('vault_workspace_installations_required');
  if (!Array.isArray(payload.packageStates)) throw new Error('vault_workspace_package_states_required');
  if (!Array.isArray(payload.installDescriptors)) throw new Error('vault_workspace_descriptors_required');
  if (!Array.isArray(payload.records)) throw new Error('vault_workspace_records_required');
  if (!Array.isArray(payload.operationStreams)) throw new Error('vault_workspace_streams_required');
  for (const descriptor of payload.installDescriptors) {
    validateRegistryManifest({ schemaVersion: 'utopia.registry.v1', name: 'vault-preview', packages: [descriptor] });
  }
  for (const stream of payload.operationStreams) validateOperationStreamDesign(stream);
  const checksums = workspaceBackupChecksums(payload);
  const expectedPayloadChecksum = sha256Canonical({
    schemaVersion: payload.schemaVersion,
    workspace: payload.workspace,
    installations: payload.installations,
    packageStates: payload.packageStates,
    installDescriptors: payload.installDescriptors,
    records: payload.records,
    operationStreams: payload.operationStreams,
    checksums,
  });
  if (
    payload.checksums.installations !== checksums.installations ||
    payload.checksums.packageStates !== checksums.packageStates ||
    payload.checksums.installDescriptors !== checksums.installDescriptors ||
    payload.checksums.records !== checksums.records ||
    payload.checksums.operationStreams !== checksums.operationStreams ||
    payload.checksums.payload !== expectedPayloadChecksum
  ) {
    throw new Error('vault_workspace_checksum_mismatch');
  }
  return payload;
}

function encryptVaultPayload(payload: unknown, passphrase: string, checksum: string, now: string): PackageVaultExport {
  if (!isSha256(checksum)) throw new Error('vault_checksum_invalid');
  assertTimestamp(now, 'vault_created_at_invalid');
  const serialized = canonicalJson(payload);
  if (utf8ByteLength(serialized) > VAULT_MAX_JSON_BYTES) throw new Error('vault_payload_too_large');
  const salt = secureRandomBytes(VAULT_SALT_BYTES);
  const iv = secureRandomBytes(VAULT_IV_BYTES);
  const key = deriveVaultKey(passphrase, salt);
  const cipher = createCipheriv(VAULT_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  if (ciphertext.length === 0 || ciphertext.length > VAULT_MAX_CIPHERTEXT_BYTES) throw new Error('vault_ciphertext_bounds_invalid');
  return {
    schemaVersion: UTOPIA_VAULT_SCHEMA_VERSION,
    algorithm: VAULT_ALGORITHM,
    kdf: VAULT_KDF,
    iterations: VAULT_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    packageChecksum: checksum,
    createdAt: now,
  };
}

function validateVaultExport(value: unknown): PackageVaultExport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('vault_export_invalid');
  const vault = value as PackageVaultExport;
  if (vault.schemaVersion !== UTOPIA_VAULT_SCHEMA_VERSION) throw new Error('vault_schema_invalid');
  if (vault.algorithm !== VAULT_ALGORITHM || vault.kdf !== VAULT_KDF || vault.iterations !== VAULT_ITERATIONS) {
    throw new Error('vault_crypto_params_invalid');
  }
  assertTimestamp(vault.createdAt, 'vault_created_at_invalid');
  decodeBase64Fixed(vault.salt, VAULT_SALT_BYTES, 'vault_salt_invalid');
  decodeBase64Fixed(vault.iv, VAULT_IV_BYTES, 'vault_iv_invalid');
  decodeBase64Fixed(vault.authTag, VAULT_AUTH_TAG_BYTES, 'vault_auth_tag_invalid');
  decodeBase64Bounded(vault.ciphertext, 1, VAULT_MAX_CIPHERTEXT_BYTES, 'vault_ciphertext_invalid');
  if (!isSha256(vault.packageChecksum)) throw new Error('vault_checksum_invalid');
  return vault;
}

function workspaceBackupChecksums(input: Omit<WorkspaceBackupPayload, 'checksums'>): Omit<WorkspaceBackupPayload['checksums'], 'payload'> {
  return {
    installations: sha256Canonical(input.installations),
    packageStates: sha256Canonical(input.packageStates),
    installDescriptors: sha256Canonical(input.installDescriptors),
    records: sha256Canonical(input.records),
    operationStreams: sha256Canonical(input.operationStreams),
  };
}

function collectRestoreConflicts(
  payload: WorkspaceBackupPayload,
  current?: {
    installations?: readonly LocalAppInstallation[];
    records?: readonly CanonicalRecord[];
    operationStreams?: readonly OperationStreamDesign[];
  },
): RestoreConflict[] {
  const conflicts: RestoreConflict[] = [];
  const currentInstallations = new Map((current?.installations ?? []).map((installation) => [installation.id, installation]));
  for (const installation of payload.installations) {
    const existing = currentInstallations.get(installation.id);
    if (existing && sha256Canonical(existing) !== sha256Canonical(installation)) {
      conflicts.push({
        kind: 'installation',
        id: installation.id,
        reason: 'checksum_mismatch',
        backupChecksum: sha256Canonical(installation),
        currentChecksum: sha256Canonical(existing),
      });
    }
  }

  const currentRecords = new Map((current?.records ?? []).map((record) => [record.id, record]));
  for (const record of payload.records) {
    const existing = currentRecords.get(record.id);
    if (existing && sha256Canonical(existing) !== sha256Canonical(record)) {
      conflicts.push({
        kind: 'record',
        id: record.id,
        reason: 'checksum_mismatch',
        backupChecksum: sha256Canonical(record),
        currentChecksum: sha256Canonical(existing),
      });
    }
  }

  const currentStreams = new Map((current?.operationStreams ?? []).map((stream) => [stream.installationId, stream]));
  for (const stream of payload.operationStreams) {
    const existing = currentStreams.get(stream.installationId);
    if (!existing) continue;
    if (compareCursor(existing.cursor, stream.cursor) > 0) {
      conflicts.push({
        kind: 'operation_stream',
        id: stream.installationId,
        reason: 'cursor_regression',
        backupChecksum: stream.checkpointChecksum,
        currentChecksum: existing.checkpointChecksum,
      });
    } else if (existing.checkpointChecksum !== stream.checkpointChecksum && existing.entries.length > stream.entries.length) {
      conflicts.push({
        kind: 'operation_stream',
        id: stream.installationId,
        reason: 'checksum_mismatch',
        backupChecksum: stream.checkpointChecksum,
        currentChecksum: existing.checkpointChecksum,
      });
    }
  }
  return conflicts;
}

function deriveVaultKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 12) throw new Error('vault_passphrase_too_short');
  return pbkdf2Sync(passphrase, salt, VAULT_ITERATIONS, VAULT_KEY_BYTES, 'sha256');
}

function getPackageForUrl(
  packagesByUrl: ReadonlyMap<string, unknown> | Record<string, unknown>,
  url: string,
): unknown {
  const maybeMap = packagesByUrl as ReadonlyMap<string, unknown>;
  if (typeof maybeMap.get === 'function') return maybeMap.get(url);
  return (packagesByUrl as Record<string, unknown>)[url];
}

function requireHttps(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error('package_url_must_be_https');
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString();
}

function requireText(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value.trim();
}

function assertTimestamp(value: string, error: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(error);
}

function isSha256(value: string): boolean {
  return SHA256_PATTERN.test(value);
}

function compareCursor(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right);
}

function requirePathSegment(value: string, label: string): string {
  const segment = value.trim();
  if (!segment || segment.includes('..') || segment.includes('\\')) throw new Error(`github_${label}_invalid`);
  return encodeURIComponent(segment).replace(/%2F/g, '/');
}

function requireSourceRevision(value: string): string {
  const revision = requireText(value, 'registry_distribution_source_revision_required');
  if (!SOURCE_REVISION_PATTERN.test(revision)) throw new Error('registry_distribution_source_revision_invalid');
  return revision;
}

function requireImmutableGitHubRef(value: string, error: string): string {
  const ref = requirePathSegment(value, 'ref');
  if (MUTABLE_GITHUB_REFS.has(ref.toLowerCase()) || ref.toLowerCase().startsWith('refs/heads/')) {
    throw new Error(error);
  }
  return ref;
}

function assertImmutableGitHubReleaseAssetUrl(value: string): void {
  const url = new URL(requireHttps(value));
  if (url.hostname !== 'github.com') throw new Error('registry_distribution_asset_host_invalid');
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 6 || segments[2] !== 'releases' || segments[3] !== 'download') {
    throw new Error('registry_distribution_asset_path_invalid');
  }
  requireImmutableGitHubRef(decodeURIComponent(segments[4]), 'registry_distribution_asset_ref_mutable');
}

function assertGitHubPagesIndexUrl(value: string): void {
  const url = new URL(requireHttps(value));
  if (!url.hostname.endsWith('.github.io')) throw new Error('registry_distribution_pages_host_invalid');
  if (url.pathname === '/' || url.pathname.endsWith('/')) throw new Error('registry_distribution_pages_path_invalid');
}

function decodeBase64Fixed(value: unknown, expectedBytes: number, error: string): Buffer {
  const decoded = decodeBase64Bounded(value, expectedBytes, expectedBytes, error);
  if (decoded.length !== expectedBytes) throw new Error(error);
  return decoded;
}

function decodeBase64Bounded(value: unknown, minBytes: number, maxBytes: number, error: string): Buffer {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  const normalized = value.trim();
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4 + 4;
  if (normalized.length > maxEncodedLength || !/^[A-Za-z0-9+/]+=*$/.test(normalized)) throw new Error(error);
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length < minBytes || decoded.length > maxBytes) throw new Error(error);
  return decoded;
}

function secureRandomBytes(size: number): Buffer {
  const cryptoApi = globalThis.crypto ?? webcrypto;
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(size);
    cryptoApi.getRandomValues(bytes);
    return Buffer.from(bytes);
  }
  return randomBytes(size);
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
