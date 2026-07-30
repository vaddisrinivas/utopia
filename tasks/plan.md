# Utopia Golden Loop Plan

## Goal

Prove one demanding app through the complete public Utopia path:

```text
natural-language request
  -> deterministic package
  -> reviewed install
  -> scoped records
  -> offline conflict and convergence
  -> approved update
  -> rollback and recovery
  -> Android x2, web, and macOS receipts
```

The reference app is `Shared Household Board`. It may use only public package
contracts and generic runtime capabilities. Food remains a reference app.

Run the current proof with:

```bash
npm run proof:golden-loop
```

Run the non-device virtual lab with:

```bash
npm run proof:golden-loop:virtual
```

The virtual lab rehearses Android x2, web, macOS, sync, update, rollback, and
recovery receipts without Expo UI hooks, Expo Go, signing, deployment, or real
devices. It is useful automation, but it is not eligible as real shell, physical
device, or unaided creator evidence.

Run the dirty-tree clean snapshot candidate with:

```bash
npm run proof:golden-loop:clean-snapshot
```

This uses a temporary Git index to create a candidate commit object from the
current filesystem without staging main. It proves the tree can be snapshotted;
final clean-checkout reproducibility still requires a reachable committed tree.

## Current Truth

Verified on 2026-07-30:

- `local_platform_status=PASS`.
- Creation, validation, reviewed install, scoped write, update, rollback, and
  data preservation pass.
- Hostile payloads, approval mismatch, capability escalation, registry
  signatures, telemetry privacy, and deterministic sync contracts pass.
- Production `npm audit --omit=dev` reports zero vulnerabilities.
- Web and Android exports pass.
- Two Android emulators can boot concurrently.
- The separate-process reference sync transport passes its durable localhost
  conflict, reconnect, replay, recovery, and isolation scenario.
- Golden Loop local required stages pass, including source-outage, backup/restore,
  capability revoke, and zero app-specific runtime checks.

The overall proof remains `BLOCKED` on:

- an unaided creator receipt;
- a multi-surface run through the networked reference sync transport;
- actual cross-runtime execution;
- web and macOS execution receipts;
- Android x2 lifecycle receipts;
- clean-checkout reproducibility.
- The virtual lab can be green while the real receipt gates remain blocked.

## Scope Rules

- A task stays active only if it can turn a Golden Loop result from `FAIL` or
  `BLOCKED` into `PASS`.
- No new app fixtures, providers, widgets, builders, or planning documents.
- No synthetic device, sync, registry, or creator evidence.
- Synthetic virtual-lab receipts must be labeled `virtual_only` and
  `synthetic_plan_is_not_device_proof`.
- Store release, physical-device proof, broad adoption, and marketplace polish
  are deferred until platform integration passes.
- Preserve dirty work. Do not stage, commit, push, or deploy without approval.
- Do not edit `packages/domain-shared`.
- Current `AGENTS.md` forbids Expo UI edits; use test/runtime ports or request a
  scope change if an execution producer genuinely requires UI work.

## Task 1: Make The Proof Match The Claim

**Description:** Remove false blockers and false passes before adding more code.

**Acceptance criteria:**

- [x] Separate platform integration from store-release readiness.
- [x] Golden Loop locally enforces zero app-specific runtime/widget code.
- [x] Required stages cover broker grant/revoke, package-source outage, and
      backup/restore rather than reporting hard-coded claims.
- [ ] Required stages cover clean-checkout reproducibility.

**Verification:**

- [ ] `npm run check:golden-loop`
- [ ] Runner-classification tests cover `PASS`, `FAIL`, and `BLOCKED`.
- [x] No store credential can block the platform-integration verdict.

**Dependencies:** None
**Estimated scope:** Medium

## Task 2: Close Missing Local Guarantees

**Description:** Add the local behavior still absent from the quoted Golden Loop.

**Acceptance criteria:**

- [x] Installed app opens and preserves records while its remote package source
      is unavailable.
