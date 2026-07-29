# Utopia Working Instructions

- Scope: rolling platform-hardening queue covering package capability
  enforcement, signed-extension trust, App Library lifecycle, package builders,
  provider-neutral sync/data homes, release gates, and generic runtime proofs.
- Expo UI edits are approved for App Library lifecycle/trust UX and generic
  renderer/capability surfaces. Unrelated Food visual redesign is out of scope.
- Do not edit `packages/domain-shared` without explicit approval.
- Do not log secrets, API keys, or token values.
- Keep chat endpoint responses deterministic and model-contract centered.
- Preserve canonical action schema and source references in action payloads.
- Required verification before completion:
  - `npm run config:validate`
  - `npm run typecheck`
  - `npm run doctor`
  - `npm run export:web`
  - `npm run export:android`
  - `npm run phase3:check:chat-send`
  - `npm run phase3:check:chat-rollback-idempotency`
