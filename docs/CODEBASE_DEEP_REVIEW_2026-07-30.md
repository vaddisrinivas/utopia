# Utopia Codebase Deep Review

Date: 2026-07-30
Reviewed commit: `bf0efff`
Companion index: `docs/CODEBASE_FILE_SCOPE_INDEX_2026-07-30.md`

## Purpose

Fresh review of:

- improvement scope by file and subsystem;
- confirmed deep bugs and misleading proof boundaries;
- modules that should be split, replaced, or deleted;
- open-source tools worth adopting;
- safer alternative architectures;
- an ordered implementation program with falsifiable exit gates.

The companion index inventories every tracked file. This report manually
prioritizes the files with the largest correctness, security, portability, or
maintenance impact.

## Review Basis

- 1,177 tracked files inventoried.
- 1,000+ text/code/config files mechanically scanned.
- High-risk runtime, install, trust, persistence, sync, registry, settings,
  renderer, server, and Golden Loop files read directly.
- Current checks run:
  - `npm run typecheck`: pass.
  - `npm audit --omit=dev --json`: 0 production vulnerabilities.
  - `npm run check:core-port-boundaries`: pass, with coverage gaps described
    below.
  - `npm run check:dependency-boundaries`: reported pass, but emitted a
    TypeScript-transpiler warning that makes the result unreliable.
- Current external bundled URLs were checked:
  - `https://wonder.app/registry/bundled.json`: 404.
  - `https://wonder.app/bundled/scientific-calculator.package.json`: 404.
  - `https://utoia.thetechcruise.com/registry.json`: DNS unresolved.

This is source and local-check evidence. It is not physical-device, live sync,
production deployment, or external creator evidence.

## Current Verdict

Utopia is no longer an immature CRUD prototype. It has substantial package,
compiler, operation, flow, install, trust, provider, and proof infrastructure.
Its main weakness is now **false composition**: several good contracts exist,
but production execution paths do not consistently enforce them.

The most important examples:

- capability declarations exist;
- a persistent user-consent ledger exists;
- native widget execution checks declarations, not the consent ledger.

And:

- registry publication verifies a trusted signing key;
- install preview can verify a package-supplied key;
- the public registry manifest drops the hosted signature metadata.

The next iteration should prioritize enforcement wiring, recovery correctness,
portable Core boundaries, and real shell receipts. More fixtures, docs, or
widgets will not compensate for those gaps.

## Severity Summary

| Severity | Count | Meaning |
|---|---:|---|
| P0 | 2 | Trust boundary can make a false security claim or bypass intended consent |
| P1 | 9 | Data loss, secret exposure, release-only backdoor risk, or architecture-invalidating defect |
| P2 | 14 | Scale, maintainability, proof quality, or product-completeness defect |
| P3 | 8 | Hygiene, documentation, and developer-experience debt |

## P0 Findings

### P0-1: Native Capability Consent Is Not Enforced

Files:

- `src/presentation/widgets/package-capability-broker.ts`
- `src/presentation/json-render-widgets.tsx`
- `src/db/capability-consent-ledger.ts`
- `packages/shared/contracts/capability-consent-ledger.ts`
- `tests/presentation/widget-capability-broker.test.ts`
- `tests/db/capability-consent-ledger.test.ts`

Observed behavior:

- `requestWidgetCapability()` checks package-declared native package and
  permission arrays.
- It calls those declarations `grantedPackages` and `grantedPermissions`.
- The persistent consent ledger records allow/deny/revocation decisions.
- Production native widget execution does not read that ledger.
- Current runtime-source usage of the ledger is concentrated in the Golden
  Loop debug handler.
- Tests simulate revocation by changing package declarations, not by revoking
  user consent.

Impact:

- A package declaration is treated as user authorization.
- Per-install approval and revocation can appear implemented while native
  execution ignores them.
- A third-party registry is unsafe until this is corrected.

Required design:

```text
package declaration
  = capability eligibility

active consent ledger decision
  = user grant

native capability broker
  = declaration AND active grant AND shell support AND runtime policy
```

Implementation:

1. Replace the synchronous broker with an injected async
   `CapabilityDecisionPort`.
2. Resolve consent by installation ID, package ID, version/checksum,
   capability, and normalized scope.
3. Deny missing, stale, revoked, package-mismatched, and unknown records.
4. Force every native bridge through this broker.
5. Add a lint/dependency rule preventing widgets from importing Expo or native
   modules directly.

Acceptance:

- Declared without consent: blocked.
- Consent without declaration: blocked.
- Active declaration and consent: allowed.
- Revoked consent: blocked immediately.
- Package update with changed checksum: old grant blocked or explicitly
  migrated by policy.
- Unknown capability: blocked.

Useful tools:

- Existing SQLite ledger and AJV contracts.
- `dependency-cruiser` for import enforcement.
- `fast-check` for permission-state combination testing.

### P0-2: Install Verification Can Trust a Package-Supplied Public Key

Files:

- `packages/shared/contracts/package-install.ts`
- `src/domain/package-install.ts`
- `app/install.tsx`
- `src/domain/publisher-trust-store.ts`
- `packages/shared/contracts/extension-trust.ts`
- `cloudflare/utopia-registry-worker.ts`

Observed behavior:

- Registry signatures may include `publicKey`.
- If install preview has neither a trust store nor a trust policy, signature
  verification uses the signature's embedded public key.
