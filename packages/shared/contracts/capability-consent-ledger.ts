import { sha256Canonical } from './canonical-json';
import { UTOPIA_PACKAGE_CHECKSUM_PATTERN } from './package-install';

export const UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION = 'utopia.capability-consent-ledger.v1' as const;
export const UTOPIA_CAPABILITY_CONSENT_DECISION_ALLOW = 'allow' as const;
export const UTOPIA_CAPABILITY_CONSENT_DECISION_DENY = 'deny' as const;

export type CapabilityConsentDecision = typeof UTOPIA_CAPABILITY_CONSENT_DECISION_ALLOW | typeof UTOPIA_CAPABILITY_CONSENT_DECISION_DENY;

export type CapabilityConsentRecord = Readonly<{
  schemaVersion: typeof UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION;
  installationId: string;
  packageId: string;
  packageVersion: string;
  packageChecksum: string;
  capability: string;
  scope: readonly string[];
  decision: CapabilityConsentDecision;
  decidedBy: string;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
  revocation?: {
    revokedBy: string;
    revokedAt: string;
    revocationReason?: string;
  };
}>;

export type CapabilityConsentLedgerDecisionState = Readonly<{
  isRevoked: boolean;
  active: boolean;
  effectiveDecision: CapabilityConsentDecision | null;
  revokedReason?: string;
}>;

const LEDGER_SCOPE_SEPARATOR = '|';

export function buildCapabilityConsentLedgerScope(input: readonly string[]): string[] {
  const normalized = input
    .map((scope) => typeof scope === 'string' ? scope.trim() : '')
    .filter((scope) => scope.length > 0)
    .filter((scope, index, values) => values.indexOf(scope) === index)
    .sort();
  return normalized;
}

export function normalizeCapabilityConsentRecord(input: CapabilityConsentRecord): CapabilityConsentRecord {
  return {
    ...input,
    scope: buildCapabilityConsentLedgerScope(input.scope),
  };
}

export function buildCapabilityConsentRecordId(input: {
  installationId: string;
  packageId: string;
  capability: string;
  scope: readonly string[];
}): string {
  return sha256Canonical({
    installationId: input.installationId,
    packageId: input.packageId,
    capability: input.capability,
    scope: buildCapabilityConsentLedgerScope(input.scope),
  });
}

export function buildCapabilityConsentRecordFingerprint(input: CapabilityConsentRecord): string {
  return sha256Canonical(canonicalCapabilityConsentRecord(input));
}

export function canonicalCapabilityConsentRecord(input: CapabilityConsentRecord): CapabilityConsentRecord {
  return normalizeCapabilityConsentRecord({
    ...input,
    scope: buildCapabilityConsentLedgerScope(input.scope),
    packageId: input.packageId.trim(),
    packageVersion: input.packageVersion.trim(),
    capability: input.capability.trim(),
    decidedBy: input.decidedBy.trim(),
    decidedAt: input.decidedAt,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    ...(input.revocation ? {
      revocation: {
        revokedBy: input.revocation.revokedBy.trim(),
        revokedAt: input.revocation.revokedAt,
        ...(input.revocation.revocationReason ? { revocationReason: input.revocation.revocationReason.trim() } : {}),
      },
    } : {}),
  });
}

