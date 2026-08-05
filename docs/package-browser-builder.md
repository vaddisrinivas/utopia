# Package Browser Builder (Local)

## Run

```bash
npx --yes tsx --tsconfig scripts/package/tsconfig.json scripts/package/browser-package-builder.ts -- --port 4173
```

Open `http://127.0.0.1:4173`.

## What it does

- Picks a starter from `tests/fixtures/package-source/manifest.json`.
- Edits app metadata, collections, queries, screens, and optional sections in JSON (advanced mode).
- Adds nontechnical screen/component/field editors with reorder/delete controls.
- Live-validates against compiler contracts.
- Supports widget append helper against current screen components.
- Imports package-source JSON.
- Uses explicit adapter contracts for JSON Forms and Puck payloads while keeping package-source as the canonical persisted format.
- JSON Forms payloads are supported for conversion when they match the documented subset; unsupported payloads return explicit reasons.
- Puck payloads remain unsupported unless conversion is implemented.
- Unsupported import responses always include `warnings` so the UI can render errors deterministically.
- Supports guided app creation using archetypes (`records`, `dashboard`, `timed-flow`, `media`, `capability-lab`) with:
  - app name and purpose
  - screen count
  - platform targets
  - demo-data toggle
  - capability selection with explicit supported/exportable/device-proof state and blocked handling
  - preferred data home field (`preferredDataHome`) added to generated package source provider template fields
  - warning output when selected capabilities require native bridge support
- Shows compiled package preview when valid; source export remains the only browser save/export format.
- Creator flow is `describe -> validate -> preview -> export` or `describe -> validate -> preview -> HTTPS install link`.
- Creator review explicitly displays data collections, providers, native permissions/capability support, checksum, and install disclosures.
- Local generated packages export as canonical source but cannot produce a fake install URL; install-link actions require a real HTTPS package source URL.
- Rejects secret-shaped fields/values before compilation; the browser AI key, when entered, exists only in the page process and is cleared on page exit. It is never included in package source, compile/import bodies, receipts, or browser storage.
- `POST /api/creator-receipt` requires a valid source or validated package, rejects source/package mismatches, and blocks out-of-range durations.

## Adapter contracts

- Canonical persistence schema: `https://schemas.utopia.dev/wonder.package-source.v1.schema.json`
- JSON Forms adapter schema: `https://schemas.utopia.dev/editors/json-forms.v1.schema.json`
- Puck adapter schema: `https://schemas.utopia.dev/editors/puck.v1.schema.json`
- Component registry mapping is exposed via `GET /api/builder-info` and is used as the contract point for adapter import/export translation.

## Deterministic checks

```bash
npx --yes vitest run tests/platform/package-browser-builder.test.ts
npx --yes vitest run tests/quality/creator-proof-harness.test.ts
npx --yes tsx --tsconfig tsconfig.json scripts/factory/run-creator-proof-harness.ts
```

## Constrained creator proof

The creator harness runs three deterministic agent profiles through the existing factory and browser builder: README-only, schema-aware, and hostile. It measures each run, accepts only compilable package-source output, rejects secret-shaped content and unsupported capabilities, and emits a redacted `utopia.creator-proof-receipt.v1` JSON receipt. The receipt explicitly records `human_usability: "not_measured"`; this is agent-pipeline proof, not a human usability study.

## Supported routes

- `GET /api/builder-info` includes starter list, archetypes, widget kinds, and capability metadata.
- `POST /api/archetype-capabilities` returns capability truth per requested `targetPlatforms`.
- `POST /api/archetype-generate` generates package source from guided inputs and rejects blocked capability selections.
- `POST /api/import` supports canonical package-source import and JSON Forms payload conversion for the documented subset.
- JSON Forms is an adapter input only: successful conversion immediately produces canonical package-source; adapter payloads are never saved or exported.
