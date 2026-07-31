# Utopia Production-Hardening Checklist

## Evidence truth

- Golden Loop remains blocked on `clean_checkout`, `multi_surface_execution`, `multi_surface_receipts`.
- `npm run proof:golden-loop` last observed status: `BLOCKED`.
- `npm test`: 152 files, 753 tests passed.
- Real web/Android x2/macOS lifecycle receipts are not yet emitted from real execution lanes.
- Live Sheets scenario is blocked by OAuth/disposable-workbook binding; Notion disposable proof is completed.
- `real sync and multi-surface proof` remains external-hardware dependent.

## Wave 0 — Repository truth (baseline)

- [x] Keep current deep review + file-scope index updated and referenced by plan.
- [x] Mark obsolete file-by-file review in archive as stale.
- [ ] Commit the evidence baseline as a separate checkpoint when tree is clean.
- [x] Add explicit archive-staleness note in `docs/archive/CODEBASE_FILE_BY_FILE_REVIEW.md`.
- [x] Add and keep red tests for consent/trust/migration/recovery regressions.

## Wave 1 — Trust and capability (mostly done)

- [x] Capability consent and broker enforcement are implemented.
- [x] TUF-style publisher trust states are enforced in checks.
- [ ] Re-run high-risk trust traces after next stable merge.

## Wave 2 — Data safety and secrets (implemented)

- [x] Migration safety checks and restore/backup integrity gates are present.
- [x] Credential persistence checks and cleanup guards are present.
- [ ] Re-run full `npm run test` after clean-checkout proof pass.

## Wave 3 — Core and contract authority (implemented)

- [x] Core boundary ports and schema authority consolidation are implemented.
- [x] Cross-boundary and dependency ownership gates are present.
- [x] Renderer navigation family and chat send/stream route ownership are extracted behind focused contracts.
- [ ] Keep a weekly evidence snapshot for core boundary scans.

## Wave 4 — Registry, sync, and shell execution (partial)

- [x] Registry publication hardening and write controls are in place.
- [x] Reference sync transport proof is available in deterministic mode.
- [x] Registry signature input validation, bounded reference-sync transport, and constrained creator receipt validation are covered by local tests.
- [ ] Real device/browser/runtime execution receipts:
  - [ ] web lifecycle receipt
  - [ ] Android x2 lifecycle receipts
  - [ ] macOS lifecycle receipt
- [ ] `npm run check:multi-surface-sync` from real execution path
- [ ] `node scripts/quality/golden-loop/check-multi-surface-receipts.mjs` pass

## Wave 5 — Authoring and release-readiness proofs

- [x] Browser creator + package-source flow exists.
- [x] Constrained creator harness + hostile-agent checks exist.
- [ ] Unassisted human creator under 600s is still unmeasured.
- [ ] Human creator telemetry is explicitly opt-in with consent labels.
- [ ] Clean-checkout proof with committed tree and fresh checkout.

## Canonical verification commands

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
npm run check:shared-state-sync
npm run check:golden-loop
npm run proof:golden-loop
npm run check:security:audit
npm run check:security:osv
npm run check:security:gitleaks
node scripts/quality/check-live-provider-readiness.mjs
node scripts/quality/check-launch-readiness.mjs
node scripts/quality/run-clean-checkout-proof.mjs
node scripts/quality/check-multi-surface-sync-proof.mjs
npm run check:reference-sync-transport
node scripts/quality/golden-loop/check-multi-surface-receipts.mjs
node scripts/quality/check-creator-study-receipt.mjs
```

## External blockers (do not mark internal as complete)

- Real shell parity: hosted Android x2 + web + macOS execution infrastructure.
- Sheets live proof: OAuth + disposable workbook/account binding.
- Clean-checkout proof: clean git tree + committed source.
- Unassisted creator UX evidence: external human-run measurement.

## Launch checkpoint (must be all PASS/BLOCKED-classified)

- `npm run proof:golden-loop` with real web/Android x2/macOS execution receipts.
- `clean_checkout` proof on committed tree.
- `multi_surface_execution` proof from the same run or same run-group evidence chain.
- `multi_surface_receipts` strict aggregate validation.
- `node scripts/quality/golden-loop/check-multi-surface-receipts.mjs` PASS.
- `node scripts/quality/check-multi-surface-sync-proof.mjs` PASS.
