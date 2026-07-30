# Operations and Observability Readiness

Scope: static security operations checks and privacy-safe observability readiness boundaries for local proof and CI gating.

## Security Operations Surface

- OSV scan policy: `scripts/quality/security/osv-gate-policy.json`
- SBOM policy: `scripts/quality/sbom/sbom-policy.json`
- Telemetry privacy boundary policy: `docs/telemetry-and-privacy-contract.md`

## OSV / SBOM Gate Scaffolding

- `scripts/quality/security/check-osv-gate.mjs` requires:
  - OSV policy presence and parser-valid JSON,
  - installed `OSV_SCANNER_CMD`/default `osv-scanner` executable and non-empty JSON scan output (or explicitly configured artifact readback),
  - optional persisted OSV report path (`OSV_REPORT_PATH`).
- `scripts/quality/sbom/check-sbom-gate.mjs` requires:
  - SBOM policy presence and parser-valid JSON,
  - installed `SYFT_CMD`/default `syft` executable and non-empty SBOM JSON output for this run,
  - generated artifact path (`RELEASE_SBOM_PATH`) when configured.

CI is fail-closed when either scanner or SBOM generator is absent.

## Telemetry / Privacy Boundaries

- `scripts/quality/security/check-telemetry-privacy-boundaries.mjs` enforces:
  - telemetry contract + tests file presence,
  - telemetry forbidden-data documentation continuity,
  - no hardcoded secret-like observability keys in docs and policy.

### OpenTelemetry / Sentry Readiness Boundaries

- Not enabled as a production runtime integration in this lane.
- No DSN/API-token constants are checked into repo.
- Forbidden telemetry markers remain in scope: prompts, prompt text, records, tokens, secrets.
- Any future OpenTelemetry or Sentry wiring must:
  - route through explicit allowlisted event payloads,
  - respect offline and opt-out behavior,
  - preserve `FORBIDDEN` field checks from telemetry contract,
  - require explicit product docs updates before release declaration.
