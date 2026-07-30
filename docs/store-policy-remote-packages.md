# Store Policy: Remote Utopia Packages

Status: allowed with constraints.

Date checked: 2026-07-29.

Sources:

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play User Data policy: https://support.google.com/googleplay/android-developer/answer/10144311

## Classification

Utopia packages are:

- data/config;
- UI schema;
- collection/query/workflow rules;
- capability declarations;
- not executable code.

Utopia packages must not include:

- JavaScript, native code, bytecode, scripts, or downloaded executable modules;
- hidden paid content unlocks;
- bypasses around app review for native device powers;
- secrets, API keys, tokens, user records, files, audio, health data, contacts, or location trails.

## Apple Boundary

Verdict: allowed with constraints.

The safe position is:

- remote packages are data-driven app configuration, not downloaded executable code;
- Utopia's reviewed binary owns every native capability;
- every install/update is user reviewed;
- native powers are brokered, denied by default, and bound to the installed package;
- packages cannot expose unreviewed native APIs directly;
- public registry listings must not become a hidden store for paid digital goods.

Do not launch iOS remote package distribution until install preview, rollback, package receipts, and capability broker enforcement are demonstrably green.

## Google Play Boundary

Verdict: allowed with constraints.

Google Play requires accurate Data safety disclosure. The launch shape must disclose telemetry collection if enabled. Data safety must cover the whole distributed app, not only bundled packages.

Required posture:

- valid privacy policy in app and store listing;
- accurate Data safety form;
- HTTPS for data in transit;
- prominent in-app disclosure before unexpected sensitive data access;
- runtime permission prompts before Android-gated data access;
- no sale of personal/sensitive data;
- account/data deletion path if accounts or hosted data are enabled.

## Launch Rule

Hosted registry and Custom GPT package creation can be prepared now.

Public launch remains blocked until:

- capability broker tests pass;
- trust preview tests pass;
- install/update/rollback/uninstall tests pass;
- telemetry redaction tests pass;
- one generated package installs from the hosted registry safely;
- Play Data safety answers and privacy policy are updated from the actual telemetry contract.
- hosted registry publishing remains explicit opt-in and has not been treated as automatically deployed.
