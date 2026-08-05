# Platform Proof Verdicts

Date: 2026-07-29

Commit under test: `8285296`

Purpose: convert the latest platform work from "large merge" into explicit pass/fail evidence.

## Verdict Summary

| Proof | Verdict | Evidence |
|---|---|---|
| Sync merge | PASS | `npm run check:sync-merge` wrote `app/build/evidence/sync-merge/sync-merge-proof.json`; `all_passed=true` |
| Platform scorecard | PASS | `npm run check:platform-generalization` wrote `app/build/evidence/platform-generalization.json`; 11 bundled apps, 8 pure-package apps, 50 adversarial fixtures excluded |
| Adversarial fixture matrix | PASS | `npm run check:adversarial-app-matrix` wrote `app/build/evidence/adversarial-app-matrix.json`; 50 entries and 50 materialized fixtures |
| Expense Splitter | PASS | `tests/runtime/expression-proof-apps.test.ts` verifies balances and minimized settlements with only `dataTable` |
| Split Rent | PASS | `tests/runtime/expression-proof-apps.test.ts` verifies exact weighted allocation and stable remainder handling with only `dataTable` |
| Workout Logger | PASS | `tests/runtime/workout-logger-flow-app.test.ts` verifies package validity, generic widgets, persistence, and restart recovery |
| Timed-flow restart policy | PASS | `tests/runtime/timed-flow.test.ts` covers monotonic time, process death, four-hours-later reopen, device restart, DST, clock rollback, duplicate resume, and app update recovery |
| Focus Intervals second-domain flow | PASS | `tests/runtime/focus-intervals-flow-app.test.ts` verifies the same flow/timer contracts in another app with no new runtime semantics |
| Pantry composition | BOUNDARY | Food still has 8 Food-shaped widget refs, including 3 `pantryShelf` refs; Food remains `domain_specific_debt` |
| Live provider proof | PASS | Disposable Notion and Google Sheets scenario proofs passed locally; evidence files were generated under `app/build/evidence/live-workspace/` and secrets were not committed |
| Live multi-device sync | BLOCKED | `npm run check:shared-state-sync` is local deterministic proof only; real two-device/provider proof is still missing |
| Signed/device release proof | PARKED | Release/device gates intentionally remain parked for the next release wave |
| Expo dependency health | PASS | `npm run doctor` passes 19/19 after correcting the root TypeScript version back to Expo SDK 57's expected `~6.0.3` |
| Web export | PASS | `npm run export:web` exported 26 static routes to `dist/web` |
| Android export | PASS | `npm run export:android` exported the Android bundle to `dist/android` |

## Commands Run

```bash
npm run check:sync-merge
npm run check:platform-generalization
npm run check:adversarial-app-matrix
npm run check:package-compiler
npm run check:food-source-roundtrip
npm run config:validate
npm run doctor
npm run typecheck
npm run gate:fast
npm run export:web
npm run export:android
npx vitest run tests/runtime/expression-proof-apps.test.ts tests/presentation/computed-records.test.ts tests/runtime/workout-logger-flow-app.test.ts tests/runtime/focus-intervals-flow-app.test.ts tests/runtime/timed-flow.test.ts tests/workflows/timed-flow-runtime.test.ts tests/presentation/json-render-reference-app.test.ts
```

## Dependency Note

The Dependabot root dependency merge upgraded TypeScript to `7.0.2`, but Expo
SDK 57 currently expects `~6.0.3`. `npm run doctor` failed until TypeScript was
returned to `~6.0.3`. The Expo patch-version drift was corrected with
`npx expo install --fix`, then repaired through `npm install` after Expo CLI hit
a transient missing-module error during its nested self-invocation.

## Current Scorecard Counts

From `app/build/evidence/platform-generalization.json`:

- 11 bundled apps scanned.
- 8 pure-package apps.
- 2 reusable runtime-capability apps.
- 1 domain-debt app.
- 8 domain-specific widget references.
- 3 specialized runtime widgets.

Bundled app classifications:

| App | Classification |
|---|---|
| Audio Loop | reusable runtime capability |
| Capability Lab | pure package |
| Expense Splitter | pure package |
| Focus Intervals | pure package |
| Food | domain-specific debt |
| Habit Grid | pure package |
| Recurring Bills | pure package |
| Scientific Calculator | reusable runtime capability |
| Spaced Repetition | pure package |
| Split Rent | pure package |
| Workout Logger | pure package |

## Acceptance Notes

Expense Splitter is accepted as package-only because it computes correct balances and minimized settlement transfers through the shared expression kernel, with no expense-named widget or renderer branch.

Workout Logger is accepted as package-only because it uses generic `stepFlow` and `durationTimer`, rejects `workoutTimer`, persists flow state, and has timer-policy tests covering the hard restart cases.

Pantry composition is not accepted. The current platform scan proves the opposite: Food still carries domain-specific renderer debt. The next legitimate proof is a dedicated pantry-from-primitives rewrite or a conscious decision to isolate Food as a signed first-party extension.
