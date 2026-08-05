# Play Store Launch Readiness

Status: preparing, not release-ready.

## Metadata

Title:

```text
Utopia
```

Short description:

```text
Local-first app runtime for personal tools and trusted app packages.
```

## Data Safety Draft

If telemetry is enabled, disclose:

- app interactions;
- diagnostics or analytics events;
- approximate product usage only;
- no API keys, tokens, or secrets;
- no user records;
- no prompts;
- no files/audio contents;
- no contacts;
- no health data;
- no location trails;
- no sale of personal/sensitive data.

If accounts or hosted sync are enabled later, update this before release.

## Required Before Production Track

- Privacy policy URL.
- Account/data deletion URL if accounts exist.
- Release AAB signed with production key.
- Android App Links verified with release cert fingerprint.
- Cloudflare SSL/TLS set to Full (strict) before any public install links are advertised.
- Screenshots updated for platform runtime, not Food-only.
- `npm run doctor`
- `npm run export:android`
- `npm run release:proof:signed-android`
- `npm run release:proof:physical-device`

## Current Boundary

Do not claim production release readiness until signed artifact and physical-device evidence are current.
# Play Store Launch Readiness

`npm run check:shared-state-sync` is deterministic local proof only. It does
not prove real multi-device synchronization; that stays blocked until a real
provider and two devices complete the live conflict/reconnect scenario.
