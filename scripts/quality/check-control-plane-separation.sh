#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if rg -n "INSERT (OR REPLACE )?INTO records|UPDATE records SET|DELETE FROM records|INSERT (OR REPLACE )?INTO record_relations|DELETE FROM record_relations" src/config; then
  echo "Control-plane violation: src/config must not write household records." >&2
  exit 1
fi

if rg -n "INSERT (OR REPLACE )?INTO config_|UPDATE config_|DELETE FROM config_" src/providers src/sync server/src/providers 2>/dev/null; then
  echo "Data-plane violation: provider/data sync modules must not write config tables." >&2
  exit 1
fi

echo "Control/data plane separation grep passed"
