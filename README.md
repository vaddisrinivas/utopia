# Utopia

Utopia is a JSON-driven app shell for reusable product runtimes.

- JSON + registry entries define app behavior.
- A shared kernel renders packages through generic widgets.
- Tests and registry checks are the admission gate.

Licensed under [PolyForm Noncommercial 1.0.0](./LICENSE).

## Current command surface

```bash
npm install
npm run config:validate
npm run typecheck
npm run test
npm run doctor
npm run export:web
npm run export:android
npm run export:ios
npm run check:doc-links
npm run phase3:check:chat-send
npm run phase3:check:chat-rollback-idempotency
npm run check:kernel-v2
```

## Current proof-facing files

- `app/_layout.tsx` — app root, theming, safe-area, router wiring.
- `app/index.tsx` — registry catalog UI and install/launch flow.
- `app/apps/[installationId].tsx` — installed app shell route.
- `src/kernel/catalog.ts` — package catalog state and metadata.
- `src/kernel/registry.ts` — catalog loading/install helpers.
- `src/kernel/render.tsx` — generic JSON render path.
- `src/kernel/*` — package runtime helpers.
- `scripts/import-corpus.ts` — registry import and migration entry.
- `scripts/validate-catalog.ts`, `scripts/generate-catalog.mjs` — canonical catalog generation.
- `scripts/quality/check-doc-links.mjs` — local markdown link checker.
- `scripts/quality/check-kernel-v2-size.mjs` — size/coverage budget check.
- `scripts/quality/report-catalog-similarity.mjs` — similarity/de-duplication reports.
- `tests/kernel-v2/*` — kernel, registry, and shell regression tests.
- `tests/kernel-v2/chat-send.test.ts` — chat send contract gate.
- `tests/kernel-v2/chat-rollback-idempotency.test.ts` — rollback/idempotency/security gate.
- `tests/kernel-v2/shell-route.test.ts` — shell wrapper height regression gate.

## Quality gates (local truth)

`npm run config:validate` runs kernel-sized checks.
`npm run check:kernel-v2` runs kernel tests + size guard.

Phase-3 gates are now separated:

- `phase3:check:chat-send` validates send contract only.
- `phase3:check:chat-rollback-idempotency` validates rollback/idempotency and scope guards.

## What is not claimed

- This README only claims files/commands that currently exist in this checkout.
- Claims outside this list (for example, unproven platform claims, release-complete status, or extra app factories) are intentionally omitted.

## Notes

- Temporary size guard is set to 12k LOC (not a final target); current authored LOC is ~11.8k, so 10k target is deferred, not achieved.
- Use the app catalog to view active/inactive apps.
- Do not copy links to files that do not exist in-tree.
