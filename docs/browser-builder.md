# Browser Builder Contracts

## Canonical format

- Canonical persisted format: `wonder.package-source.v1`
- Canonical schema URL: `https://schemas.utopia.dev/wonder.package-source.v1.schema.json`
- Imports are validated against source shape, and only source format is saved or exported.

## Adapter contracts

- JSON Forms schema URL: `https://schemas.utopia.dev/editors/json-forms.v1.schema.json`
- Puck schema URL: `https://schemas.utopia.dev/editors/puck.v1.schema.json`
- JSON Forms conversion supports a strict subset:
  - top-level `schema.type: "object"` with `schema.properties`
  - property types in `{string, number, integer, boolean, object, array}`
  - field property `title` maps to no field metadata, required fields map to `required`
  - `schema.title` maps to app label and id slug
  - `uischema` must include `elements` controls with `scope: "#/properties/<field>"`
- Puck conversion is not supported.
- Importing adapter payloads outside the documented JSON Forms subset returns explicit unsupported reasons.
- Secret-shaped field names/values are rejected before source compilation, and unsupported capability ids fail closed during guided generation.

- `/api/creator-receipt` requires a compile-valid source or validated package; source/package `id` and `version` must match when both are present, and duration is bounded.
- This is a constrained creator contract proof, not a human usability study.

## Runtime contracts

- `GET /api/builder-info` returns:
  - starters
  - archetypes
  - capability matrix
  - adapter contracts
  - widget registry mapping for adapter round-trips
- `POST /api/import` supports:
  - `wonder.package-source.v1` payloads (persisted)
  - JSON Forms payloads that match the documented subset (converted to package-source)
  - other adapter payloads with schema-validated explicit unsupported reasons

## Validation contract

 - `BuilderImportResponse` now supports:
  - `{ status: 'source', mode: 'package-source' }`
  - `{ status: 'compiled', mode: 'compiled-package' }`
 - `{ status: 'unsupported', mode: 'unsupported' }`

## Creator flow

The browser creator is a deliberate four-step path:

1. Describe the app with a name, purpose, archetype, target platforms, data home, and capability choices.
2. Validate the generated canonical `wonder.package-source.v1` through the package compiler.
3. Preview install trust data before any handoff: checksum, collections, providers, native permissions/capabilities, and disclosures.
4. Export canonical source JSON, or create/copy an install link only when the creator supplies a real HTTPS package source URL.

Local generated packages do not receive a fake install URL. This keeps install links actionable and prevents a local preview placeholder from being mistaken for a published package. The optional AI key remains page-memory-only and is never sent in builder requests, source, previews, receipts, or browser storage.