- [x] Export/backup, simulated device loss, restore, update, and rollback preserve
      installation-scoped records.
- [x] One declared native capability is denied, granted, exercised through the
      broker, revoked, and denied again.

**Verification:**

- [ ] Focused install, recovery, and capability tests pass.
- [ ] `npm run typecheck`
- [ ] `npm run proof:golden-loop` keeps all required local stages green.

**Dependencies:** Task 1
**Estimated scope:** Medium

## Task 3: Implement One Real Sync Transport

**Description:** Add a networked reference relay backed by durable storage.
It runs as a separate process behind the existing provider-neutral sync contract,
without exposing the transport to packages or bypassing the operation kernel.

**Acceptance criteria:**

- [x] Multiple client/device IDs under one shared installation can buffer writes,
      reconnect, detect conflict, replay idempotently, and converge.
- [x] A second installation proves tenant and installation isolation.
- [ ] Android, web, and macOS clients exchange operations through the network
      transport rather than sharing process memory.
- [x] Tombstones, cursors, idempotent replay, tenant isolation, and recovery are
      exercised against the real transport.
- [x] The same package remains valid when the transport adapter is absent.

**Verification:**

- [x] Existing deterministic sync proof remains green.
- [x] A Git-bound network receipt records distinct client and installation IDs and final state
      checksum without secrets or record content.
- [x] Failure reports `BLOCKED`, never synthetic `PASS`.

**Dependencies:** Task 1
**Estimated scope:** Medium, split adapter and live-scenario work if over five files

## Task 4: Produce Real Surface Receipts

This task has three parallel, non-overlapping lanes.

First define one guarded, non-production shell-proof protocol. Every driver must
execute the same install, write, disconnect, conflict, reconnect, update,
rollback, and checksum scenario through the shell's real runtime and database.

### 4A: Web

- [x] Replace stale Food/LifeOS smoke assertions with stable Utopia runtime
      signals.
- [ ] Use Playwright to run the Golden package lifecycle in the web shell.
- [ ] Emit a provenance-bound web receipt with installation ID, package checksum,
      conflict, rollback, and convergence assertions.

### 4B: macOS

- [x] Make `npm run macos:build` produce a runnable `.app`.
- [ ] Launch the `.app` and run the same Golden package lifecycle through its
      real storage/runtime ports.
- [ ] Emit the matching macOS receipt or classify unsupported behavior explicitly.

### 4C: Android x2

- [ ] Build and install the same debug artifact on two clean emulators using
      Maestro/ADB.
- [ ] Assign distinct installation IDs and execute the live sync scenario.
- [ ] Capture both matching Android receipts without treating emulator boot as app
      execution.

**Verification:**

- [ ] `check-multi-surface-receipts.mjs` passes.
- [ ] Four unique installation IDs share one package checksum.
- [ ] No receipt contains package records, prompts, keys, files, or user content.

**Dependencies:** Task 3; 4A and 4B build repair may start in parallel
**Estimated scope:** Three medium lanes

### 4D: Virtual Lab

- [x] Produce a push-button local rehearsal that emits Android x2, web, and
      macOS-shaped shell receipts without using real devices or Expo UI hooks.
- [x] Define the shared `goldenLoopDebug` command protocol for install, write,
      sync disconnect/reconnect, update, rollback, backup/restore, capability
      grant/revoke, and checksum commands.
- [x] Require a random per-run token and loopback/ADB-only style arguments.
- [x] Reject arbitrary command names, argument keys, external endpoints, SQL,
      files, URLs, and code payloads.
- [x] Emit only redacted command traces in receipts.
- [x] Mark every virtual receipt as not device proof.
- [x] Keep the strict multi-surface validator fail-closed against virtual
      receipts.
- [x] Report `physical_device=NOT_REQUIRED`,
      `human_usability=NOT_MEASURED`, and
      `real_multi_surface_receipts=NOT_PROVEN`.
- [x] Produce a `CANDIDATE_PASS` clean snapshot using a temporary Git index
      without staging main.

**Verification:**

