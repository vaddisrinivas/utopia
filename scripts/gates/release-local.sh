#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

run_gate() {
  echo "release-local: $*"
  "$@"
}

run_gate npm run config:validate
run_gate npm run check:no-mutable-npx
run_gate npm run typecheck
run_gate npm test
run_gate npm run doctor
run_gate env UTOPIA_RELEASE_BUNDLE=1 npm run export:web
run_gate env UTOPIA_RELEASE_BUNDLE=1 npm run export:android
run_gate npm run check:ios-export
run_gate npm run phase3:check:chat-send
run_gate npm run phase3:check:chat-rollback-idempotency
run_gate npm run check:release-artifact-receipt

echo "release-local: PASS"
