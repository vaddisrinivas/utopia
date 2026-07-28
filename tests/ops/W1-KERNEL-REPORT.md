# W1-KERNEL REPORT

- Task: Freeze kernel contracts and boundaries (P1-A/P1-B scope)
- Base branch: `main`
- Base SHA: `5f9b091c9667593f74e383554e59eb562211c4dd`
- Current SHA: `114a0931a3d7099e9eaaad851317b26b794d4cab`
- Scope SHA merge-base: `5f9b091c9667593f74e383554e59eb562211c4dd`

## Diff-tree (kernel contract scope)
- `tests/contracts/w1-kernel-boundary-fixtures.json` (added)
- `tests/contracts/w1-kernel-contracts.test.ts` (added)
- `tests/ops/apply.test.ts` (amended)
- `scripts/quality/check-kernel-boundaries.ts` (added)
- `package.json` (script added: `check:kernel-boundaries`)
- `tests/ops/W1-KERNEL-REPORT.md` (added)

## Checks
- `npm run check:kernel-boundaries` target added in `package.json`.
- `./server/node_modules/.bin/tsx --tsconfig tsconfig.json scripts/quality/check-kernel-boundaries.ts` not runnable in current workspace (binary path missing).
- No full test or typecheck execution was performed in this step.

## Blockers
- Runtime check blocker: `tsx` executable missing under `./server/node_modules/.bin`, so boundary script has not been executed locally.

## Merge risk
- Medium: script enforces canonical write boundaries via string-match regex and allowlist fixture; should be validated in CI/host once `tsx` is available.
- Low: additional kernel tests added are fixture-driven and avoid schema/API changes.

## Remaining scope
- Execute `npm run check:kernel-boundaries` and ensure it passes after dependency/tooling setup.
- Optionally extend contract fixtures/tests if `QuerySpec`, proposal identity, or receipts require stronger numeric/hash assertions.

## Ready-to-merge
- Not ready pending successful boundary check + CI test pass for touched kernel contract artifacts.
