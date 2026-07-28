# Utopia

Utopia is a JSON-rendered, package-driven app platform for personal software.

The goal: build many useful apps by editing app packages, not rewriting screens.

## Shape

- Native shell: Expo / React Native.
- UI renderer: JSON Render.
- App contract: package JSON.
- First app: `apps/food/food.v1.json`.
- Data: local-first SQLite, with optional Notion and Google Sheets homes.
- AI: chat + package/data proposals guarded by validation.

## First app

Food is the first bundled app package:

- kitchen map
- use-first shelf
- 7-day plan
- quick add
- Notion / Sheets data homes
- AI food assistant

## Development

```bash
npm install
npm run config:validate
npm run typecheck
npm run android:dev
```

## Rules

- No secrets in git.
- No internal planning artifacts in this repo.
- Prefer existing libraries over custom framework code.
- UI should be package-owned wherever possible.
- The kernel owns writes, approvals, provenance, undo, and provider verification.
