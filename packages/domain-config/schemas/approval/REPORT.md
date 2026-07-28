# W1-APPROVAL Contract Report

## Scope

- Created durable approval schema at `reactive-proposal-approval.v1.schema.json`.
- Added approval threat fixtures under `schemas/approval/fixtures`.
- Added contract test `server/test/approval-schema-contract.ts`.
- No migrations, DB writes, UI, MCP/chat, or provider code changes.

## Delivery Metadata

- Base branch: `main`
- Base SHA: `5f9b091c9667593f74e383554e59eb562211c4dd`
- Current SHA: `5e6691cadf17f3ec8e3e53c8ed6d5d3ff2fd0dfb6`
- Diff-tree basis: `git diff --name-status 5f9b091c9667593f74e383554e59eb562211c4dd..5e6691cadf17f3ec8e3e53c8ed6d5d3ff2fd0dfb6`

## Checks

- `node scripts/validate-domain-config.mjs` (not executed in this task)
- `node -e` JSON fixture parse sanity check (`accept.json` and every threat fixture)
- `node -e` Ajv threat sanity check: all threat fixtures rejected by schema or uniqueness checks
- `approval-schema-contract.ts` contract test prepared for CI execution.

## Evidence of Rejection

- `ai-sdk-approval.json`: missing Wonder receipt fields and type mismatch.
- `tampered-idempotency-key.json`: idempotency pattern violation.
- `tampered-operation-hash.json`: invalid operation hash format.
- `tampered-proposal-hash.json`: invalid proposal hash format.
- `wrong-actor.json`: actor/local_actor/decision actor mismatch check.
- `wrong-workspace.json`: authority/workspace binding mismatch check.
- `revision-drift.json`: target revision vector reverse-order check.
- `expired.json`: expiry check against runtime `Date.now()`.
- `capability-escalation.json`: unsupported capability enum.
- `action-binding.json`: action id must bind proposal id.
- `replay.json`: approval id replay replay check.

## Generated TypeScript

- Not generated in this task.
- Current pipeline has no durable-schema-to-TypeScript generator wired in the active scripts.

## Blocker

- Merge blocked only if approval schema-to-TypeScript is required before merge.

## Merge Risk

- Low: contract-only change inside schemas + fixtures + test; no production surface changes.

## Remaining Scope

- Generate durable approval TypeScript in the next pipeline-enabled slice (if/when toolchain lands).
- Add runtime binding checks for proposal/action revision and capability alignment in proposal execution path.

## Ready-to-merge

- BLOCKING: `approval-schema-contract.ts` was written and requires execution in CI before merge.
