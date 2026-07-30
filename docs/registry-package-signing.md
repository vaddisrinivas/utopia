# Registry Package Signing

Staging registry writes are disabled by default. A write becomes possible only when all three conditions hold:

1. `REGISTRY_WRITE_MODE=signed`.
2. Request bearer token matches `PUBLISHER_TOKEN`.
3. The package's canonical JSON has a fresh ECDSA P-256 signature from a key in `REGISTRY_PUBLISHER_KEYS_JSON`.

The private key stays local or in a CI secret. Cloudflare receives only a JSON map of key IDs to base64 SPKI public keys. A bearer token alone cannot publish a package.

## Local Key

```bash
node scripts/registry/create-signing-key.mjs --key-id utopia-staging-publisher-2026-07
```

This creates a private PEM at `~/.config/utopia/registry-signing/` with mode `0600`, plus a public SPKI file. Never commit either file.

## Stage

Upload only the public-key map and publisher token as Worker secrets. Keep `REGISTRY_WRITE_MODE=disabled` in `cloudflare/wrangler.toml` for the first staging deployment. Enable signed writes only in a later, reviewed staging config change.

## Publish

```bash
node scripts/registry/sign-package.mjs \
  --package-path dist/github-app-factory/app/package.json \
  --key-id utopia-staging-publisher-2026-07 \
  --private-key-path ~/.config/utopia/registry-signing/utopia-staging-publisher-2026-07.private.pem

node scripts/registry/publish-package.mjs \
  --signed-package-path dist/github-app-factory/app/package.signed.json \
  --enabled=true
```

Signatures expire after 15 minutes. Immutable package IDs make replay of an existing accepted package harmless; a modified package requires a new valid signature.

This proves registry admission, not app-side trust-chain consumption. App installation must still verify checksum, publisher policy, capability grants, and user approval.
