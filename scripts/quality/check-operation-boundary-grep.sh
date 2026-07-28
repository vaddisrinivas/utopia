#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if rg -n "INSERT INTO records|UPDATE records SET|DELETE FROM records|INSERT INTO record_relations|DELETE FROM record_relations" src app \
  --glob '!src/ops/apply.ts' \
  --glob '!src/db/migrations.ts' \
  --glob '!src/db/recovery.ts' \
  --glob '!src/providers/provider-local-copy.ts'; then
  echo "Operation boundary violation: record writes must go through src/ops/apply.ts" >&2
  exit 1
fi

if ! rg -n "DELETE FROM records WHERE source_provider = \\?" src/providers/provider-local-copy.ts >/dev/null; then
  echo "Operation boundary violation: provider disconnect clear exception changed or disappeared; audit lifecycle deletion." >&2
  exit 1
fi

if rg -n "^\s*import\s*\{[^}]*\b(createRecord|updateRecord|archiveRecord)\b" server/src/agents/executor.ts; then
  echo "Operation boundary violation: chat executor must not import direct MCP record mutators." >&2
  exit 1
fi

echo "Operation boundary grep passed"
