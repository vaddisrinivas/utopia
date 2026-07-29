# Utopia Runtime Proof Checklist

## Wave -1: Blocking Gates

- [x] Record branch, HEAD, tracked diff, and untracked inventory.
- [x] Classify current dirty paths without modifying them.
- [x] Recommend relocating all 50 matrix-backed app directories unchanged to
  `tests/fixtures/adversarial-apps/`.
- [x] Keep the separate Workout Logger proof seed under `apps/`, but unproven.
- [x] Receive yes/no user decision for the recommended relocation.
- [x] Receive and persist Expo UI scope authorization.
- [x] Keep `packages/domain-shared` forbidden without separate approval.
- [x] Select baseline commit `18af6fe`.

## Worktrees

- [x] Create isolated Workout Logger and Focus Intervals worker worktrees.
- [x] Start both worktrees from the approved working-tree state.
- [x] Run Workout Logger with `gpt-5.3-codex-spark`.
- [x] Run Focus Intervals with `gpt-5.4-mini`.
- [x] Inspect both worker commits before applying their scoped deltas.
- [x] Start the 10-minute coordinator monitor.

## Wave 0: Repository Truth

- [x] Run and fix or classify `check:sync-merge`.
- [ ] If blocked, assign Evidence worker, reproducer, and post-Wave-2 revisit.
- [x] Relocate approved adversarial stubs out of `apps/`.
- [x] Classify proven, reference, fixture, probe, and expected-boundary entries.
- [x] Make scorecard product counts include only proven bundled apps.
- [x] Ratchet domain debt and per-app runtime delta.
- [x] Archive the 211 KB file-by-file review outside active root docs.
- [x] Preserve Habit Grid and Audio Loop sentinels.
- [x] Pass Wave 0 checks.

## Wave 1: Pantry Spike

- [x] Start two-day time box.
- [x] Rebuild one pantry screen from plausible generic primitives.
- [x] Prove the composition with one unrelated collection.
- [x] Demonstrate every new primitive on that unrelated screen in the same spike.
- [x] Record domain-reference reduction from 9 to 8.
- [x] Preserve Food source round-trip.
- [x] Preserve Habit Grid package-only status.
- [x] Preserve Audio Loop behavior.
- [x] Classify `PASS`.
- [x] Stop after the bounded spike.

## Wave 2: Expressions

- [x] Create canonical shared expression fixture corpus first.
- [x] Fix decimal precision, rounding, ordering, error, and serialization policy.
- [x] Run the same corpus in client and server tests.
- [x] Define the smallest bounded expression/query contract.
- [x] Add depth, record, relation, operation, cycle, and numeric budgets.
- [x] Add structured deterministic errors.
- [x] Implement Expense Splitter balances and settlements package-only.
- [x] Implement Split Rent weighted allocation package-only.
- [x] Add client/server parity fixtures.
- [x] Reject arbitrary code and app-named runtime operations.
- [x] Reject `settlementCalculator`.
- [x] Pass focused expression tests.
- [x] Pass shared regression checks.
- [x] Integrate Wave 2 before starting Wave 3.

## Wave 3: Flows and Timers

- [x] Define bounded persisted `stepFlow`.
- [x] Define resilient `durationTimer`.
- [x] Implement UTC plus monotonic timer policy.
- [x] Test background/foreground.
- [x] Test process kill before expiry.
- [x] Test reopening four hours after expiry.
- [x] Test device restart.
- [x] Test clock rollback and forward jump.
- [x] Test DST boundary.
- [x] Test cancel/retry race and duplicate resume.
- [x] Test app update during an active session.
- [x] Implement Workout Logger package-only.
- [x] Reject `workoutTimer`.
- [x] Pass focused flow/timer tests.
- [x] Pass shared regression checks.

## Week 5: Flow Validation

- [x] Implement Focus Intervals as an unrelated timed flow package-only.
- [x] Reuse the existing flow/timer contract without app-specific semantics.
- [x] Classify `PASS`: the second app required no missing generic semantic.
- [x] Pass shared regression checks.

## Ten-Minute Loop

- [x] Read each active worker with current status.
- [x] Check commits, diff summary, tests, and blockers.
- [x] Do not interrupt progressing work.
- [x] Do not duplicate implementation.
- [x] Inspect completed commits before integration.
- [x] Notify only on failure, completion, conflict, decision, or external action.
- [x] No stagnant-worker escalation was needed.

## Final Acceptance

- [x] Repository counts are honest.
- [x] Pantry spike has an explicit `PASS` outcome.
- [x] Expense Splitter is package-only.
- [x] Split Rent is package-only.
- [x] Workout Logger is package-only.
- [x] Focus Intervals is package-only as the Week 5 generality proof.
- [x] Habit Grid and Audio Loop remain green.
- [x] No domain-specific primitive was introduced.
- [x] Required checks pass.
- [x] Complete integration diff reviewed.
- [x] Monitor deleted.
- [x] Parked roadmap retained for the next iteration after proof contracts stabilized.
- [ ] User decides commit, squash, merge, and push.

## Parked

- [ ] Capability broker and signed extensions.
- [ ] App Library expansion.
- [ ] Browser and visual builders.
- [ ] Self-hosted package editor.
- [ ] Data-home UX and provider OAuth.
- [ ] Sync vendor selection and shared-device product.
- [ ] Shared workspace collections with per-installation grants:
  - [ ] keep parked until expression/query scope, flows, broker, data-home policy, and sync roles are proven.
  - [ ] enforce grants at DB/store layer.
  - [ ] start with shared `people`, `events`, `media`, `tags`; keep meals/workouts/body metrics namespaced until proven by independent apps.
  - [ ] support `read`, `append`, `own-writes`, `write`.
  - [ ] make uninstall delete app-private data only; shared data survives separately.
- [ ] Broad CI and cross-platform release closure.
