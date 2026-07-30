# Browser Builder Contracts

## Canonical format

- Canonical persisted format: `wonder.package-source.v1`
- Canonical schema URL: `https://schemas.utopia.dev/wonder.package-source.v1.schema.json`
- Imports are validated against source shape, and only source format is persisted.

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
