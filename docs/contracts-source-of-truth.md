# Contracts Source Of Truth

Scope: package contract authority for this repo slice.

Rule: one layer owns each contract shape; other layers may mirror or compile it, but should not invent new rules.

## Inventory

| Layer | Files | Role |
| --- | --- | --- |
| TS contract source | `packages/shared/contracts/package.ts` | Canonical `AppPackage` types, semantic categories, and shared validation helpers. |
| TS contract siblings | `packages/shared/contracts/query.ts`, `packages/shared/contracts/ui-primitives.ts`, `packages/shared/contracts/ui-widgets.ts`, `packages/shared/contracts/native-capability-kinds.ts`, `packages/shared/contracts/native-capabilities.ts`, `packages/shared/contracts/package-install.ts`, `packages/shared/contracts/package-change.ts`, `packages/shared/contracts/app-installation.ts`, `packages/shared/contracts/receipts.ts` | Supporting contract types used by the package boundary. |
| JSON Schema source | `packages/schemas/src/app-package-schemas.ts` | Machine-readable app-package schemas for v2 and v3. |
| Schema registry | `packages/schemas/src/package-registry.ts` | Schema ids, aliases, and registry consistency checks. |
| Shared validator bridge | `packages/schemas/src/package-validation.ts` | AJV-backed structural validation plus semantic/policy checks. |
| Compiler | `packages/app-compiler/index.ts` | Source-folder to canonical package JSON compiler and preview metadata builder. |
| Server validator | `server/src/kernel/package.ts` | Runtime package validator used by server paths. |
| Generic schema utility | `server/src/kernel/validation.ts` | JSON-schema compilation helper, not package-specific. |
| Duplicate server schema | `server/src/kernel/package-schema.ts` | Server-side schema copy used for local runtime validation; keep aligned until removed. |
| Contract tests | `tests/contracts/package-validation.test.ts`, `tests/contracts/schema-registry.test.ts`, `server/test/package-validation.ts`, `server/test/package-contract.ts`, `tests/platform/package-compiler.test.ts` | Parity and regression coverage. |

## Authority Chain

1. `packages/shared/contracts/package.ts` owns the TypeScript contract shape.
2. `packages/schemas/src/app-package-schemas.ts` owns the JSON Schema shape.
3. `packages/schemas/src/package-registry.ts` binds schema ids to versions and aliases.
4. `packages/schemas/src/package-validation.ts` enforces structural + semantic validity.
5. `packages/app-compiler/index.ts` emits canonical package JSON from source folders.
6. `server/src/kernel/package.ts` must stay behavior-aligned with the shared validator.
7. `server/src/kernel/package-schema.ts` is a duplication point and should not drift.

## Migration Order

1. Change the TS contract first in `packages/shared/contracts/package.ts` and any direct sibling contract types.
2. Update `packages/schemas/src/app-package-schemas.ts` and `packages/schemas/src/package-registry.ts` to match the new contract shape.
3. Update `packages/schemas/src/package-validation.ts` and keep the shared contract tests green.
4. Update `packages/app-compiler/index.ts` only if source normalization or emitted package shape must change.
5. Update `server/src/kernel/package.ts` after the shared contract and schema layers agree.
6. Refresh generated fixtures only after the compiler output is final.
7. Update any docs or references last.

## Generated Artifacts

Regenerate these after a contract or compiler change:

- `tests/fixtures/package-validation/manifest.json`
- `tests/fixtures/package-validation/*.json`
- `tests/fixtures/app-packages/reference-app/compiled/reference-app-1.0.0.package.json`
- `tests/fixtures/app-packages/reference-app/compiled/reference-app-1.1.0.package.json`
- `app/build/evidence/native-capability-contract.json` when native capability rules change

Do not hand-edit generated fixtures unless the source change that produced them is in the same PR.

## Stop Conditions

- Stop if a change touches the TS contract but the JSON schema is not updated in the same plan.
- Stop if the compiler output changes but fixture regeneration is not part of the same PR.
- Stop if the server validator needs new rules that are not already represented in shared validation.
- Stop if a fix would require editing Expo UI files or `packages/domain-shared`.
- Stop if the change would introduce a new schema version without fixture coverage for both old and new shapes.

## First Safe PR

Smallest safe first PR:

1. Add this doc.
2. Add or update one parity test that proves `validateArtifact`, `validateAppPackage`, and the fixture manifest still agree.
3. Keep emitted package JSON unchanged.
4. Do not bump schema versions or rewrite the compiler in the same PR.

That PR is safe because it creates a written contract map before any behavior move.
