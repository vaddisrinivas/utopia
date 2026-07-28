#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
node scripts/quality/require-disposable-lane.mjs provider postgres

if [[ -z "${POSTGRES_TEST_API_ROOT:-${WONDERFOOD_POSTGRES_API_ROOT:-}}" ]]; then
  echo "Set POSTGRES_TEST_API_ROOT or WONDERFOOD_POSTGRES_API_ROOT." >&2
  exit 1
fi

if [[ -z "${POSTGRES_TEST_API_TOKEN:-${WONDERFOOD_POSTGRES_API_TOKEN:-}}" ]]; then
  echo "Set POSTGRES_TEST_API_TOKEN or WONDERFOOD_POSTGRES_API_TOKEN." >&2
  exit 1
fi

if [[ -z "${POSTGRES_TEST_HOUSEHOLD_ID:-${WONDERFOOD_POSTGRES_HOUSEHOLD_ID:-}}" ]]; then
  echo "Set POSTGRES_TEST_HOUSEHOLD_ID or WONDERFOOD_POSTGRES_HOUSEHOLD_ID." >&2
  exit 1
fi

./gradlew --rerun-tasks :app:testFossDebugUnitTest --tests 'app.utopia.sync.UtopiaLiveWorkspaceProofTest.livePostgresWorkspaceExportsSeedSnapshotAndReadsItBack'
