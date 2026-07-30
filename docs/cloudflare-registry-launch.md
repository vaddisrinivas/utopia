# Cloudflare Registry Launch Plan

Decision: use Cloudflare for the product backend. GitHub Pages is optional later for docs or a static builder UI.

## Why Not GitHub Pages Alone

GitHub Pages is enough for:

- docs;
- examples;
- static builder UI;
- public schema browser.

GitHub Pages is not enough for:

- authenticated package publishing;
- storing arbitrary generated packages;
- telemetry;
- moderation;
- private/unlisted packages;
- install counts;
- rate control;
- deletion workflows.

## MVP Loop

```text
Custom GPT
  -> generates Utopia package JSON
  -> POSTs package to hosted registry
  -> receives install link

User taps link
  -> Utopia opens install preview
  -> schema/checksum/capability/trust review
  -> user approves
  -> app installs locally
```

## Hosted Stack

```text
utoia.thetechcruise.com
  Cloudflare Worker: API, install page, app-link files
  R2: immutable package JSON blobs plus registry/index.json
  Analytics Engine: allowlisted product events
```

No D1 in v0. R2 is enough until we need accounts, moderation queues, search, or publisher dashboards.

## API

```text
POST /v1/packages
GET  /p/:id.json
GET  /v1/packages/:id
GET  /v1/registry.json
POST /v1/events
GET  /install?url=<package-url>
```

### Publish Metadata Lifecycle

- `POST /v1/packages` is disabled unless `REGISTRY_WRITE_MODE=signed` is set explicitly.
- In signed mode every publish needs both a valid `authorization: Bearer <token>` and an ECDSA P-256 signature from a key in `REGISTRY_PUBLISHER_KEYS_JSON`.
- The signature covers canonical package JSON, has a 15-minute freshness window, and is stored with immutable package metadata.
- Registry writes are immutable by package blob ID (derived from package checksum); replaying the same package returns existing install metadata, while lifecycle changes (visibility/source drift) are rejected.
- `registry/packages/<id>.json` records include explicit labels:
  - `generated` (always present)
  - `unlisted` (present when visibility is unlisted)
- `/v1/registry.json` reads only schema-valid entries from `registry/index.json`; malformed rows are ignored (fail-closed metadata behavior).

Default package visibility is `unlisted`.

## Install Link

```text
utopia://install?url=https%3A%2F%2Futoia.thetechcruise.com%2Fp%2Fabc123.json
```

Fallback web link:

```text
https://utoia.thetechcruise.com/install?url=https%3A%2F%2Futoia.thetechcruise.com%2Fp%2Fabc123.json
```

## Cloudflare Setup

```bash
cd cloudflare
npx wrangler r2 bucket create utopia-packages
```

```bash
npx wrangler secret put PUBLISHER_TOKEN
npx wrangler secret put REGISTRY_PUBLISHER_KEYS_JSON
npx wrangler deploy
```

Keep `REGISTRY_WRITE_MODE="disabled"` for staging and launch preparation. To permit signed publishing later, generate a local ECDSA P-256 key with `node scripts/registry/create-signing-key.mjs`, upload only its public SPKI value in the publisher-key map, then deploy `REGISTRY_WRITE_MODE="signed"`. The private key stays outside the repository. `node scripts/registry/sign-package.mjs` creates the signed publish envelope.

Set `IOS_APP_ID` in `cloudflare/wrangler.toml` before iOS launch.

Local publisher token file:

```text
/Users/srinivasvaddi/.config/utopia/registry-publisher-token.env
```

Do not paste the token or private signing key into docs or commits. For GitHub Actions, store the token as:

```text
UTOPIA_REGISTRY_PUBLISHER_TOKEN
```

## GitHub Factory Publish

The app factory workflow uploads artifacts by default. Hosted publish is opt-in and is not treated as automatically deployed.

Default:

```text
publish_to_registry=false
```

Opt in only when ready:

```text
workflow_dispatch -> publish_to_registry=true
```

The workflow summary warns users:

- package JSON will be sent to `utoia.thetechcruise.com`;
- visibility is `unlisted`;
- Utopia still reviews before install;
- users can leave publish disabled.

Forks will not get the publisher token unless the fork owner adds their own secret.
Forks also need their own authorized signing key; a token by itself cannot publish.

## Telemetry Ingestion

`POST /v1/events` is disabled by default. Enable it only with:

```text
TELEMETRY_INGEST_ENABLED=true
TELEMETRY_INGEST_TOKEN=<shared token>
```

`TELEMETRY_INGEST_TOKEN` is a trusted-ingress secret, not a mobile or browser client secret. Do not embed it in an Expo config, package, GitHub Pages builder, or Custom GPT action. Until per-install, short-lived telemetry credentials exist, keep client telemetry disabled and send events only through a trusted server-side relay. The worker rejects missing or invalid tokens, oversized payloads, and more than five events per anonymous installation per minute.

## Cloudflare Security Settings

Before deploy:

- SSL/TLS encryption mode: Full (strict).
- Always Use HTTPS: enabled.
- Minimum TLS version: TLS 1.2 or stricter.
- HSTS: enabled only after link verification is proven.
- WAF/rate limiting: protect `POST /v1/packages` and `POST /v1/events`.
- Bot/Turnstile: defer until public write access exists.
- Keep `PUBLISHER_TOKEN` at least 96 characters.

Worker response hardening:

- HSTS header;
- `x-content-type-options: nosniff`;
- no-referrer policy;
- strict permissions policy;
- locked-down content security policy.

## Launch Gates

- `npm run check:launch-readiness`
- `npm run check:link-install`
- `npm run check:widget-capability-broker`
- `npm run check:package-compiler`
- `npm run check:schema-registry`
- `npm run doctor`
- `npm run export:android`

Release still needs real signed Android and physical-device proof.