- `app/install.tsx` does not provide a publisher trust store or trust policy.
- A self-signed package can therefore prove internal consistency, not
  publisher identity.
- The Cloudflare publish endpoint correctly verifies against configured
  publisher keys.
- The public registry manifest omits each row's stored signature, so hosted
  publication trust does not reach the normal install descriptor.

Impact:

- “Signature verified” can be confused with “trusted publisher”.
- Hosted registry verification is not end-to-end.
- Key rotation, expiry, rollback protection, and delegated publishers remain
  incomplete at the client boundary.

Required design:

```text
checksum match             -> package bytes unchanged
self-signature valid       -> package internally consistent, identity unknown
trusted-root signature     -> publisher identity accepted
TUF target accepted        -> registry version/freshness/rollback accepted
```

Implementation:

1. Never emit `signature_verified` for an embedded, untrusted key.
2. Introduce `signature_present_untrusted`.
3. Include signature/key ID in the registry manifest or resolve metadata by
   immutable checksum before preview.
4. Require trust-root resolution before publisher verification.
5. Use TUF metadata for root rotation, expiry, targets, and rollback
   protection.
6. Keep Sigstore for CI provenance only; do not substitute it for offline
   package trust.

Acceptance:

- Self-signed unknown key: reviewable but untrusted.
- Trusted current key: verified.
- Expired root/targets: blocked.
- Revoked key: blocked.
- Older signed target after a newer accepted version: rollback blocked.
- Manifest signature and package checksum mismatch: blocked.

Recommended tool:

