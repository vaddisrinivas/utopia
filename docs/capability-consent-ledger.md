# Capability Consent Ledger Contract

Contract version: `utopia.capability-consent-ledger.v1`

Each consent record is a durable, install-scoped object that captures capability permissions with explicit lifecycle state.

## Required fields

- `schemaVersion`: must be `utopia.capability-consent-ledger.v1`
- `installationId`: install identifier
- `packageId`: package identifier
- `packageVersion`: package version string
- `packageChecksum`: `sha256:<64 hex chars>`
- `capability`: capability symbol
- `scope`: non-empty array of trimmed, unique, deterministic scope values
- `decision`: `allow | deny`
- `decidedBy`: actor identity
- `decidedAt`: ISO timestamp
- `createdAt`: ISO timestamp
- `updatedAt`: ISO timestamp

## Optional revocation

If revoked, include:

- `revocation.revokedBy`: actor identity
- `revocation.revokedAt`: ISO timestamp (must be on/after `decidedAt`)
- `revocation.revocationReason`: optional text

## Helpers

- `validateCapabilityConsentRecord` throws with `capability_consent_record_invalid:` on malformed records.
- `buildCapabilityConsentRecordId` and fingerprint helpers provide deterministic identifiers and hash anchors.
- `getCapabilityConsentLedgerState` returns revocation and effective decision state.
- `buildCapabilityConsentLedgerScope` normalizes scope ordering for hostile input.

## DB persistence layer

Storage table: `capability_consent_ledger` (migration `14`).

- Indexed by `id` and `app_installation_id`.
- Indexed for installation lookups by `(app_installation_id, updated_at DESC)`.
- Columns:
  - `schema_version`
  - `package_id`, `package_version`, `package_checksum`
  - `capability`, `scope_json`, `decision`, `decided_by`, `decided_at`, `created_at`, `updated_at`
  - optional revocation fields: `revoked_by`, `revoked_at`, `revocation_reason`
  - `fingerprint` (recomputed on load for integrity checks)

### Data-layer invariants

- `upsert` requires resolved installation package context:
  - context row must resolve package `id`, `version`, and `checksum`
  - these values must match the input record
  - error `capability_consent_package_context_unavailable` when context cannot be resolved
  - error `capability_consent_package_context_mismatch` when any context field differs
- `get`/`list` enforce the same package context by filtering rows to the active install package context.
- `revoke` rehydrates the current record and re-upserts with revocation metadata.
- Corrupted row data fails fast via:
  - `capability_consent_record_invalid:*` from contract validation
  - `capability_consent_record_fingerprint_mismatch` when row fingerprint diverges.

### Data lifecycle

- Record rows are retained with `app_installation_id` foreign key and removed when an installation is deleted.
- Deleting an app installation purges consent rows in the same transaction as other install-scoped data.
