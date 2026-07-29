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
- Imports package-source JSON and compiled package JSON when import is lossless.
- Returns clear unsupported reasons when compiled conversion is impossible.
- Unsupported import responses always include `warnings: []` so the UI can render errors deterministically.
- Supports guided app creation using archetypes (`records`, `dashboard`, `timed-flow`, `media`, `capability-lab`) with:
  - app name and purpose
  - screen count
  - platform targets
  - demo-data toggle
  - capability selection with explicit supported/exportable/device-proof state and blocked handling
  - preferred data home field (`preferredDataHome`) added to generated package source provider template fields
  - warning output when selected capabilities require native bridge support
- Downloads compiled package JSON when valid.

## Deterministic checks

```bash
npx --yes vitest run tests/platform/package-browser-builder.test.ts
```

## Supported routes

- `GET /api/builder-info` includes starter list, archetypes, widget kinds, and capability metadata.
- `POST /api/archetype-capabilities` returns capability truth per requested `targetPlatforms`.
- `POST /api/archetype-generate` generates package source from guided inputs and rejects blocked capability selections.
