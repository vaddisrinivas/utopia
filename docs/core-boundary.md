# Core Boundary Map

## Scope

Core-facing authority is split across:

- package/schema authority
- compiler/runtime authority
- renderer authority
- capability authority
- storage authority
- sync authority

The lane below maps current ownership and source-of-truth locations only.

## Package authority

- `packages/shared/contracts/*` owns contract and interface shape for installs, package metadata, runtime contracts, and trust proofs.
- `packages/schemas/src/*` owns JSON schema validators and the package schema registry.
- `packages/domain-config/*` owns domain catalog/survey/schema fragments consumed by runtime and sync.
- `packages/app-compiler/*` owns source-folder → package JSON compilation and preview generation.
- `packages/runtime-kernel/*` owns shared expression/recurrence/timed-flow primitives.

## Runtime authority

- `src/domain/runtime.ts` and `src/domain/package-runtime.ts` own package execution/runtime adaptation for UI and chat.
- `server/src/kernel/*` owns server-side query, operation, and reactive proposal execution kernels.
- `src/ops/*`, `src/actions/*`, `src/chat/*`, `src/ai/*`, `src/workflows/*` own local durable ops, undo, chat handoff, AI routing, and workflow behavior.

## Renderer authority

- `src/domain/renderer.tsx` and `src/presentation/json-render-*.tsx` map package records/widgets into native UI components.
- `src/presentation/widgets/*` define render families and broker capability-aware behaviors.

## Capability authority

- `src/domain/package-install.ts`, `src/domain/package-control-room.ts`, `src/domain/app-package-bridge.ts`, `src/domain/extension-trust.ts`, `src/domain/publisher-trust-*` own install-preview and trust-capability mediation.
- `src/domain/package-sharing*.ts` and `src/cloud-vault*` own trust and sharing pathways.

## Storage authority

- `src/db/*` owns SQLite persistence, migrations, recovery snapshots, and record/operation state.
- `src/settings/*` owns local runtime settings persistence.

## Sync authority

- `src/providers/*` owns pull/push, merge, and token-adapter plumbing.
- `server/src/providers/*` owns server-provider workers, webhooks, and sync adapters.
- `src/config/sync.ts` owns merge/retry/capability sync policy.

## Gate rules (enforce now)

- Core authority layers must not import app or server entry layers directly:
  - no imports from `app/`
  - no imports from `server/src/`
- Core authority layers must not import `src/providers` or provider adapters directly.
- Core authority layers must not import React/Expo UI surfaces:
  - `react`, `react-native`, `react-native-*`
- `expo`, `expo-*` (except `expo-sqlite` storage access)
  - `expo-router`, `expo-sharing`, `expo-status-bar`, `expo-splash-screen`, `expo-symbols`, `expo-asset`
- Core authority layers must not import Cloudflare deployment/runtime layers:
  - `cloudflare/*`, `@cloudflare/*`, `wrangler`

## Known gaps (snapshot)

- `src/workflows/runtime.ts` imports `@/server/src/workflows/control-machine` for control-state transitions.
- `src/domain/runtime-context.tsx` is currently the core context entrypoint and imports React primitives.

## Check runbook

- `node scripts/quality/check-core-boundaries.mjs` (repo scan + fail-fast violations)
- `npm run check:dependency-boundaries` (dependency-cruiser for static import edges)
