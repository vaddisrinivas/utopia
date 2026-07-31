import type { DatabasePort as SQLiteDatabase } from '@/src/domain/database-port';

import { sha256Canonical, canonicalJson } from '@/src/domain/canonical-json';
import { loadAppPackage } from '@/src/domain/package-loader';
import type { AppPackage } from '@/packages/shared/contracts/package';
import type { AppInstallationId } from '@/packages/shared/contracts/app-installation';

export type PackageMigrationRisk =
  | 'safe'
  | 'review_required'
  | 'destructive'
  | 'requires_new_build'
  | 'unsupported';

export type PackageMigrationLifecycleState =
  | 'planned'
  | 'approved'
  | 'applying'
  | 'activated'
  | 'rolled_back'
  | 'recovered'
  | 'failed'
  | 'manual_review';

export type PackageMigrationPolicyCategory =
  | 'safe_auto'
  | 'operator_review'
  | 'destructive_exception';

export type PackageMigrationOperation = Readonly<
  (
    | { kind: 'add_field'; collectionId: string; fieldId: string; field: unknown; defaultValue?: unknown }
    | { kind: 'rename_field'; collectionId: string; fromFieldId: string; toFieldId: string }
    | { kind: 'copy_field'; collectionId: string; fromFieldId: string; toFieldId: string }
    | { kind: 'set_default'; collectionId: string; fieldId: string; value: unknown }
    | { kind: 'map_enum'; collectionId: string; fieldId: string; values: Record<string, unknown> }
    | { kind: 'archive_collection'; collectionId: string }
    | { kind: 'assert_invariant'; collectionId: string; expression: string }
  ) & { risk?: PackageMigrationRisk; detail?: string }
>;

export type PackageMigrationChange = Readonly<{
  kind: 'collection_added' | 'collection_removed' | 'field_added' | 'field_removed' | 'field_type_changed' | 'query_changed' | 'capability_added';
  id: string;
  risk: PackageMigrationRisk;
  detail: string;
}>;

export type PackageMigrationPlan = Readonly<{
  schemaVersion: 'wonder.package-migration-plan.v1';
  fromPackageKey: string;
  toPackageKey: string;
  fromChecksum: string;
  toChecksum: string;
  risk: PackageMigrationRisk;
  changes: readonly PackageMigrationChange[];
  operations: readonly PackageMigrationOperation[];
  affectedRecordCount: number;
  operationHash: string;
  compatibilityMatrix: {
    oldReadersCanReadNewRecords: boolean;
    newReadersCanReadOldRecords: boolean;
    requiresSnapshot: boolean;
    rollbackAllowed: boolean;
  };
}>;

export type PackageMigrationSnapshot = Readonly<{
  schemaVersion: 'wonder.package-migration-snapshot.v1';
  installationId: string;
  workspaceId: string;
  activePackageKey: string;
  activeChecksum: string;
  recordCount: number;
  recordsChecksum: string;
  snapshotHash: string;
  capturedAt: string;
}>;

export type PackageMigrationApprovalReceipt = Readonly<{
  schemaVersion: 'wonder.package-migration-approval.v1';
  approved: true;
  workspaceId: string;
  installationId: string;
  currentPackageKey: string;
  currentPackageChecksum: string;
  snapshotHash: string;
  planHash: string;
  fromChecksum: string;
  toChecksum: string;
  operationHash: string;
  risk: PackageMigrationRisk;
  policyCategory: PackageMigrationPolicyCategory;
  approvedBy: string;
  actorHash: string;
  approvedAt: string;
  expiresAt: string | null;
  nonce: string;
  consumedReceiptHash: string | null;
}>;

export type PackageMigrationReceipt = Readonly<{
  schemaVersion: 'wonder.package-migration-receipt.v1';
  journalId: string;
  status: 'activated' | 'rejected' | 'rolled_back' | 'recovered' | 'manual_review';
  installationId: string;
  planHash: string;
  snapshotHash: string;
  affectedRecordCount: number;
  approvalHash?: string;
  reason?: string;
  receiptHash: string;
  createdAt: string;
}>;

