#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
node scripts/quality/require-disposable-lane.mjs provider notion

if [[ -z "${NOTION_TOKEN:-${NOTION_API_KEY:-}}" ]]; then
  echo "Set NOTION_TOKEN or NOTION_API_KEY." >&2
  exit 1
fi

if [[ -z "${NOTION_TEST_PAGE_ID:-}" ]]; then
  echo "Set NOTION_TEST_PAGE_ID." >&2
  exit 1
fi

./gradlew :app:testFossDebugUnitTest --tests 'app.utopia.sync.UtopiaLiveWorkspaceProofTest.liveNotionWorkspaceExportsSeedRowsAndReadsThemBack'
