# Changelog

All user-visible changes are recorded here. Utopia follows Keep a Changelog
structure.

## Unreleased

## 1.0.5 - 2026-07-21

Utopia 1.0.5 is the canonical household reset release. It completes the
local-first SQLite runtime cutover, replaces lossy provider projections with
interlinked V4 Notion and Google Sheets workspaces, and keeps Postgres behind a
user-owned HTTPS service endpoint rather than raw Android database credentials.

### Added

- Added canonical household runtime coverage for Kitchen, Shopping, Meals,
  Recipes, Spending, proposals, audit, sync bases, conflicts, tombstones, and
  recovery snapshots.
- Added V4 Notion and Google Sheets workspace projections with linked Kitchen,
  Shopping, Meals, Recipes, Ingredients, Spending, Purchase Lines, support
  bindings, protected formulas, and repair proof.
- Added Postgres HTTPS/schema proof with household membership checks and no
  direct Android DSN/password/socket path.
- Added seven proposal-only Utopia AI skill contracts with typed fixtures,
  provenance, confidence, warnings, and fail-closed safety coverage.

### Changed

- Replaced the legacy `FoodChatStore` runtime with canonical
  `HouseholdRepository` and `HouseholdCommandExecutor` authority.
- Updated first-run data homes to Local, Notion, Google Sheets, and Postgres,
  with Local as the fastest no-account/no-network path.
- Updated provider proof scripts and docs to use V4 fields and current live
  evidence instead of V3 workspace names.

### Verified

- GitHub Android Quality passed on the final main release commit with local
  quality plus connected device-quality lanes for API 26 and API 35.
- Live Notion, Google Sheets, and local Postgres-backed HTTPS proofs passed.
- Physical Samsung S23 Ultra install/restart proof preserved canonical local
  state for the 1.0.5 release candidate.

### Changed

- Removed previous combined Postgres provider language from the active 1.0.5 scope. Postgres is supported only through a Postgres-backed HTTPS API or user-owned service endpoint; Android must not ship raw database credentials, privileged server tokens, or raw database socket paths.
- Renamed the remaining UI/AI memory projection from `FoodMemory` to `HouseholdUiMemory` so public and production code no longer presents it as the legacy runtime model.
- Updated public docs to avoid claiming live-provider, device, signing, CI, PR, tag, release, checksum, or install proof before those gates are evidenced.

## 1.0.4 - 2026-07-19

Utopia 1.0.4 is a workspace release. It keeps the app usable
offline with local SQLite, adds the first real Notion/Google Sheets/Postgres
data-home contracts, and upgrades the Android shell toward the AI home-space
model.

### Upgrade and install notes

- Install the Play APK for the richest integration surface: `Utopia-play-v1.0.4.apk`.
- Install the FOSS APK when you want the no-Google dependency build: `Utopia-foss-v1.0.4.apk`.
- Existing local data stays local. Connecting another data home should create a
  rollback snapshot before the new backend is committed.
- Google Sheets, Notion, and Postgres support are early in
  this release. They validate configuration, preserve local-first behavior, and
  establish uniform schemas; full two-way production sync remains marked partial
  in `FEATURES.md`.

### Added

- Added local-first SQLite plus optional Notion, Google Sheets, and Postgres workspace sync contracts.
- Added polished Notion/Sheets human workspace schema, seeded provider proof harnesses, and durable conflict inbox handling.
- Added provider contracts for recipe lookup, barcode/package lookup, nutrition lookup attribution, cache policy, and provider warnings.
- Added TheMealDB recipe lookup preview mapping and Open Food Facts package lookup mapping.
- Added typed AI skill contracts for recipe import, pantry normalization, can-cook ranking, meal planning, cart building, recipe personalization, cooking coach, receipt parsing, and nutrition estimation.
- Added Samsung Food shared-link recipe import detection for individual public/shared links.
- Added plan/cart plain-text sharing formatter that excludes secrets and provider credentials.
- Added focused tests for provider mapping, AI skill proposals, Sheets/Notion workspace sync, backend switch safety, and conflict handling.
- Added a V3 Android workspace shell with `Now`, `Food`, `Week`, `Saved`, and `Cart` destinations.
- Added first-run data-home onboarding for local SQLite, Google Sheets, Notion, and Postgres HTTPS endpoints.
- Added a backend router so one app data contract can point at local SQLite or an optional external data home.
- Added URL/config parsers for Google Sheets, Notion pages, and Postgres HTTPS endpoint configuration.
- Added Android Keystore-backed credential storage for provider tokens.
- Added shared workspace snapshot export, canonical import, and snapshot merge contracts.
- Added seed workspace fixtures so Notion, Sheets, and app mapping can be tested with realistic food, recipe, meal, cart, and purchase data.
- Added typed contracts for recipe import, pantry normalization, can-cook ranking, cart generation, meal planning, personalization, cooking coach, receipt parsing, nutrition estimation, TheMealDB mapping, and Open Food Facts mapping.
- Added deterministic/manual coverage for food entry, cart item creation, recipe creation, meal logging, and AI capture surfaces.
- Added release helper scripts for evidence collection and Google Sheets live proof runs.

