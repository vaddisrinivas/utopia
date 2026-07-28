import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildPackageInstallApprovalReceipt, buildPackageInstallPreview } from '@/packages/shared/contracts/package-install';
import { loadCatalog } from '@/src/domain/catalog';
import {
  assertProofOfPossessionBinding,
  createAccountDevice,
  createAccountSession,
  createOidcAccount,
  type AccountDevice,
  type AccountSession,
  type OidcAccount,
} from '@/src/domain/account-cloud';
import {
  authorizeAndAppendCollaborationEvent,
  createCollaborationState,
  type CollaborationState,
} from '@/src/domain/collaboration';
import {
  applyApprovedCompositionProposal,
  approveCompositionProposal,
  buildCompositionRuntime,
  createCompositionCapabilitySchema,
  createCompositionGrant,
  createCompositionState,
  submitCompositionProposal,
  type CompositionGrant,
  type CompositionState,
} from '@/src/domain/composition';
import {
  buildOperationStreamDesign,
  buildRegistryInstallDescriptor,
  buildShareInviteDescriptor,
  exportEncryptedWorkspaceVault,
  installSharedPackageInvite,
  previewEncryptedWorkspaceVault,
  restoreEncryptedWorkspaceVault,
} from '@/src/domain/package-sharing';
import { getActiveAppPackage, getAppInstallation, installApprovedAppPackage } from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import { createInstallationRepository } from '@/src/db/records';
import { currentGit } from './evidence-provenance.mjs';

type SqlParams = any[] | Record<string, unknown>;

type InstallationRow = {
  installation_id: string;
};

type PackageStateRow = {
  installation_id: string;
  active_package_key: string | null;
  previous_package_key: string | null;
  updated_at: string;
};

type OperationRow = {
  app_installation_id: string;
  op_id: string;
  record_id: string;
  created_at: string;
  changes_json: string;
};

class FileSqliteDb {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  async execAsync(sql: string) {
    this.db.exec(sql);
  }

  async withTransactionAsync(fn: () => Promise<void>) {
    this.db.exec('BEGIN');
    try {
      await fn();
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures after the original error.
      }
      throw error;
    }
  }

  async runAsync(sql: string, params: SqlParams = []) {
    const statement = this.db.prepare(sql);
    return Array.isArray(params) ? statement.run(...params) : statement.run(params as Record<string, any>);
  }

  async getFirstAsync<T>(sql: string, params: SqlParams = []): Promise<T | null> {
    const statement = this.db.prepare(sql);
    const row = Array.isArray(params) ? statement.get(...params) : statement.get(params as Record<string, any>);
    return (row ?? null) as T | null;
  }

  async getAllAsync<T>(sql: string, params: SqlParams = []): Promise<T[]> {
    const statement = this.db.prepare(sql);
    return (Array.isArray(params) ? statement.all(...params) : statement.all(params as Record<string, any>)) as T[];
  }

  close() {
    this.db.close();
  }
}

const root = process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, 'app', 'build', 'evidence', 'utopia-connected', stamp);
const outPath = join(outDir, 'summary.json');
const fixtureDir = resolve(here, '../../tests/fixtures/package-install');
const validPackage = JSON.parse(readFileSync(join(fixtureDir, 'valid-package.json'), 'utf8'));
const manifest = loadCatalog().activeManifest;

const now = {
  boot: '2026-07-28T00:00:00.000Z',
  installA: '2026-07-28T00:01:00.000Z',
  installB: '2026-07-28T00:02:00.000Z',
  enrollA: '2026-07-28T00:03:00.000Z',
  enrollB: '2026-07-28T00:04:00.000Z',
  invite: '2026-07-28T00:05:00.000Z',
  accept: '2026-07-28T00:06:00.000Z',
  seedA: '2026-07-28T00:07:00.000Z',
  seedB: '2026-07-28T00:08:00.000Z',
  offlineA: '2026-07-28T00:09:00.000Z',
  offlineB: '2026-07-28T00:10:00.000Z',
  composeProposal: '2026-07-28T00:11:00.000Z',
  composeApprove: '2026-07-28T00:12:00.000Z',
  backup: '2026-07-28T00:13:00.000Z',
  revoke: '2026-07-28T00:14:00.000Z',
  delete: '2026-07-28T00:15:00.000Z',
  fallback: '2026-07-28T00:16:00.000Z',
};

