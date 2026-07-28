import type { SQLiteDatabase } from 'expo-sqlite';

import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';
import type { DomainManifest } from '@/src/domain/catalog';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import { applyOperation } from '@/src/ops/apply';
import { computeInverse } from '@/src/ops/inverse';
import type { Operation, OperationResult } from '@/src/ops/operation';

type OperationRow = {
  op_id: string;
  app_installation_id: string;
  inverse_op_id: string | null;
  before_json: string | null;
  after_json: string | null;
  changes_json: string | null;
  status: string;
};

type UndoOperationOptions = {
  appInstallationId?: string | null;
};

function normalizeAppInstallationId(value?: string | null): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_APP_INSTALLATION_ID;
}

export async function undoOperation(
  db: SQLiteDatabase,
  manifest: DomainManifest,
  opId: string,
  options: UndoOperationOptions = {},
): Promise<OperationResult> {
  const appInstallationId = normalizeAppInstallationId(options.appInstallationId);
  const row = await db.getFirstAsync<OperationRow>(
    'SELECT * FROM operations WHERE app_installation_id = ? AND op_id = ?',
    [appInstallationId, opId],
  );
  if (!row) {
    return { status: 'rejected', op_id: opId, reject_reason: 'operation_not_found' };
  }
  if (row.status === 'undone') {
    return { status: 'duplicate', op_id: opId };
  }
  const after = row.after_json ? JSON.parse(row.after_json) as CanonicalRecord : null;
  const before = row.before_json ? JSON.parse(row.before_json) as CanonicalRecord | null : null;
  const original = row.changes_json ? JSON.parse(row.changes_json) as Operation : null;
  if (!after || !original) {
    return { status: 'rejected', op_id: opId, reject_reason: 'inverse_unavailable' };
  }
  const inverse = { ...computeInverse(before, original, after), app_installation_id: appInstallationId };
  const result = await applyOperation(db, manifest, inverse, { appInstallationId });
  if (result.status === 'applied' || result.status === 'duplicate') {
    await db.runAsync(
      'UPDATE operations SET status = ? WHERE app_installation_id = ? AND op_id = ?',
      ['undone', appInstallationId, opId],
    );
  }
  return result;
}
