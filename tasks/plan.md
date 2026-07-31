# Utopia Production-Hardening Plan

## Goal

Deliver public-beta readiness using evidence-backed checks only. No plan item is complete unless reflected in check artifacts and explicit blockers are resolved.

## Evidence status (current)

- Golden Loop: **BLOCKED** (`npm run proof:golden-loop`).
- Blockers in the current proof summary: `clean_checkout`, `multi_surface_execution`, `multi_surface_receipts`.
- Local platform checks and local guarantees remain healthy: `npm test` (152 files, 753 tests), `npm run gate:fast`, core schema/recovery/security gates, and focused chat/creator/registry checks pass in repository evidence.
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
- Real web + Android x2 + macOS shell execution receipts remain infrastructure-dependent.
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
