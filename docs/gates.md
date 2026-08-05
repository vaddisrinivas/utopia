# Gates

- `scripts/gates/dev-fast.sh`: edit-loop checks only; includes widget catalog budget check (`npm run check:widget-catalog`), audio-loop source roundtrip, package compiler, Audio Loop intent/recorder/persistence/state/contract, and chat rollback/send checks; use this for quick signal, not release proof.
- `npm run check:audio-loop`: parser and presentation proof gate; it includes `check:audio-loop-intent` (intent/media-session parser assertions in `tests/platform/audio-loop-intent.test.ts`) and is parse-only proof (no Android Google Assistant or media-session runtime/device assertions).
- `scripts/gates/release-local.sh`: local completion gate; runs the repo completion checks from `AGENTS.md` that are feasible on a workstation.
- Both wrappers use `npx` for binaries so they stay runnable even before local node modules are installed.
- `scripts/quality/check-widget-catalog-env-assertions.mjs`: minimal runtime assertions for `UTOPIA_MAX_DOMAIN_WIDGETS` default (7) and overridden values.
- `check:live-provider-readiness` (`npm run check:live-provider-readiness`) validates Notion and Google Sheets live-proof readiness without calling live APIs: it reports required env present/missing per provider, disposable lane guard status, and concrete proof commands.

## Proof vs history

- The `scripts/quality/*` files are proof/evidence checks and historical validators.
- `check:shared-state-sync` (`npm run check:shared-state-sync`) is a local deterministic shared-state merge/recovery proof and does not prove live multi-device sync service behavior.
- The produced evidence includes `live_multi_device_sync_claims`, with
  `readiness.local_deterministic=PASS` and
  `readiness.live_provider_device=BLOCKED` to make local PASS and live proof
  status explicit.
- The gate wrappers above are the preferred entry points for day-to-day validation.
- A passing historical artifact does not replace a fresh local gate run.