### Changed

- Google Sheets raw sync tabs now use hidden `_wf_*` sheet names to avoid collisions with human-facing tabs such as `Recipes`.
- Google Sheets provisioning repairs mismatched legacy headers and keeps workspace tabs readable.
- AI features remain reviewable proposals; deterministic app code owns validation, persistence, undo, and external provider sync.
- Navigation labels now reflect the V3 workspace language: `Now`, `Food`, `Week`, `Saved`, and `Cart`.
- Receipt parsing and food draft normalization are more deterministic across AI, import, and command paths.
- AppFunctions service lint/API handling is safer on unsupported Android versions.
- Connected Android quality now runs FOSS, Play, and core data device tests serially to avoid emulator contention.
- Android CI now proves local quality plus device-quality lanes on API 26 and API 35 before release.

## 1.0.3 - 2026-07-18

### Added

- Added Android AppFunctions workflow actions for food workspace automation.
- Added production receipt capture provider wiring and safer receipt-to-Kitchen put-away.
- Added pantry-first planning, nutrition provider-chain work, meal-prep batch planning, recipe import parsing, scaled shopping-list gaps, household profiles, compatibility export, and prepared-base remix suggestions.
- Added cross-channel golden tests, risk-policy coverage, and external automation validation scripts.

### Changed

- Updated the release and App Links verification flow for trustworthy signed distribution.

## 1.0.2 - 2026-07-18

### Added

- Added separate FOSS and Play distribution flavors.
- Added FOSS stubs for Google Drive backup and Health Connect integrations.

### Changed

- Updated README, screenshots, demo media, and Fastlane metadata for open-source discovery.
- Kept Google Identity, Play Services Auth, and Health Connect dependencies out of the FOSS flavor.

## 1.0.1 - 2026-07-18

### Changed

- Moved primary create actions into a context-aware bottom action dock.
- Kept AI, receipt, and related quick actions as compact secondary dock actions.
- Made Shop's bottom action follow To buy, Receipts, and Put away modes.
- Reduced duplicate top action rows across Today, Kitchen, Plan, Recipes, and Shop.
- Improved AI chat history previews to show the latest user message in each chat.

## 1.0.0 - 2026-07-17

### Added

- Five-destination Android workspace for Today, Kitchen, Plan, Recipes, and Shop.
- Manual food, grocery, recipe, meal, plan, receipt, CSV, share, and app-command intake.
- Editable AI conversations, persistent chat history, visible AI context, and editable proposals.
- Deterministic Primary → Fallback provider routing with no round robin.
- Azure OpenAI v1 Responses, v1 Chat Completions, and legacy deployment routing.
- Receipt notes, line-level proposal review, store/price provenance, storage, expiry, and nutrition fields.
- Bounded deep-link and proposal-package commands with atomic review and audit history.
- Encrypted local/Google Drive backup flow, optional Health Connect, and Android automation contracts.

### Changed

- Receipt purchases default to Kitchen put-away review instead of the shopping-needed state.
- Unknown nutrition remains unset instead of appearing as zero.
- Food imagery and emoji prefer stored identity before deterministic fallback.
- AI prompts/skills are visible and editable under Settings → AI assistant.
- AI connection tests report real provider HTTP errors instead of false-positive success.

### Security

- Automatic Android backup is disabled; provider credentials remain Keystore-protected.
- External links, shares, and intents stage untrusted drafts and cannot silently mutate local data.
