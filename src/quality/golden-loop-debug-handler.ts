import type { SQLiteDatabase } from 'expo-sqlite';

import {
  UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION,
  buildCapabilityConsentRecordId,
} from '@/packages/shared/contracts/capability-consent-ledger';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import {
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
} from '@/packages/shared/contracts/package-install';
import {
  activateApprovedAppPackageUpdate,
  deleteAppInstallationAndData,
  getActiveAppPackage,
  getPackageInstallAppInstallation,
  installApprovedAppPackage,
  rollbackAppPackage,
} from '@/src/db/app-package-registry';
import {
  getCapabilityConsentLedgerRecord,
  revokeCapabilityConsentLedgerRecord,
  upsertCapabilityConsentLedgerRecord,
} from '@/src/db/capability-consent-ledger';
import { exportRecoverySnapshot, type RecoveryExport } from '@/src/db/migrations';
import { listRecordsForDomainAndInstallation, getRecordForInstallation } from '@/src/db/records';
import { importRecoverySnapshot } from '@/src/db/recovery';
import { loadAppPackage } from '@/src/domain/package-loader';
import { applyOperation } from '@/src/ops/apply';
import {
  type GoldenLoopDebugCommand,
  type GoldenLoopDebugResult,
  validateGoldenLoopDebugCommand,
} from '@/src/quality/golden-loop-debug-protocol';

const backups = new Map<string, RecoveryExport>();
const transportModes = new Map<string, 'connected' | 'disconnected'>();
const pendingTransportOperations = new Map<string, GoldenLoopDebugCommand[]>();

export async function executeGoldenLoopDebugCommand(
  db: SQLiteDatabase,
  command: unknown,
  options: { expectedToken: string | null; now?: () => string },
): Promise<GoldenLoopDebugResult> {
  const now = options.now ?? (() => new Date().toISOString());
  try {
    validateGoldenLoopDebugCommand(command, options.expectedToken);
    let result: GoldenLoopDebugResult;
    switch (command.command) {
      case 'package.install':
        result = await installPackage(db, command, now);
        break;
      case 'record.write':
        result = await writeRecord(db, command, now);
        break;
      case 'transport.disconnect':
      case 'transport.reconnect':
        result = await setTransportMode(command, now);
        break;
      case 'package.update':
        result = await updatePackage(db, command, now);
        break;
      case 'package.rollback':
        result = await rollbackPackage(db, command, now);
        break;
      case 'backup.export':
        result = await exportBackup(db, command, now);
        break;
      case 'installation.reset':
        result = await resetInstallation(db, command, now);
        break;
      case 'backup.restore':
        result = await restoreBackup(db, command, now);
        break;
      case 'capability.grant':
        result = await grantCapability(db, command, now);
        break;
      case 'capability.revoke':
        result = await revokeCapability(db, command, now);
        break;
      case 'state.checksum':
        result = await stateChecksum(db, command, now);
        break;
      default:
        result = blocked(command, now(), 'golden_loop_debug_command_unknown');
        break;
    }
    await recordDebugOperation(db, command, result);
    await observeDebugOperation(command);
    return result;
  } catch (error) {
    const fallback = command as Partial<GoldenLoopDebugCommand>;
    return {
      status: 'failed',
      command: isCommandName(fallback.command) ? fallback.command : 'state.checksum',
      installation_id: typeof fallback.installation_id === 'string' ? fallback.installation_id : 'unknown',
      operation_id: typeof fallback.operation_id === 'string' ? fallback.operation_id : 'unknown',
      receipt_id: receiptId(typeof fallback.operation_id === 'string' ? fallback.operation_id : 'unknown'),
      error: error instanceof Error ? error.message : 'golden_loop_debug_failed',
      applied_at: now(),
    };
  }
}

