import type { SQLiteDatabase } from 'expo-sqlite';

import {
  type CapabilityConsentRecord,
  buildCapabilityConsentRecordFingerprint,
  buildCapabilityConsentRecordId,
  canonicalCapabilityConsentRecord,
  validateCapabilityConsentRecord,
} from '@/packages/shared/contracts/capability-consent-ledger';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';

type ConsentLedgerRow = {
  id: string;
  app_installation_id: string;
  schema_version: string;
  package_id: string;
  package_version: string;
  package_checksum: string;
  capability: string;
  scope_json: string;
  decision: 'allow' | 'deny';
  decided_by: string;
  decided_at: string;
  created_at: string;
  updated_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  fingerprint: string;
};

type InstallPackageContext = {
  packageId: string;
  packageVersion: string;
  packageChecksum: string;
};

type RevokeCapabilityConsentInput = {
  installationId: string;
  recordId: string;
  revokedBy: string;
  revokedAt: string;
  revocationReason?: string;
};

export async function upsertCapabilityConsentLedgerRecord(
  db: SQLiteDatabase,
  input: CapabilityConsentRecord,
): Promise<CapabilityConsentRecord> {
  const record = canonicalCapabilityConsentRecord(validateCapabilityConsentRecord(input));
  const normalizedInstallationId = normalizeInstallationId(record.installationId);
  const context = await resolvePackageContext(db, normalizedInstallationId);
  if (!context) {
    throw new Error('capability_consent_package_context_unavailable');
  }
  if (
    context.packageId !== record.packageId
    || context.packageVersion !== record.packageVersion
    || context.packageChecksum !== record.packageChecksum
  ) {
    throw new Error('capability_consent_package_context_mismatch');
  }

  const normalizedRecord: CapabilityConsentRecord = {
    ...record,
    installationId: normalizedInstallationId,
    updatedAt: record.updatedAt,
  };
  const scope = normalizedRecord.scope;
  const id = buildCapabilityConsentRecordId(normalizedRecord);
  const row = validateStoredLedgerRow({
    app_installation_id: normalizedInstallationId,
    schema_version: normalizedRecord.schemaVersion,
    package_id: normalizedRecord.packageId,
    package_version: normalizedRecord.packageVersion,
    package_checksum: normalizedRecord.packageChecksum,
    capability: normalizedRecord.capability,
    scope_json: JSON.stringify(scope),
    decision: normalizedRecord.decision,
    decided_by: normalizedRecord.decidedBy,
    decided_at: normalizedRecord.decidedAt,
    created_at: normalizedRecord.createdAt,
    updated_at: normalizedRecord.updatedAt,
    revoked_by: normalizedRecord.revocation?.revokedBy ?? null,
    revoked_at: normalizedRecord.revocation?.revokedAt ?? null,
    revocation_reason: normalizedRecord.revocation?.revocationReason ?? null,
    fingerprint: buildCapabilityConsentRecordFingerprint(normalizedRecord),
  });
  await db.runAsync(
    `INSERT INTO capability_consent_ledger (
      id,
      app_installation_id,
      schema_version,
      package_id,
      package_version,
      package_checksum,
      capability,
      scope_json,
      decision,
      decided_by,
      decided_at,
      created_at,
      updated_at,
      revoked_by,
      revoked_at,
      revocation_reason,
      fingerprint
    ) VALUES (
      $id,
      $app_installation_id,
      $schema_version,
      $package_id,
      $package_version,
      $package_checksum,
      $capability,
      $scope_json,
      $decision,
      $decided_by,
      $decided_at,
      $created_at,
      $updated_at,
      $revoked_by,
      $revoked_at,
      $revocation_reason,
      $fingerprint
    )
    ON CONFLICT (id) DO UPDATE SET
      schema_version = excluded.schema_version,
      package_id = excluded.package_id,
      package_version = excluded.package_version,
      package_checksum = excluded.package_checksum,
      capability = excluded.capability,
      scope_json = excluded.scope_json,
      decision = excluded.decision,
      decided_by = excluded.decided_by,
      decided_at = excluded.decided_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      revoked_by = excluded.revoked_by,
      revoked_at = excluded.revoked_at,
      revocation_reason = excluded.revocation_reason,
      fingerprint = excluded.fingerprint`,
    {
      $id: id,
      $app_installation_id: row.app_installation_id,
      $schema_version: row.schema_version,
      $package_id: row.package_id,
      $package_version: row.package_version,
      $package_checksum: row.package_checksum,
      $capability: row.capability,
      $scope_json: row.scope_json,
      $decision: row.decision,
      $decided_by: row.decided_by,
      $decided_at: row.decided_at,
      $created_at: row.created_at,
      $updated_at: row.updated_at,
      $revoked_by: row.revoked_by,
      $revoked_at: row.revoked_at,
      $revocation_reason: row.revocation_reason,
      $fingerprint: row.fingerprint,
    },
  );

  return getCapabilityConsentLedgerRecord(db, normalizedInstallationId, id) as Promise<CapabilityConsentRecord>;
}

