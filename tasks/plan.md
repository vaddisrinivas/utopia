# Utopia Production-Hardening Plan

## Goal

Deliver a closed Android beta for local-first package apps with private/unlisted
hosted installation. Sharing, web/macOS parity, public marketplace publishing,
and ten-minute self-service creation remain experimental.

No item is complete unless reflected in appropriate evidence.

## Critical path

1. Verify the integrated hardening set.
2. Wire publisher/purpose metadata into live capability requests.
3. Wire staged recovery activation to Android Expo SQLite/filesystem.
4. Pin release-gate tooling and remove mutable downloads from blocking gates.
5. Build a release Android bundle and prove the debug bridge is absent. **Done locally with throwaway release signing; not Play signing proof.**
6. Prove Audio Loop record/save/rename/restart/replay, or remove that beta claim.
7. Run one signed Android Golden Loop with actual SQLite state and private
   registry receipts.

Do not make sync, web, macOS, public publishers, or human creator evidence block
this narrower beta.

## Evidence status (current)

- Golden Loop: **BLOCKED** (`npm run proof:golden-loop`).
- Blockers in the current proof summary: `clean_checkout`, `multi_surface_receipts`, and fresh same-run Android x2 aggregation.
- Local platform checks and local guarantees remain healthy: `npm test` (152 files, 753 tests), `npm run gate:fast`, core schema/recovery/security gates, and focused chat/creator/registry checks pass in repository evidence.
- Web shell receipt is now real local browser execution.
- macOS shell receipt is now real local native app execution through Launch Services and a native URL handler.
- Android x2 emulator receipts exist from the earlier run, but are stale against the current package checksum and must be rerun before the strict aggregate receipt can pass.
- Synthetic/virtual-lab receipts are explicitly non-final for launch claims.
- Review artifacts now referenced directly from local files:
  - `docs/CODEBASE_DEEP_REVIEW_2026-07-30.md`
  - `docs/CODEBASE_FILE_SCOPE_INDEX_2026-07-30.md`

## Canonical all-surfaces workflow (truth-only)

### A. Local preflight (single run, non-equivalent to real parity)

```bash
npm run config:validate
npm run typecheck
npm run doctor
npm run export:web
npm run export:android
npm run phase3:check:chat-send
npm run phase3:check:chat-rollback-idempotency
npm run check:clean-checkout
npm run check:multi-surface-sync
npm run check:golden-loop
npm run proof:golden-loop
```

### B. Real multi-surface proof (preferred for launch)

```bash
gh workflow run golden-loop-all-surfaces.yml
RUN_ID=$(gh run list --workflow golden-loop-all-surfaces.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
gh run download "$RUN_ID" --name golden-loop-multi-surface -D app/build/evidence/golden-loop
node scripts/quality/golden-loop/check-multi-surface-receipts.mjs
node scripts/quality/check-multi-surface-sync-proof.mjs
node scripts/quality/run-clean-checkout-proof.mjs
```

### C. Targeted surface lanes (same commit surface)

```bash
gh workflow run golden-loop-clean-checkout.yml
gh workflow run golden-loop-web.yml
gh workflow run golden-loop-android-emulators.yml
gh workflow run golden-loop-macos.yml
```

Evidence must be consumed from:
- `app/build/evidence/golden-loop/golden-loop-proof.json`
- `app/build/evidence/golden-loop/clean-checkout/utopia_golden_loop_clean_checkout.json`
- `app/build/evidence/golden-loop/multi-surface/`
- `app/build/evidence/golden-loop/multi-surface-receipts.json`

## Architecture constraints (current target)

- JSON Schema remains authority for contracts.
- AJV remains shared schema execution engine.
- Capability enforcement remains brokered and user-consent-gated.
- Trust states remain separated: checksum, signature, publisher identity, and policy validity.
- Core remains headless; shell adapters own React/Expo/native/file/db implementation.
- Packages remain schema+runtime contract artifacts; no raw native or shell-specific code in package payloads.

## Stop-doing rules

- No new core architecture claims without evidence-backed gates.
- No live/synthetic parity substitute.
- No producer-side source-assertions as proof.
- No public-registry writes in automation until trust-signing policy is approved.

## Wave posture (non-duplicative)

### Wave 0 (blocked)
- Preserve current review + deep-file index as immutable evidence artifacts.
- Mark stale archive artifacts as stale in repo truth tables.
- Keep all red-gate regressions that document current threat surfaces.

### Wave 1 (in progress)
- Trust + capability gates are accepted if consent, signature, and TUF policies remain enforceable from live receipts.

### Wave 2 (in progress)
- Migration/recovery and secret-handling gates remain accepted only when evidence is generated from fresh checkpoints.

### Wave 3 (in progress)
- Portable Core and contract authority accepted only with enforced boundaries and dependency-owner proofs.

### Wave 4+ (active)
- Registry atomicity, sync transport, and shell execution are open only in three tracks:
  - registry/publication policy and write controls
  - reference-sync transport readiness and networked proof
  - Android x2 / web / macOS real receipts + aggregate receipt check

## External blockers (must fix before launch readiness)

- Dirty tree blocks `clean-checkout` evidence.
- Google Sheets live proof needs OAuth + disposable workbook/account binding (existing Notion disposable proof is complete).
- Real web + macOS shell execution receipts pass locally; Android x2 must be rerun for the current package checksum/run id before aggregate parity is launch-grade.
- Unaided human creator proof under 10 minutes is still external evidence.

## Required final verification (launch gate)

- `npm run config:validate`
- `npm run typecheck`
- `npm run doctor`
- `npm run export:web`
- `npm run export:android`
- `npm run phase3:check:chat-send`
- `npm run phase3:check:chat-rollback-idempotency`
- `npm run check:golden-loop`
- `npm run check:clean-checkout`
- `npm run check:multi-surface-sync`
- `npm run proof:golden-loop`
- `node scripts/quality/check-live-provider-readiness.mjs`
- `node scripts/quality/check-release-readiness.mjs`
- `npm run check:shared-state-sync`
- `node scripts/quality/golden-loop/check-multi-surface-receipts.mjs`
- `git diff --check`
