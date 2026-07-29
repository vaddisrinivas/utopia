#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

echo "dev-fast: npx typescript tsc --noEmit"
npx --yes -p typescript tsc --noEmit

echo "dev-fast: npx tsx scripts/quality/check-phase3-chat-send.ts"
npx --yes tsx --tsconfig tsconfig.json scripts/quality/check-phase3-chat-send.ts

echo "dev-fast: npx tsx scripts/quality/check-phase3-chat-rollback-idempotency.ts"
npx --yes tsx --tsconfig tsconfig.json scripts/quality/check-phase3-chat-rollback-idempotency.ts

echo "dev-fast: PASS"