export async function getCapabilityConsentLedgerRecord(
  db: SQLiteDatabase,
  installationId: string,
  recordId: string,
): Promise<CapabilityConsentRecord | null> {
  const normalizedInstallationId = normalizeInstallationId(installationId);
  const context = await resolvePackageContext(db, normalizedInstallationId);
  if (!context) throw new Error('capability_consent_package_context_unavailable');
  const row = await db.getFirstAsync<ConsentLedgerRow>(
    `SELECT * FROM capability_consent_ledger
     WHERE id = $id
       AND app_installation_id = $app_installation_id
       AND package_id = $package_id
       AND package_version = $package_version
       AND package_checksum = $package_checksum`,
    {
      $id: recordId,
      $app_installation_id: normalizedInstallationId,
      $package_id: context.packageId,
      $package_version: context.packageVersion,
      $package_checksum: context.packageChecksum,
    },
  );
  return row ? hydrateLedgerRecord(row) : null;
}

export async function listCapabilityConsentLedgerRecordsForInstallation(
  db: SQLiteDatabase,
  installationId: string,
): Promise<CapabilityConsentRecord[]> {
  const normalizedInstallationId = normalizeInstallationId(installationId);
  const context = await resolvePackageContext(db, normalizedInstallationId);
  if (!context) return [];
  const rows = await db.getAllAsync<ConsentLedgerRow>(
    `SELECT * FROM capability_consent_ledger
     WHERE app_installation_id = $app_installation_id
       AND package_id = $package_id
       AND package_version = $package_version
       AND package_checksum = $package_checksum
     ORDER BY updated_at DESC`,
    {
      $app_installation_id: normalizedInstallationId,
      $package_id: context.packageId,
      $package_version: context.packageVersion,
      $package_checksum: context.packageChecksum,
    },
  );
  return rows.map(hydrateLedgerRecord);
}

export async function revokeCapabilityConsentLedgerRecord(
  db: SQLiteDatabase,
  input: RevokeCapabilityConsentInput,
): Promise<CapabilityConsentRecord> {
  if (!isText(input.recordId) || !isText(input.revokedBy) || !isText(input.revokedAt)) {
    throw new Error('capability_consent_revoke_input_invalid');
  }
  const installationId = normalizeInstallationId(input.installationId);
  const current = await getCapabilityConsentLedgerRecord(db, installationId, input.recordId);
  if (!current) throw new Error('capability_consent_record_not_found');
  if (current.revocation) return current;
  const revoked: CapabilityConsentRecord = {
    ...current,
    updatedAt: input.revokedAt,
    revocation: {
      revokedBy: input.revokedBy.trim(),
      revokedAt: input.revokedAt,
      ...(input.revocationReason ? { revocationReason: input.revocationReason } : {}),
    },
  };
  return upsertCapabilityConsentLedgerRecord(db, revoked);
}

