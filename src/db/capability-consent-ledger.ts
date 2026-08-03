import type { SQLiteDatabase } from 'expo-sqlite';

import {
  type CapabilityConsentRecord,
  type CapabilityConsentMigrationPolicy,
  buildCapabilityConsentRecordFingerprint,
  buildCapabilityConsentRecordId,
  canonicalCapabilityConsentRecord,
  createCapabilityDecisionPort,
  type CapabilityDecisionPort,
  UTOPIA_CAPABILITY_CONSENT_LEGACY_PURPOSE,
  UTOPIA_CAPABILITY_GRANT_SCHEMA_VERSION,
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
  publisher_id: string | null;
  capability: string;
  scope_json: string;
  declared_purpose: string;
  grant_schema_version: string;
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
    publisher_id: normalizedRecord.publisherId ?? null,
    capability: normalizedRecord.capability,
    scope_json: JSON.stringify(scope),
    declared_purpose: normalizedRecord.declaredPurpose ?? UTOPIA_CAPABILITY_CONSENT_LEGACY_PURPOSE,
    grant_schema_version: normalizedRecord.grantSchemaVersion ?? UTOPIA_CAPABILITY_GRANT_SCHEMA_VERSION,
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
      publisher_id,
      capability,
      scope_json,
      declared_purpose,
      grant_schema_version,
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
      $publisher_id,
      $capability,
      $scope_json,
      $declared_purpose,
      $grant_schema_version,
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
      publisher_id = excluded.publisher_id,
      capability = excluded.capability,
      scope_json = excluded.scope_json,
      declared_purpose = excluded.declared_purpose,
      grant_schema_version = excluded.grant_schema_version,
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
      $publisher_id: row.publisher_id,
      $capability: row.capability,
      $scope_json: row.scope_json,
      $declared_purpose: row.declared_purpose,
      $grant_schema_version: row.grant_schema_version,
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
       AND app_installation_id = $app_installation_id`,
    {
      $id: recordId,
      $app_installation_id: normalizedInstallationId,
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
     ORDER BY updated_at DESC`,
    {
      $app_installation_id: normalizedInstallationId,
    },
  );
  return rows.map(hydrateLedgerRecord);
}

export async function loadCapabilityDecisionPort(
  db: SQLiteDatabase,
  installationId: string,
  policy?: CapabilityConsentMigrationPolicy,
): Promise<CapabilityDecisionPort> {
  const records = await listCapabilityConsentLedgerRecordsForInstallation(db, installationId);
  return createCapabilityDecisionPort(records, policy);
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
  const row = validateStoredLedgerRow({
    app_installation_id: installationId,
    schema_version: revoked.schemaVersion,
    package_id: revoked.packageId,
    package_version: revoked.packageVersion,
    package_checksum: revoked.packageChecksum,
    publisher_id: revoked.publisherId ?? null,
    capability: revoked.capability,
    scope_json: JSON.stringify(revoked.scope),
    declared_purpose: revoked.declaredPurpose ?? UTOPIA_CAPABILITY_CONSENT_LEGACY_PURPOSE,
    grant_schema_version: revoked.grantSchemaVersion ?? UTOPIA_CAPABILITY_GRANT_SCHEMA_VERSION,
    decision: revoked.decision,
    decided_by: revoked.decidedBy,
    decided_at: revoked.decidedAt,
    created_at: revoked.createdAt,
    updated_at: revoked.updatedAt,
    revoked_by: revoked.revocation?.revokedBy ?? null,
    revoked_at: revoked.revocation?.revokedAt ?? null,
    revocation_reason: revoked.revocation?.revocationReason ?? null,
    fingerprint: buildCapabilityConsentRecordFingerprint(revoked),
  });
  await db.runAsync(
    `UPDATE capability_consent_ledger
     SET updated_at = $updated_at,
         revoked_by = $revoked_by,
         revoked_at = $revoked_at,
         revocation_reason = $revocation_reason,
         fingerprint = $fingerprint
     WHERE id = $id AND app_installation_id = $app_installation_id`,
    {
      $id: input.recordId,
      $app_installation_id: installationId,
      $updated_at: row.updated_at,
      $revoked_by: row.revoked_by,
      $revoked_at: row.revoked_at,
      $revocation_reason: row.revocation_reason,
      $fingerprint: row.fingerprint,
    },
  );
  return (await getCapabilityConsentLedgerRecord(db, installationId, input.recordId)) ?? revoked;
}

function hydrateLedgerRecord(row: ConsentLedgerRow): CapabilityConsentRecord {
  const canonical = canonicalizeScopeJson(row.scope_json);
  const candidate: CapabilityConsentRecord = canonicalCapabilityConsentRecord({
    schemaVersion: row.schema_version as CapabilityConsentRecord['schemaVersion'],
    installationId: row.app_installation_id,
    packageId: row.package_id,
    packageVersion: row.package_version,
    packageChecksum: row.package_checksum,
    ...(isText(row.publisher_id) ? { publisherId: row.publisher_id } : {}),
    capability: row.capability,
    scope: canonical,
    declaredPurpose: row.declared_purpose,
    grantSchemaVersion: row.grant_schema_version as CapabilityConsentRecord['grantSchemaVersion'],
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
    || !isText(row.declared_purpose) || !isText(row.grant_schema_version)
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
  const packagePayloadChecksum = packageChecksumFromPayloadJson(row.package_payload_json);
  if (!isText(row.checksum)) {
    return null;
  }
  if (packagePayloadChecksum && row.checksum !== packagePayloadChecksum) {
    return null;
  }
  const packageChecksum = row.checksum;

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
