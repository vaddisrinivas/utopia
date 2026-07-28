# Utopia Working Instructions

- Scope: server chat/runtime slice only for this pass.
- Do not edit Expo UI files.
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
