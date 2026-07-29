# Platform Release Contract

Scope: local platform release lanes for this repo slice.

This document defines the shared release flow and the evidence folders that back each lane.

## Contract

- Keep release checks local and credential-free by default.
- Keep the release path deterministic: same git head, same inputs, same exported outputs.
- Do not treat a platform export as release proof until the matching evidence file exists.
- Keep chat/runtime contract checks in the shared preflight so platform lanes do not drift.
- Do not require Expo UI edits to satisfy this contract.

## Shared Flow

1. Preflight the repo state.
2. Run the shared chat/runtime checks.
3. Run local export proof for web, Android bundle export, and iOS bundle export.
4. Run cross-platform parity proof for app identity, install route, package runtime source, and exported bundles.
5. Run signed Android proof only when release signing artifacts exist.
6. Run physical-device proof only against a real device.
7. Review the export output and evidence together.

## Shared Preflight

- `npm run config:validate`
- `npm run typecheck`
- `npm run doctor`
- `npm run phase3:check:chat-send`
- `npm run phase3:check:chat-rollback-idempotency`

## Platform Lanes

### Web

- Export command: `npm run export:web`
- Export output: `dist/web/`

### Android

- Export command: `npm run export:android`
- Export output: `dist/android/`
- Local export proof: `npm run release:proof:exports`
- Cross-platform export parity: `npm run release:proof:cross-platform`
- Release evidence:
  - `app/build/evidence/android-release-artifacts.json`
  - `app/build/evidence/android-release-build-receipt.json`
  - `app/build/evidence/cross-platform-behavior-parity.json`
- Signed release proof: `npm run release:proof:signed-android`
- Signed release rule: this gate must fail until the APK is release-signed and the AAB is signed. Debug signing is not release proof.

### iOS

- Export command: `npm run export:ios`
- Export validator: `npm run check:ios-export`
- Export output: `dist/ios/`
- Local export proof: `npm run release:proof:exports`
- Release evidence:
  - `app/build/evidence/ios-export.json`

### Physical Device

- Proof command: `npm run release:proof:physical-device`
- Collector command: `npm run release:collect:physical-device`
- Evidence: `app/build/evidence/physical-device-release.json`
- Required status: `passed`
- Required proof id: `utopia_physical_device_release`
- Required claims:
  - app installed on a real device;
  - app launch verified;
  - basic flow verified;
  - evidence matches the current git head/tree/dirty hash.
- Forbidden evidence: raw device serials, tokens, API keys, signing passwords.
- Blocker rule: if this evidence is missing, stale, failed, or writes a raw device serial, physical release proof is blocked.

## Shared Evidence Folders

- `app/build/evidence/`
- `app/build/evidence/live-workspace/`
- `app/build/evidence/android-release-artifacts.json`
- `app/build/evidence/android-release-build-receipt.json`
- `app/build/evidence/ios-export.json`
- `app/build/evidence/physical-device-release.json`
- `app/build/evidence/cross-platform-behavior-parity.json`
- `app/build/evidence/release-readiness.json`
- `app/build/evidence/release-supply-chain.json`

## Lane Rules

- Web lane must prove a fresh web export before release review.
- Android export lane must prove the exported bundle is current.
- Cross-platform parity must prove shared app identity and exported bundles for web, Android, and iOS. This is not a substitute for physical-device proof.
- Android signed lane must separately prove release signing. It may not pass from debug-signed artifacts.
- iOS lane must prove the export metadata and bundle match the current git head.
- Physical-device lane must separately prove install, launch, and one basic flow on real hardware.
- If a lane needs secret-backed signing or device access, keep that separate from local export proof.

## Wrapper Contract

These wrappers are convenience entry points only:

- `scripts/gates/platform-web.sh`
- `scripts/gates/platform-android.sh`
- `scripts/gates/platform-ios.sh`
- `scripts/gates/release-proof-exports.sh`
- `scripts/gates/release-proof-signed-android.sh`
- `scripts/gates/release-proof-physical-device.sh`

They should only call existing local commands and should not fetch credentials or mutate remote state.
