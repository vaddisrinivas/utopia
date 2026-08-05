# Schema authority (app package)

## Source of truth

- JSON Schema: `packages/schemas/src/app-package-schemas.ts`
- Schema registry: `packages/schemas/src/package-registry.ts`
- Shared AJV entrypoint: `packages/shared/contracts/schema/ajv-authority.ts`
- Structural + semantic validator: `packages/schemas/src/package-validation.ts`
- Fixtures: `tests/fixtures/package-validation/*.json`
- Schema suite fixtures: `scripts/schema/fixtures/app-package-schema-suite.json`

## One AJV entrypoint

All app-package JSON Schema compilation now goes through:

- `getSchemaValidator(schema)` in `packages/shared/contracts/schema/ajv-authority.ts`

This includes:
- draft-07 and draft-2020-12 support
- shared cache keyed by schema id/title/raw schema
- consistent error shape and fallback on unsupported/invalid `$schema`

## Harness

`scripts/schema/schema-test-harness.ts` provides:
- `readSchemaSuiteFixture`
- `resolveSchemaForSuiteCase`
- `runSchemaSuite`

It loads the JSON Schema Test Suite-like fixture format in `scripts/schema/fixtures/app-package-schema-suite.json`.

## Tests

`tests/contracts/schema-authority.test.ts`
- asserts AJV compile cache sharing
- executes the suite fixtures across v2 and v3 schemas

Included in `npm run check:schema-registry`.

## Fast-check

`fast-check` is intentionally not added yet; add as a follow-up if dependency churn is acceptable in this lane.