function hydrateLedgerRecord(row: ConsentLedgerRow): CapabilityConsentRecord {
  const canonical = canonicalizeScopeJson(row.scope_json);
  const candidate: CapabilityConsentRecord = canonicalCapabilityConsentRecord({
    schemaVersion: row.schema_version as CapabilityConsentRecord['schemaVersion'],
    installationId: row.app_installation_id,
    packageId: row.package_id,
    packageVersion: row.package_version,
    packageChecksum: row.package_checksum,
    capability: row.capability,
    scope: canonical,
    decision: row.decision,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(isText(row.revoked_by) && isText(row.revoked_at)
      ? {
        revocation: {
          revokedBy: row.revoked_by ?? '',
          revokedAt: row.revoked_at ?? row.updated_at,
          ...(row.revocation_reason ? { revocationReason: row.revocation_reason } : {}),
        },
      }
      : {}),
  });
  const validated = validateCapabilityConsentRecord(candidate);
  const expectedFingerprint = buildCapabilityConsentRecordFingerprint(validated);
  if (row.fingerprint !== expectedFingerprint) {
    throw new Error('capability_consent_record_fingerprint_mismatch');
  }
  return validated;
}

function validateStoredLedgerRow(row: Omit<ConsentLedgerRow, 'id'>): Omit<ConsentLedgerRow, 'id'> {
  if (!isText(row.app_installation_id) || !isText(row.schema_version) || !isText(row.package_id)
    || !isText(row.package_version) || !isText(row.package_checksum) || !isText(row.capability)
    || !isText(row.decided_by) || !isText(row.decided_at) || !isText(row.created_at)
    || !isText(row.updated_at) || !isText(row.scope_json)
    || (row.decision !== 'allow' && row.decision !== 'deny')) {
    throw new Error('capability_consent_row_invalid');
  }
  if (isText(row.revoked_by) !== isText(row.revoked_at)) {
    throw new Error('capability_consent_row_invalid:revocation_field_mismatch');
  }
  return row;
}

function canonicalizeScopeJson(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('capability_consent_record_invalid:scope_json_invalid');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('capability_consent_record_invalid:scope_json_not_array');
  }
  const canonical = parsed.filter((scope): scope is string => typeof scope === 'string');
  const normalized = canonical.map((scope) => scope.trim()).filter((scope) => scope.length > 0);
  if (!normalized.length) {
    throw new Error('capability_consent_record_invalid:scope_json_empty');
  }
  return normalized;
}

async function resolvePackageContext(
  db: SQLiteDatabase,
  installationId: string,
): Promise<InstallPackageContext | null> {
  const row = await db.getFirstAsync<{
    package_id: string | null;
    version: string | null;
    checksum: string | null;
    active_package_key: string | null;
    package_payload_json: string | null;
    package_payload_id: string | null;
    package_payload_version: string | null;
  }>(
    `SELECT
      ai.package_id AS package_id,
      ai.version AS version,
      ai.checksum AS checksum,
      s.active_package_key AS active_package_key,
      p.payload_json AS package_payload_json,
      p.package_id AS package_payload_id,
      p.version AS package_payload_version
    FROM app_installations AS ai
    LEFT JOIN app_installation_package_state AS s
      ON s.installation_id = ai.installation_id
    LEFT JOIN app_packages AS p
      ON p.package_key = s.active_package_key
    WHERE ai.installation_id = ?`,
    [installationId],
  );
  if (!row) return null;

  const packageId = row.package_id ?? row.package_payload_id;
  const packageVersion = row.version ?? row.package_payload_version;
  const packageChecksum = row.checksum ?? packageChecksumFromPayloadJson(row.package_payload_json);

  if (!isText(packageId) || !isText(packageVersion) || !isText(packageChecksum)) {
    return null;
  }

  return {
    packageId,
    packageVersion,
    packageChecksum,
  };
}

function packageChecksumFromPayloadJson(payloadJson: string | null): string | null {
  if (!payloadJson) return null;
  try {
    return sha256Canonical(JSON.parse(payloadJson));
  } catch {
    return null;
  }
}

function normalizeInstallationId(input?: string | null): string {
  const value = input?.trim();
  return value && value.length > 0 ? value : DEFAULT_APP_INSTALLATION_ID;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
