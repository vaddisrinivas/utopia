# Release Security

Scope: local release supply chain for Android and exported bundles.

Rules:

- Do not claim release readiness unless the evidence files are current.
- Keep checksums, signing proof, and provenance tied to the same git head.
- Do not require secret material to produce local evidence.
- Keep signed artifacts paired with changelog, privacy notes, and migration notes.

Local export gates:

- `npm run config:validate`
- `npm run typecheck`
- `npm run doctor`
- `npm run export:web`
- `npm run export:android`
- `npm run check:ios-export`
- `npm run phase3:check:chat-send`
- `npm run phase3:check:chat-rollback-idempotency`

Release proof gates:

- `npm run release:proof:exports`: local web, Android, and iOS export proof. No signing claim.
- `npm run release:proof:signed-android`: real release-signed APK plus signed AAB. Must block on debug/unsigned artifacts.
- `npm run release:proof:physical-device`: real-device install, launch, and basic-flow proof. Must block until evidence exists.
- `npm run release:proof:all`: full proof chain. Expected to block until signed Android and physical-device evidence are real.

Supply-chain evidence:

- Android artifact proof: `app/build/evidence/android-release-artifacts.json`
- Android build receipt: `app/build/evidence/android-release-build-receipt.json`
- iOS export proof: `app/build/evidence/ios-export.json`
- Physical-device proof: `app/build/evidence/physical-device-release.json`
- Release supply-chain manifest: `app/build/evidence/release-supply-chain.json`

Physical-device evidence must not contain raw device serials, tokens, signing keys, API keys, or passwords.

Helper:

- `npm run release:supply-chain`

Optional local inputs:

- `RELEASE_SBOM_PATH`
- `RELEASE_PROVENANCE_PATH`
- `RELEASE_MIGRATION_NOTES_PATH`
