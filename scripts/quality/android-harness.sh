#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-local}"

local_tasks=(
  ":app:lintFossDebug"
  ":app:lintPlayDebug"
  ":core:data:lintDebug"
  ":app:testFossDebugUnitTest"
  ":app:testPlayDebugUnitTest"
  ":core:model:test"
  ":core:engine:test"
  ":core:ai:test"
  ":core:data:testDebugUnitTest"
  ":app:assembleFossDebug"
  ":app:assemblePlayDebug"
  ":app:assembleFossDebugAndroidTest"
  ":app:assemblePlayDebugAndroidTest"
  ":core:data:assembleDebugAndroidTest"
)

connected_tasks=(
  ":app:connectedFossDebugAndroidTest"
  ":app:connectedPlayDebugAndroidTest"
  ":core:data:connectedDebugAndroidTest"
)

case "$MODE" in
  local)
    ./gradlew "${local_tasks[@]}"
    ;;
  connected)
    for task in "${connected_tasks[@]}"; do
      ./gradlew "$task"
    done
    ;;
  all)
    "$0" local
    "$0" connected
    ;;
  ai)
    scripts/quality/smoke-ai-providers.py --write-config /tmp/utopia-working-ai-configs.json
    ;;
  ai-all)
    scripts/quality/smoke-ai-providers.py --write-config /tmp/utopia-all-ai-configs.json --write-config-mode available
    ;;
  *)
    echo "Usage: $0 [local|connected|all|ai|ai-all]" >&2
    exit 64
    ;;
esac