export type PackageMigrationJournalEntry = Readonly<{
  schemaVersion: 'wonder.package-migration-journal.v1';
  journalId: string;
  installationId: string;
  workspaceId: string;
  state: PackageMigrationLifecycleState;
  planHash: string;
  operationHash: string;
  snapshotHash: string;
  fromPackageKey: string;
  toPackageKey: string;
  fromChecksum: string;
  toChecksum: string;
  affectedRecordCount: number;
  plan: PackageMigrationPlan;
  snapshot: PackageMigrationSnapshot;
  approval: PackageMigrationApprovalReceipt | null;
  receipt: PackageMigrationReceipt | null;
  packageHash: string;
  actorHash: string | null;
  policyCategory: PackageMigrationPolicyCategory | null;
  approvalExpiresAt: string | null;
  approvalNonce: string | null;
  consumedReceiptHash: string | null;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PackageMigrationActivation = Readonly<{
  status: 'activated' | 'recovered' | 'rejected';
  plan: PackageMigrationPlan;
  snapshot: PackageMigrationSnapshot;
  activePackageKey: string;
  receipt: PackageMigrationReceipt;
  reason?: string;
}>;

export type PackageMigrationRecovery = Readonly<{
  status: 'already_restored' | 'rolled_back' | 'completed' | 'manual_review';
  activePackageKey: string | null;
  receipt: PackageMigrationReceipt;
  reason?: string;
}>;

type MigrationRecordRow = {
  id: string;
  collection: string;
  properties: string;
};

type AppInstallationContext = {
  installationId: string;
  workspaceId: string;
};

type MigrationContext = {
  installation: AppInstallationContext;
  fromPackageJson: unknown;
  fromPackage: AppPackage;
  toPackageJson: unknown;
  toPackage: AppPackage;
  snapshot: PackageMigrationSnapshot;
  plan: PackageMigrationPlan;
  journalId: string;
};

type JournalRow = {
  id: string;
  installation_id: string;
  workspace_id: string;
  state: PackageMigrationLifecycleState;
  plan_hash: string;
  operation_hash: string;
  snapshot_hash: string;
  from_package_key: string;
  to_package_key: string;
  from_checksum: string;
  to_checksum: string;
  affected_record_count: number | string;
  plan_json: string;
  snapshot_json: string;
  approval_json: string | null;
  receipt_json: string | null;
  package_hash: string;
  actor_hash: string | null;
  policy_category: PackageMigrationPolicyCategory | null;
  approval_expires_at: string | null;
  approval_nonce: string | null;
  consumed_receipt_hash: string | null;
  error_reason: string | null;
  created_at: string;
  updated_at: string;
};

type AppPackageStateRow = {
  active_package_key: string | null;
  previous_package_key: string | null;
};

export function buildPackageMigrationApprovalReceipt(input: {
  plan: PackageMigrationPlan;
  snapshot: PackageMigrationSnapshot;
  workspaceId?: string;
  installationId?: string;
  approvedBy: string;
  approvedAt?: string;
  expiresAt?: string | null;
  policyCategory?: PackageMigrationPolicyCategory;
  nonce?: string;
  consumedReceiptHash?: string | null;
}): PackageMigrationApprovalReceipt {
  const approvedAt = input.approvedAt ?? new Date().toISOString();
  const approvedBy = input.approvedBy.trim();
  if (!approvedBy) throw new Error('package_migration_approval_actor_required');
  if (Number.isNaN(Date.parse(approvedAt))) throw new Error('package_migration_approval_time_invalid');
  if (input.expiresAt != null && Number.isNaN(Date.parse(input.expiresAt))) throw new Error('package_migration_approval_expiry_invalid');
  const workspaceId = text(input.workspaceId) || input.snapshot.workspaceId;
  const installationId = text(input.installationId) || input.snapshot.installationId;
  if (!workspaceId) throw new Error('package_migration_approval_workspace_required');
  if (!installationId) throw new Error('package_migration_approval_installation_required');
  const policyCategory = input.policyCategory ?? (input.plan.risk === 'review_required' ? 'operator_review' : 'safe_auto');
  const nonce = text(input.nonce) || hashValue([installationId, input.plan.operationHash, approvedAt, approvedBy]).slice(7, 31);
  return {
    schemaVersion: 'wonder.package-migration-approval.v1',
    approved: true,
    workspaceId,
    installationId,
    currentPackageKey: input.plan.fromPackageKey,
    currentPackageChecksum: input.snapshot.activeChecksum,
    snapshotHash: input.snapshot.snapshotHash,
    planHash: hashValue(input.plan),
    fromChecksum: input.plan.fromChecksum,
    toChecksum: input.plan.toChecksum,
    operationHash: input.plan.operationHash,
    risk: input.plan.risk,
    policyCategory,
    approvedBy,
    actorHash: hashValue({ approvedBy }),
    approvedAt,
    expiresAt: input.expiresAt ?? null,
    nonce,
    consumedReceiptHash: input.consumedReceiptHash ?? null,
  };
}

export function planPackageMigration(input: {
  fromPackageJson: unknown;
  toPackageJson: unknown;
  affectedRecordCount?: number;
}): PackageMigrationPlan {
  const fromPackage = loadAppPackage(input.fromPackageJson).activePackage;
  const toPackage = loadAppPackage(input.toPackageJson).activePackage;
  const changes: PackageMigrationChange[] = [];
  const fromCollections = fromPackage.collections;
  const toCollections = toPackage.collections;

  if (fromPackage.id !== toPackage.id) {
    changes.push({
      kind: 'collection_removed',
      id: fromPackage.id,
      risk: 'unsupported',
      detail: `Package id changed from ${fromPackage.id} to ${toPackage.id}.`,
    });
  }

  for (const id of Object.keys(toCollections).sort()) {
    if (!fromCollections[id]) {
      changes.push({ kind: 'collection_added', id, risk: 'safe', detail: `${id} collection added.` });
    }
  }
  for (const id of Object.keys(fromCollections).sort()) {
    if (!toCollections[id]) {
      changes.push({ kind: 'collection_removed', id, risk: 'destructive', detail: `${id} collection removed.` });
    }
  }

  for (const collectionId of Object.keys(toCollections).sort()) {
    const before = fromCollections[collectionId]?.fields ?? {};
    const after = toCollections[collectionId]?.fields ?? {};
    for (const fieldId of Object.keys(after).sort()) {
      const id = `${collectionId}.${fieldId}`;
      if (!before[fieldId]) {
        changes.push({ kind: 'field_added', id, risk: after[fieldId].required ? 'review_required' : 'safe', detail: `${id} field added.` });
      } else if (before[fieldId].type !== after[fieldId].type) {
        changes.push({ kind: 'field_type_changed', id, risk: 'requires_new_build', detail: `${id} type changed from ${before[fieldId].type} to ${after[fieldId].type}.` });
      }
    }
    for (const fieldId of Object.keys(before).sort()) {
      if (!after[fieldId]) {
        changes.push({ kind: 'field_removed', id: `${collectionId}.${fieldId}`, risk: 'destructive', detail: `${collectionId}.${fieldId} field removed.` });
      }
    }
  }

  for (const id of Object.keys(toPackage.queries).sort()) {
    if (JSON.stringify(fromPackage.queries[id] ?? null) !== JSON.stringify(toPackage.queries[id] ?? null)) {
      changes.push({ kind: 'query_changed', id, risk: 'review_required', detail: `${id} query changed.` });
    }
  }
  for (const capability of toPackage.capabilities.filter((item) => !fromPackage.capabilities.includes(item)).sort()) {
    changes.push({ kind: 'capability_added', id: capability, risk: 'review_required', detail: `${capability} capability added.` });
  }

  const operations = [
    ...inferMigrationOperations(fromPackage, toPackage),
    ...readDeclaredMigrationOperations(input.toPackageJson),
  ];
  const risk = maxRisk([...changes.map((change) => change.risk), ...operations.map(operationRisk)]);
  const operationHash = hashValue(operations);
  return {
    schemaVersion: 'wonder.package-migration-plan.v1',
    fromPackageKey: packageKey(fromPackage),
    toPackageKey: packageKey(toPackage),
    fromChecksum: sha256Canonical(fromPackage),
    toChecksum: sha256Canonical(toPackage),
    risk,
    changes,
    operations,
    affectedRecordCount: input.affectedRecordCount ?? 0,
    operationHash,
    compatibilityMatrix: {
      oldReadersCanReadNewRecords: !changes.some((change) => change.kind === 'field_type_changed'),
      newReadersCanReadOldRecords: !changes.some((change) => change.kind === 'collection_removed' || change.kind === 'field_removed'),
      requiresSnapshot: changes.length > 0,
      rollbackAllowed: risk === 'safe' || risk === 'review_required',
    },
  };
}

export async function capturePackageMigrationSnapshot(input: {
  db: SQLiteDatabase;
  installationId: AppInstallationId;
  now?: string;
}): Promise<PackageMigrationSnapshot> {
  const installation = await getInstallationContext(input.db, input.installationId);
  const active = await getActivePackage(input.db, input.installationId);
  if (!active) throw new Error(`package_migration_active_missing:${input.installationId}`);
  const records = await listMigrationRecordRows(input.db, input.installationId);
  const capturedAt = input.now ?? new Date().toISOString();
  const snapshotCore = {
    installationId: installation.installationId,
    workspaceId: installation.workspaceId,
    activePackageKey: packageKey(active),
    activeChecksum: sha256Canonical(active),
    recordCount: records.length,
    recordsChecksum: sha256Canonical(records),
  };
  return {
    schemaVersion: 'wonder.package-migration-snapshot.v1',
    ...snapshotCore,
    capturedAt,
    snapshotHash: sha256Canonical(snapshotCore),
  };
}

export async function dryRunPackageMigration(input: {
  db: SQLiteDatabase;
  installationId: AppInstallationId;
  toPackageJson: unknown;
  now?: string;
}): Promise<{ status: 'ready' | 'review_required' | 'blocked'; plan: PackageMigrationPlan; snapshot: PackageMigrationSnapshot; journalId: string }> {
  const context = await buildMigrationContext(input);
  await upsertJournalEntry(input.db, buildJournalEntry({
    context,
    state: 'planned',
    createdAt: context.snapshot.capturedAt,
    updatedAt: context.snapshot.capturedAt,
  }));
  const blockedByOperation = context.plan.operations.some((operation) => isBlockingRisk(operationRisk(operation)));
  return {
    status: isBlockingRisk(context.plan.risk) || blockedByOperation ? 'blocked' : context.plan.risk === 'safe' ? 'ready' : 'review_required',
    plan: context.plan,
    snapshot: context.snapshot,
    journalId: context.journalId,
  };
}

export async function activateDryRunPackageMigration(input: {
  db: SQLiteDatabase;
  installationId: AppInstallationId;
  toPackageJson: unknown;
  expectedSnapshot: PackageMigrationSnapshot;
  approval?: PackageMigrationApprovalReceipt;
  now?: string;
}): Promise<PackageMigrationActivation> {
  const now = input.now ?? new Date().toISOString();
  const context = await buildMigrationContext({
    db: input.db,
    installationId: input.installationId,
    toPackageJson: input.toPackageJson,
    now,
  });
  const dryRunStatus = classifyDryRun(context.plan);

  if (!matchesSnapshot(context.snapshot, input.expectedSnapshot)) {
    const recovered = await recoverActivatedMigration({
      db: input.db,
      installationId: input.installationId,
      toPackageJson: input.toPackageJson,
      expectedSnapshot: input.expectedSnapshot,
      now,
    });
    if (recovered) return recovered;
    return persistRejectedActivation(input.db, context, input.approval ?? null, now, 'package_migration_snapshot_mismatch');
  }

  if (dryRunStatus === 'blocked') {
    return persistRejectedActivation(input.db, context, input.approval ?? null, now, `package_migration_${context.plan.risk}`);
  }

  if (dryRunStatus === 'review_required') {
    if (!input.approval) return persistRejectedActivation(input.db, context, null, now, 'package_migration_approval_required');
    assertApprovalMatchesContext(input.approval, context, now);
  } else if (input.approval) {
    assertApprovalMatchesContext(input.approval, context, now);
  }

  const approval = input.approval ?? null;
  if (approval) {
    await assertApprovalNotConsumedByOtherInstallation(input.db, approval, context.installation.installationId, context.journalId);
    await upsertJournalEntry(input.db, buildJournalEntry({
      context,
      state: 'approved',
      approval,
      createdAt: context.snapshot.capturedAt,
      updatedAt: now,
    }));
  }

  const receipt = buildMigrationReceipt({
    journalId: context.journalId,
    status: 'activated',
    installationId: context.installation.installationId,
    plan: context.plan,
    snapshot: context.snapshot,
    approval,
    now,
  });

  try {
    await input.db.withTransactionAsync(async () => {
      await upsertJournalEntry(input.db, buildJournalEntry({
        context,
        state: 'applying',
        approval,
        createdAt: context.snapshot.capturedAt,
        updatedAt: now,
      }));
      await validateDeclarativeMigrationOperations(input.db, context.installation.installationId, context.plan.operations);
      await applyDeclarativeMigrationOperations(input.db, context.installation.installationId, context.plan.operations);
      await storeAppPackagePayload(input.db, context.toPackage, now);
      await writePackageState(input.db, context.installation.installationId, context.plan.toPackageKey, context.plan.fromPackageKey, now);
      await insertPackageReceipt(input.db, context.installation.installationId, context.plan.toPackageKey, context.plan.fromPackageKey, now, {
        requestHash: context.snapshot.activeChecksum,
        packageHash: context.plan.toChecksum,
        approvalHash: approval ? hashValue(approval) : null,
        approvedBy: approval?.approvedBy ?? null,
      });
      await upsertJournalEntry(input.db, buildJournalEntry({
        context,
        state: 'activated',
        approval,
        receipt,
        createdAt: context.snapshot.capturedAt,
        updatedAt: now,
      }));
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'package_migration_apply_failed';
    await upsertJournalEntry(input.db, buildJournalEntry({
      context,
      state: 'failed',
      approval,
      createdAt: context.snapshot.capturedAt,
      updatedAt: now,
      errorReason: reason,
    }));
    return persistRejectedActivation(input.db, context, approval, now, reason);
  }

  return {
    status: 'activated',
    plan: context.plan,
    snapshot: context.snapshot,
    activePackageKey: context.plan.toPackageKey,
    receipt,
  };
}

export async function rollbackPackageMigration(input: {
  db: SQLiteDatabase;
  installationId: AppInstallationId;
  expectedActivePackageKey?: string;
  now?: string;
}): Promise<{ status: 'rolled_back' | 'rejected'; activePackageKey: string | null; reason?: string; receipt?: PackageMigrationReceipt }> {
  const installationId = inputId(input.installationId);
  const active = await getActivePackage(input.db, installationId);
  const activePackageKey = active ? packageKey(active) : null;
  if (input.expectedActivePackageKey && activePackageKey !== input.expectedActivePackageKey) {
    return { status: 'rejected', activePackageKey, reason: 'package_migration_rollback_active_mismatch' };
  }
  const state = await getPackageState(input.db, installationId);
  if (!state?.previous_package_key) {
    return { status: 'rejected', activePackageKey, reason: 'package_migration_no_previous_package' };
  }
  const previousPackageJson = await getStoredPackagePayload(input.db, state.previous_package_key);
  if (!previousPackageJson) {
    return { status: 'rejected', activePackageKey, reason: 'package_migration_previous_package_missing' };
  }
  const previousPackage = loadAppPackage(previousPackageJson).activePackage;
  const latestJournal = await getLatestJournalEntry(input.db, installationId);
  const now = input.now ?? new Date().toISOString();
  await input.db.withTransactionAsync(async () => {
    await writePackageState(input.db, installationId, state.previous_package_key, null, now);
    await insertPackageReceipt(input.db, installationId, state.previous_package_key, activePackageKey, now, {});
    if (latestJournal) {
      const receipt = buildMigrationReceipt({
        journalId: latestJournal.journalId,
        status: 'rolled_back',
        installationId,
        plan: latestJournal.plan,
        snapshot: latestJournal.snapshot,
        approval: latestJournal.approval,
        now,
      });
      await upsertJournalEntry(input.db, {
        ...latestJournal,
        state: 'rolled_back',
        receipt,
        errorReason: null,
        updatedAt: now,
      });
    }
  });
  return {
    status: 'rolled_back',
    activePackageKey: packageKey(previousPackage),
    ...(latestJournal ? {
      receipt: buildMigrationReceipt({
        journalId: latestJournal.journalId,
        status: 'rolled_back',
        installationId,
        plan: latestJournal.plan,
        snapshot: latestJournal.snapshot,
        approval: latestJournal.approval,
        now,
      }),
    } : {}),
  };
}

export async function recoverInterruptedPackageMigration(input: {
  db: SQLiteDatabase;
  installationId: AppInstallationId;
  now?: string;
}): Promise<PackageMigrationRecovery> {
  const installationId = inputId(input.installationId);
  const latestJournal = await getLatestJournalEntry(input.db, installationId);
  const now = input.now ?? new Date().toISOString();
  if (!latestJournal) {
    const snapshot = await capturePackageMigrationSnapshot({ db: input.db, installationId, now });
    const receipt = buildMigrationReceipt({
      journalId: `pkgmig:${installationId}:missing`,
      status: 'manual_review',
      installationId,
      plan: null,
      snapshot,
      now,
      reason: 'package_migration_journal_missing',
    });
    return { status: 'manual_review', activePackageKey: snapshot.activePackageKey, reason: 'package_migration_journal_missing', receipt };
  }

  const active = await getActivePackage(input.db, installationId);
  const activePackageKey = active ? packageKey(active) : null;
  const activeChecksum = active ? sha256Canonical(active) : null;
  const receiptFor = (status: PackageMigrationReceipt['status'], reason?: string) => buildMigrationReceipt({
    journalId: latestJournal.journalId,
    status,
    installationId,
    plan: latestJournal.plan,
    snapshot: latestJournal.snapshot,
    approval: latestJournal.approval,
    now,
    reason,
  });

  const fromPackage = await getStoredPackageByKey(input.db, latestJournal.fromPackageKey);
  const toPackage = await getStoredPackageByKey(input.db, latestJournal.toPackageKey);
  if (!fromPackage || !toPackage) {
    const receipt = receiptFor('manual_review', 'package_migration_package_history_missing');
    await upsertJournalEntry(input.db, {
      ...latestJournal,
      state: 'manual_review',
      receipt,
      errorReason: 'package_migration_package_history_missing',
      updatedAt: now,
    });
    return { status: 'manual_review', activePackageKey, reason: 'package_migration_package_history_missing', receipt };
  }
  if (sha256Canonical(fromPackage) !== latestJournal.fromChecksum || sha256Canonical(toPackage) !== latestJournal.toChecksum) {
    const receipt = receiptFor('manual_review', 'package_migration_package_checksum_mismatch');
    await upsertJournalEntry(input.db, {
      ...latestJournal,
      state: 'manual_review',
      receipt,
      errorReason: 'package_migration_package_checksum_mismatch',
      updatedAt: now,
    });
    return { status: 'manual_review', activePackageKey, reason: 'package_migration_package_checksum_mismatch', receipt };
  }

  if (activePackageKey === latestJournal.fromPackageKey && activeChecksum === latestJournal.snapshot.activeChecksum) {
    const receipt = receiptFor('recovered');
    await upsertJournalEntry(input.db, {
      ...latestJournal,
      state: latestJournal.state === 'rolled_back' ? 'rolled_back' : 'recovered',
      receipt,
      errorReason: null,
      updatedAt: now,
    });
    return { status: 'already_restored', activePackageKey, receipt };
  }

  if (activePackageKey === latestJournal.toPackageKey && activeChecksum === latestJournal.toChecksum) {
    const receipt = receiptFor('recovered');
    await upsertJournalEntry(input.db, {
      ...latestJournal,
      state: 'recovered',
      receipt,
      errorReason: null,
      updatedAt: now,
    });
    return { status: 'completed', activePackageKey, receipt };
  }

  const state = await getPackageState(input.db, installationId);
  if (state?.previous_package_key === latestJournal.fromPackageKey) {
    await input.db.withTransactionAsync(async () => {
      await writePackageState(input.db, installationId, latestJournal.fromPackageKey, null, now);
      await insertPackageReceipt(input.db, installationId, latestJournal.fromPackageKey, latestJournal.toPackageKey, now, {});
      const receipt = receiptFor('recovered');
      await upsertJournalEntry(input.db, {
        ...latestJournal,
        state: 'recovered',
        receipt,
        errorReason: null,
        updatedAt: now,
      });
    });
    return {
      status: 'rolled_back',
      activePackageKey: latestJournal.fromPackageKey,
      receipt: receiptFor('recovered'),
    };
  }

  const receipt = receiptFor('manual_review', 'package_migration_state_ambiguous');
  await upsertJournalEntry(input.db, {
    ...latestJournal,
    state: 'manual_review',
    receipt,
    errorReason: 'package_migration_state_ambiguous',
    updatedAt: now,
  });
  return { status: 'manual_review', activePackageKey, reason: 'package_migration_state_ambiguous', receipt };
}

async function recoverActivatedMigration(input: {
  db: SQLiteDatabase;
  installationId: AppInstallationId;
  toPackageJson: unknown;
  expectedSnapshot: PackageMigrationSnapshot;
  now: string;
}): Promise<PackageMigrationActivation | null> {
  const active = await getActivePackage(input.db, input.installationId);
  if (!active) return null;
  const toPackage = loadAppPackage(input.toPackageJson).activePackage;
  if (packageKey(active) !== packageKey(toPackage) || sha256Canonical(active) !== sha256Canonical(toPackage)) return null;
  const previousPackageJson = await getStoredPackagePayload(input.db, input.expectedSnapshot.activePackageKey);
  if (!previousPackageJson) return null;
  const state = await input.db.getFirstAsync<{ previous_package_key: string | null }>(
    `SELECT previous_package_key FROM app_installation_package_state WHERE installation_id = $installation_id`,
    { $installation_id: inputId(input.installationId) },
  );
  if (state?.previous_package_key !== input.expectedSnapshot.activePackageKey) return null;
  const previousPackage = loadAppPackage(previousPackageJson).activePackage;
  const affectedRecordCount = await countAffectedRecords(input.db, input.installationId, previousPackage, toPackage);
  const plan = planPackageMigration({ fromPackageJson: previousPackageJson, toPackageJson: input.toPackageJson, affectedRecordCount });
  const receipt = buildMigrationReceipt({
    journalId: journalIdFor(input.installationId, input.expectedSnapshot.snapshotHash, hashValue(plan)),
    status: 'recovered',
    installationId: inputId(input.installationId),
    plan,
    snapshot: input.expectedSnapshot,
    now: input.now,
  });
  return {
    status: 'recovered',
    plan,
    snapshot: input.expectedSnapshot,
    activePackageKey: packageKey(active),
    receipt,
  };
}

async function persistRejectedActivation(
  db: SQLiteDatabase,
  context: MigrationContext,
  approval: PackageMigrationApprovalReceipt | null,
  now: string,
  reason: string,
): Promise<PackageMigrationActivation> {
  const receipt = buildMigrationReceipt({
    journalId: context.journalId,
    status: 'rejected',
    installationId: context.installation.installationId,
    plan: context.plan,
    snapshot: context.snapshot,
    approval,
    now,
    reason,
  });
  await upsertJournalEntry(db, buildJournalEntry({
    context,
    state: 'failed',
    approval,
    receipt,
    createdAt: context.snapshot.capturedAt,
    updatedAt: now,
    errorReason: reason,
  }));
  return {
    status: 'rejected',
    plan: context.plan,
    snapshot: context.snapshot,
    activePackageKey: context.snapshot.activePackageKey,
    reason,
    receipt,
  };
}

async function buildMigrationContext(input: {
  db: SQLiteDatabase;
  installationId: AppInstallationId;
  toPackageJson: unknown;
  now?: string;
}): Promise<MigrationContext> {
  const installation = await getInstallationContext(input.db, input.installationId);
  const snapshot = await capturePackageMigrationSnapshot({ db: input.db, installationId: installation.installationId, now: input.now });
  const active = await getActivePackage(input.db, installation.installationId);
  if (!active) throw new Error(`package_migration_active_missing:${installation.installationId}`);
  const fromPackageJson = await getStoredPackagePayload(input.db, snapshot.activePackageKey) ?? active;
  const fromPackage = loadAppPackage(fromPackageJson).activePackage;
  const toPackage = loadAppPackage(input.toPackageJson).activePackage;
  const affectedRecordCount = await countAffectedRecords(input.db, installation.installationId, fromPackage, toPackage);
  const planWithoutOpsCount = planPackageMigration({
    fromPackageJson,
    toPackageJson: input.toPackageJson,
    affectedRecordCount,
  });
  const operationAffectedRecordCount = await countOperationAffectedRecords(input.db, installation.installationId, planWithoutOpsCount.operations);
  const plan: PackageMigrationPlan = {
    ...planWithoutOpsCount,
    affectedRecordCount: Math.max(affectedRecordCount, operationAffectedRecordCount),
  };
  return {
    installation,
    fromPackageJson,
    fromPackage,
    toPackageJson: input.toPackageJson,
    toPackage,
    snapshot,
    plan,
    journalId: journalIdFor(installation.installationId, snapshot.snapshotHash, hashValue(plan)),
  };
}

function classifyDryRun(plan: PackageMigrationPlan): 'ready' | 'review_required' | 'blocked' {
  const blockedByOperation = plan.operations.some((operation) => isBlockingRisk(operationRisk(operation)));
  if (isBlockingRisk(plan.risk) || blockedByOperation) return 'blocked';
  return plan.risk === 'safe' ? 'ready' : 'review_required';
}

function buildJournalEntry(input: {
  context: MigrationContext;
  state: PackageMigrationLifecycleState;
  approval?: PackageMigrationApprovalReceipt | null;
  receipt?: PackageMigrationReceipt | null;
  errorReason?: string | null;
  createdAt: string;
  updatedAt: string;
}): PackageMigrationJournalEntry {
  const approval = input.approval ?? null;
  return {
    schemaVersion: 'wonder.package-migration-journal.v1',
    journalId: input.context.journalId,
    installationId: input.context.installation.installationId,
    workspaceId: input.context.installation.workspaceId,
    state: input.state,
    planHash: hashValue(input.context.plan),
    operationHash: input.context.plan.operationHash,
    snapshotHash: input.context.snapshot.snapshotHash,
    fromPackageKey: input.context.plan.fromPackageKey,
    toPackageKey: input.context.plan.toPackageKey,
    fromChecksum: input.context.plan.fromChecksum,
    toChecksum: input.context.plan.toChecksum,
    affectedRecordCount: input.context.plan.affectedRecordCount,
    plan: input.context.plan,
    snapshot: input.context.snapshot,
    approval,
    receipt: input.receipt ?? null,
    packageHash: input.context.plan.toChecksum,
    actorHash: approval?.actorHash ?? null,
    policyCategory: approval?.policyCategory ?? null,
    approvalExpiresAt: approval?.expiresAt ?? null,
    approvalNonce: approval?.nonce ?? null,
    consumedReceiptHash: approval?.consumedReceiptHash ?? null,
    errorReason: input.errorReason ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

async function upsertJournalEntry(db: SQLiteDatabase, entry: PackageMigrationJournalEntry): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO package_migration_journal (
      id, installation_id, workspace_id, state, plan_hash, operation_hash, snapshot_hash,
      from_package_key, to_package_key, from_checksum, to_checksum, affected_record_count,
      plan_json, snapshot_json, approval_json, receipt_json, package_hash, actor_hash,
      policy_category, approval_expires_at, approval_nonce, consumed_receipt_hash,
      error_reason, created_at, updated_at
    ) VALUES (
      $id, $installation_id, $workspace_id, $state, $plan_hash, $operation_hash, $snapshot_hash,
      $from_package_key, $to_package_key, $from_checksum, $to_checksum, $affected_record_count,
      $plan_json, $snapshot_json, $approval_json, $receipt_json, $package_hash, $actor_hash,
      $policy_category, $approval_expires_at, $approval_nonce, $consumed_receipt_hash,
      $error_reason, $created_at, $updated_at
    )`,
    {
      $id: entry.journalId,
      $installation_id: entry.installationId,
      $workspace_id: entry.workspaceId,
      $state: entry.state,
      $plan_hash: entry.planHash,
      $operation_hash: entry.operationHash,
      $snapshot_hash: entry.snapshotHash,
      $from_package_key: entry.fromPackageKey,
      $to_package_key: entry.toPackageKey,
      $from_checksum: entry.fromChecksum,
      $to_checksum: entry.toChecksum,
      $affected_record_count: entry.affectedRecordCount,
      $plan_json: canonicalJson(entry.plan),
      $snapshot_json: canonicalJson(entry.snapshot),
      $approval_json: entry.approval ? canonicalJson(entry.approval) : null,
      $receipt_json: entry.receipt ? canonicalJson(entry.receipt) : null,
      $package_hash: entry.packageHash,
      $actor_hash: entry.actorHash,
      $policy_category: entry.policyCategory,
      $approval_expires_at: entry.approvalExpiresAt,
      $approval_nonce: entry.approvalNonce,
      $consumed_receipt_hash: entry.consumedReceiptHash,
      $error_reason: entry.errorReason,
      $created_at: entry.createdAt,
      $updated_at: entry.updatedAt,
    },
  );
}

async function getLatestJournalEntry(db: SQLiteDatabase, installationId: string): Promise<PackageMigrationJournalEntry | null> {
  const row = await db.getFirstAsync<JournalRow>(
    `SELECT *
      FROM package_migration_journal
      WHERE installation_id = $installation_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1`,
    { $installation_id: installationId },
  );
  return row ? journalEntryFromRow(row) : null;
}

async function assertApprovalNotConsumedByOtherInstallation(
  db: SQLiteDatabase,
  approval: PackageMigrationApprovalReceipt,
  installationId: string,
  journalId: string,
): Promise<void> {
  const approvalHash = hashValue(approval);
  const row = await db.getFirstAsync<{ installation_id: string; id: string; state: string }>(
    `SELECT installation_id, id, state
      FROM package_migration_journal
      WHERE approval_json IS NOT NULL
        AND json_extract(approval_json, '$.schemaVersion') = 'wonder.package-migration-approval.v1'
        AND json_extract(approval_json, '$.planHash') = $plan_hash
        AND json_extract(approval_json, '$.nonce') = $nonce
        AND json_extract(approval_json, '$.approvedAt') = $approved_at
        AND json_extract(approval_json, '$.approvedBy') = $approved_by
        AND id != $journal_id
      LIMIT 1`,
    {
      $plan_hash: approval.planHash,
      $nonce: approval.nonce,
      $approved_at: approval.approvedAt,
      $approved_by: approval.approvedBy,
      $journal_id: journalId,
    },
  );
  if (row && row.installation_id !== installationId) {
    throw new Error(`package_migration_approval_cross_installation:${approvalHash}`);
  }
  const consumed = await db.getFirstAsync<{ id: string }>(
    `SELECT id
      FROM package_migration_journal
      WHERE installation_id = $installation_id
        AND id != $journal_id
        AND receipt_json IS NOT NULL
        AND json_extract(receipt_json, '$.approvalHash') = $approval_hash
      LIMIT 1`,
    {
      $installation_id: installationId,
      $journal_id: journalId,
      $approval_hash: approvalHash,
    },
  );
  if (consumed) throw new Error(`package_migration_approval_replayed:${approvalHash}`);
}

async function validateDeclarativeMigrationOperations(
  db: SQLiteDatabase,
  installationId: AppInstallationId,
  operations: readonly PackageMigrationOperation[],
): Promise<void> {
  const rows = await listMigrationRecordRows(db, installationId);
  for (const operation of operations) {
    const risk = operationRisk(operation);
    if (isBlockingRisk(risk)) throw new Error(`package_migration_${risk}`);
    if (operation.kind === 'archive_collection') throw new Error('package_migration_archive_collection_requires_review');
    if (operation.kind !== 'assert_invariant') continue;
    for (const row of rows.filter((item) => item.collection === operation.collectionId)) {
      if (!evaluateInvariant(operation.expression, parseProperties(row.properties))) {
        throw new Error(`package_migration_invariant_failed:${operation.collectionId}:${operation.expression}`);
      }
    }
  }
}

async function applyDeclarativeMigrationOperations(
  db: SQLiteDatabase,
  installationId: AppInstallationId,
  operations: readonly PackageMigrationOperation[],
): Promise<void> {
  for (const operation of operations) {
    if (operation.kind === 'archive_collection' || operation.kind === 'assert_invariant') continue;
    const rows = await listMigrationRecordRows(db, installationId);
    if (!rows.length) return;
    for (const row of rows.filter((item) => item.collection === operation.collectionId)) {
      const properties = parseProperties(row.properties);
      const before = canonicalJson(properties);
      if (operation.kind === 'add_field' && !Object.hasOwn(properties, operation.fieldId)) {
        properties[operation.fieldId] = operation.defaultValue ?? null;
      } else if (operation.kind === 'rename_field' && Object.hasOwn(properties, operation.fromFieldId) && !Object.hasOwn(properties, operation.toFieldId)) {
        properties[operation.toFieldId] = properties[operation.fromFieldId];
        delete properties[operation.fromFieldId];
      } else if (operation.kind === 'copy_field' && Object.hasOwn(properties, operation.fromFieldId) && !Object.hasOwn(properties, operation.toFieldId)) {
        properties[operation.toFieldId] = properties[operation.fromFieldId];
      } else if (operation.kind === 'set_default' && (properties[operation.fieldId] === undefined || properties[operation.fieldId] === null)) {
        properties[operation.fieldId] = operation.value;
      } else if (operation.kind === 'map_enum') {
        const current = properties[operation.fieldId];
        if (typeof current !== 'string' || !Object.hasOwn(operation.values, current)) continue;
        properties[operation.fieldId] = operation.values[current];
      } else {
        continue;
      }
      if (canonicalJson(properties) === before) continue;
      await db.runAsync(
        `UPDATE records SET properties = $properties WHERE app_installation_id = $installation_id AND id = $id`,
        {
          $properties: JSON.stringify(properties),
          $installation_id: inputId(installationId),
          $id: row.id,
        },
      );
    }
  }
}

function evaluateInvariant(expression: string, properties: Record<string, unknown>): boolean {
  const present = /^properties\.([A-Za-z0-9_]+) is present$/u.exec(expression);
  if (present) {
    const value = properties[present[1]];
    return value !== undefined && value !== null;
  }
  const removedOnlyAfterReview = /^properties\.([A-Za-z0-9_]+) removed only after review$/u.exec(expression);
  if (removedOnlyAfterReview) {
    return true;
  }
  return false;
}

function inferMigrationOperations(fromPackage: AppPackage, toPackage: AppPackage): PackageMigrationOperation[] {
  const operations: PackageMigrationOperation[] = [];
  for (const collectionId of Object.keys(toPackage.collections).sort()) {
    const before = fromPackage.collections[collectionId]?.fields ?? {};
    const after = toPackage.collections[collectionId]?.fields ?? {};
    for (const fieldId of Object.keys(after).sort()) {
      if (!before[fieldId]) {
        operations.push({ kind: 'add_field', collectionId, fieldId, field: after[fieldId] });
        if (after[fieldId].required) {
          operations.push({ kind: 'assert_invariant', collectionId, expression: `properties.${fieldId} is present` });
        }
      }
    }
    for (const fieldId of Object.keys(before).sort()) {
      if (!after[fieldId]) operations.push({ kind: 'assert_invariant', collectionId, expression: `properties.${fieldId} removed only after review` });
    }
  }
  for (const collectionId of Object.keys(fromPackage.collections).sort()) {
    if (!toPackage.collections[collectionId]) operations.push({ kind: 'archive_collection', collectionId });
  }
  return operations;
}

function readDeclaredMigrationOperations(packageJson: unknown): PackageMigrationOperation[] {
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) return [];
  const source = packageJson as { migrations?: unknown; migration?: { operations?: unknown }; migrationOperations?: unknown };
  const raw = Array.isArray(source.migrationOperations)
    ? source.migrationOperations
    : Array.isArray(source.migration?.operations)
      ? source.migration.operations
      : Array.isArray(source.migrations)
        ? source.migrations
        : [];
  return raw.map(parseMigrationOperation);
}

function parseMigrationOperation(value: unknown): PackageMigrationOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('package_migration_operation_invalid');
  const operation = value as Record<string, unknown>;
  const kind = text(operation.kind);
  const common = migrationOperationMeta(operation);
  if (kind === 'add_field') {
    return {
      kind,
      collectionId: requiredText(operation.collectionId, 'collectionId'),
      fieldId: requiredText(operation.fieldId, 'fieldId'),
      field: operation.field,
      defaultValue: operation.defaultValue,
      ...common,
    };
  }
  if (kind === 'rename_field') {
    return {
      kind,
      collectionId: requiredText(operation.collectionId, 'collectionId'),
      fromFieldId: requiredText(operation.fromFieldId, 'fromFieldId'),
      toFieldId: requiredText(operation.toFieldId, 'toFieldId'),
      ...common,
    };
  }
  if (kind === 'copy_field') {
    return {
      kind,
      collectionId: requiredText(operation.collectionId, 'collectionId'),
      fromFieldId: requiredText(operation.fromFieldId, 'fromFieldId'),
      toFieldId: requiredText(operation.toFieldId, 'toFieldId'),
      ...common,
    };
  }
  if (kind === 'set_default') {
    return {
      kind,
      collectionId: requiredText(operation.collectionId, 'collectionId'),
      fieldId: requiredText(operation.fieldId, 'fieldId'),
      value: operation.value,
      ...common,
    };
  }
  if (kind === 'map_enum') {
    return {
      kind,
      collectionId: requiredText(operation.collectionId, 'collectionId'),
      fieldId: requiredText(operation.fieldId, 'fieldId'),
      values: stringRecord(operation.values),
      ...common,
    };
  }
  if (kind === 'archive_collection') {
    return {
      kind,
      collectionId: requiredText(operation.collectionId, 'collectionId'),
      ...common,
    };
  }
  if (kind === 'assert_invariant') {
    return {
      kind,
      collectionId: requiredText(operation.collectionId, 'collectionId'),
      expression: requiredText(operation.expression, 'expression'),
      ...common,
    };
  }
  throw new Error(`package_migration_operation_unsupported:${kind || '<missing>'}`);
}

function migrationOperationMeta(operation: Record<string, unknown>): Pick<PackageMigrationOperation, 'risk' | 'detail'> {
  return {
    ...(isRisk(operation.risk) ? { risk: operation.risk } : {}),
    ...(text(operation.detail) ? { detail: text(operation.detail) } : {}),
  };
}

async function countAffectedRecords(
  db: SQLiteDatabase,
  installationId: AppInstallationId,
  fromPackage: AppPackage,
  toPackage: AppPackage,
): Promise<number> {
  const rows = await listMigrationRecordRows(db, installationId);
  if (!rows.length) return 0;
  const changedCollections = new Set<string>();
  for (const collectionId of Object.keys(fromPackage.collections)) {
    if (!toPackage.collections[collectionId]) changedCollections.add(collectionId);
  }
  for (const collectionId of Object.keys(toPackage.collections)) {
    const before = fromPackage.collections[collectionId]?.fields ?? {};
    const after = toPackage.collections[collectionId]?.fields ?? {};
    if (JSON.stringify(before) !== JSON.stringify(after)) changedCollections.add(collectionId);
  }
  return rows.filter((row) => changedCollections.has(row.collection)).length;
}

async function countOperationAffectedRecords(
  db: SQLiteDatabase,
  installationId: AppInstallationId,
  operations: readonly PackageMigrationOperation[],
): Promise<number> {
  const rows = await listMigrationRecordRows(db, installationId);
  if (!rows.length || !operations.length) return 0;
  return rows.filter((row) => operations.some((operation) => operationAffectsRow(operation, row))).length;
}

function operationAffectsRow(operation: PackageMigrationOperation, row: MigrationRecordRow): boolean {
  if (row.collection !== operation.collectionId) return false;
  if (operation.kind === 'archive_collection') return true;
  if (operation.kind === 'assert_invariant') return false;
  const properties = parseProperties(row.properties);
  if (operation.kind === 'add_field') return !Object.hasOwn(properties, operation.fieldId);
  if (operation.kind === 'rename_field') return Object.hasOwn(properties, operation.fromFieldId) && !Object.hasOwn(properties, operation.toFieldId);
  if (operation.kind === 'copy_field') return Object.hasOwn(properties, operation.fromFieldId) && !Object.hasOwn(properties, operation.toFieldId);
  if (operation.kind === 'set_default') return properties[operation.fieldId] === undefined || properties[operation.fieldId] === null;
  if (operation.kind === 'map_enum') return typeof properties[operation.fieldId] === 'string' && Object.hasOwn(operation.values, String(properties[operation.fieldId]));
  return false;
}

async function listMigrationRecordRows(
  db: SQLiteDatabase,
  installationId: AppInstallationId,
): Promise<MigrationRecordRow[]> {
  const rows = await db.getAllAsync<MigrationRecordRow>(
    `SELECT id, collection, properties FROM records WHERE app_installation_id = $installation_id ORDER BY collection ASC, id ASC`,
    { $installation_id: inputId(installationId) },
  );
  return rows.map((row) => ({
    id: row.id,
    collection: row.collection,
    properties: normalizePropertiesJson(row.properties),
  }));
}

function buildMigrationReceipt(input: {
  journalId: string;
  status: PackageMigrationReceipt['status'];
  installationId: AppInstallationId;
  plan: PackageMigrationPlan | null;
  snapshot: PackageMigrationSnapshot;
  approval?: PackageMigrationApprovalReceipt | null;
  now: string;
  reason?: string;
}): PackageMigrationReceipt {
  const receiptCore = {
    schemaVersion: 'wonder.package-migration-receipt.v1' as const,
    journalId: input.journalId,
    status: input.status,
    installationId: inputId(input.installationId),
    planHash: input.plan ? hashValue(input.plan) : 'sha256:recovery',
    snapshotHash: input.snapshot.snapshotHash,
    affectedRecordCount: input.plan?.affectedRecordCount ?? input.snapshot.recordCount,
    ...(input.approval ? { approvalHash: hashValue(input.approval) } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    createdAt: input.now,
  };
  return {
    ...receiptCore,
    receiptHash: hashValue(receiptCore),
  };
}

async function getInstallationContext(db: SQLiteDatabase, installationId: AppInstallationId): Promise<AppInstallationContext> {
  const row = await db.getFirstAsync<{ installation_id: string; workspace_id: string }>(
    `SELECT installation_id, workspace_id FROM app_installations WHERE installation_id = $installation_id`,
    { $installation_id: inputId(installationId) },
  );
  if (!row) throw new Error(`app_installation_not_found:${installationId}`);
  return {
    installationId: row.installation_id,
    workspaceId: row.workspace_id,
  };
}

async function getActivePackage(db: SQLiteDatabase, installationId: AppInstallationId): Promise<AppPackage | null> {
  const state = await getPackageState(db, installationId);
  if (!state?.active_package_key) return null;
  return getStoredPackageByKey(db, state.active_package_key);
}

async function getPackageState(db: SQLiteDatabase, installationId: AppInstallationId): Promise<AppPackageStateRow | null> {
  return db.getFirstAsync<AppPackageStateRow>(
    `SELECT active_package_key, previous_package_key
      FROM app_installation_package_state
      WHERE installation_id = $installation_id`,
    { $installation_id: inputId(installationId) },
  );
}

async function getStoredPackageByKey(db: SQLiteDatabase, packageKeyValue: string): Promise<AppPackage | null> {
  const payload = await getStoredPackagePayload(db, packageKeyValue);
  if (!payload) return null;
  return loadAppPackage(payload).activePackage;
}

async function getStoredPackagePayload(db: SQLiteDatabase, packageKeyValue: string): Promise<unknown | null> {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    `SELECT payload_json FROM app_packages WHERE package_key = $package_key`,
    { $package_key: packageKeyValue },
  );
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    throw new Error(`package_migration_stored_package_invalid:${packageKeyValue}`);
  }
}

async function storeAppPackagePayload(db: SQLiteDatabase, appPackage: AppPackage, now: string): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO app_packages
      (package_key, package_id, version, payload_json, created_at, updated_at)
      VALUES ($package_key, $package_id, $version, $payload_json, $created_at, $updated_at)`,
    {
      $package_key: packageKey(appPackage),
      $package_id: appPackage.id,
      $version: appPackage.version,
      $payload_json: JSON.stringify(appPackage),
      $created_at: now,
      $updated_at: now,
    },
  );
}

async function writePackageState(
  db: SQLiteDatabase,
  installationId: string,
  activePackageKey: string | null,
  previousPackageKey: string | null,
  now: string,
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO app_installation_package_state
      (installation_id, active_package_key, previous_package_key, updated_at)
      VALUES ($installation_id, $active_package_key, $previous_package_key, $updated_at)`,
    {
      $installation_id: installationId,
      $active_package_key: activePackageKey,
      $previous_package_key: previousPackageKey,
      $updated_at: now,
    },
  );
  if (installationId === 'default') {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_package_state
        (id, active_package_key, previous_package_key, updated_at)
        VALUES ('default', $active_package_key, $previous_package_key, $updated_at)`,
      {
        $active_package_key: activePackageKey,
        $previous_package_key: previousPackageKey,
        $updated_at: now,
      },
    );
  }
}

async function insertPackageReceipt(
  db: SQLiteDatabase,
  installationId: string,
  packageKeyValue: string | null,
  previousPackageKey: string | null,
  now: string,
  evidence: {
    requestHash?: string | null;
    packageHash?: string | null;
    approvalHash?: string | null;
    approvedBy?: string | null;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO app_package_receipts
      (id, action, package_key, previous_package_key, created_at, request_hash, package_hash, approval_hash, approved_by)
      VALUES ($id, 'activate', $package_key, $previous_package_key, $created_at, $request_hash, $package_hash, $approval_hash, $approved_by)`,
    {
      $id: `app-package:${installationId}:activate:${packageKeyValue ?? 'none'}:${now}`,
      $package_key: packageKeyValue,
      $previous_package_key: previousPackageKey,
      $created_at: now,
      $request_hash: evidence.requestHash ?? null,
      $package_hash: evidence.packageHash ?? null,
      $approval_hash: evidence.approvalHash ?? null,
      $approved_by: evidence.approvedBy?.trim() || null,
    },
  );
}

function journalEntryFromRow(row: JournalRow): PackageMigrationJournalEntry {
  return {
    schemaVersion: 'wonder.package-migration-journal.v1',
    journalId: row.id,
    installationId: row.installation_id,
    workspaceId: row.workspace_id,
    state: row.state,
    planHash: row.plan_hash,
    operationHash: row.operation_hash,
    snapshotHash: row.snapshot_hash,
    fromPackageKey: row.from_package_key,
    toPackageKey: row.to_package_key,
    fromChecksum: row.from_checksum,
    toChecksum: row.to_checksum,
    affectedRecordCount: numberValue(row.affected_record_count),
    plan: parseJson<PackageMigrationPlan>(row.plan_json),
    snapshot: parseJson<PackageMigrationSnapshot>(row.snapshot_json),
    approval: row.approval_json ? parseJson<PackageMigrationApprovalReceipt>(row.approval_json) : null,
    receipt: row.receipt_json ? parseJson<PackageMigrationReceipt>(row.receipt_json) : null,
    packageHash: row.package_hash,
    actorHash: row.actor_hash,
    policyCategory: row.policy_category,
    approvalExpiresAt: row.approval_expires_at,
    approvalNonce: row.approval_nonce,
    consumedReceiptHash: row.consumed_receipt_hash,
    errorReason: row.error_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertApprovalMatchesContext(
  approval: PackageMigrationApprovalReceipt,
  context: MigrationContext,
  now: string,
): void {
  if (approval.schemaVersion !== 'wonder.package-migration-approval.v1' || approval.approved !== true) {
    throw new Error('package_migration_approval_mismatch');
  }
  if (
    approval.workspaceId !== context.installation.workspaceId
    || approval.installationId !== context.installation.installationId
    || approval.currentPackageKey !== context.plan.fromPackageKey
    || approval.currentPackageChecksum !== context.snapshot.activeChecksum
    || approval.snapshotHash !== context.snapshot.snapshotHash
    || approval.planHash !== hashValue(context.plan)
    || approval.fromChecksum !== context.plan.fromChecksum
    || approval.toChecksum !== context.plan.toChecksum
    || approval.operationHash !== context.plan.operationHash
    || approval.risk !== context.plan.risk
  ) {
    throw new Error('package_migration_approval_mismatch');
  }
  if (approval.expiresAt && Date.parse(approval.expiresAt) < Date.parse(now)) {
    throw new Error('package_migration_approval_expired');
  }
}

function packageKey(appPackage: AppPackage): string {
  return `${appPackage.id}@${appPackage.version}`;
}

function journalIdFor(installationId: AppInstallationId, snapshotHash: string, planHash: string): string {
  return `pkgmig:${inputId(installationId)}:${snapshotHash}:${planHash}`;
}

function maxRisk(values: readonly PackageMigrationRisk[]): PackageMigrationRisk {
  if (values.includes('unsupported')) return 'unsupported';
  if (values.includes('requires_new_build')) return 'requires_new_build';
  if (values.includes('destructive')) return 'destructive';
  if (values.includes('review_required')) return 'review_required';
  return 'safe';
}

function isBlockingRisk(risk: PackageMigrationRisk): boolean {
  return risk === 'destructive' || risk === 'requires_new_build' || risk === 'unsupported';
}

function operationRisk(operation: PackageMigrationOperation): PackageMigrationRisk {
  if (operation.risk) return operation.risk;
  if (operation.kind === 'archive_collection') return 'destructive';
  if (operation.kind === 'assert_invariant') return 'review_required';
  return 'safe';
}

function matchesSnapshot(left: PackageMigrationSnapshot, right: PackageMigrationSnapshot): boolean {
  return left.activePackageKey === right.activePackageKey
    && left.activeChecksum === right.activeChecksum
    && left.recordsChecksum === right.recordsChecksum
    && left.snapshotHash === right.snapshotHash;
}

function isRisk(value: unknown): value is PackageMigrationRisk {
  return value === 'safe'
    || value === 'review_required'
    || value === 'destructive'
    || value === 'requires_new_build'
    || value === 'unsupported';
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function numberValue(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseInt(String(value), 10);
}

function requiredText(value: unknown, label: string): string {
  const result = text(value);
  if (!result) throw new Error(`package_migration_operation_${label}_required`);
  return result;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('package_migration_operation_values_invalid');
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error('package_migration_operation_values_invalid');
    result[key] = item;
  }
  return result;
}

function normalizePropertiesJson(value: string): string {
  try {
    return canonicalJson(JSON.parse(value));
  } catch {
    return canonicalJson({});
  }
}

function parseProperties(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function inputId(value: AppInstallationId): string {
  const id = String(value ?? '').trim();
  if (!id) throw new Error('app_installation_id_required');
  return id;
}

function hashValue(value: unknown): string {
  return sha256Canonical(value);
}
