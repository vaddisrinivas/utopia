# Utopia Current Risk Register

Date: 2026-07-31
Code reviewed through: `0b340b1`
Documentation refresh: `2f67b63`

Companions:

- Complete tracked-file inventory:
  `docs/CODEBASE_FILE_SCOPE_INDEX_2026-07-30.md`
- Historical `bf0efff` audit:
  `docs/archive/CODEBASE_DEEP_REVIEW_BASELINE_BF0EFFF_2026-07-30.md`

## Current Verdict

At `2f67b63` plus the current uncommitted hardening set, Utopia has a
substantial, locally verified package runtime. The recommended next claim is:

> Closed Android beta for local-first package apps with private/unlisted hosted
> installation.

Sharing, web/macOS parity, public marketplace publishing, and ten-minute
self-service creation remain experimental until separately proven.

The historical audit is not a list of current defects. Counts and file totals
live in the companion inventory; they are not quality evidence.

Evidence labels used here:

- `SOURCE`: current source inspection.
- `UNIT`: focused automated test.
- `INTEGRATION`: multiple runtime components with a real local dependency.
- `EXPORT`: platform export/build.
- `EMULATOR`, `DEVICE`, `LIVE`, `EXTERNAL_USER`: observed execution evidence.

Statuses:

- `OPEN`: current defect or missing required implementation.
- `PARTIAL`: implementation exists but an important behavior or proof is absent.
- `FIXED_VERIFIED`: current behavior is reproduced by an appropriate test.
- `FIXED_SOURCE_ONLY`: source and local gates pass; advertised runtime proof is absent.
- `BLOCKED_EXTERNAL`: implementation is ready but the required external execution has not run.
- `ACCEPTED_BOUNDARY`: deliberately unsupported and accurately disclosed.
- `SUPERSEDED`: historical finding replaced by a different current risk.

## Open Findings

| ID | Severity | Status | Subsystem | Current evidence | Remaining gap |
|---|---|---|---|---|---|
| C-01 | P1 | `FIXED_SOURCE_ONLY` | Audio recording | Installed Expo Audio recorder lifecycle and permission handling are covered by focused tests | Prove record, save, rename, restart, and replay on Android, or omit recording from the beta claim |
| C-02 | P1 | `FIXED_VERIFIED` | Privacy/defaults | Private workspace defaults and the one-off private setup script are removed; focused scans and settings tests pass | Scrub distributable history before a public source release if those identifiers existed in published commits |
| C-03 | P1 | `PARTIAL` | Browser credentials | Recursive storage redaction, strict registry CSP/security headers, credential-free CORS, URL rejection, and redaction tests pass | PKCE and secure server-side `HttpOnly` sessions remain required before a web beta |
| C-04 | P1 | `PARTIAL` | Recovery | Shell-neutral staged activation validates, migrates, integrity-checks, reopens, verifies, and rolls back under injected failures | Wire the activation port to Expo SQLite/filesystem and run Android interruption/storage tests |
| C-05 | P1 | `PARTIAL` | Registry publication | Incomplete writes are hidden; publication states, retries, reconciliation/GC, admin isolation, and failure tests pass | Use a Durable Object before multiple or public publishers; one controlled private publisher may remain token-gated |
| C-06 | P1 | `PARTIAL` | Network sync | Localhost HTTP relay proof exercises distinct clients, offline conflict, reconnect, and deterministic convergence | Production transport and real-shell execution remain unproven; do not advertise family/group sync |
| C-07 | P1 | `BLOCKED_EXTERNAL` | Shell parity | `tasks/todo.md:44-49` lists missing web, Android x2, and macOS runtime receipts | Execute the same lifecycle through real shells and retain Git-bound receipts |
| C-08 | P2 | `FIXED_VERIFIED` | Product URLs | Bundled packages use a reserved internal source intercepted locally; tests prove no network fetch | Public registry URLs remain a separate deployment concern |
| C-09 | P2 | `PARTIAL` | Creator UX | Dumb, moderate, and hostile agents run in isolated bounded workspaces through schema, compiler, approval, migration, and install checks | This is automated-agent evidence only; human usability remains unmeasured |
| C-10 | P2 | `FIXED_SOURCE_ONLY` | Consent identity | Grant identity now includes installation, publisher, package, capability, scope, purpose, and schema; same-version checksum drift is tampering | Wire publisher/purpose metadata into the live widget path; default remains fail-closed re-consent |

