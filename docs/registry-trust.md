# Registry Trust Metadata Contract (Cloudflare + Shared Contracts)

This lane keeps extension trust evaluation fail-closed and aligns the contract shape with TUF roles before real TUF.js integration.

## Goal

- Treat trust metadata as untrusted input.
- Fail closed on any malformed, stale, expired, or rollback metadata.
- Keep policy authority in `packages/shared/contracts/extension-trust.ts`.

## Documents

### Root metadata

- `utopia.extension-trust-root.v1`
- Purpose: pin trusted root signer and delegate publisher-specific publisher constraints.
- Signature: optional `signature` object in metadata, validated when present.
- Required checks:
  - Valid schema version.
  - Positive integer `version`.
  - `expires` is a valid ISO date and not expired.
  - `delegatedPublishers` is non-empty.
  - Each publisher delegation has:
    - `publisherId`
    - `extensionIdPatterns` (wildcard pattern support: `io.utopia.*` or `*`)
    - `delegatedSigningKeyIds`
    - optional `minimumTargetsVersion`

### Targets metadata

- `utopia.extension-trust-targets.v1`
- Purpose: carry publisher-specific target versioning/key-scoped constraints.
- Signature: optional `signature` object in metadata, validated when present.
- Required checks:
  - Valid schema version.
  - Positive integer `version`.
  - `publisherId` match.
  - `expires` is valid ISO date and not expired.
  - `delegatedSigningKeyIds` non-empty.

## Registry-hosted trust endpoints

- `GET /v1/trust/extension/root`
  - Reads trust-root metadata from `registry/trust/extension-root.json` in R2.
- `GET /v1/trust/extension/targets?publisher=<publisherId>`
  - Reads publisher targets from `registry/trust/extension-targets-<publisherId>.json` in R2.
  - `publisher` must match `^[A-Za-z0-9_.-]+$`.

Both endpoints return 404 when metadata is not present.
Both endpoints return 400 when stored payload is not well-formed trust metadata JSON.

## Registry metadata hardening notes

- Registry writes (package publish/metadata/index updates) are still token-only through `POST /v1/packages`.
- Hosted package rows in `registry/packages/<id>.json` are fail-closed: malformed or label-incomplete rows are rejected by the worker on read (`package_metadata_invalid`).
- `registry/index.json` is also fail-closed; malformed package rows are filtered before generating `/v1/registry.json`.
- Trust endpoints intentionally remain read-focused in this lane; any future trust writes should follow the same token-only rule and structured-label approach.

## Fail-closed behavior implemented

`resolveExtensionTrustPolicyWithTufMetadata(...)` rejects on:
- invalid/missing metadata
- expired root or targets
- root rollback (`root.version < minimumAcceptedRootVersion`)
- targets rollback (`targets.version < minimumAcceptedTargetsVersionByPublisher[publisherId]`)
- exact matches are accepted (cache replay / same version)
- root key pinning mismatch
- publisher not delegated
- extension outside delegated patterns
- signing key outside delegated/publisher key lists
- `targets.publisherId` mismatch
- signature mismatch or absent configured signatures

The resolver performs signature verification for signed root/targets payloads using trusted policy keys and canonicalized payloads.

BLOCKED: endpoint-side cryptographic trust chain verification is blocked until registry hosting exposes trusted public-key material and signer identity rotation state for `root` and `targets`; endpoint responses remain structure-checked and version-safe today.
