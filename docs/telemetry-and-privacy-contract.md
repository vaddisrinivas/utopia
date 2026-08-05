# Telemetry And Privacy Contract

Goal: learn which packages people use, where installs fail, and whether packages are useful, without collecting personal app data.

## Allowed Events

Defined in `packages/shared/contracts/telemetry.ts`:

- `package_created`
- `install_previewed`
- `install_blocked`
- `package_installed`
- `package_opened`
- `package_uninstalled`
- `capability_blocked`
- `feedback_submitted`

Allowed fields:

- anonymous installation id;
- event name;
- timestamp;
- package id;
- package version;
- source;
- rating;
- short tags.

Allowed field list is enforced by `collectTelemetryEventIssues`; any additional top-level fields are rejected.

## Ingestion Controls

- Ingestion is disabled by default.
- Opt in in Cloudflare Worker with:
  - `TELEMETRY_INGEST_ENABLED=true`
  - `TELEMETRY_INGEST_TOKEN=<shared token>`
- `POST /v1/events` requires `x-utopia-telemetry-token` matching the token above.
- That token is trusted-ingress only. It must never ship in a native app, web bundle, package JSON, Custom GPT action, or fork. Client telemetry stays disabled until the registry can issue per-install, short-lived credentials.
- Payloads are rejected when they exceed `UTOPIA_TELEMETRY_MAX_EVENT_BYTES`.
- Rate limit is enforced per `anonymousInstallationId` (5 events / 60s window in worker).
- Missing, short, or mismatched tokens are rejected.

## Forbidden Data

Never collect:

- records;
- prompts;
- API keys;
- tokens;
- secrets;
- audio;
- files;
- health data;
- contacts;
- location trails;
- email;
- phone.

Forbidden data checks apply to both install-time telemetry and install/publish disclosure contracts.

Nested payloads are recursively checked for forbidden keys as well.

## Install / Publish Disclosures

- Install disclosures: `installDisclosures` in `packages/shared/contracts/package-install.ts`.
- Publish disclosures: `publishDisclosures` in `packages/shared/contracts/package-install.ts`.
- Disclosure strings are user-facing and must be shown before approval or publish submission.

The test file `tests/contracts/telemetry.test.ts` blocks these shapes.

## Product Questions This Can Answer

- Which generated apps are opened most?
- Which packages fail install review?
- Which capabilities are blocked most?
- Which sources create useful apps?
- Which app types get uninstalled?
- What feedback rating do users give a package?

## Play Store Notes

Once telemetry is enabled, Google Play Data safety must disclose it. Keep store answers, privacy policy, and this contract aligned.

## Launch Boundary

The current Worker endpoint is ready for a trusted server-side relay, not direct public-client ingestion. A static bearer token in an app can be extracted and is not abuse protection. Before enabling direct app telemetry, add per-install short-lived credentials, replay protection, and a server-side issuance boundary; until then, keep `TELEMETRY_INGEST_ENABLED` unset.

If hosted accounts or sync are added later, update this contract before release.