Current active count: **P0 0, P1 5, P2 1, P3 0**. This counts only
`OPEN`, `PARTIAL`, and `BLOCKED_EXTERNAL` rows above.

## Reproduction and Verification

| IDs | Command or procedure | Current result | Why green gates are insufficient |
|---|---|---|---|
| C-01 | `npm run check:audio-loop` plus Android record-restart-replay | Installed API contract passes; runtime scenario absent | Node tests cannot prove microphone, file ownership, interruption, or replay |
| C-02 | Private-identifier scan plus `tests/settings/utopia-settings.test.ts` | Local source/default checks pass | Public history cleanup is a separate release procedure |
| C-03 | Settings and registry security tests plus browser storage/URL/console inspection | Redaction, CSP, URL policy, and cache/CORS tests pass | Unit tests do not provide OAuth/PKCE or secure server-session evidence |
| C-04 | `tests/db/recovery-activation.test.ts` plus Android kill/storage-exhaustion fault injection | Port/state-machine tests pass; real adapter absent | Injected ports do not prove SQLite file activation on Android |
| C-05 | `tests/platform/registry-worker.test.ts` with parallel writes and injected R2 failures | Publication lifecycle tests pass | R2 conditional locking is unavailable; Durable Objects are required for strict multi-writer serialization |
| C-06, C-07 | `npm run proof:golden-loop` with a real relay and real shell receipts | `BLOCKED` | Local deterministic receipts are not live transport or app execution |
| C-08 | Install bundled packages with a fetch spy | Local sentinel source passes without network access | Bundled sources are intentionally not shareable public URLs |
| C-09 | Constrained-agent harness; separately, target-user session | Automated agents pass; human session not run | Agents measure contract clarity, not novice usability |
| C-10 | Consent ledger and broker regression suites | Authorization/integrity separation passes locally | Live runtime metadata wiring and shell revocation remain |

## Remediation Verification

| Historical finding | Status | Remediation | Evidence | Remaining proof |
|---|---|---|---|---|
| Native consent not enforced | `FIXED_SOURCE_ONLY` | `0b340b1` | Broker requires declaration plus persisted decision at `src/presentation/widgets/package-capability-broker.ts:149-186`; hostile consent tests pass | Native revocation through a real shell |
| Package-supplied key treated as trusted | `FIXED_SOURCE_ONLY` | `0b340b1` | Install preview distinguishes untrusted package keys at `packages/shared/contracts/package-install.ts:540-612`; trust-root tests pass | Root rotation and rollback against the deployed registry |
| Foreign-key migration control inside transaction | `FIXED_VERIFIED` | `0b340b1` | FK lifecycle moved around migration transactions at `src/db/migrations.ts:1022-1096`; migration tests pass | Device interruption matrix belongs to recovery work |
| Backup silently converts table failures to empty data | `FIXED_VERIFIED` | `0b340b1` | Recovery export/import fails closed and validates manifests/checksums; recovery tests pass | Versioned-file activation remains C-04 |
| Core imports UI/native dependencies | `FIXED_SOURCE_ONLY` | `0b340b1` | Core port and dependency-boundary gates pass | Cross-shell runtime conformance |
| Dependency boundary gate false-passes | `FIXED_VERIFIED` | `0b340b1` | Boundary scanner now fails closed and is part of local gates | None for this finding |
| Debug bridge in release graph | `FIXED_SOURCE_ONLY` | `0b340b1` | `metro.config.js:12-17` aliases release builds to a no-op; exclusion scan/test pass | Signed release bundle scan |
| Install fetch unbounded | `FIXED_VERIFIED` | `0b340b1` | 10-second and 1 MiB limits at `src/domain/package-install.ts:32-33,561-615`; focused tests pass | None for this finding |
| Registry manifest drops signature metadata | `FIXED_VERIFIED` | `0b340b1` | Hosted metadata carries signatures and publication integrity revalidates all components | Live deployed registry round trip |
| Renderer/server entrypoint concentration | `PARTIAL` | `0b340b1` | Renderer families and chat repository/service/routes were extracted; size ratchets pass | Continue only when ownership or change-risk evidence justifies another split |

