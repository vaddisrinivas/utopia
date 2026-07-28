#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
PROVIDERS=("$@")
if [[ "${#PROVIDERS[@]}" -eq 0 ]]; then
  PROVIDERS=(notion sheets postgres)
fi

AGENT_ENV_WRAPPER="$HOME/.codex/skills/agent-env/scripts/run-with-agent-env.sh"
if [[ "${WONDERFOOD_LIVE_PROOF_SKIP_AGENT_ENV:-0}" != "1" &&
      -x "$AGENT_ENV_WRAPPER" &&
      -f "$HOME/.config/agent-secrets/agent.env" ]]; then
  WONDERFOOD_LIVE_PROOF_SKIP_AGENT_ENV=1 exec "$AGENT_ENV_WRAPPER" "$0" "${PROVIDERS[@]}"
fi

missing=0
if [[ -z "${SSL_CERT_FILE:-}" ]]; then
  cert_file="$(python3 - <<'PY' 2>/dev/null || true
try:
    import certifi
    print(certifi.where())
except Exception:
    pass
PY
)"
  if [[ -n "$cert_file" && -f "$cert_file" ]]; then
    export SSL_CERT_FILE="$cert_file"
  fi
fi

require_one_of() {
  local label="$1"
  shift
  local found=0
  for name in "$@"; do
    if [[ -n "${!name:-}" ]]; then
      found=1
      break
    fi
  done
  if [[ "$found" -eq 0 ]]; then
    echo "Missing env for $label: one of $*" >&2
    missing=1
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing env: $name" >&2
    missing=1
  fi
}

for provider in "${PROVIDERS[@]}"; do
  case "$provider" in
    notion)
      require_one_of notion-token NOTION_TOKEN NOTION_API_KEY
      ;;
    sheets|google-sheets)
      if [[ -z "${GOOGLE_SHEETS_ACCESS_TOKEN:-}" ]]; then
        require_env GOOGLE_CLIENT_ID
        require_env GOOGLE_CLIENT_SECRET
      fi
      ;;
    postgres)
      require_one_of postgres-root POSTGRES_TEST_API_ROOT WONDERFOOD_POSTGRES_API_ROOT
      require_one_of postgres-token POSTGRES_TEST_API_TOKEN WONDERFOOD_POSTGRES_API_TOKEN
      require_one_of postgres-household POSTGRES_TEST_HOUSEHOLD_ID WONDERFOOD_POSTGRES_HOUSEHOLD_ID
      ;;
    *)
      echo "Unknown provider: $provider" >&2
      exit 2
      ;;
  esac
done

if [[ "$missing" -ne 0 ]]; then
  echo "Live provider proof env is incomplete. Values were not printed." >&2
  exit 1
fi

for provider in "${PROVIDERS[@]}"; do
  case "$provider" in
    notion)
      node scripts/quality/require-disposable-lane.mjs provider notion
      scripts/quality/run-notion-scenario-proof.sh
      ;;
    sheets|google-sheets)
      node scripts/quality/require-disposable-lane.mjs provider sheets
      scripts/quality/run-google-sheets-scenario-proof.sh
      ;;
    postgres)
      node scripts/quality/require-disposable-lane.mjs provider postgres
      scripts/quality/run-postgres-live-proof.sh
      ;;
  esac
done