- [TUF.js](https://github.com/theupdateframework/tuf-js)

## P1 Findings

### P1-1: Web Credentials Are Stored in Plaintext `localStorage`

Files:

- `src/settings/settings-storage.web.ts`
- `src/settings/utopia-settings.ts`
- `app/config.tsx`
- `src/presentation/json-render-widgets.tsx`

Stored settings include:

- AI provider API keys;
- Notion and Sheets access tokens;
- PostgreSQL URL;
- MCP token.

Impact:

- Any same-origin script compromise or XSS can exfiltrate all credentials.
- Browser persistence survives tabs and sessions.
- The generic renderer currently exposes token-entry UI inside a very large
  effectful module.

Replacement:

- Split harmless preferences from credentials.
- Browser credentials should be:
  - session-only memory for bring-your-own-key experiments; or
  - server-side OAuth/token exchange with an HttpOnly, Secure, SameSite cookie.
- Never put provider refresh tokens or database URLs in browser storage.
- Native may continue using SecureStore, with platform-specific threat
  documentation.

Acceptance:

- Browser storage contains no API key, provider token, database URL, or MCP
  token.
- Telemetry and error logs cannot contain credential fields.
- Sign-out and workspace removal revoke server-side sessions.

### P1-2: Audio Loop Recording Uses an API the Installed Expo Module Does Not Expose

Files:

- `src/presentation/widget-native-bridges.ts`
- `src/presentation/json-render-widgets.tsx`
- `tests/presentation/audio-loop-recorder-bridge.test.ts`
- `tests/presentation/audio-loop-contract.test.ts`

Observed behavior:

- The bridge checks `audio.createAudioRecorder`.
- Installed `expo-audio` exposes `useAudioRecorder()` and recorder lifecycle
  APIs, not `createAudioRecorder`.
- Current tests prove the unavailable branch but not successful integration
  with the installed module.

Impact:

- The visible recorder path is likely nonfunctional in a real build.
- Source-contract tests can pass while the defining product behavior fails.

Replacement:

- Build an owned recorder component/hook around
  `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`.
- Keep recording lifecycle in the shell adapter.
- Expose only capability-neutral start/stop/result events to package widgets.

Acceptance:

- Explicit tap requests microphone permission.
- Start, stop, auto-name, durable copy, rename, and playback pass on Android
  emulator and iOS simulator.
- Process death during recording has an explicit recovery result.
- No voice action silently starts the microphone.

### P1-3: Foreign-Key Migration Control Is Inside a Transaction

Files:

- `src/db/migrations.ts`
- `tests/db/migrations.test.ts`
- `tests/helpers/memory-db.ts`

Observed behavior:

- A migration transaction executes `PRAGMA foreign_keys = OFF`.
- SQLite does not change `foreign_keys` while a transaction is active.

Impact:

- Table-rebuild migrations may fail only against real SQLite with populated
  relations.
- A memory DB can miss this behavior.

Fix:

1. Read current FK state.
2. Disable before starting the migration transaction.
3. Perform the rebuild.
4. Commit.
5. Run `PRAGMA foreign_key_check`.
6. Re-enable in `finally`.

Acceptance:

- Every historical schema upgrades with populated relational fixtures.
- Interrupted migration rolls back.
- FK check is empty after upgrade.
- Real Expo SQLite test, not only the memory test double.

### P1-4: Recovery Export Converts Table Errors Into Empty Backups

Files:

- `src/db/migrations.ts`
- `src/db/recovery.ts`
- `src/domain/cloud-vault.ts`
- `src/domain/cloud-vault-storage.ts`
- `app/vault.web.tsx`
- `app/vault.tsx`

Observed behavior:

- Export catches a table query failure and records an empty row set.
- Restore deletes current rows before inserting snapshot rows.
- Snapshot lacks a strong per-table manifest with count and checksum.
- Native vault UI explicitly says restore is web-only.

Impact:

- A damaged export can look valid and restore as data loss.
- Recovery is not cross-platform.
- “Device-loss restore” is not proven.

Replacement:

- Fail export when any required table cannot be read.
- Add manifest version, database schema version, table list, row counts, and
  per-table checksums.
- Reject duplicate, unknown, missing-required, or checksum-invalid tables.
- Restore to a temporary database, migrate, validate, then atomically swap.
- Use WebCrypto-compatible primitives behind a crypto port.

Acceptance:

- Corrupt one table: export fails.
- Tamper one row: restore fails before deletion.
- Restore old schema: migration succeeds and FK/integrity checks pass.
- Device-loss scenario preserves package, records, consent, and history.

### P1-5: Core Is Still Coupled to Expo and Node

Files:

- `src/domain/runtime-context.ports.ts`
- `src/domain/package-migrations.ts`
- `src/domain/package-sharing.ts`
- `src/domain/cloud-vault.ts`
- `src/domain/cloud-vault-storage.ts`
- `src/domain/collaboration.ts`
- `src/domain/queries.ts`
- `src/ops/apply.ts`
- `src/ops/undo.ts`
- `src/workflows/runtime.ts`
- `src/workflows/timed-flow-runtime.ts`
- `src/providers/shared-state-sync.ts`
- `.dependency-cruiser.cjs`

Observed behavior:

- Core-facing files import `expo-sqlite`.
- Domain crypto imports `node:crypto`.
- Reference sync imports `node:fs`.
- The dependency rule blocks selected UI imports but omits `expo-sqlite`,
  `node:crypto`, and `node:fs`.

Impact:

- “Same Core across Android, iOS, web, macOS, and server” remains conditional.
- Browser and native shells need bundler exceptions or parallel
  implementations.
- Passing boundary checks overstates portability.

Replacement:

```text
Core
  DatabasePort
  CryptoPort
  ClockPort
  FilePort
  TransportPort

Adapters
  expo-sqlite
  Node filesystem
  WebCrypto
  native secure storage
  remote sync
```

Acceptance:

- Core packages compile in a Node test project with no Expo/React dependency.
- Core packages compile in a browser test project with no Node builtin.
- Dependency gate fails on a deliberately introduced forbidden import.

### P1-6: Dependency Boundary Gate Can False-Pass

Files:

- `package.json`
- `.dependency-cruiser.cjs`
- `scripts/gates/dev-fast.sh`
- `scripts/gates/release-local.sh`

Observed behavior:

- The gate downloads `dependency-cruiser` and `typescript` through `npx`.
- The repo pins TypeScript `~6.0.3`, while the downloaded toolchain can select a
  different version.
- Current run emitted `missing-typescript-transpiler` and still exited
  successfully.
- Other gates also execute an unpinned `npx typescript`.

Impact:

- TypeScript edges may be missing from the graph.
- A green architecture gate can mean “not analyzed”.
- Builds depend on network and mutable latest packages.

Fix:

- Pin `dependency-cruiser` in dev dependencies.
- Use local `npm exec -- dependency-cruiser`.
- Use local `tsc`.
- Treat warnings about unreadable TypeScript as gate failure.
- Add a negative fixture that intentionally violates each rule.

### P1-7: Golden Loop Debug Bridge Is Present in the Production App Graph

Files:

- `app/_layout.tsx`
- `src/quality/GoldenLoopDebugBridge.tsx`
- `src/quality/golden-loop-debug-protocol.ts`
- `src/quality/golden-loop-debug-handler.ts`
- `scripts/quality/golden-loop/debug-bridge-commands.mjs`
- `scripts/quality/golden-loop/android/run-golden-loop-android-lane.mjs`
- `scripts/quality/macos/run-golden-loop-debug-bridge.mjs`

Observed behavior:

- Root layout always imports and mounts the bridge.
- Runtime enablement uses `EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_DEBUG`.
- The token is also `EXPO_PUBLIC`, so enabled builds embed it in client code.
- Android commands put the token and full command in a deep-link URL.
- Commands can install/update packages, write data, reset installations,
  restore backups, and grant capabilities.
- “Transport disconnect/reconnect” changes an in-memory map; it does not drive
  a network transport.
- Backups are held in a process-local `Map`.

Impact:

- A misconfigured release can expose a destructive command surface.
- Tokens may leak through command lines, deep-link logs, shell history, or
  diagnostics.
- The receipt can prove runtime command execution but not network sync or
  device-loss recovery.

Required design:

- Put the bridge in a debug-only entrypoint excluded from production bundles.
- Add a release source/bundle gate proving bridge symbols and URL scheme are
  absent.
- Never put authorization secrets in URLs.
- Prefer a local, authenticated test transport:
  - web: test-only same-origin channel;
  - Android: instrumentation/bound service or loopback with debug certificate;
  - macOS: test process/XPC or loopback with debug entitlement.
- Make real sync commands call the transport adapter and produce server and
  client operation IDs.

Acceptance:

- Release bundle string scan finds no bridge symbol, token variable, or debug
  URL route.
- Debug receipt identifies an observed DB operation and shell execution.
- Network sync receipt includes two writers, server acknowledgement, reconnect,
  and deterministic convergence.

### P1-8: Registry Publication Is Not Atomic

Files:

- `cloudflare/utopia-registry-worker.ts`
- `cloudflare/wrangler.toml`
- `tests/platform/cloudflare-registry-worker.test.ts`

Observed behavior:

- Package blob, metadata, and registry index are separate R2 writes.
- Index update is read-modify-write.
- Concurrent writers can lose index entries.
- A failed intermediate write leaves partial package state.
- Telemetry rate limiting uses isolate-local memory.

Impact:

- Published package can exist without metadata/index, or metadata without
  discoverability.
- Concurrent publication is nondeterministic.
- Rate limits are bypassable across isolates.

Replacement:

- Durable Object as the publication coordinator:
  - validate;
  - reserve immutable checksum;
  - write R2 blob;
  - write metadata;
  - update serialized index;
  - emit receipt.
- Use Cloudflare Rate Limiting or a Durable Object for telemetry limits.
- D1 is optional for MVP blobs; use it when search, categories, ownership,
  moderation, and queryable lifecycle data become requirements.

### P1-9: Registry Secret Detection Is Key-Name Only

Files:

- `cloudflare/utopia-registry-worker.ts`
- `scripts/registry/publish-package.mjs`
- `.github/workflows/github-app-factory.yml`

Observed behavior:

- Publication rejects keys matching `secret`, `token`, `api-key`, `password`,
  or `credential`.
- Secret-like values under ordinary names can pass.

Fix:

- Keep schema-level forbidden fields.
- Run Gitleaks or TruffleHog over serialized publication input and generated
  PR artifacts.
- Add entropy/provider-pattern checks with a reviewed false-positive policy.
- Ensure packages never contain user records, prompts, media, or credentials.

Recommended tool:

- [Gitleaks](https://github.com/gitleaks/gitleaks), MIT.

## P2 Findings

### P2-1: Four AJV Authorities Can Drift

Files:

- `packages/schemas/src/package-validation.ts`
- `packages/shared/contracts/schema/ajv-authority.ts`
- `server/src/kernel/validation.ts`
- `scripts/domain-config-validator.mjs`
- `docs/schema-authority.md`

Each creates or configures AJV independently, with different dialect loading,
format behavior, and error handling.

Target:

```text
JSON Schema files = canonical authority
one shared AJV factory = structural validation
generated TypeScript = developer convenience
semantic policy = explicit layer after validation
Zod = private implementation detail only
```

Adopt:

- [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
- [Bowtie](https://github.com/bowtie-json-schema)
- [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript)
- [Spectral](https://github.com/stoplightio/spectral)
- [fast-check](https://github.com/dubzzz/fast-check)

Do not add TypeBox as another authority.

### P2-2: `json-render-widgets.tsx` Remains a 3,966-Line Runtime Hub

Files:

- `src/presentation/json-render-widgets.tsx`
- `src/presentation/json-render-surface.tsx`
- `src/presentation/widget-catalog.ts`
- `src/presentation/widgets/*`

It still combines:

- DB access;
- package mutations;
- chat;
- health;
- settings and credentials;
- native permissions;
- media recording/playback;
- capture/scanning;
- many widget families.

Target split:

```text
widgets/display/*
widgets/input/*
widgets/data/*
widgets/flow/*
widgets/media/*
widgets/native/*
widgets/system/*
widget-registry.ts
widget-runtime-context.ts
```

Rules:

- Pure rendering receives data and commands.
- Effects live in injected services.
- No nested “generic” component may retain domain-specific props.
- New primitive must serve two unrelated apps.

### P2-3: Server Tool Catalog Is a 3,653-Line Policy/Execution Hub

Files:

- `server/src/tools/catalog.ts`
- `server/src/tools/authoring.ts`
- `server/src/tools/db.ts`
- `server/src/tools/execute.ts`
- `server/src/tools/policy.ts`

Target split:

```text
tool-definitions/*
tool-validation/*
tool-policy/*
tool-executors/*
tool-receipts/*
tool-undo/*
```

Keep one catalog composition file with no provider writes.

### P2-4: Server Runtime Uses Global/File State and Sync Subprocesses

Files:

- `server/src/runtime/state.ts`
- `server/src/runtime/persistence.ts`
- `server/src/runtime/undo.ts`
- `server/src/providers/provider-undo-worker.ts`

Problems:

- 2,000-line state module;
- mutable process state;
- JSON persistence;
- synchronous subprocess execution for provider undo;
- source-TS runtime assumptions;
- weak multi-tenant isolation.

Replacement:

- repository interfaces;
- durable operation log;
- outbox/job worker;
- idempotency keys in persistent storage;
- async provider executor;
- explicit workspace/installation ownership.

For hosted Cloudflare execution, Durable Objects are a better fit for
single-workspace serialization than process-global state.

### P2-5: Server Entrypoint Still Owns Too Much

Files:

- `server/src/index.ts`
- `server/src/routes/chat-routes.ts`
- `server/src/routes/chat-control-routes.ts`
- `server/src/routes/package-routes.ts`
- `server/src/routes/provider-routes.ts`
- `server/src/routes/mcp-routes.ts`

Route extraction is moving correctly, but auth, streaming, run state, retries,
undo, and idempotency remain tightly coupled.

Approach:

- Keep Hono.
- Create typed request context.
- Extract chat-control state machine before moving endpoints.
- Route modules own parsing/status only.
- Application services own authorization, idempotency, and execution.
- Persistence owns run/undo state.

### P2-6: Reference Sync Is a Node-File Proof, Not Product Sync

Files:

- `src/providers/shared-state-sync.ts`
- `src/providers/sync-contract.ts`
- `scripts/providers/run-shared-state-sync.mjs`
- `scripts/quality/golden-loop/reference-sync-service.mjs`
- `tests/providers/shared-state-sync.test.ts`

Keep:

- deterministic merge fixtures;
- operation identity;
- conflict taxonomy;
- local proof corpus.

Replace:

- `node:fs` transport and proof-only backend with one real transport behind
  `sync-contract`.

Candidate spike:

- [PowerSync JS](https://github.com/powersync-ja/powersync-js)
- [Electric](https://github.com/electric-sql/electric)

Decision rule:

- two weeks maximum;
- same nine offline/conflict/reconnect/recovery scenarios;
- choose one;
- packages never reference vendor APIs.

Do not build a custom production sync engine.

### P2-7: Install Fetch Has No Time or Body Limit

Files:

- `src/domain/package-install.ts`
- `app/install.tsx`

Problems:

- arbitrary HTTPS fetch;
- no timeout;
- no response byte limit before JSON parsing;
- no redirect policy;
- manifest size bounded only after complete download.

Fix:

- `AbortController` timeout;
- `Content-Length` check;
- streamed byte cap;
- redirect count and final-origin policy;
- maximum registry entries;
- pagination for public registry.

### P2-8: Record Listing Performs Relation N+1 Queries

Files:

- `src/db/records.ts`
- `src/db/app-installation-data.ts`
- `src/domain/queries.ts`

Fix:

- fetch records and relations in bounded batches;
- group relations in memory;
- add query-count assertions;
- add indexes based on measured query plans.

Also:

- `workspaceId` must either be enforced or removed from repository input.
- malformed stored JSON should surface corruption, not silently become `{}`.

### P2-9: Browser Builder Is Too Large and Has Format-Risk

Files:

- `scripts/package/browser-package-builder.ts`
- `scripts/package/browser-package-builder-model.ts`
- `scripts/package/browser-package-builder-ui.ts`
- `docs/package-authoring.md`

Target:

- canonical package source remains the only saved format;
- JSON Forms edits schema-backed fields;
- Puck may edit screen composition only through an immediate adapter;
- raw Monaco mode remains available for advanced users;
- every edit compiles, previews, and validates continuously.

Recommended:

- [JSON Forms](https://github.com/eclipsesource/jsonforms)
- [Puck](https://github.com/puckeditor/puck)

Do not persist Puck JSON or JSON Forms UI schema as a second app format.

### P2-10: Tests Overuse Source-Shape Assertions

Files:

- numerous files under `tests/quality`, `tests/platform`, and
  `tests/presentation`;
- companion index marks tests containing `readFileSync`.

Source-shape tests are useful for:

- forbidden imports;
- required workflow wiring;
- debt ratchets;
- release symbol exclusion.

They do not prove:

- actual playback or recording;
- native permission behavior;
- network sync;
- device lifecycle;
- database migration semantics;
- usable authoring.

Add:

- Playwright for browser builder/web shell.
- Maestro for Android/iOS product flows.
- Stryker mutation testing for trust, compiler, operation kernel, and recovery.
- fast-check property tests for package validation, migrations, expressions,
  and merges.

### P2-11: Product Defaults Still Encode Food and Private Workspace Metadata

Files:

- `src/settings/utopia-settings.ts`
- `src/domain/catalog.ts`
- Food package sources under `apps/food`.

Observed behavior:

- default active domain is Food;
- default workflows and capture language are Food-specific;
- default Notion page and data-source IDs are embedded.

Impact:

- Platform shell remains domain-shaped.
- Public builds ship personal/workspace metadata.
- New users inherit irrelevant defaults.

Fix:

- generic empty first-run;
- explicit reference-app install choice;
- sanitized demo provider fixtures;
- local ignored configuration for private provider IDs.

Food should remain a strong reference app, not the shell default.

### P2-12: Bundled App URLs Are Internal Aliases, Not Shareable URLs

Files:

- `src/domain/package-install.ts`
- `src/domain/utopia-registry.ts`
- `docs/package-authoring.md`
- registry deployment configuration.

The in-app fetcher intercepts exact bundled URLs and returns local JSON, so
bundled installation may work inside Utopia. Direct browser/share consumers get
404, and the intended staging hostname does not resolve.

Fix:

- call bundled URLs what they are: local aliases; or
- publish immutable package blobs to a real host;
- add a network `HEAD`/`GET` gate only after deployment is approved.

### P2-13: Registry Manifest Drops Hosted Signature Metadata

Files:

- `cloudflare/utopia-registry-worker.ts`
- `packages/shared/contracts/package-install.ts`
- `src/domain/package-install.ts`

The hosted metadata stores `signature`; `registryManifest()` maps rows without
it. This compounds P0-2 and breaks end-to-end publisher verification.

Fix:

- include a trust-resolvable signature descriptor in the manifest;
- never embed the public key as the source of trust;
- bind package ID, version, checksum, publisher ID, and signature key ID.

### P2-14: Golden Loop Transport Receipts Can Overstate Sync

Files:

- `src/quality/golden-loop-debug-handler.ts`
- `scripts/quality/golden-loop/web-execution-receipt.mjs`
- `scripts/quality/golden-loop/android/run-golden-loop-android-lane.mjs`
- `scripts/quality/macos/run-golden-loop-debug-bridge.mjs`

`transport.disconnect` and `transport.reconnect` currently update a local map.
That proves command routing, not offline transport behavior or multi-writer
convergence.

Required receipt fields:

- shell identity and build commit;
- operation ID generated by each writer;
- local DB observation;
- transport enqueue;
- server acknowledgement;
- reconnect;
- remote application;
- final checksum independently read on every installation.

## P3 Findings

### P3-1: Stale Review Documents Can Mislead

Files:

- `docs/archive/CODEBASE_FILE_BY_FILE_REVIEW.md`
- `docs/architecture.md`
- `docs/schema-authority.md`
- `docs/platform-generalization-scorecard.md`

Action:

- Link this review from the archive header.
- Mark evidence dates and commits in every scorecard.
- Do not let docs claim one validator or proven behavior when executable gates
  say otherwise.

### P3-2: Large Generated Package JSON Obscures Review

Files:

- compiled package JSON under `apps/*`;
- package sources under `apps/*/package-source`.

Keep generated artifacts only when:

- source is canonical;
- round-trip is deterministic;
- checksum drift gate exists;
- generated diffs are reviewed separately from source diffs.

### P3-3: Native Project Ownership Is Unclear

Files:

- `android/**`
- `ios/**`
- `macos/**`

Mark each file as:

- generated by Expo prebuild;
- owned native bridge;
- signing/release config;
- proof-only test harness.

Avoid hand-editing generated files without a config-plugin source.

### P3-4: Action Versions and Permissions Need Continuous Ratchets

Files:

- `.github/workflows/*`
- `.github/dependabot.yml`

Add:

- SHA-pinned third-party actions;
- least-privilege `permissions`;
- job timeouts;
- concurrency cancellation;
- artifact retention limits;
- no secrets on fork PRs;
- provenance/SBOM output on release candidates.

### P3-5: Dependency and Dead-Code Ownership Is Not Automated Enough

Add:

- [Knip](https://github.com/webpro-nl/knip) for unused files, exports, and
  dependencies.
- Keep dependency-cruiser for layer rules.
- Run both with pinned versions.

### P3-6: Supply-Chain Checks Should Produce Current Artifacts

Use:

- [OSV Scanner](https://github.com/google/osv-scanner)
- [Syft](https://github.com/anchore/syft)
- Gitleaks

Every release-candidate report should include:

- dependency scan timestamp;
- lockfile checksum;
- SBOM checksum;
- scanner version;
- unresolved findings;
- no stale artifact reuse.

### P3-7: Telemetry Needs Operational Observability Without Product Data

Files:

- `src/telemetry/*`
- `cloudflare/utopia-registry-worker.ts`
- telemetry tests and docs.

Keep the current event allowlist and prohibition on records/prompts/files.

Add:

- OpenTelemetry for service latency/errors/traces;
- redaction tests;
- deletion/retention policy;
- anonymous installation ID rotation;
- opt-in state in every event receipt.

Do not enable replay or generic payload capture.

### P3-8: Scorecards Need Trend, Not Snapshot

Files:

- `scripts/quality/check-platform-generalization.mjs`
- `docs/platform-generalization-scorecard.md`

Track per commit/app:

- package-only status;
- new widget kinds;
- new native capabilities;
- domain-named runtime references;
- source-only vs behavior proof;
- creator time;
- cross-shell receipt status.

Ratchet domain debt and specialized widget count so they cannot silently grow.

## File-by-File Improvement Scope

### App Shell

| File | Scope |
|---|---|
| `app/_layout.tsx` | Remove production import of Golden Loop bridge; keep root composition thin |
| `app/install.tsx` | Inject trust store/policy; bounded fetch; exact trust copy |
| `app/apps/[installationId].tsx` | Split lifecycle, data-home, update, and rendering controllers |
| `app/config.tsx` | Remove web secret persistence; provider OAuth/session model |
| `app/package-control-room.tsx` | Keep advanced management separate from ordinary install/open flow |
| `app/vault.web.tsx` | Use recovery manifest and atomic restore |
| `app/vault.tsx` | Replace “web only” placeholder with portable crypto/storage adapter |
| `app/(tabs)/apps.tsx` | Categories/search/update status only after trustworthy registry metadata |

### Domain and Contracts

| File | Scope |
|---|---|
| `src/domain/package-install.ts` | Correct trust semantics; body limits; timeout; redirect policy |
| `src/domain/publisher-trust-store.ts` | Make sole publisher-key resolution path; connect TUF metadata |
| `src/domain/package-loader.ts` | Keep deterministic; property-test malformed and versioned packages |
| `src/domain/package-migrations.ts` | Remove Expo DB type from Core; expand migration compatibility corpus |
| `src/domain/package-sharing.ts` | Replace Node crypto with CryptoPort/WebCrypto |
| `src/domain/cloud-vault.ts` | Portable crypto; authenticated manifest; resource limits |
| `src/domain/cloud-vault-storage.ts` | Replace Node-only hashing/storage dependency |
| `src/domain/runtime-context.ports.ts` | Ports must not import concrete Expo SQLite types |
| `src/domain/queries.ts` | Pure query contract plus repository adapter; query plan tests |
| `src/domain/collaboration.ts` | Remove SQLite concrete type; define workspace authorization |
| `src/domain/package-change-templates.ts` | Split templates from validation/execution; prevent hidden DSL growth |
| `packages/shared/contracts/package-install.ts` | Separate integrity signature from trusted-publisher status |
| `packages/shared/contracts/extension-trust.ts` | Align with TUF-compatible root/target lifecycle |
| `packages/shared/contracts/capability-consent-ledger.ts` | Define package-update grant migration explicitly |

### Persistence and Recovery

| File | Scope |
|---|---|
| `src/db/migrations.ts` | Correct FK pragma lifecycle; fail-closed export; real SQLite migration matrix |
| `src/db/recovery.ts` | Verify manifest/checksums before deletion; temporary DB restore |
| `src/db/records.ts` | Remove relation N+1; surface corruption; enforce scope |
| `src/db/app-package-registry.ts` | Split install/update/rollback/receipt repositories |
| `src/db/app-installation-data.ts` | Make installation ownership and delete-data semantics explicit |
| `src/db/capability-consent-ledger.ts` | Add active-decision query used by production broker |
| `src/db/provider.tsx` | Shell-only provider; no policy decisions |

### Renderer and Native Capabilities

| File | Scope |
|---|---|
| `src/presentation/json-render-widgets.tsx` | Decompose into effect-free widget families |
| `src/presentation/json-render-surface.tsx` | Keep layout/render orchestration only |
| `src/presentation/widget-catalog.ts` | Registry metadata, compatibility, and fallback only |
| `src/presentation/widgets/package-capability-broker.ts` | Enforce declaration plus persisted consent |
| `src/presentation/widget-native-bridges.ts` | Use actual Expo APIs; one bridge per capability |
| `src/presentation/widgets/audio-loop-state.ts` | Keep deterministic state; property-test playlist/history invariants |
| `src/presentation/widgets/audio-loop-persistence.ts` | Durable URI ownership and process-death recovery |
| `src/health/connect.ts` | Move native adapter out of Core-facing path |
| `src/platform/*` | Route every native operation through broker and shell port |

### Sync and Providers

| File | Scope |
|---|---|
| `src/providers/sync-contract.ts` | Preserve vendor-neutral operation and receipt contract |
| `src/providers/shared-state-sync.ts` | Split pure merge from Node file transport; stop calling it live sync |
| `src/providers/notion-data-home.ts` | Disposable-lane proof, retry/backoff, schema drift, rate handling |
| `src/providers/google-sheets-data-home.ts` | OAuth lifecycle, workbook provisioning, pagination, conflict semantics |
| `src/providers/data-home-adapter.ts` | Clear readiness/auth/offline capability state |
| `src/providers/data-home-selection.ts` | Package preference never overrides unavailable/unsafe adapter |

### Server

| File | Scope |
|---|---|
| `server/src/index.ts` | Continue route extraction after chat-control state machine separation |
| `server/src/runtime/state.ts` | Replace process/file state with repositories and durable jobs |
| `server/src/tools/catalog.ts` | Split schema, policy, executor, provider, receipt, undo |
| `server/src/agent/executor.ts` | Bound model/tool loops; persistent idempotency and cancellation |
| `server/src/kernel/validation.ts` | Consume canonical AJV authority |
| `server/src/routes/chat-control-routes.ts` | Preserve auth, run state, streaming, retry, action, and undo via service API |
| `server/src/routes/provider-routes.ts` | Exact route ownership; no policy in HTTP layer |
| `server/src/routes/package-routes.ts` | Bounded payloads and canonical validator |

### Registry and Telemetry

| File | Scope |
|---|---|
| `cloudflare/utopia-registry-worker.ts` | Atomic publish coordinator, signature propagation, durable rate limits |
| `cloudflare/wrangler.toml` | Disabled writes by default; explicit bindings; no secrets |
| `src/telemetry/contract.ts` | Code-level allowlist and forbidden payload fields |
| `src/telemetry/client.ts` | Opt-in, batching limits, retry limits, no content capture |
| `scripts/registry/publish-package.mjs` | Explicit opt-in; local signing; no private key upload |

### Authoring and Compiler

| File | Scope |
|---|---|
| `scripts/package/browser-package-builder.ts` | Split controller; embed JSON Forms adapter |
| `scripts/package/browser-package-builder-model.ts` | Canonical package-source state only |
| `scripts/factory/generate-app-from-prompt.ts` | Bounded model output; adversarial prompt and secret tests |
| `packages/app-compiler/src/*` | Deterministic source-to-package compilation and lossless round-trip |
| `packages/schemas/src/package-validation.ts` | Consume canonical validator factory |
| `scripts/domain-config-validator.mjs` | Consume canonical validator CLI adapter |

### Proof and Quality

| File | Scope |
|---|---|
| `src/quality/GoldenLoopDebugBridge.tsx` | Debug-only bundle; no URL token; actual transport hooks |
| `src/quality/golden-loop-debug-handler.ts` | Replace process-local backup/transport simulation |
| `scripts/quality/golden-loop/web-execution-receipt.mjs` | Require observed browser/runtime/DB artifacts |
| `scripts/quality/golden-loop/android/run-golden-loop-android-lane.mjs` | Instrumentation/Maestro driver; no secret in deep link |
| `scripts/quality/macos/run-golden-loop-debug-bridge.mjs` | Actual shell process receipt, not source-only runner |
| `.dependency-cruiser.cjs` | Complete deny rules; pinned analyzer; negative fixtures |
| `scripts/quality/check-core-port-boundaries.mjs` | AST/import graph rather than narrow regex |
| `scripts/quality/check-platform-generalization.mjs` | Proven-only trend and ratchets |

## Open-Source Adoption Matrix

| Need | Adopt/evaluate | Decision |
|---|---|---|
| JSON Schema validation | AJV | Keep; one shared factory |
| Schema conformance | JSON Schema Test Suite, Bowtie | Adopt |
| Generated TS types | json-schema-to-typescript | Adopt after schema cleanup |
| Package lint policy | Spectral | Adopt |
| Property testing | fast-check | Adopt |
| Architecture rules | dependency-cruiser | Keep and pin |
| Dead code/dependencies | Knip | Adopt |
| Browser schema editor | JSON Forms | Adopt through package-source adapter |
| Visual screen editor | Puck | Evaluate; never canonical format |
| Workflow visualization | XState/Stately | Keep XState; adapter only |
| Production sync | PowerSync or Electric | Timeboxed comparison, choose one |
| Registry trust | TUF.js | Adopt |
| CI provenance | Sigstore.js | Evaluate; not package trust |
| Browser E2E | Playwright | Adopt |
| Mobile E2E | Maestro | Adopt |
| Mutation testing | Stryker JS | Adopt for critical kernels |
| Dependency vulnerabilities | OSV Scanner | Adopt/current artifacts |
| SBOM | Syft | Adopt/current artifacts |
| Secret scanning | Gitleaks | Adopt |
| Service telemetry | OpenTelemetry JS | Adopt with redaction |
| Crash reporting | Sentry React Native | Optional; replay off, PII stripped |

## Better Alternative Architecture

```text
Canonical package source
  -> JSON Schema validation
  -> semantic policy validation
  -> deterministic compiler
  -> immutable package JSON

Core
  -> data/query/operation/expression/flow contracts
  -> DatabasePort / CryptoPort / ClockPort / TransportPort
  -> no React / Expo / Node builtins

Shell
  -> renderer
  -> capability broker
  -> persisted consent decision
  -> platform adapter

Services
  -> registry publication coordinator
  -> TUF trust metadata
  -> selected sync transport
  -> telemetry allowlist
  -> durable operation/undo state

Proof
  -> generated app
  -> install
  -> actual DB operation
  -> two-writer transport convergence
  -> update/rollback/recovery
  -> independent shell checksums
```

## Recommended Execution Order

### Vertical 1: Trust Enforcement

Files:

- capability broker;
- consent ledger;
- package install trust;
- registry signature manifest;
- TUF integration.

Exit:

- no native operation without active consent;
- no trusted-publisher label without pinned/TUF key;
- revoked package/key/capability blocks immediately.

### Vertical 2: Data Safety

Files:

- migrations;
- recovery;
- vault;
- records repository.

Exit:

- historical populated DB upgrades;
- tamper-proof backup;
- atomic restore;
- no silent empty-table export;
- recovery works in every supported shell.

### Vertical 3: Portable Core

Files:

- domain DB types;
- crypto;
- file-backed sync;
- architecture gates.

Exit:

- Core compiles in browser and Node harnesses;
- no Expo/React/Node builtins;
- negative dependency fixtures fail correctly.

### Vertical 4: Real Sync and Shell Receipts

Files:

- sync contract/adapter;
- debug bridge;
- Android x2 driver;
- web driver;
- macOS driver.

Exit:

- two offline writers;
- real transport reconnect;
- deterministic convergence;
- independent final DB checksum from all installations;
- release build excludes debug bridge.

### Vertical 5: Authoring Proof

Files:

- browser builder;
- factory;
- package compiler;
- install flow.

Exit:

- fresh user or constrained agent creates and installs a useful app in under
  ten minutes;
- canonical package source only;
- zero app-specific runtime code;
- no secrets in generated package.

### Vertical 6: Service Hardening

Files:

- Cloudflare registry;
- server runtime/tool catalog;
- telemetry;
- supply-chain workflows.

Exit:

- atomic immutable publication;
- writes disabled by default;
- durable rate limits;
- current SBOM/vulnerability/secret evidence;
- no records/prompts/files in telemetry.

## Stop-Doing List

- Do not add more bundled apps until enforcement and recovery defects are
  closed.
- Do not call local map/file behavior live sync.
- Do not call an embedded-key signature trusted publisher verification.
- Do not add another schema authority or renderer.
- Do not persist browser API keys.
- Do not build custom TUF, CRDT, visual editor, or analytics infrastructure
  when proven tools fit.
- Do not accept source-string tests as behavior proof.
- Do not ship the Golden Loop bridge in release bundles.

## Definition of Ready for Public Beta

All must be true:

- capability declaration plus active user consent enforced;
- publisher trust rooted in pinned/TUF metadata;
- recovery corruption and migration matrix green;
- one real networked sync transport;
- Android x2, web, and macOS runtime receipts;
- debug bridge absent from release;
- browser contains no persisted credentials;
- one novice/constrained creator completes build-to-install under ten minutes;
- registry publication atomic and writes disabled by default;
- telemetry opt-in and payload allowlist enforced;
- current OSV, SBOM, secret-scan, typecheck, config, doctor, web export, Android
  export, and phase-3 chat gates pass.

Until then, the accurate claim is:

> Utopia is a capable local-first package runtime with promising authoring,
> trust, and service foundations. Several production enforcement and proof
> boundaries remain incomplete.