## Beta Blockers by Release Profile

| Requirement | Android beta | Web beta | Cross-platform beta | Evidence |
|---|---:|---:|---:|---|
| Consent and publisher trust | Yes | Yes | Yes | Integration plus hostile-package tests |
| Safe migrations and recovery | Yes | Yes | Yes | Real SQLite corruption/interruption matrix |
| Debug bridge absent | Yes | N/A | Yes | Release bundle scan; signed build for store beta |
| Browser credential safety | No | Yes | Yes | Browser storage, CSP, OAuth, and redaction tests |
| Audio recording | Only if advertised | Only if advertised | Only if advertised | Real shell recording and restart |
| Sharing/sync | Only if advertised | Only if advertised | Yes | Two-writer offline/reconnect proof |
| macOS parity | No | No | Yes | Real macOS shell receipt |
| Creator under ten minutes | Only if advertised | Only if advertised | Only if advertised | Unaided target-user session |
| Hosted registry publication | Only if enabled | Only if enabled | Only if enabled | Concurrency and failure-injection tests |

## Public Beta Trust/Release Posture

Public beta is **not open** until every item below has a fresh evidence artifact
from the committed tree:

| Gate | Current status | Evidence/next action |
|---|---|---|
| Capability consent and publisher purpose | PASS | Broker/ledger tests require explicit publisher, purpose, checksum, version, and revocation handling |
| Private registry writes | PASS local | Token-gated and fail-closed locally; public writes remain disabled |
| Debug bridge exclusion | PASS local Android release | Throwaway signed release scan passes; Play signing proof still separate |
| Web shell receipt | PASS local | `app/build/evidence/golden-loop/web-execution-receipt.json` |
| macOS shell receipt | PASS local | `app/build/evidence/golden-loop/macos-lane-c-receipt.json` |
| Android x2 shell receipt | STALE | Earlier emulator receipts pass, but must be regenerated for current package checksum/run id |
| Strict multi-surface aggregate | BLOCKED | Re-run Android x2, then `node scripts/quality/golden-loop/check-multi-surface-receipts.mjs` |
| Clean checkout | BLOCKED until commit | Commit current tree, then run `npm run check:clean-checkout` |
| Public beta release | BLOCKED | Requires all above plus final configured release gates |

## Ordered Work

1. Run the integrated consent, trust, recovery, registry, settings, Audio Loop,
   creator-agent, and package-install suites.
2. Wire publisher and declared-purpose metadata into live capability requests.
3. Wire recovery activation to the Android Expo SQLite/filesystem shell.
4. Pin release-gate tooling; remove mutable `npx --yes` downloads from blocking
   gates. Keep TypeScript 7 isolated.
5. Build the release Android bundle and run debug-bridge exclusion scanning.
6. Prove Audio Loop record, save, rename, restart, and replay on Android, or
   mark recording unsupported for the beta.
7. Run one signed Android Golden Loop: generate, private publish, install,
   write, update/migrate, rollback, uninstall-with-data, restore, verify SQLite.
8. Open the closed beta only after that evidence bundle passes.

Do later, when the matching claim is enabled:

- Web PKCE and secure server sessions before web beta.
- Durable Object registry serialization before multiple/public publishers.
- PowerSync evaluation and real multi-device proof before family/group sync.
- Maestro flows and an unaided creator study before advertising ten-minute
  self-service creation.
- TUF.js root rotation/delegation before a public multi-publisher marketplace.
- Server/package-install/migration file splits only when ownership or
  change-risk evidence justifies them.

## Public-Beta Rule

Track A is mandatory. Track B is mandatory only for capabilities and surfaces
the beta advertises. Track C requires bounded safety gates, not completion of
every architectural refactor.

No local test, export, emulator, live service, physical device, or external-user
result may be reported as another evidence class.
