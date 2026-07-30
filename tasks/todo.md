# Utopia Golden Loop Checklist

## Completed Foundation

- [x] Shared Household Board generic package fixture.
- [x] Deterministic compile and server/artifact validation.
- [x] Reviewed install, scoped write, update, rollback, and data preservation.
- [x] Tamper, approval mismatch, capability escalation, registry signature, and
      telemetry privacy tests.
- [x] Deterministic local sync contract.
- [x] Strict creator and Android x2/web/macOS receipt validators.
- [x] Web and Android exports.
- [x] Production audit at zero vulnerabilities.
- [x] Single `npm run proof:golden-loop` evidence report.
- [x] Separate `npm run proof:golden-loop:virtual` local lab for non-device,
      non-Expo automation rehearsal.
- [x] Separate `npm run proof:golden-loop:clean-snapshot` candidate snapshot
      proof using a temporary Git index.

## P0: Proof Accuracy

- [x] Split platform integration from store-release readiness.
- [x] Enforce zero app-specific runtime/widget code in the proof.
- [x] Add remote-package-source outage behavior to required local stages.
- [x] Add backup/device-loss restore to required local stages.
- [x] Add capability grant/use/revoke to required local stages.
- [x] Add clean-checkout reproducibility stage. Final execution remains blocked
      until the integrated dirty tree is committed.

## P1: Network Transport Proof

- [x] Select one reference transport behind the existing sync contract.
- [x] Run the transport as a separate localhost process with durable storage.
- [x] Implement the adapter without changing package semantics.
- [x] Prove tenant isolation, buffered writes, conflict, rollback replay,
      tombstones, cursors, reconnect, and convergence.
- [x] Emit a redacted Git-bound network transport receipt.
- [ ] Drive this transport from Android x2, web, and macOS; localhost proof alone
      is not multi-surface sync evidence.

## P1: Surface Execution

- [x] Define one guarded shell-proof protocol used by every surface, requiring
      hashed raw observations rather than self-reported lifecycle booleans.
- [x] Repair web smoke assertions for current exported routes.
- [x] Add a real-browser, fail-closed web lifecycle driver. Install now executes;
      write, update, rollback, and reference-sync controls remain blocked.
- [ ] Emit a real web lifecycle receipt.
- [x] Produce a runnable macOS `.app` with a Git-bound artifact receipt.
- [x] Add a fail-closed macOS lifecycle harness bound to the `.app` hash and
      canonical shell-proof protocol.
- [ ] Produce a real macOS lifecycle receipt from the running app.
- [x] Add a guarded Android x2 proof driver for dedicated test APKs, explicit
      emulators, redacted observations, and canonical per-device receipts.
- [ ] Build/install one artifact on two clean Android emulators.
- [ ] Run the same live scenario using four distinct installation IDs.
- [ ] Pass the strict multi-surface receipt validator.
- [x] Generate virtual Android x2/web/macOS-shaped receipts without using real
      devices or Expo UI hooks.
- [x] Define the `goldenLoopDebug` command protocol and validate install, write,
      disconnect/reconnect, update, rollback, backup/restore,
      capability grant/revoke, and checksum command shapes.
- [x] Require a random per-run token and redacted command traces.
- [x] Reject arbitrary commands, external endpoints, unsafe argument keys, SQL,
      files, URLs, and code payloads.
- [x] Mark virtual receipts as not real device/shell proof and keep the strict
      receipt validator fail-closed against them.

## P2: Human And Reproducibility Evidence

- [ ] Build one browser flow: describe, generate, validate, preview, local install,
      and export.
- [x] Keep the creator AI key in browser memory only.
- [x] Add duration and redacted failure-category recording.
- [x] Add clean-checkout CI with lockfile install, isolated cache, and private
      environment stripping.
- [ ] Run one unaided creator session in 600 seconds or less.
- [ ] Validate the creator receipt.
- [ ] Reproduce local Golden stages from a clean checkout.
- [x] Create a candidate commit object from the dirty filesystem without staging
      main.
- [ ] Make final `npm run proof:golden-loop` pass. Current local platform stages
      pass; creator, clean checkout, cross-runtime, and multi-surface evidence block.
- [ ] Use `npm run proof:golden-loop:virtual` as a local rehearsal only; it does
      not close real receipts, clean checkout, or unaided creator proof.

## Required Checks

- [x] `npm run check:golden-loop`
- [x] `npm run config:validate`
- [x] `npm run typecheck`
- [x] `npm run doctor`
- [x] `npm run export:web`
- [x] `npm run export:android`
- [x] `npm run phase3:check:chat-send`
- [x] `npm run phase3:check:chat-rollback-idempotency`
- [x] `git diff --check`

## Deferred

- Store signing and physical-device release evidence.
- iOS parity.
- Additional apps, widgets, providers, builders, and marketplace features.
- External security review and adoption campaigns.

## User Decision Gates

- [ ] Approve committing the exact integrated tree before final clean-checkout proof.
- [ ] Approve a narrow Expo runtime test hook only if external drivers cannot
      exercise the real lifecycle through existing interfaces. The web driver now
      proves this hook is required for write, update, rollback, and reference sync.
- [ ] Supply one genuinely unaided external creator for the final authoring receipt.
