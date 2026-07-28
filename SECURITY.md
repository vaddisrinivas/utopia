# Security policy

## Supported version

Security fixes target the current `main` branch until tagged releases begin.

Current security claims below reflect the current source snapshot; older device and release evidence stays historical unless repeated here.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when available. Do not open a public issue
for credential exposure, intent injection, unsafe mutation, backup disclosure, health
data exposure, or data-loss defects.

Include affected version, reproduction steps, impact, and any suggested mitigation.
Do not include real user food, receipt, account, health, or provider data.

## Security boundaries

- Public intents and links are untrusted input.
- External changes are staged for review; destructive and sensitive actions require
  explicit confirmation.
- Provider credentials are encrypted with Android Keystore and excluded from backup.
- Android automatic backup is disabled. Explicit Google Drive archives are encrypted.
- Cleartext networking is restricted to local-development loopback hosts.
- Hosted server and official MCP ingress fail closed unless a bearer token is
  configured, or authless access is explicitly enabled with `LIFEOS_LOCAL_DEV=true`
  on loopback only.
- Non-loopback server bind must have configured bearer auth before boot.
- Official MCP principal and domain scope are server-trusted from configured
  bearer tokens; caller `x-utopia-*scope` and principal headers cannot widen access.
- Backend switching creates a local rollback snapshot before the new active backend
  is committed.
- Google Sheets sync requires Google authorization; a public Sheet link alone is not
  treated as write permission.
- Notion setup uses a page URL plus integration/personal token. Utopia must never
  collect Notion usernames or passwords.
- `/providers/status` may stay readable for diagnostics, but canonical provider IDs
  are redacted unless the caller is authenticated or explicit local development is enabled.
- Supabase/PostgREST/Utopia server modes require HTTPS endpoints and API tokens.
  Direct PostgreSQL DSN mode is advanced/internal and must use TLS-capable restricted
  roles if enabled by a fork.

## Release security gates

- Release signing ownership and certificate retention policy must be documented before
  publishing a signed build.
- Production `assetlinks.json` must match the release signing certificate before
  verified links are claimed.
- Google OAuth clients for release builds must be configured outside source control;
  client IDs may be public, client secrets and tokens must not be committed.
- Signed artifacts must include checksums, changelog, privacy notes, and migration notes.
