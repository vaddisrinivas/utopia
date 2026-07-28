#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
POSTGRES_BIN="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@16/bin/postgres}"
PSQL_BIN="${PSQL_BIN:-/opt/homebrew/opt/postgresql@16/bin/psql}"
PG_PORT="${WONDERFOOD_LOCAL_POSTGRES_PORT:-55432}"
API_PORT="${WONDERFOOD_LOCAL_POSTGRES_API_PORT:-18765}"
PG_SOCKET_DIR="$ROOT_DIR/build/evidence/live-workspace/postgres-local"
DB_NAME="${WONDERFOOD_LOCAL_POSTGRES_DB:-utopia_live_proof}"
TOKEN="${WONDERFOOD_LOCAL_POSTGRES_TOKEN:-local-postgres-proof-token}"
HOUSEHOLD_ID="${WONDERFOOD_LOCAL_POSTGRES_HOUSEHOLD_ID:-local-proof-household}"
WONDERFOOD_LOCAL_POSTGRES_DB="$DB_NAME" node scripts/quality/require-disposable-lane.mjs provider local-postgres

if [[ ! -x "$POSTGRES_BIN" || ! -x "$PSQL_BIN" ]]; then
  echo "Install postgresql@16 first, or set POSTGRES_BIN and PSQL_BIN." >&2
  exit 1
fi

mkdir -p "$PG_SOCKET_DIR"

postgres_pid=""
api_pid=""
cleanup() {
  if [[ -n "$api_pid" ]]; then kill "$api_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$postgres_pid" ]]; then kill "$postgres_pid" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

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
CREATE TABLE IF NOT EXISTS utopia_schema_versions (
  schema_version integer NOT NULL,
  schema_fingerprint text PRIMARY KEY
);
INSERT INTO utopia_schema_versions(schema_version, schema_fingerprint)
VALUES (1, 'wf-postgres-v1-canonical-household')
ON CONFLICT (schema_fingerprint) DO UPDATE SET schema_version = EXCLUDED.schema_version;
SQL

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

    def do_GET(self):
        if not self.authenticated():
            return self.send_json(401, {"error": "unauthorized"})
        path = urllib.parse.urlparse(self.path).path
        if path == "/health":
            return self.send_json(200, {"status": "ok", "store": "postgres-local"})
        if path == "/schema":
            return self.send_json(200, {"schema_version": 1, "schema_fingerprint": "wf-postgres-v1-canonical-household"})
        if path.startswith("/households/") and path.endswith("/snapshot/current"):
            household = urllib.parse.unquote(path.split("/")[2])
            sql = (
                "SELECT json_build_object('snapshot_json', snapshot_json, 'updated_at', updated_at)::text "
                "FROM utopia_snapshots WHERE household_id = "
                + dollar_quote("h", household)
                + " AND snapshot_id = 'current';"
            )
            out = psql_json(sql)
            return self.send_json(200, json.loads(out) if out else {})
        return self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if not self.authenticated():
            return self.send_json(401, {"error": "unauthorized"})
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/households/") and path.endswith("/snapshot/current"):
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode())
            household = urllib.parse.unquote(path.split("/")[2])
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
            out = psql_json(sql)
            return self.send_json(200, json.loads(out) if out else {"updated_at": data.get("updated_at", "")})
        return self.send_json(404, {"error": "not_found"})

HTTPServer(("127.0.0.1", API_PORT), Handler).serve_forever()
PY
api_pid="$!"

for _ in {1..40}; do
  if curl --silent --fail -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$API_PORT/health" >/dev/null; then
    break
  fi
  sleep 0.25
done

POSTGRES_TEST_API_ROOT="http://127.0.0.1:$API_PORT" \
POSTGRES_TEST_API_TOKEN="$TOKEN" \
POSTGRES_TEST_HOUSEHOLD_ID="$HOUSEHOLD_ID" \
POSTGRES_TEST_CONNECTION_MODE=WONDERFOOD_SERVER \
scripts/quality/run-postgres-live-proof.sh