- [x] `npm run proof:golden-loop:virtual`
- [x] `npm run proof:golden-loop:clean-snapshot`
- [x] Focused virtual-lab tests pass.

## Task 5: Creator And Clean-Checkout Proof

**Description:** Prove the path is usable and reproducible, not merely testable.

**Acceptance criteria:**

- [ ] One browser path supports describe, generate, validate, preview, local web
      install, and package export.
- [ ] A user-provided AI key stays in browser memory and is never persisted,
      logged, committed, or sent to Utopia services.
- [ ] The browser flow records duration and redacted failure categories.
- [ ] A new creator describes the app, generates a valid package, opens install
      review, installs it, and opens it in 600 seconds or less without assistance.
- [ ] A clean-checkout CI job installs from the lockfile and reproduces all local
      Golden stages with caches disabled and no private machine paths.
- [ ] Creator and checkout receipts are fresh, Git-bound, and content-free.

**Verification:**

- [ ] Creator receipt validator passes.
- [ ] Clean-checkout job passes.
- [ ] `npm run proof:golden-loop` has no platform-integration blockers.

**Dependencies:** Tasks 2 and 4
**Estimated scope:** Medium automation plus one external participant

## Automation Contract

The active 15-minute automation owns this queue. It may maintain at most four
non-overlapping `gpt-5.3-codex-spark` lanes:

| Lane | Automated work | Exit |
|---|---|---|
| A | proof accuracy, local guarantees, clean-checkout harness | required local stages pass |
| B | networked sync relay and live scenario | live sync receipt passes |
| C | web runner, then Android x2 drivers | three surface receipts pass |
| D | runnable macOS shell and driver | macOS receipt passes |

After lanes A-D integrate, the automation refills one lane with the browser
creator path. It reviews each worker diff, integrates only scoped files, runs
focused checks, and updates `tasks/todo.md` after verified results.

The automation must stop and notify for:

- a required commit or clean branch;
- an Expo runtime/UI scope change;
- credentials or deployment;
- the external unaided creator;
- any request to fabricate or weaken evidence.

## Score Targets

| Area | Current | Automation target | Final 10/10 evidence |
|---|---:|---:|---|
| Sync | 4.0 | 9.0 | networked multi-writer recovery receipt |
| Android/web/macOS parity | 5.0 | 9.0 | matching real-shell lifecycle receipts |
| Authoring | 6.5 | 9.0 | unaided creator under 600 seconds |
| Reproducibility | 6.5 | 10.0 | clean-checkout CI passes |

## Parallel Execution

Use at most four active lanes:

| Lane | Work | Start |
|---|---|---|
| A | Task 1, then Task 2 | now |
| B | Task 3 transport adapter | after Task 1 contract |
| C | Task 4A web receipt producer | now |
| D | Task 4B macOS build/receipt producer | now |

After Task 3 passes, reuse lanes for Android x2 and clean checkout. Creator
evidence runs last because it depends on a stable flow.

## Checkpoints

After every integration:

```text
npm run check:golden-loop
npm run config:validate
npm run typecheck
git diff --check
```

Before calling the platform loop complete:

```text
npm run doctor
npm run export:web
npm run export:android
npm run phase3:check:chat-send
npm run phase3:check:chat-rollback-idempotency
npm run proof:golden-loop
```

## Deferred Until The Loop Passes

- Store signing and physical-device release proof.
- Hosted registry publication and distribution services.
- iOS parity.
- More apps, widgets, providers, and data homes.
- JSON Forms, Puck, Monaco, and additional builder modes.
- Marketplace categories, ratings, screenshots, and commercial services.
- Broad documentation, external security review, and adoption programs.

These remain valid later goals. They are not active tasks.

## Definition Of Done

Platform integration is complete only when:

- all required local stages pass;
- live sync passes;
- Android x2, web, and macOS receipts pass;
- recovery and package-source-outage scenarios pass;
- an unaided creator and a clean checkout pass;
- the evidence bundle matches the exact Git source and contains no secrets or
  user content.
