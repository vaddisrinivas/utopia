# Launch Readiness

Goal: prepare Utopia for official launch without claiming release proof early.

## External Builder/Publisher Surface

- Implemented:
  - hosted registry publish API docs and schema
  - package-builder skill contract and safety policy
  - Custom GPT publish instructions and action payload contract
  - launch-readiness checker script
- Parked:
  - GitHub Pages builder workflow
  - drag/drop builder
  - public package marketplace browsing

## Ready Now

- Package-only app proof exists.
- Hosted registry scaffold exists.
- Custom GPT action spec exists.
- GitHub app factory hosted publish is opt-in and skipped by default.
- Local long publisher token exists outside the repo.
- Utopia install links support:
  - `utopia://install?url=...`
  - `https://utoia.thetechcruise.com/install?url=...`
- Telemetry contract blocks records, prompts, keys, files, audio, health, contacts, and location.
- Play Store metadata is runtime-oriented, not Food-only.

## Not Launching Today

Still required before public launch. Blockers are fail-closed and listed with required actions.

- App Link + Universal Link config:
  - Set production values in `cloudflare/wrangler.toml`:
    - `IOS_APP_ID = "REPLACE_WITH_YOUR_IOS_TEAM_ID.app.utopia"` in `[vars]`
    - `ANDROID_SHA256_CERT_FINGERPRINT = "REPLACE_WITH_ANDROID_SHA256_CERT_FINGERPRINT"` in `[vars]`
  - Keep staging explicit too under `[env.staging.vars]`.
  - Copy the same app ID and fingerprint format used in store release signing.
- Privacy policy URL:
  - Set `app.json` field `expo.privacyPolicy` to a public HTTPS URL, or set env var `UTOPIA_PRIVACY_POLICY_URL`.
  - Do not leave this empty. Store links must resolve in browser without auth.
- App signing proof:
  - Run:
    - `BUILD_RELEASE_ARTIFACTS=1 npm run release:proof:signed-android`
  - Keep fresh valid files in:
    - `app/build/evidence/android-release-artifacts.json`
    - `app/build/evidence/android-release-build-receipt.json`
  - Both files must report successful status for launch checks to clear.
- Publisher + registry launch prep:
  - Copy local publisher token into Cloudflare `PUBLISHER_TOKEN` and GitHub `UTOPIA_REGISTRY_PUBLISHER_TOKEN` only when ready.
  - run `./scripts/gates/release-proof-signed-android.sh` and `./scripts/gates/release-proof-physical-device.sh` as gated checks.
- deploy Cloudflare Worker:
  - Set `CLOUDFLARE_API_TOKEN` and run registry publish per `docs/cloudflare-registry-launch.md`.
  - Do not enable write mode until all above blockers are cleared.

## Live Proof Boundaries

- Notion disposable Food proof passed on 2026-07-30. Evidence:
  `app/build/evidence/live-workspace/notion_scenarios-1785373741.json`.
- Repeatable Notion proof still needs a persistent disposable-target configuration
  in the private environment; no production or personal target is ever used.
- Google Sheets live proof is blocked until a disposable
  `GOOGLE_SHEETS_TEST_SPREADSHEET_ID`, an account id, disposable-provider
  authorization, and an explicit live-provider acknowledgement are configured.
- `npm run check:shared-state-sync` proves deterministic local conflict, merge,
  recovery, and restart behavior only. Real multi-device/provider sync remains
  blocked until two real devices use a real shared provider and capture the
  agreed conflict/reconnect evidence.

Readiness evidence: `app/build/evidence/live-provider-readiness.json` and
`app/build/evidence/shared-state-sync-proof.json`.

## Best Public Loop

```text
Custom GPT creates package
Cloudflare stores package
Utopia opens install link
Utopia validates and previews
User approves install
Telemetry records only product-level events
```

## Parked For Later

- GitHub Pages static builder.
- Drag/drop builder.
- public package marketplace browsing;
- reviews/ratings;
- accounts;
- donations;
- hosted sync commercialization.
