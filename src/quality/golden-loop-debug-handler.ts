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

export async function executeGoldenLoopDebugCommand(
  db: SQLiteDatabase,
  command: unknown,
  options: { expectedToken: string | null; now?: () => string },
): Promise<GoldenLoopDebugResult> {
  const now = options.now ?? (() => new Date().toISOString());
  try {
    validateGoldenLoopDebugCommand(command, options.expectedToken);
    switch (command.command) {
      case 'package.install':
        return await installPackage(db, command, now);
      case 'record.write':
        return await writeRecord(db, command, now);
      case 'transport.disconnect':
      case 'transport.reconnect':
        return setTransportMode(command, now);
      case 'package.update':
        return await updatePackage(db, command, now);
      case 'package.rollback':
        return await rollbackPackage(db, command, now);
      case 'backup.export':
        return await exportBackup(db, command, now);
      case 'installation.reset':
        return await resetInstallation(db, command, now);
      case 'backup.restore':
        return await restoreBackup(db, command, now);
      case 'capability.grant':
        return await grantCapability(db, command, now);
      case 'capability.revoke':
        return await revokeCapability(db, command, now);
      case 'state.checksum':
        return await stateChecksum(db, command, now);
      default:
        return blocked(command, now(), 'golden_loop_debug_command_unknown');
    }
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

function setTransportMode(
  command: GoldenLoopDebugCommand,
  now: () => string,
): GoldenLoopDebugResult {
  transportModes.set(command.installation_id, command.command === 'transport.disconnect' ? 'disconnected' : 'connected');
  return applied(command, now(), {
    checksum: sha256Canonical({
      installation_id: command.installation_id,
      transport: transportModes.get(command.installation_id),
    }),
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
  const capability = textArg(command, 'capability') ?? 'debug.local-sync';
  const scope = stringListArg(command, 'scope') ?? ['golden-loop'];
  const decidedAt = now();
  const record = await upsertCapabilityConsentLedgerRecord(db, {
    schemaVersion: UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION,
    installationId: command.installation_id,
    packageId: pkg.id,
    packageVersion: pkg.version,
    packageChecksum: sha256Canonical(pkg),
    capability,
    scope,
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
