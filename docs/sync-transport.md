# Sync Transport Evaluation

## Scope

- Capture a vendor-neutral sync transport port contract for sync adapters.
- Evaluate PowerSync adapter compatibility against the existing shared-state sync proof contract.
- Keep all local deterministic evidence in scope.
- Never claim live multi-device sync proof from local tests.

## Contract boundary

The transport boundary for this lane is defined in:

- `packages/shared/contracts/sync-transport.ts` (`SYNC_TRANSPORT_SCHEMA_VERSION`)
- `packages/shared/contracts/` for sync operation shape and records constraints.

Current local contract shape:

- `transport.kind = vendor-neutral-operation-stream`
- `readiness.localDeterministic.status = PASS`
- `readiness.liveProviderDevice.status = BLOCKED`
- `readiness.liveProviderDevice.requiredNextProof` contains `real installations/devices`

## PowerSync boundary (documentation assessment)

- Evaluation is explicit and bounded to existing sync contract results.
- PowerSync mapping is an adapter assessment, not a live proof.
- `syncPort.status` for PowerSync is currently `BLOCKED` while local deterministic checks are `PASS`.

### PowerSync facet map (current)

| Facet | Verdict |
| --- | --- |
| append_operations | supported |
| tombstones | shim-required |
| cursor_checkpoint | shim-required |
| conflict_manual_review | shim-required |
| offline_replay | supported |

## Lane execution (local only)

1. Generate deterministic shared-state proof (`app/build/evidence/shared-state-sync-proof.json`).
2. Run `scripts/quality/check-sync-transport.mjs`.
3. Publish `app/build/evidence/sync-transport-evaluation.json`.

## Blocking rules

- `liveProviderDevice = BLOCKED` is required by design because proof is limited to local deterministic scenarios.
- Multi-device real installation proof (`real installations/devices`) is still required and not yet complete.

## Non-goals

- Do not assert hosted multi-device proof.
- Do not claim device or service-level sync behavior.
- Do not edit runtime providers/server adapters in this lane.
