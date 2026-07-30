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

Still required before public release:

- deploy Cloudflare Worker;
- configure release Android fingerprint for App Links;
- configure iOS Team ID for Universal Links;
- publish privacy policy URL;
- copy local publisher token into Cloudflare `PUBLISHER_TOKEN` and GitHub `UTOPIA_REGISTRY_PUBLISHER_TOKEN` only when ready;
- fill Google Play Data safety from actual telemetry behavior;
- run signed Android release proof;
- run physical-device proof;
- run one end-to-end Custom GPT package publish and install.

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