export function collectCapabilityConsentRecordValidationErrors(input: unknown, path = ''): string[] {
  if (input === undefined || input === null || typeof input !== 'object' || Array.isArray(input)) {
    return [`${path} must be an object`];
  }

  const record = input as Partial<CapabilityConsentRecord>;
  const errors: string[] = [];

  if (record.schemaVersion !== UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION) {
    errors.push(`${path}schemaVersion must be ${UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION}`);
  }
  if (!isText(record.installationId)) errors.push(`${path}installationId is required`);
  if (!isText(record.packageId)) errors.push(`${path}packageId is required`);
  if (!isText(record.packageVersion)) errors.push(`${path}packageVersion is required`);
  if (!isText(record.packageChecksum) || !UTOPIA_PACKAGE_CHECKSUM_PATTERN.test(record.packageChecksum)) {
    errors.push(`${path}packageChecksum must be sha256:<64 hex chars>`);
  }
  if (!isText(record.capability)) errors.push(`${path}capability is required`);
  if (!Array.isArray(record.scope)) {
    errors.push(`${path}scope must be an array`);
  } else {
    const normalized = buildCapabilityConsentLedgerScope(record.scope);
    if (!normalized.length) {
      errors.push(`${path}scope must be a non-empty array`);
    }
    for (const [index, scope] of normalized.entries()) {
      if (!isText(scope)) {
        errors.push(`${path}scope[${index}] must be text`);
      }
    }
  }

  if (record.decision !== 'allow' && record.decision !== 'deny') {
    errors.push(`${path}decision must be allow or deny`);
  }
  if (!isText(record.decidedBy)) errors.push(`${path}decidedBy is required`);
  if (!isText(record.decidedAt)) {
    errors.push(`${path}decidedAt is required`);
  } else if (Number.isNaN(Date.parse(record.decidedAt))) {
    errors.push(`${path}decidedAt must be ISO timestamp`);
  }

  if (!isText(record.createdAt)) {
    errors.push(`${path}createdAt is required`);
  } else if (Number.isNaN(Date.parse(record.createdAt))) {
    errors.push(`${path}createdAt must be ISO timestamp`);
  }

  if (!isText(record.updatedAt)) {
    errors.push(`${path}updatedAt is required`);
  } else if (Number.isNaN(Date.parse(record.updatedAt))) {
    errors.push(`${path}updatedAt must be ISO timestamp`);
  }

  const createdAt = Date.parse(String(record.createdAt));
  const decidedAt = Date.parse(String(record.decidedAt));
  const updatedAt = Date.parse(String(record.updatedAt));
  if (!Number.isNaN(createdAt) && !Number.isNaN(decidedAt) && decidedAt < createdAt) {
    errors.push(`${path}decidedAt must not be before createdAt`);
  }
  if (!Number.isNaN(updatedAt) && !Number.isNaN(decidedAt) && updatedAt < decidedAt) {
    errors.push(`${path}updatedAt must not be before decidedAt`);
  }

  if (record.revocation !== undefined) {
    if (!isText(record.revocation?.revokedBy)) {
      errors.push(`${path}revocation.revokedBy is required`);
    }
    if (!isText(record.revocation?.revokedAt)) {
      errors.push(`${path}revocation.revokedAt is required`);
    } else if (Number.isNaN(Date.parse(record.revocation.revokedAt))) {
      errors.push(`${path}revocation.revokedAt must be ISO timestamp`);
    } else if (!Number.isNaN(decidedAt) && Date.parse(record.revocation.revokedAt) < decidedAt) {
      errors.push(`${path}revocation.revokedAt must be after decidedAt`);
    }
    if (record.revocation?.revocationReason !== undefined && !isText(record.revocation.revocationReason)) {
      errors.push(`${path}revocation.revocationReason must be text`);
    }
  }

  return errors;
}

export function validateCapabilityConsentRecord(input: unknown): CapabilityConsentRecord {
  const errors = collectCapabilityConsentRecordValidationErrors(input);
  if (errors.length) throw new Error(`capability_consent_record_invalid:${errors.join('|')}`);
  return input as CapabilityConsentRecord;
}

export function isCapabilityConsentRecordRevoked(input: CapabilityConsentRecord): boolean {
  return Boolean(input.revocation);
}

export function getCapabilityConsentLedgerState(input: CapabilityConsentRecord): CapabilityConsentLedgerDecisionState {
  const revoked = isCapabilityConsentRecordRevoked(input);
  return {
    isRevoked: revoked,
    active: !revoked,
    effectiveDecision: revoked ? null : input.decision,
    ...(revoked && input.revocation?.revocationReason ? { revokedReason: input.revocation.revocationReason } : {}),
  };
}

export function buildCapabilityConsentRecordSnapshotText(input: CapabilityConsentRecord): string {
  const canonical = canonicalCapabilityConsentRecord(input);
  const scope = canonical.scope.join(LEDGER_SCOPE_SEPARATOR);
  return `${canonical.installationId}${LEDGER_SCOPE_SEPARATOR}${canonical.packageId}${LEDGER_SCOPE_SEPARATOR}${canonical.packageId}@${canonical.packageVersion}${LEDGER_SCOPE_SEPARATOR}${scope}${LEDGER_SCOPE_SEPARATOR}${canonical.decision}`;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
