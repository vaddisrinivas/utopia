# Utopia Cloudflare Registry

Purpose: store generated Utopia package JSON, return install links, and collect privacy-limited product telemetry.

Not a trust authority. The app still validates schema, checksum, capabilities, publisher trust, and user approval before install. The registry does enforce signed admission for enabled writes.

## Stack

- Worker: API and install landing page.
- R2 `PACKAGES`: immutable package JSON blobs plus `registry/index.json`.
- Analytics Engine `TELEMETRY`: allowlisted product events only.
- Custom domain: `utoia.thetechcruise.com`.

No D1 in v0.

## Setup

```bash
cd cloudflare
npx wrangler r2 bucket create utopia-packages
```

Deploy staging first. It is read-only because `REGISTRY_WRITE_MODE=disabled`.

For iOS Universal Links, replace `IOS_APP_ID` with `TEAMID.app.utopia`.

## API

```text
POST /v1/packages
GET  /p/:id.json
GET  /v1/packages/:id
GET  /v1/registry.json
POST /v1/events
GET  /install?url=<package-url>
GET  /.well-known/assetlinks.json
GET  /.well-known/apple-app-site-association
```

`POST /v1/packages` is disabled by default. When explicitly enabled in signed mode, it requires:

```text
Authorization: Bearer <PUBLISHER_TOKEN>
Content-Type: application/json

Body (JSON):
  package: <validated package object>
  source: custom_gpt | github_factory | browser_builder | registry
  visibility: unlisted | public
  publish: true (required for source=github_factory)
  signature: ECDSA P-256 signature over canonical package JSON
```

Use a long random token. Local development token is stored at:

```text
/Users/srinivasvaddi/.config/utopia/registry-publisher-token.env
```

Hosted publish is explicit and opt-in. The worker rejects `github_factory` publish requests missing `publish: true`.

See [registry package signing](../docs/registry-package-signing.md) for local-key creation, public-key upload, and the staged enablement sequence.

Cloudflare dashboard settings before public use:

- SSL/TLS: Full (strict).
- Always Use HTTPS: enabled.
- Minimum TLS: 1.2 or stricter.
- Rate limit `POST /v1/packages`.
- Rate limit `POST /v1/events`.

Response includes:

```json
{
  "install_url": "utopia://install?url=https%3A%2F%2Futoia.thetechcruise.com%2Fp%2Fabc.json",
  "web_url": "https://utoia.thetechcruise.com/install?url=https%3A%2F%2Futoia.thetechcruise.com%2Fp%2Fabc.json"
}
```

## Launch Rule

Do not turn on public listing until:

- package install preview is green;
- capability broker gates native powers;
- telemetry redaction tests pass;
- Android App Links use the release cert fingerprint;
- privacy policy and Play Data safety answers match the telemetry contract.
