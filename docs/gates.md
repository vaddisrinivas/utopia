# Gates

- `scripts/gates/dev-fast.sh`: edit-loop checks only; use this for quick signal, not release proof.
- `scripts/gates/release-local.sh`: local completion gate; runs the repo completion checks from `AGENTS.md` that are feasible on a workstation.
- Both wrappers use `npx` for binaries so they stay runnable even before local node modules are installed.

## Proof vs history

- The `scripts/quality/*` files are proof/evidence checks and historical validators.
- The gate wrappers above are the preferred entry points for day-to-day validation.
- A passing historical artifact does not replace a fresh local gate run.