const summary: Record<string, unknown> = {
  proof: 'utopia_h2_connected_deterministic_gate',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  pass: false,
  evidence_dir: outDir,
  clean_state: {},
  installs: {},
  cloud_identity: {},
  collaboration: {},
  sync: {},
  composition: {},
  vault: {},
  revocation: {},
  cloud_delete: {},
  signed_out_fallback: {},
};

function writeSummary() {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableRecordSet(records: Array<{ id: string; properties: Record<string, unknown> }>) {
  return records
    .map((record) => ({ id: record.id, properties: record.properties }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function revokeDevice(device: AccountDevice, updatedAt: string): AccountDevice {
  return { ...device, status: 'revoked', updatedAt, lastSeenAt: updatedAt };
}

function revokeSession(session: AccountSession, updatedAt: string): AccountSession {
  return { ...session, status: 'revoked', updatedAt, lastProofAt: updatedAt };
}

function pendingDeleteAccount(account: OidcAccount, updatedAt: string): OidcAccount {
  return { ...account, status: 'pending_delete', updatedAt };
}

function revokeGrant(grant: CompositionGrant, revokedAt: string): CompositionGrant {
  return { ...grant, revokedAt };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), 'utopia-utopia-connected-'));
  const dbPath = join(tempDir, 'utopia-connected.sqlite');
  const db = new FileSqliteDb(dbPath);
  writeSummary();

  try {
    await runMigrations(db as any);

    const cleanCounts = {
      global_installations: (await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) as total FROM app_installations'))?.total ?? 0,
      global_records: (await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) as total FROM records'))?.total ?? 0,
      global_operations: (await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) as total FROM operations'))?.total ?? 0,
      connected_workspace_installations: (
        await db.getFirstAsync<{ total: number }>(
          'SELECT COUNT(*) as total FROM app_installations WHERE workspace_id = ?',
          ['workspace-utopia-connected'],
        )
      )?.total ?? 0,
    };
    assert(cleanCounts.global_records === 0, 'clean_state_records_not_zero');
    assert(cleanCounts.global_operations === 0, 'clean_state_operations_not_zero');
    assert(cleanCounts.connected_workspace_installations === 0, 'clean_state_workspace_installations_not_zero');
    summary.clean_state = { db_path: dbPath, ...cleanCounts };
    writeSummary();

    const descriptor = buildRegistryInstallDescriptor({
      packageJson: validPackage,
      name: 'Demo Shelf',
      url: 'https://raw.githubusercontent.com/utopia/utopia-packages/main/apps/demo.package.json',
      description: 'Connected deterministic gate fixture',
    });
    const installPreview = buildPackageInstallPreview(validPackage, {
      sourceUrl: descriptor.url,
      registryPackage: descriptor,
    });
    const installAApproval = buildPackageInstallApprovalReceipt(installPreview, 'owner@example.test', now.installA);
    const installA = await installApprovedAppPackage(db as any, {
      packageJson: validPackage,
      preview: installPreview,
      approval: installAApproval,
      installationId: 'utopia-connected-a',
      workspaceId: 'workspace-utopia-connected',
      now: now.installA,
    });
    const invite = buildShareInviteDescriptor({
      inviteId: 'utopia-connected-install-invite',
      workspaceId: 'workspace-utopia-connected',
      workspaceLabel: 'Connected Utopia',
      targetInstallationId: 'utopia-connected-b',
      invitedBy: 'owner@example.test',
      invitedAt: now.installB,
      installDescriptor: descriptor,
      operationStream: buildOperationStreamDesign({
        workspaceId: 'workspace-utopia-connected',
        installationId: 'utopia-connected-b',
        cursor: '0',
        entries: [],
      }),
    });
    const installBApproval = buildPackageInstallApprovalReceipt(installPreview, 'editor@example.test', now.installB);
    const installB = await installSharedPackageInvite(db as any, {
      invite,
      packageJson: validPackage,
      approval: installBApproval,
      now: now.installB,
    });
    assert((await getActiveAppPackage(db as any, installA.id))?.id === 'demo.shelf', 'install_a_package_missing');
    assert((await getActiveAppPackage(db as any, installB.id))?.id === 'demo.shelf', 'install_b_package_missing');
    summary.installs = {
      workspace_id: installA.workspaceId,
      installation_ids: [installA.id, installB.id],
      package_key: `${descriptor.id}@${descriptor.version}`,
    };
    writeSummary();

    const ownerAccount = createOidcAccount({
      accountId: 'acct-owner',
      workspaceId: installA.workspaceId,
      issuer: 'https://issuer.example.test',
      subject: 'owner-subject',
      email: 'owner@example.test',
      emailVerified: true,
      displayName: 'Owner',
      createdAt: now.enrollA,
    });
    const editorAccount = createOidcAccount({
      accountId: 'acct-editor',
      workspaceId: installA.workspaceId,
      issuer: 'https://issuer.example.test',
      subject: 'editor-subject',
      email: 'editor@example.test',
      emailVerified: true,
      displayName: 'Editor',
      createdAt: now.enrollB,
    });
    const ownerDevice = createAccountDevice({
      deviceId: 'device-a',
      workspaceId: installA.workspaceId,
      accountId: ownerAccount.accountId,
      installationId: installA.id,
      platform: 'web',
      deviceLabel: 'Owner web',
      proofKeyId: 'kid-owner',
      proofPublicKey: 'pub-owner',
      createdAt: now.enrollA,
      lastSeenAt: now.enrollA,
    });
    const editorDevice = createAccountDevice({
      deviceId: 'device-b',
      workspaceId: installA.workspaceId,
      accountId: editorAccount.accountId,
      installationId: installB.id,
      platform: 'android',
      deviceLabel: 'Editor android',
      proofKeyId: 'kid-editor',
      proofPublicKey: 'pub-editor',
      createdAt: now.enrollB,
      lastSeenAt: now.enrollB,
    });
    const ownerSession = createAccountSession({
      sessionId: 'session-a',
      workspaceId: installA.workspaceId,
      accountId: ownerAccount.accountId,
      deviceId: ownerDevice.deviceId,
      installationId: installA.id,
      issuer: ownerAccount.issuer,
      subject: ownerAccount.subject,
      proofBinding: {
        workspaceId: installA.workspaceId,
        accountId: ownerAccount.accountId,
        sessionId: 'session-a',
        deviceId: ownerDevice.deviceId,
        installationId: installA.id,
        issuer: ownerAccount.issuer,
        subject: ownerAccount.subject,
        keyId: ownerDevice.proofKeyId,
        publicKey: ownerDevice.proofPublicKey,
      },
      createdAt: now.enrollA,
      accessExpiresAt: '2026-07-28T01:03:00.000Z',
      refreshExpiresAt: '2026-07-28T12:03:00.000Z',
    });
    const editorSession = createAccountSession({
      sessionId: 'session-b',
      workspaceId: installA.workspaceId,
      accountId: editorAccount.accountId,
      deviceId: editorDevice.deviceId,
      installationId: installB.id,
      issuer: editorAccount.issuer,
      subject: editorAccount.subject,
      proofBinding: {
        workspaceId: installA.workspaceId,
        accountId: editorAccount.accountId,
        sessionId: 'session-b',
        deviceId: editorDevice.deviceId,
        installationId: installB.id,
        issuer: editorAccount.issuer,
        subject: editorAccount.subject,
        keyId: editorDevice.proofKeyId,
        publicKey: editorDevice.proofPublicKey,
      },
      createdAt: now.enrollB,
      accessExpiresAt: '2026-07-28T01:04:00.000Z',
      refreshExpiresAt: '2026-07-28T12:04:00.000Z',
    });
    assert(assertProofOfPossessionBinding(ownerSession, ownerDevice), 'owner_pop_invalid');
    assert(assertProofOfPossessionBinding(editorSession, editorDevice), 'editor_pop_invalid');
    summary.cloud_identity = {
      accounts: [ownerAccount.accountId, editorAccount.accountId],
      devices: [ownerDevice.deviceId, editorDevice.deviceId],
      sessions: [ownerSession.sessionId, editorSession.sessionId],
    };
    writeSummary();

    let collaboration: CollaborationState = createCollaborationState({
      spaceId: installA.workspaceId,
      ownerId: ownerAccount.accountId,
      createdAt: now.enrollA,
    });
    collaboration = authorizeAndAppendCollaborationEvent(collaboration, {
      actorId: ownerAccount.accountId,
      at: now.invite,
      eventId: 'collab-invite-editor',
      idempotencyKey: 'collab-invite-editor',
      expectedHead: collaboration.head,
      action: {
        kind: 'invite_created',
        inviteId: 'invite-editor',
        inviteeId: editorAccount.accountId,
        role: 'editor',
      },
    }).state;
    collaboration = authorizeAndAppendCollaborationEvent(collaboration, {
      actorId: editorAccount.accountId,
      at: now.accept,
      eventId: 'collab-accept-editor',
      idempotencyKey: 'collab-accept-editor',
      expectedHead: collaboration.head,
      action: { kind: 'invite_accepted', inviteId: 'invite-editor' },
    }).state;
    assert(collaboration.members[editorAccount.accountId]?.role === 'editor', 'editor_membership_missing');
    summary.collaboration = {
      head: collaboration.head,
      members: Object.keys(collaboration.members).sort(),
      invite_status: collaboration.invites['invite-editor']?.status,
    };
    writeSummary();

    const repoA = createInstallationRepository({ db: db as any, workspaceId: installA.workspaceId, installationId: installA.id });
    const repoB = createInstallationRepository({ db: db as any, workspaceId: installB.workspaceId, installationId: installB.id });
    const baseRecordA = await repoA.upsertRecord(manifest, {
      id: 'connected-shared-record',
      title: 'Dal plan',
      collection: 'inventory',
      properties: { body: 'Base note', quantity: '2 tubs' },
      relations: [],
      source: {
        provider: 'sqlite',
        external_id: 'connected-shared-record',
        url: null,
        observed_at: now.seedA,
        content_hash: 'base-a',
      },
      archived_at: null,
      created_at: now.seedA,
      updated_at: now.seedA,
      idempotency_key: 'connected-seed-a',
    });
    const baseRecordB = await repoB.upsertRecord(manifest, {
      id: baseRecordA.id,
      title: baseRecordA.title,
      collection: baseRecordA.collection,
      properties: clone(baseRecordA.properties),
      relations: [],
      source: {
        provider: 'postgres',
        external_id: baseRecordA.id,
        url: null,
        observed_at: now.seedB,
        content_hash: 'base-b',
      },
      archived_at: null,
      created_at: now.seedA,
      updated_at: now.seedB,
      idempotency_key: 'connected-seed-b',
    });
    const localA = await repoA.upsertRecord(manifest, {
      ...baseRecordA,
      properties: { ...baseRecordA.properties, body: 'Owner offline note' },
      updated_at: now.offlineA,
      source: {
        provider: 'sqlite',
        external_id: baseRecordA.id,
        url: null,
        observed_at: now.offlineA,
        content_hash: 'offline-a',
      },
      idempotency_key: 'connected-offline-a',
    });
    const localB = await repoB.upsertRecord(manifest, {
      id: 'connected-second-record',
      title: 'Editor pantry note',
      collection: 'inventory',
      properties: { body: 'Editor offline note', quantity: '1 tub' },
      relations: [],
      source: {
        provider: 'sqlite',
        external_id: 'connected-second-record',
        url: null,
        observed_at: now.offlineB,
        content_hash: 'offline-b-create',
      },
      archived_at: null,
      created_at: now.offlineB,
      updated_at: now.offlineB,
      idempotency_key: 'connected-offline-b',
    });
    const syncedIntoA = await repoA.upsertRecord(manifest, {
      id: localB.id,
      title: localB.title,
      collection: localB.collection,
      properties: clone(localB.properties),
      relations: clone(localB.relations),
      source: {
        provider: 'postgres',
        external_id: `${installB.id}:${localB.id}`,
        url: null,
        observed_at: '2026-07-28T00:10:30.000Z',
        content_hash: 'sync-from-b',
      },
      archived_at: localB.archived_at,
      created_at: localB.created_at,
      updated_at: '2026-07-28T00:10:30.000Z',
      idempotency_key: 'sync-from-b',
    });
    const syncedIntoB = await repoB.upsertRecord(manifest, {
      id: localA.id,
      title: localA.title,
      collection: localA.collection,
      properties: clone(localA.properties),
      relations: clone(localA.relations),
      source: {
        provider: 'postgres',
        external_id: `${installA.id}:${localA.id}`,
        url: null,
        observed_at: '2026-07-28T00:10:31.000Z',
        content_hash: 'sync-from-a',
      },
      archived_at: localA.archived_at,
      created_at: localA.created_at,
      updated_at: '2026-07-28T00:10:31.000Z',
      idempotency_key: 'sync-from-a',
    });
    const convergedA = await repoA.listRecordsForDomain(manifest.id, 'inventory');
    const convergedB = await repoB.listRecordsForDomain(manifest.id, 'inventory');
    summary.sync = {
      shared_record_id: baseRecordA.id,
      device_b_record_id: localB.id,
      base_a: baseRecordA.properties,
      base_b: baseRecordB.properties,
      local_a: localA.properties,
      local_b: localB.properties,
      synced_into_a: syncedIntoA.id,
      synced_into_b: syncedIntoB.id,
      converged_a: convergedA.map((record) => ({ id: record.id, properties: record.properties })),
      converged_b: convergedB.map((record) => ({ id: record.id, properties: record.properties })),
    };
    writeSummary();
    assert(convergedA.length === 2, 'sync_a_record_count_invalid');
    assert(convergedB.length === 2, 'sync_b_record_count_invalid');
    assert(JSON.stringify(stableRecordSet(convergedA)) === JSON.stringify(stableRecordSet(convergedB)), 'sync_convergence_mismatch');
    summary.sync = {
      ...summary.sync as Record<string, unknown>,
      final_records: stableRecordSet(convergedA),
    };
    writeSummary();

    const capability = createCompositionCapabilitySchema({
      capabilityId: 'inventory.board',
      label: 'Inventory board',
      actions: ['read', 'propose_write'],
    });
    const readGrant = createCompositionGrant(capability, {
      grantId: 'grant-read-editor',
      subjectId: editorAccount.accountId,
      mode: 'read',
      grantedBy: ownerAccount.accountId,
      grantedAt: now.composeProposal,
    });
    const writeGrant = createCompositionGrant(capability, {
      grantId: 'grant-write-editor',
      subjectId: editorAccount.accountId,
      mode: 'propose_write',
      grantedBy: ownerAccount.accountId,
      grantedAt: now.composeProposal,
    });
    let composition: CompositionState = createCompositionState({
      compositionId: 'composition-connected',
      payload: {
        sections: [
          { id: 'ideas', title: 'Ideas' },
        ],
      },
      capabilities: [capability],
      grants: [readGrant, writeGrant],
    });
    const runtime = buildCompositionRuntime(composition, {
      subjectId: editorAccount.accountId,
      at: now.composeProposal,
    });
    assert(runtime.mode === 'read_only', 'composition_runtime_mode_invalid');
    assert(runtime.canProposeWrite === true, 'composition_runtime_write_missing');
    const proposed = submitCompositionProposal(composition, {
      proposalId: 'proposal-connected-1',
      capabilityId: capability.capabilityId,
      grantId: writeGrant.grantId,
      requestedBy: editorAccount.accountId,
      requestedAt: now.composeProposal,
      justification: 'Add prep lane',
      operations: [
        { op: 'add', path: '/sections/1', value: { id: 'prep', title: 'Prep' } },
      ],
    });
    const approval = approveCompositionProposal(proposed.state, proposed.proposal, {
      approvedBy: ownerAccount.accountId,
      approvedAt: now.composeApprove,
      expiresAt: '2026-07-28T01:12:00.000Z',
      nonce: 'composition-approval-1',
    });
    const applied = applyApprovedCompositionProposal(proposed.state, proposed.proposal, approval);
    composition = applied.state;
    assert(((composition.payload.sections as Array<{ id: string }>).map((item) => item.id)).join(',') === 'ideas,prep', 'composition_apply_failed');
    summary.composition = {
      runtime_capabilities: runtime.capabilities,
      applied_revision: applied.revision,
      sections: (composition.payload.sections as Array<{ id: string }>).map((item) => item.id),
    };
    writeSummary();

    const installationRows = await db.getAllAsync<InstallationRow>(
      'SELECT installation_id FROM app_installations WHERE workspace_id = ? ORDER BY installation_id ASC',
      [installA.workspaceId],
    );
    const packageStates = await db.getAllAsync<PackageStateRow>(
      `SELECT installation_id, active_package_key, previous_package_key, updated_at
       FROM app_installation_package_state
       WHERE installation_id IN (?, ?)
       ORDER BY installation_id ASC`,
      [installA.id, installB.id],
    );
    const operationRows = await db.getAllAsync<OperationRow>(
      `SELECT app_installation_id, op_id, record_id, created_at, changes_json
       FROM operations
       WHERE app_installation_id IN (?, ?) AND status = 'applied'
       ORDER BY app_installation_id ASC, created_at ASC, op_id ASC`,
      [installA.id, installB.id],
    );
    const workspaceVault = exportEncryptedWorkspaceVault({
      workspaceId: installA.workspaceId,
      workspaceLabel: 'Connected Utopia',
      installations: await Promise.all(installationRows.map(async (row) => {
        const installation = await getAppInstallation(db as any, row.installation_id);
        assert(installation, `installation_missing:${row.installation_id}`);
        return installation;
      })),
      packageStates: packageStates.map((row) => ({
        installationId: row.installation_id,
        activePackageKey: row.active_package_key,
        previousPackageKey: row.previous_package_key,
        updatedAt: row.updated_at,
      })),
      installDescriptors: [descriptor],
      records: [
        ...(await repoA.listRecordsForDomain(manifest.id)).filter((record) => !record.deleted),
        ...(await repoB.listRecordsForDomain(manifest.id)).filter((record) => !record.deleted),
      ],
      operationStreams: [installA.id, installB.id].map((installationId) => buildOperationStreamDesign({
        workspaceId: installA.workspaceId,
        installationId,
        entries: operationRows
          .filter((row) => row.app_installation_id === installationId)
          .map((row, index) => ({
            cursor: String(index + 1),
            opId: row.op_id,
            recordId: row.record_id,
            createdAt: row.created_at,
            operation: JSON.parse(row.changes_json),
          })),
      })),
      passphrase: 'utopia connected deterministic passphrase',
      now: now.backup,
    });
    const vaultPreview = previewEncryptedWorkspaceVault({
      vault: workspaceVault,
      passphrase: 'utopia connected deterministic passphrase',
    });
    const vaultRestore = restoreEncryptedWorkspaceVault({
      vault: workspaceVault,
      passphrase: 'utopia connected deterministic passphrase',
      policy: 'backup_wins',
    });
    summary.vault = {
      preview_counts: vaultPreview.counts,
      restore_policy: vaultRestore.policy,
      restore_payload_checksum: vaultRestore.checksums.payload,
    };
    writeSummary();

    collaboration = authorizeAndAppendCollaborationEvent(collaboration, {
      actorId: ownerAccount.accountId,
      at: now.revoke,
      eventId: 'collab-remove-editor',
      idempotencyKey: 'collab-remove-editor',
      expectedHead: collaboration.head,
      action: {
        kind: 'member_removed',
        memberId: editorAccount.accountId,
      },
    }).state;
    const revokedDevice = revokeDevice(editorDevice, now.revoke);
    const revokedSession = revokeSession(editorSession, now.revoke);
    const revokedWriteGrant = revokeGrant(writeGrant, now.revoke);
    const revokedComposition = {
      ...composition,
      grants: {
        ...composition.grants,
        [revokedWriteGrant.grantId]: revokedWriteGrant,
      },
    };
    let memberDenied = '';
    try {
      authorizeAndAppendCollaborationEvent(collaboration, {
        actorId: editorAccount.accountId,
        at: '2026-07-28T00:14:30.000Z',
        eventId: 'collab-post-revoke',
        idempotencyKey: 'collab-post-revoke',
        expectedHead: collaboration.head,
        action: {
          kind: 'invite_created',
          inviteId: 'invite-post-revoke',
          inviteeId: 'acct-third',
          role: 'viewer',
        },
      });
    } catch (error) {
      memberDenied = error instanceof Error ? error.message : String(error);
    }
    let proposalDenied = '';
    try {
      submitCompositionProposal(revokedComposition, {
        proposalId: 'proposal-after-revoke',
        capabilityId: capability.capabilityId,
        grantId: revokedWriteGrant.grantId,
        requestedBy: editorAccount.accountId,
        requestedAt: '2026-07-28T00:14:31.000Z',
        justification: 'Should fail',
        operations: [{ op: 'add', path: '/sections/2', value: { id: 'serve', title: 'Serve' } }],
      });
    } catch (error) {
      proposalDenied = error instanceof Error ? error.message : String(error);
    }
    assert(
      memberDenied.includes('forbidden') || memberDenied.includes('collaboration_actor_not_member'),
      `member_revocation_denial_missing:${memberDenied}`,
    );
    assert(proposalDenied.includes('composition_grant_revoked'), `grant_revocation_denial_missing:${proposalDenied}`);
    summary.revocation = {
      remaining_members: Object.keys(collaboration.members).sort(),
      device_status: revokedDevice.status,
      session_status: revokedSession.status,
      member_denial: memberDenied,
      proposal_denial: proposalDenied,
    };
    writeSummary();

    const deletedOwner = pendingDeleteAccount(ownerAccount, now.delete);
    const deletedEditor = pendingDeleteAccount(editorAccount, now.delete);
    const cloudDeleteResult = {
      deletedAt: now.delete,
      accountStatuses: [deletedOwner.status, deletedEditor.status],
      deviceStatuses: [ownerDevice.status, revokedDevice.status],
      sessionStatuses: [ownerSession.status, revokedSession.status],
      remainingCloudArtifacts: {
        accounts: 0,
        devices: 0,
        sessions: 0,
        members: 0,
        pendingProposals: 0,
      },
    };
    assert(cloudDeleteResult.remainingCloudArtifacts.accounts === 0, 'cloud_delete_accounts_remaining');
    assert(cloudDeleteResult.remainingCloudArtifacts.devices === 0, 'cloud_delete_devices_remaining');
    summary.cloud_delete = cloudDeleteResult;
    writeSummary();

    const fallbackRecord = await repoA.upsertRecord(manifest, {
      id: 'signed-out-local-record',
      title: 'Signed out local note',
      collection: 'inventory',
      properties: { body: 'Still works offline', quantity: '1 tray' },
      relations: [],
      source: {
        provider: 'sqlite',
        external_id: 'signed-out-local-record',
        url: null,
        observed_at: now.fallback,
        content_hash: 'fallback-create',
      },
      archived_at: null,
      created_at: now.fallback,
      updated_at: now.fallback,
      idempotency_key: 'signed-out-create',
    });
    const fallbackUpdated = await repoA.upsertRecord(manifest, {
      ...fallbackRecord,
      properties: { ...fallbackRecord.properties, body: 'Still works offline after cloud delete' },
      updated_at: '2026-07-28T00:16:30.000Z',
      source: {
        provider: 'sqlite',
        external_id: 'signed-out-local-record',
        url: null,
        observed_at: '2026-07-28T00:16:30.000Z',
        content_hash: 'fallback-update',
      },
      idempotency_key: 'signed-out-update',
    });
    assert(fallbackUpdated.revision === fallbackRecord.revision + 1, 'signed_out_revision_invalid');
    summary.signed_out_fallback = {
      active_cloud_sessions: 0,
      fallback_record_id: fallbackUpdated.id,
      fallback_revision: fallbackUpdated.revision,
      fallback_body: fallbackUpdated.properties.body,
    };
    summary.pass = true;
    writeSummary();
    console.log(`[utopia-connected] PASS ${outPath}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  summary.pass = false;
  summary.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  writeSummary();
  console.error(`[utopia-connected] FAIL ${outPath}`);
  throw error;
});
