#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

run_gate() {
  echo "platform-ios: $*"
  "$@"
}

run_gate npm run config:validate
run_gate npm run typecheck
run_gate npm run doctor
run_gate npm run phase3:check:chat-send
run_gate npm run phase3:check:chat-rollback-idempotency
run_gate npm run export:ios
run_gate npm run check:ios-export

echo "platform-ios: PASS"