async function recordDebugOperation(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  result: GoldenLoopDebugResult,
) {
  await db.runAsync(
    `INSERT OR IGNORE INTO operations (
      op_id, app_installation_id, kind, domain, collection, record_id, expected_revision, result_revision,
      actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id,
      status, reject_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      command.operation_id,
      command.installation_id,
      'create',
      'golden-loop-debug',
      command.command,
      command.operation_id,
      null,
      null,
      'agent',
      'golden-loop-debug',
      command.operation_id,
      JSON.stringify({
        command: command.command,
        status: result.status,
        receipt_id: result.receipt_id,
      }),
      null,
      null,
      null,
      result.status === 'applied' ? 'applied' : 'rejected',
      result.status === 'applied' ? null : result.error ?? result.blockers?.join(',') ?? 'golden_loop_debug_not_applied',
      result.applied_at,
    ],
  );
}

async function installPackage(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const active = await getActiveAppPackage(db, command.installation_id);
  const pkg = objectArg(command, 'package_json');
  if (!pkg) return blocked(command, now(), 'golden_loop_debug_package_json_required');
  const runtime = loadAppPackage(pkg);
  if (active?.id === runtime.activePackage.id && active.version === runtime.activePackage.version) {
    return applied(command, now(), { package_version: active.version });
  }
  if (active) return blocked(command, now(), 'golden_loop_debug_installation_already_active');
  const sourceUrl = textArg(command, 'source_url') ?? 'https://utoia.thetechcruise.com/p/debug-package.json';
  const preview = buildPackageInstallPreview(pkg, {
    sourceUrl,
    expectedChecksum: sha256Canonical(pkg),
  });
  const approval = buildPackageInstallApprovalReceipt(preview, 'golden-loop-debug', now());
  await installApprovedAppPackage(db, {
    packageJson: pkg,
    preview,
    approval,
    installationId: command.installation_id,
    now: now(),
  });
  return applied(command, now(), { package_version: runtime.activePackage.version });
}

async function writeRecord(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const pkg = await getActiveAppPackage(db, command.installation_id);
  if (!pkg) return blocked(command, now(), 'golden_loop_debug_no_active_package');
  const runtime = loadAppPackage(pkg);
  const recordId = textArg(command, 'record_id') ?? `task-${command.operation_id}`;
  const current = await getRecordForInstallation(db, command.installation_id, recordId);
  const observedAt = now();
  const result = await applyOperation(db, runtime.activeManifest, {
    op_id: command.operation_id,
    kind: current ? 'update' : 'create',
    domain: pkg.id,
    collection: textArg(command, 'collection') ?? 'task',
    record_id: recordId,
    expected_revision: current?.revision,
    record: {
      title: textArg(command, 'title') ?? `Golden Loop ${recordId}`,
      properties: {
        owner: textArg(command, 'owner') ?? 'golden-loop',
        status: textArg(command, 'status') ?? 'todo',
        routine: 'golden-loop',
        field_values_hash: textArg(command, 'field_values_hash') ?? 'sha256:unset',
      },
      relations: [],
      source: {
        provider: 'sqlite',
        external_id: recordId,
        url: null,
        observed_at: observedAt,
        content_hash: null,
      },
      archived_at: null,
    },
    actor: 'agent',
    origin: 'workflow',
    idempotency_key: command.operation_id,
  }, { appInstallationId: command.installation_id });
  if (result.status !== 'applied') return blocked(command, now(), `golden_loop_debug_record_${result.status}`);
  return applied(command, now(), { package_version: pkg.version });
}

async function setTransportMode(
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const nextMode = command.command === 'transport.disconnect' ? 'disconnected' : 'connected';
  transportModes.set(command.installation_id, nextMode);
  if (nextMode === 'connected') {
    await flushPendingTransportOperations(command);
  }
  return applied(command, now(), {
    checksum: sha256Canonical({
      installation_id: command.installation_id,
      transport: transportModes.get(command.installation_id),
    }),
  });
}

async function observeDebugOperation(command: GoldenLoopDebugCommand) {
  const endpoint = textArg(command, 'reference_sync_endpoint');
  if (!endpoint) return;
  const mode = transportModes.get(command.installation_id) ?? 'connected';
  if (mode === 'disconnected' && command.command !== 'transport.reconnect') {
    const pending = pendingTransportOperations.get(command.installation_id) ?? [];
    pendingTransportOperations.set(command.installation_id, [...pending, command]);
    return;
  }
  await stageReferenceOperation(endpoint, command);
  await syncReferenceDevice(endpoint, command);
}

async function flushPendingTransportOperations(command: GoldenLoopDebugCommand) {
  const endpoint = textArg(command, 'reference_sync_endpoint');
  if (!endpoint) return;
  const pending = pendingTransportOperations.get(command.installation_id) ?? [];
  pendingTransportOperations.delete(command.installation_id);
  for (const pendingCommand of pending) {
    await stageReferenceOperation(endpoint, pendingCommand);
  }
}

function referenceDeviceId(command: GoldenLoopDebugCommand): string {
  return textArg(command, 'device_id') ?? `debug-device-${command.installation_id}`;
}

function referenceOperation(command: GoldenLoopDebugCommand) {
  const observedAt = new Date().toISOString();
  return {
    op_id: command.operation_id,
    kind: 'create',
    domain: 'golden-loop-debug',
    collection: command.command,
    record_id: command.operation_id,
    expected_revision: 0,
    record: {
      id: command.operation_id,
      domain: 'golden-loop-debug',
      collection: command.command,
      title: command.command,
      properties: {
        installation_id: command.installation_id,
      },
      relations: [],
      source: {
        provider: 'reference-sync',
        external_id: command.operation_id,
        url: null,
        observed_at: observedAt,
        content_hash: sha256Canonical({
          command: command.command,
          operation_id: command.operation_id,
        }),
      },
      archived_at: null,
    },
    actor: 'agent',
    origin: 'sync',
    idempotency_key: command.operation_id,
  };
}

async function postReferenceSync(endpoint: string, path: string, body: Record<string, unknown>) {
  const base = endpoint.replace(/\/$/, '').replace(/\/reference-sync$/, '');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`golden_loop_reference_sync_failed:${path}:${response.status}`);
}

async function stageReferenceOperation(endpoint: string, command: GoldenLoopDebugCommand) {
  await postReferenceSync(endpoint, '/reference-sync/v1/stage', {
    schemaVersion: 'utopia.vendor-neutral-shared-state-sync.v1',
    workspaceId: 'golden-loop',
    installationId: command.installation_id,
    deviceId: referenceDeviceId(command),
    operation: referenceOperation(command),
  });
}

async function syncReferenceDevice(endpoint: string, command: GoldenLoopDebugCommand) {
  await postReferenceSync(endpoint, '/reference-sync/v1/sync', {
    schemaVersion: 'utopia.vendor-neutral-shared-state-sync.v1',
    workspaceId: 'golden-loop',
    installationId: command.installation_id,
    deviceId: referenceDeviceId(command),
  });
}

async function updatePackage(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const pkg = objectArg(command, 'package_json');
  if (!pkg) return blocked(command, now(), 'golden_loop_debug_package_json_required');
  const runtime = loadAppPackage(pkg);
  const sourceUrl = textArg(command, 'source_url') ?? 'https://utoia.thetechcruise.com/p/debug-package-update.json';
  const preview = buildPackageInstallPreview(pkg, {
    sourceUrl,
    expectedChecksum: sha256Canonical(pkg),
  });
  const approval = buildPackageInstallApprovalReceipt(preview, 'golden-loop-debug', now());
  await activateApprovedAppPackageUpdate(db, {
    packageJson: pkg,
    preview,
    approval,
    installationId: command.installation_id,
    now: now(),
  });
  return applied(command, now(), { package_version: runtime.activePackage.version });
}

async function rollbackPackage(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const pkg = await rollbackAppPackage(db, command.installation_id);
  if (!pkg) return blocked(command, now(), 'golden_loop_debug_no_previous_package');
  return applied(command, now(), { package_version: pkg.version });
}

async function exportBackup(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const snapshot = await exportRecoverySnapshot(db);
  const backupId = textArg(command, 'backup_id') ?? command.operation_id;
  backups.set(backupKey(command.installation_id, backupId), snapshot);
  return applied(command, now(), {
    backup_id: backupId,
    checksum: sha256Canonical(snapshot),
    count: snapshot.tables.reduce((total, table) => total + table.rows.length, 0),
  });
}

async function resetInstallation(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  await deleteAppInstallationAndData(db, command.installation_id, {
    confirmedInstallationId: command.installation_id,
    deleteData: true,
  });
  return applied(command, now());
}

async function restoreBackup(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const backupId = textArg(command, 'backup_id') ?? command.operation_id;
  const snapshot = backups.get(backupKey(command.installation_id, backupId));
  if (!snapshot) return blocked(command, now(), 'golden_loop_debug_backup_not_found');
  await importRecoverySnapshot(db, snapshot);
  return applied(command, now(), {
    backup_id: backupId,
    checksum: sha256Canonical(snapshot),
  });
}

async function grantCapability(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const pkg = await getActiveAppPackage(db, command.installation_id);
  if (!pkg) return blocked(command, now(), 'golden_loop_debug_no_active_package');
  const installation = await getPackageInstallAppInstallation(db, command.installation_id);
  const installedChecksum = installation?.packageBinding?.checksum;
  if (!installedChecksum) return blocked(command, now(), 'golden_loop_debug_installation_checksum_unavailable');
  const capability = textArg(command, 'capability') ?? 'debug.local-sync';
  const scope = stringListArg(command, 'scope') ?? ['golden-loop'];
  const decidedAt = now();
  const record = await upsertCapabilityConsentLedgerRecord(db, {
    schemaVersion: UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION,
    installationId: command.installation_id,
    packageId: pkg.id,
    packageVersion: pkg.version,
    packageChecksum: installedChecksum,
    publisherId: textArg(command, 'publisher_id') ?? 'utopia.local-debug',
    capability,
    scope,
    declaredPurpose: textArg(command, 'declared_purpose') ?? 'golden loop runtime proof',
    decision: 'allow',
    decidedBy: 'golden-loop-debug',
    decidedAt,
    createdAt: decidedAt,
    updatedAt: decidedAt,
  });
  return applied(command, now(), {
    capability_record_id: buildCapabilityConsentRecordId(record),
    package_version: pkg.version,
  });
}

async function revokeCapability(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const pkg = await getActiveAppPackage(db, command.installation_id);
  if (!pkg) return blocked(command, now(), 'golden_loop_debug_no_active_package');
  const capability = textArg(command, 'capability') ?? 'debug.local-sync';
  const scope = stringListArg(command, 'scope') ?? ['golden-loop'];
  const recordId = buildCapabilityConsentRecordId({
    installationId: command.installation_id,
    packageId: pkg.id,
    capability,
    scope,
    publisherId: textArg(command, 'publisher_id') ?? 'utopia.local-debug',
    declaredPurpose: textArg(command, 'declared_purpose') ?? 'golden loop runtime proof',
  });
  const current = await getCapabilityConsentLedgerRecord(db, command.installation_id, recordId);
  if (!current) return blocked(command, now(), 'golden_loop_debug_capability_record_not_found');
  await revokeCapabilityConsentLedgerRecord(db, {
    installationId: command.installation_id,
    recordId,
    revokedBy: 'golden-loop-debug',
    revokedAt: now(),
    revocationReason: 'golden-loop-debug-revoke',
  });
  return applied(command, now(), {
    capability_record_id: recordId,
    package_version: pkg.version,
  });
}

async function stateChecksum(
  db: SQLiteDatabase,
  command: GoldenLoopDebugCommand,
  now: () => string,
): Promise<GoldenLoopDebugResult> {
  const active = await getActiveAppPackage(db, command.installation_id);
  if (!active) return blocked(command, now(), 'golden_loop_debug_no_active_package');
  const records = await listRecordsForDomainAndInstallation(
    db,
    command.installation_id,
    active.id,
  );
  const summary = records.map((record) => ({
    id: record.id,
    collection: record.collection,
    revision: record.revision,
    deleted: record.deleted,
    archived_at: record.archived_at,
    property_keys: Object.keys(record.properties ?? {}).sort(),
  })).sort((a, b) => `${a.collection}:${a.id}`.localeCompare(`${b.collection}:${b.id}`));
  return applied(command, now(), {
    checksum: sha256Canonical(summary),
    count: summary.length,
  });
}

function applied(
  command: GoldenLoopDebugCommand,
  appliedAt: string,
  extra: Partial<GoldenLoopDebugResult> = {},
): GoldenLoopDebugResult {
  return {
    status: 'applied',
    command: command.command,
    installation_id: command.installation_id,
    operation_id: command.operation_id,
    receipt_id: receiptId(command.operation_id),
    applied_at: appliedAt,
    ...extra,
  };
}

function blocked(
  command: GoldenLoopDebugCommand | Partial<GoldenLoopDebugCommand>,
  appliedAt: string,
  blocker: string,
): GoldenLoopDebugResult {
  return {
    status: 'blocked',
    command: isCommandName(command.command) ? command.command : 'state.checksum',
    installation_id: typeof command.installation_id === 'string' ? command.installation_id : 'unknown',
    operation_id: typeof command.operation_id === 'string' ? command.operation_id : 'unknown',
    receipt_id: receiptId(typeof command.operation_id === 'string' ? command.operation_id : 'unknown'),
    blockers: [blocker],
    applied_at: appliedAt,
  };
}

function receiptId(operationId: string) {
  return `golden-loop-debug-${operationId}`;
}

function backupKey(installationId: string, backupId: string) {
  return `${installationId}:${backupId}`;
}

function textArg(command: GoldenLoopDebugCommand, key: string): string | null {
  const value = command.arguments?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stringListArg(command: GoldenLoopDebugCommand, key: string): string[] | null {
  const value = command.arguments?.[key];
  if (!Array.isArray(value)) return null;
  const normalized = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return normalized.length ? normalized : null;
}

function objectArg(command: GoldenLoopDebugCommand, key: string): Record<string, unknown> | null {
  const value = command.arguments?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isCommandName(value: unknown): value is GoldenLoopDebugCommand['command'] {
  return typeof value === 'string' && [
    'package.install',
    'record.write',
    'transport.disconnect',
    'transport.reconnect',
    'package.update',
    'package.rollback',
    'backup.export',
    'installation.reset',
    'backup.restore',
    'capability.grant',
    'capability.revoke',
    'state.checksum',
  ].includes(value);
}
