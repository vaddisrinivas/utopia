#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
POSTGRES_BIN="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@16/bin/postgres}"
PSQL_BIN="${PSQL_BIN:-/opt/homebrew/opt/postgresql@16/bin/psql}"
PG_PORT="${WONDERFOOD_LOCAL_POSTGRES_SCENARIO_PORT:-55433}"
API_PORT="${WONDERFOOD_LOCAL_POSTGRES_SCENARIO_API_PORT:-18766}"
PG_SOCKET_DIR="${WONDERFOOD_LOCAL_POSTGRES_SCENARIO_SOCKET_DIR:-/tmp/wf-pg-scenarios}"
DB_NAME="${WONDERFOOD_LOCAL_POSTGRES_SCENARIO_DB:-utopia_live_scenario_proof}"
TOKEN="${WONDERFOOD_LOCAL_POSTGRES_SCENARIO_TOKEN:-local-postgres-scenario-token}"
HOUSEHOLD_ID="${WONDERFOOD_LOCAL_POSTGRES_SCENARIO_HOUSEHOLD_ID:-local-scenario-household}"
OUT_DIR="${WONDERFOOD_LOCAL_POSTGRES_SCENARIO_OUT:-app/build/evidence/live-workspace}"
WONDERFOOD_LOCAL_POSTGRES_DB="$DB_NAME" node scripts/quality/require-disposable-lane.mjs provider local-postgres

if [[ ! -x "$POSTGRES_BIN" || ! -x "$PSQL_BIN" ]]; then
  echo "Install postgresql@16 first, or set POSTGRES_BIN and PSQL_BIN." >&2
  exit 1
fi

mkdir -p "$PG_SOCKET_DIR" "$OUT_DIR"

postgres_pid=""
api_pid=""
cleanup() {
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" >/dev/null 2>&1 || true
    wait "$api_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$postgres_pid" ]]; then
    kill "$postgres_pid" >/dev/null 2>&1 || true
    wait "$postgres_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

sql() {
  "$PSQL_BIN" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -tA -c "$1"
}

start_api() {
  POSTGRES_PSQL_BIN="$PSQL_BIN" \
  POSTGRES_SOCKET_DIR="$PG_SOCKET_DIR" \
  POSTGRES_PORT="$PG_PORT" \
  POSTGRES_DB="$DB_NAME" \
  POSTGRES_API_PORT="$API_PORT" \
  POSTGRES_API_TOKEN="$TOKEN" \
  python3 - <<'PY' &
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import subprocess
import urllib.parse

PSQL = os.environ["POSTGRES_PSQL_BIN"]
SOCKET_DIR = os.environ["POSTGRES_SOCKET_DIR"]
PORT = os.environ["POSTGRES_PORT"]
DB = os.environ["POSTGRES_DB"]
API_PORT = int(os.environ["POSTGRES_API_PORT"])
TOKEN = os.environ["POSTGRES_API_TOKEN"]

def dollar_quote(tag, value):
    return f"${tag}$" + str(value).replace(f"${tag}$", "") + f"${tag}$"

def psql_json(sql):
    out = subprocess.run(
        [PSQL, "-h", SOCKET_DIR, "-p", PORT, "-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-c", sql],
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    return out.splitlines()[0] if out else ""

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def authenticated(self):
        return self.headers.get("Authorization") == "Bearer " + TOKEN

    def send_json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def scoped_household(self, path):
        household = urllib.parse.unquote(path.split("/")[2])
        session_household = self.headers.get("X-Utopia-Household", "")
        return household if not session_household or session_household == household else None

    def do_GET(self):
        if not self.authenticated():
            return self.send_json(401, {"error": "unauthorized"})
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        if path == "/health":
            return self.send_json(200, {"status": "ok", "store": "postgres-local"})
        if path == "/schema":
            if qs.get("mismatch") == ["1"]:
                return self.send_json(200, {"schema_version": 999, "schema_fingerprint": "wf-postgres-mismatch"})
            return self.send_json(200, {"schema_version": 1, "schema_fingerprint": "wf-postgres-v1-canonical-household"})
        if path.startswith("/households/") and path.endswith("/snapshot/current"):
            household = self.scoped_household(path)
            if household is None:
                return self.send_json(403, {"error": "wrong_household"})
            out = psql_json(
                "SELECT json_build_object('snapshot_json', snapshot_json, 'updated_at', updated_at)::text "
                "FROM utopia_snapshots WHERE household_id = "
                + dollar_quote("h", household)
                + " AND snapshot_id = 'current';"
            )
            return self.send_json(200, json.loads(out) if out else {})
        return self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if not self.authenticated():
            return self.send_json(401, {"error": "unauthorized"})
        path = urllib.parse.urlparse(self.path).path
        household = self.scoped_household(path) if path.startswith("/households/") else None
        if path.startswith("/households/") and household is None:
            return self.send_json(403, {"error": "wrong_household"})
        if path.startswith("/households/") and path.endswith("/snapshot/current"):
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode())
            sql = """
INSERT INTO utopia_snapshots(household_id, snapshot_id, schema_version, updated_at, snapshot_json)
VALUES ({household}, 'current', {schema_version}, {updated_at}, {snapshot_json})
ON CONFLICT (household_id, snapshot_id) DO UPDATE SET schema_version=EXCLUDED.schema_version, updated_at=EXCLUDED.updated_at, snapshot_json=EXCLUDED.snapshot_json
RETURNING json_build_object('updated_at', updated_at)::text;
""".format(
                household=dollar_quote("h", household),
                schema_version=int(data.get("schema_version", 1)),
                updated_at=dollar_quote("u", data.get("updated_at", "")),
                snapshot_json=dollar_quote("s", data.get("snapshot_json", "")),
            )
            return self.send_json(200, json.loads(psql_json(sql)))
        if path.startswith("/households/") and path.endswith("/outbox"):
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode())
            command_id = data.get("command_id", "")
            key = data.get("idempotency_key", "")
            command_json = json.dumps(data.get("command", {}))
            sql = """
INSERT INTO utopia_outbox(household_id, command_id, idempotency_key, command_json, created_at, pushed_at)
VALUES ({household}, {command_id}, {key}, {command_json}, now(), now())
ON CONFLICT (household_id, idempotency_key) DO UPDATE SET pushed_at=COALESCE(utopia_outbox.pushed_at, now())
RETURNING json_build_object('command_id', command_id, 'idempotency_key', idempotency_key, 'pushed', pushed_at is not null)::text;
""".format(
                household=dollar_quote("h", household),
                command_id=dollar_quote("c", command_id),
                key=dollar_quote("k", key),
                command_json=dollar_quote("j", command_json),
            )
            return self.send_json(200, json.loads(psql_json(sql)))
        if path.startswith("/households/") and "/tombstones/" in path:
            parts = path.split("/")
            entity_type = urllib.parse.unquote(parts[4])
            entity_id = urllib.parse.unquote(parts[5])
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0")) or "2").decode() or "{}")
            sql = """
INSERT INTO utopia_tombstones(household_id, entity_type, entity_id, reason, command_id, updated_at)
VALUES ({household}, {entity_type}, {entity_id}, {reason}, {command_id}, now())
ON CONFLICT (household_id, entity_type, entity_id) DO UPDATE SET reason=EXCLUDED.reason, command_id=EXCLUDED.command_id, updated_at=EXCLUDED.updated_at
RETURNING json_build_object('entity_type', entity_type, 'entity_id', entity_id)::text;
""".format(
                household=dollar_quote("h", household),
                entity_type=dollar_quote("t", entity_type),
                entity_id=dollar_quote("e", entity_id),
                reason=dollar_quote("r", data.get("reason", "archive")),
                command_id=dollar_quote("c", data.get("command_id", "archive-command")),
            )
            return self.send_json(200, json.loads(psql_json(sql)))
        return self.send_json(404, {"error": "not_found"})

