# Emulator Sync Proof (Android AVD Lane)

## Scope

- Build a deterministic emulator-sync proof harness for Android emulator identities.
- Capture local convergence/conflict/rollback assertions.
- Include explicit network partition/reconnect controls.
- Emit BLOCKED evidence when adb/emulators/service are unavailable.
- Do not claim physical-device proof or live-provider proof.

## Fixed harness shape

- Run script: `./scripts/quality/check-emulator-sync-proof.mjs`
- Default AVD identities: `emulator-5554`, `emulator-5556`, `emulator-5558`
- Identity limit: 3
- Required concurrent installations: 2
- Evidence output: `app/build/evidence/emulator-sync/<runId>/emulator-sync-proof-*.json`

## How it works

1. Discover adb binary and start-server status.
2. Read `adb devices -l` and match requested AVD serials.
3. If unavailable, block with `status: BLOCKED` and explicit blockers.
4. If ready, build deterministic profiles:
   - distinct installation IDs per identity
   - per-device network partition/reconnect command sets
5. Build and evaluate a deterministic sync scenario:
   - 2+ installations modify the same field concurrently
   - conflict detection with deterministic winner
   - convergence check on final merged record
   - rollback replay for the loser path
6. Write artifacts:
   - `adb-devices.txt`
   - `deterministic-scenario.json`
   - `deterministic-scenario-evaluation.json`

## Evidence contract

- `proof: utopia_emulator_sync_proof`
- `status: BLOCKED | PASS`
- `proof_scope.physical_device_claim === 'not_applicable'`
- `proof_scope.live_provider_claim === 'BLOCKED'`
- `artifacts` include `path`, `bytes`, `sha256`
- local assertions recorded in `evidence.plan.scenario_evaluation.assertions`

## Blocking conditions

- adb unavailable
- adb server unavailable
- fewer than 2 requested AVD identities currently connected

Blocked outcomes do not represent failure of platform logic;
`status` is intentionally explicit `BLOCKED`.

## Isolated macOS fixture input

The multi-surface proof script normally scans the checked-out macOS build
products. Tests and isolated runners may set
`UTOPIA_MACOS_APP_BUNDLE_PATHS` to a comma-separated list of explicit `.app`
bundle paths. When set, only those paths are considered; stale build products
cannot satisfy or suppress `missing_macos_build_artifact`.
# Emulator Sync Proof

The current harness can discover Android emulators and produce a deterministic conflict/convergence plan. That is not a device-sync pass.

It remains `BLOCKED` until a real Utopia app execution receipt proves multi-install writes, partition, reconnect, rollback, and convergence. Booting two emulators alone must never turn this gate green.
