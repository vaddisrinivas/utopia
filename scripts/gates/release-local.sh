#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

run_gate() {
  echo "release-local: $*"
  "$@"
}

run_gate npm run config:validate
run_gate npx --yes -p typescript tsc --noEmit
run_gate npx --yes expo-doctor
run_gate npx --yes expo export --platform web --output-dir dist/web
run_gate npx --yes expo export --platform android --output-dir dist/android
run_gate npm run check:ios-export
run_gate npx --yes tsx --tsconfig tsconfig.json scripts/quality/check-phase3-chat-send.ts
run_gate npx --yes tsx --tsconfig tsconfig.json scripts/quality/check-phase3-chat-rollback-idempotency.ts

echo "release-local: PASS"