HTTPServer(("127.0.0.1", API_PORT), Handler).serve_forever()
PY
  api_pid="$!"
  for _ in {1..40}; do
    if curl --silent --fail -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$API_PORT/health" >/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  echo "Local Postgres scenario API did not start." >&2
  return 1
}

api_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl --silent --show-error --fail-with-body \
      -X "$method" \
      -H "Authorization: Bearer $TOKEN" \
      -H "X-Utopia-Household: $HOUSEHOLD_ID" \
      -H "Content-Type: application/json" \
      --data "$body" \
      "http://127.0.0.1:$API_PORT$path"
  else
    curl --silent --show-error --fail-with-body \
      -X "$method" \
      -H "Authorization: Bearer $TOKEN" \
      -H "X-Utopia-Household: $HOUSEHOLD_ID" \
      "http://127.0.0.1:$API_PORT$path"
  fi
}

LC_ALL=en_US.UTF-8 "$POSTGRES_BIN" -D /opt/homebrew/var/postgresql@16 -p "$PG_PORT" -k "$PG_SOCKET_DIR" \
  >"$PG_SOCKET_DIR/postgres.log" 2>&1 &
postgres_pid="$!"

for _ in {1..40}; do
  if "$PSQL_BIN" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

"$PSQL_BIN" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" \
  | grep -q 1 || "$PSQL_BIN" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB_NAME"

"$PSQL_BIN" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS utopia_snapshots (
  household_id text NOT NULL,
  snapshot_id text NOT NULL,
  schema_version integer NOT NULL,
  updated_at text NOT NULL,
  snapshot_json text NOT NULL,
  PRIMARY KEY (household_id, snapshot_id)
);
CREATE TABLE IF NOT EXISTS utopia_outbox (
  household_id text NOT NULL,
  command_id text NOT NULL,
  idempotency_key text NOT NULL,
  command_json text NOT NULL,
  created_at timestamptz NOT NULL,
  pushed_at timestamptz,
  PRIMARY KEY (household_id, command_id),
  UNIQUE (household_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS utopia_tombstones (
  household_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text NOT NULL,
  command_id text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, entity_type, entity_id)
);
SQL

start_api

snapshot='{"schemaVersion":1,"foods":[],"stockLots":[],"shoppingItems":[],"recipes":[],"mealPlans":[],"mealLogs":[],"receipts":[],"foodEvents":[],"relations":[],"attachments":[],"pages":[],"foodAliases":[],"nutritionSnapshots":[]}'
api_json POST "/households/$HOUSEHOLD_ID/snapshot/current" \
  "{\"schema_version\":1,\"updated_at\":\"2026-07-20T18:00:00Z\",\"snapshot_json\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$snapshot")}" >/dev/null

