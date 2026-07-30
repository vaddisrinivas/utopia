# Conformance Lane (Gate 2)

This lane verifies contract conformance for core runtime and package surfaces with deterministic fixtures.

## Included checks

- `canonical-json deterministic`
  - Validates shared canonical serialization and canonical checksum agreement.
- `package-validation shared rules`
  - Validates shared package validation on one valid and one intentionally invalid fixture.
- `package-validation server parity`
  - Compares shared package validation outcome with `@/server/src/kernel/package` when that module imports.
- `expression-runtime parity`
  - Compares shared expression/query/computed results against server runtime for a fixed corpus.
- `install/update lifecycle`
  - Runs install -> update preview -> activate update -> rollback using in-memory SQLite and existing app-package contracts.
- `capability denial contract`
  - Validates native capability denial signals against contract-backed finder logic.
- `install-runtime-mobile`
  - Explicitly `BLOCKED`: requires physical-device/runner evidence.
- `server-runtime-android-capability`
  - Explicitly `BLOCKED`: parity evidence not claimed without device/emulator path.

## Implementation contract

- Scope only reads/writes in:
  - `packages/conformance/**`
  - `tests/conformance/**`
  - `scripts/quality/check-conformance*.ts`
  - `docs/conformance.md`
- No checks claim shell/device runner behavior.
- No edits are made to Expo UI, schema definitions, routes, `package.json`, or shared trust boundaries outside the requested scope.

## Status model

- `pass`: contract assertion verified with local deterministic fixtures.
- `blocked`: assertion deferred; requires external evidence or native runtime parity.
- `fail`: assertion mismatch in fixture or contract behavior.
