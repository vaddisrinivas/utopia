# Adversarial App Tests

Scope: these apps are evidence probes. They exist to measure runtime generality, not to pad the app count.

The full 50-app falsification matrix is machine-readable at `docs/adversarial-app-matrix.json`.
Every matrix row points to a preserved JSON fixture under
`tests/fixtures/adversarial-apps/`. Fixtures are not bundled products and do not
count toward the platform generalization scorecard.

Regenerate the fixtures from the matrix with:

```bash
npm run materialize:adversarial-apps
```

Check that all 50 rows still point to valid fixtures with:

```bash
npm run check:adversarial-app-matrix
```

The top-five architecture invalidators are:

1. Chess Clock: real-time loop.
2. Expense Splitter: aggregate expression and graph minimization.
3. Spaced Repetition: algorithmic temporal scheduling.
4. Live Shared Shopping List: multi-writer sync.
5. Package That Edits Packages: self-hosting.

## Current Results

| App | Runtime unknown | Package-only | Result |
|---|---|---:|---|
| 50 adversarial fixtures | Runtime breadth across seven axes | No | Preserved inputs: 1 proven, remaining entries partial or expected boundaries |
| Expense Splitter | Derived computation across records | Yes | Grouped balances and minimized settlements pass through the shared expression kernel |
| Split Rent | Exact weighted allocation | Yes | Stable remainder distribution passes through the same expression kernel |
| Workout Logger | Multi-step flow and running timers | Yes | Persisted `stepFlow` and `durationTimer` survive restart and clock scenarios |
| Focus Intervals | Unrelated timed-flow reuse | Yes | Reuses the same flow/timer contracts without new runtime semantics |

## Deltas

Before these two apps:

```text
4 bundled apps
1 package-only app
8 Food-specific widget refs
3 specialized runtime widgets
```

After Wave 5:

```text
8 proven/reference bundled apps
5 package-only apps
50 adversarial fixtures excluded
Workout Logger admitted as a package-only proof
Focus Intervals admitted as the unrelated timed-flow proof
8 Food-specific widget refs
3 specialized runtime widgets
```

## Interpretation

Expense Splitter and Split Rent close the aggregate-expression gap without
`settlementCalculator` or rent-specific runtime code.

Workout Logger closes the persisted timer/flow gap without a `workoutTimer`.
Focus Intervals validates that flow contract in a second domain without shell
growth.

Sync hardening now has a deterministic local proof lane: `npm run check:shared-state-sync`
and `tests/providers/shared-state-sync.test.ts` exercise conflict, merge, and
device-loss recovery outcomes on memory/file adapters only. This proof is explicitly
local (deterministic) and does not claim live multi-device service proof.

Next design targets:

- app quality evals that score whether the app is usable, not merely package-only.