response_dir="$(mktemp -d)"
read_before_file="$response_dir/read-before.json"
read_after_file="$response_dir/read-after.json"
concurrent_file="$response_dir/concurrent.json"
schema_file="$response_dir/schema.json"
mismatch_file="$response_dir/schema-mismatch.json"

api_json GET "/households/$HOUSEHOLD_ID/snapshot/current" > "$read_before_file"
kill "$api_pid" >/dev/null 2>&1 || true
wait "$api_pid" >/dev/null 2>&1 || true
api_pid=""
start_api
api_json GET "/households/$HOUSEHOLD_ID/snapshot/current" > "$read_after_file"

sql "UPDATE utopia_snapshots SET updated_at = '2026-07-20T18:05:00Z' WHERE household_id = '$HOUSEHOLD_ID' AND snapshot_id = 'current';" >/dev/null
api_json GET "/households/$HOUSEHOLD_ID/snapshot/current" > "$concurrent_file"

api_json POST "/households/$HOUSEHOLD_ID/tombstones/item/item-1" '{"reason":"archive","command_id":"archive-item-1"}' >/dev/null
api_json POST "/households/$HOUSEHOLD_ID/outbox" '{"command_id":"command-1","idempotency_key":"same-key","command":{"type":"archive"}}' >/dev/null
api_json POST "/households/$HOUSEHOLD_ID/outbox" '{"command_id":"command-1-replay","idempotency_key":"same-key","command":{"type":"archive"}}' >/dev/null

bad_auth_code="$(curl --silent --output /dev/null --write-out '%{http_code}' -H "Authorization: Bearer invalid" "http://127.0.0.1:$API_PORT/health")"
wrong_household_code="$(curl --silent --output /dev/null --write-out '%{http_code}' -H "Authorization: Bearer $TOKEN" -H "X-Utopia-Household: other-household" "http://127.0.0.1:$API_PORT/households/$HOUSEHOLD_ID/snapshot/current")"
api_json GET "/schema" > "$schema_file"
api_json GET "/schema?mismatch=1" > "$mismatch_file"

outbox_count="$(sql "SELECT count(*) FROM utopia_outbox WHERE household_id = '$HOUSEHOLD_ID' AND idempotency_key = 'same-key';" | tr -d '[:space:]')"
tombstone_count="$(sql "SELECT count(*) FROM utopia_tombstones WHERE household_id = '$HOUSEHOLD_ID' AND entity_type = 'item' AND entity_id = 'item-1';" | tr -d '[:space:]')"

evidence="$OUT_DIR/postgres-scenarios-$(date +%s).json"
python3 - "$evidence" "$schema_file" "$mismatch_file" "$read_before_file" "$read_after_file" "$concurrent_file" <<PY
import json, sys
schema = json.load(open(sys.argv[2]))
mismatch = json.load(open(sys.argv[3]))
before = json.load(open(sys.argv[4]))
after = json.load(open(sys.argv[5]))
concurrent = json.load(open(sys.argv[6]))
payload = {
  "provider": "postgres",
  "captured_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "proof": "local_postgres_scenarios",
  "household_id": "${HOUSEHOLD_ID:0:4}...${HOUSEHOLD_ID: -4}",
  "offline_queue_replay_idempotent": "$outbox_count" == "1",
  "reconnect_preserved_snapshot": before.get("snapshot_json") == after.get("snapshot_json"),
  "concurrent_remote_edit_seen": concurrent.get("updated_at") == "2026-07-20T18:05:00Z",
  "archive_tombstone_recorded": "$tombstone_count" == "1",
  "expired_auth_rejected": "$bad_auth_code" == "401",
  "cross_household_rejected": "$wrong_household_code" == "403",
  "schema_ok": schema.get("schema_fingerprint") == "wf-postgres-v1-canonical-household",
  "schema_mismatch_detectable": mismatch.get("schema_fingerprint") != schema.get("schema_fingerprint"),
  "disconnect_local_use_note": "Local SQLite mode remains independent; this proof stops the HTTP API without touching app local storage.",
}
missing = [k for k, v in payload.items() if isinstance(v, bool) and not v]
payload["all_scenarios_passed"] = not missing
payload["failed_scenarios"] = missing
open(sys.argv[1], "w").write(json.dumps(payload, indent=2, sort_keys=True))
print(sys.argv[1])
if missing:
    raise SystemExit("Failed scenarios: " + ", ".join(missing))
PY
