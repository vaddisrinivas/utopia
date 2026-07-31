#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SPREADSHEET_ID="${GOOGLE_SHEETS_TEST_SPREADSHEET_ID:-}"
SCOPE="https://www.googleapis.com/auth/spreadsheets openid https://www.googleapis.com/auth/userinfo.email"
REDIRECT_PORT="${GOOGLE_OAUTH_REDIRECT_PORT:-8765}"
REDIRECT_URI="http://127.0.0.1:${REDIRECT_PORT}/callback"
TOKEN_FILE="${GOOGLE_SHEETS_TOKEN_FILE:-${ROOT_DIR}/build/evidence/live-workspace/google-sheets-token.json}"
GOOGLE_SHEETS_PROVISION_DISPOSABLE="${GOOGLE_SHEETS_PROVISION_DISPOSABLE:-0}"
GOOGLE_SHEETS_SCENARIO_COMMAND="${GOOGLE_SHEETS_SCENARIO_COMMAND:-$ROOT_DIR/scripts/quality/run-google-sheets-scenario-proof.sh}"
PROVISIONED_DISPOSABLE_SHEET=0
mkdir -p "$(dirname "$TOKEN_FILE")"

redact_id() {
  local value="${1:-}"
  if [[ -z "$value" ]]; then
    echo "<missing>"
    return
  fi
  if (( ${#value} <= 8 )); then
    echo "********"
    return
  fi
  echo "${value:0:4}...${value: -4}"
}

if [[ "$GOOGLE_SHEETS_PROVISION_DISPOSABLE" != "0" && "$GOOGLE_SHEETS_PROVISION_DISPOSABLE" != "1" ]]; then
  echo "GOOGLE_SHEETS_PROVISION_DISPOSABLE must be 0 or 1; received $GOOGLE_SHEETS_PROVISION_DISPOSABLE." >&2
  exit 1
fi

validate_provider_auth_key() {
  local key_value="${1:-}"
  if [[ -z "$key_value" ]]; then
    return
  fi
  if (( ${#key_value} < 32 )); then
    echo "WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY must be at least 32 characters when provided explicitly." >&2
    exit 1
  fi
}

cleanup_disposable_sheet() {
  if [[ "$PROVISIONED_DISPOSABLE_SHEET" != "1" ]]; then
    return
  fi
  GOOGLE_SHEETS_ACCESS_TOKEN="$GOOGLE_SHEETS_ACCESS_TOKEN" \
  GOOGLE_SHEETS_TEST_SPREADSHEET_ID="$SPREADSHEET_ID" \
  python3 - <<'PY'
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import sys

token = os.environ['GOOGLE_SHEETS_ACCESS_TOKEN']
spreadsheet_id = os.environ['GOOGLE_SHEETS_TEST_SPREADSHEET_ID']
request = urllib.request.Request(
    'https://www.googleapis.com/drive/v3/files/' + urllib.parse.quote(spreadsheet_id, safe=''),
    data=json.dumps({'trashed': True}).encode(),
    headers={
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
    },
    method='PATCH',
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()
except urllib.error.HTTPError as error:
    if error.code not in (404, 410):
        print(f"Unable to archive disposable sheet: HTTP {error.code}", file=sys.stderr)
except Exception as error:
    print(f"Unable to archive disposable sheet: {error}", file=sys.stderr)
PY
}
trap cleanup_disposable_sheet EXIT

if [[ -z "${GOOGLE_SHEETS_ACCESS_TOKEN:-}" && -s "$TOKEN_FILE" ]]; then
  : "${GOOGLE_CLIENT_ID:?GOOGLE_CLIENT_ID is required to refresh cached Google Sheets token}"
  : "${GOOGLE_CLIENT_SECRET:?GOOGLE_CLIENT_SECRET is required to refresh cached Google Sheets token}"
  GOOGLE_SHEETS_ACCESS_TOKEN="$(python3 - "$TOKEN_FILE" <<'PY'
import json
import os
import sys
import urllib.parse
import urllib.request

path = sys.argv[1]
try:
    with open(path) as f:
        cached = json.load(f)
except Exception:
    cached = {}

refresh_token = cached.get("refresh_token", "")
if refresh_token:
    data = urllib.parse.urlencode(
        {
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        refreshed = json.load(response)
    cached.update(refreshed)
    cached["refresh_token"] = refresh_token
    with open(path, "w") as f:
        json.dump(cached, f)

print(cached.get("access_token", ""))
PY
)"
fi

if [[ -z "${GOOGLE_SHEETS_ACCESS_TOKEN:-}" ]]; then
  : "${GOOGLE_CLIENT_ID:?GOOGLE_CLIENT_ID is required when GOOGLE_SHEETS_ACCESS_TOKEN is absent}"
  : "${GOOGLE_CLIENT_SECRET:?GOOGLE_CLIENT_SECRET is required when GOOGLE_SHEETS_ACCESS_TOKEN is absent}"
  python3 - "$TOKEN_FILE" "$REDIRECT_PORT" "$REDIRECT_URI" "$SCOPE" <<'PY'
import http.server
import json
import os
import socketserver
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

out, port, redirect_uri, scope = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
client_id = os.environ["GOOGLE_CLIENT_ID"]
client_secret = os.environ["GOOGLE_CLIENT_SECRET"]
state = "utopia-sheets-live-proof"
result = {}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path != "/callback" or qs.get("state", [""])[0] != state:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Invalid Utopia OAuth callback.")
            return
        code = qs.get("code", [""])[0]
        if not code:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"No OAuth code returned.")
            return
        import subprocess
        curl = subprocess.run(["bash", "-lc", "command -v curl"], check=True, capture_output=True, text=True).stdout.strip()
        proc = subprocess.run([
            curl,
            "--silent",
            "--show-error",
            "--request",
            "POST",
            "https://oauth2.googleapis.com/token",
            "--header",
            "Content-Type: application/x-www-form-urlencoded",
            "--data-urlencode",
            "code=" + code,
            "--data-urlencode",
            "client_id=" + client_id,
            "--data-urlencode",
            "client_secret=" + client_secret,
            "--data-urlencode",
            "redirect_uri=" + redirect_uri,
            "--data-urlencode",
            "grant_type=authorization_code",
        ], check=True, capture_output=True, text=True)
        token = json.loads(proc.stdout)
        result.update(token)
        with open(out, "w") as f:
            json.dump(token, f)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Utopia Sheets live proof token captured. You can close this tab.")
        threading.Thread(target=self.server.shutdown, daemon=True).start()

params = urllib.parse.urlencode({
    "client_id": client_id,
    "redirect_uri": redirect_uri,
    "response_type": "code",
    "scope": scope,
    "access_type": "offline",
    "prompt": "consent",
    "state": state,
})
url = "https://accounts.google.com/o/oauth2/v2/auth?" + params
print("Opening browser for Google Sheets OAuth. Token values will not be printed.")
webbrowser.open(url)
with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
    httpd.timeout = 240
    httpd.handle_request()
if not result:
    raise SystemExit("OAuth callback was not completed.")
print("Google Sheets OAuth token saved for this proof run.")
PY
  GOOGLE_SHEETS_ACCESS_TOKEN="$(python3 - "$TOKEN_FILE" <<'PY'
import json, sys
print(json.load(open(sys.argv[1])).get('access_token',''))
PY
)"
fi

if [[ -z "${WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY:-}" ]]; then
  WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))")"
else
  validate_provider_auth_key "$WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY"
fi

if [[ -z "${GOOGLE_SHEETS_ACCESS_TOKEN:-}" ]]; then
  echo "Google Sheets access token is missing after OAuth." >&2
  exit 1
fi

if [[ -z "$SPREADSHEET_ID" && "$GOOGLE_SHEETS_PROVISION_DISPOSABLE" == "1" ]]; then
  PROVISIONED_DISPOSABLE_SHEET=1
  SPREADSHEET_ID="$(GOOGLE_SHEETS_ACCESS_TOKEN="$GOOGLE_SHEETS_ACCESS_TOKEN" python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(
    'https://sheets.googleapis.com/v4/spreadsheets',
    data=json.dumps({'properties': {'title': 'Utopia Disposable Provider Proof'}}).encode(),
    headers={'Authorization': 'Bearer ' + os.environ['GOOGLE_SHEETS_ACCESS_TOKEN'], 'Content-Type': 'application/json'},
    method='POST',
)
with urllib.request.urlopen(req, timeout=30) as response:
    print(json.load(response)['spreadsheetId'])
PY
)"
  echo "Created disposable Google Sheets target: $(redact_id "$SPREADSHEET_ID")"
elif [[ -z "$SPREADSHEET_ID" ]]; then
  echo "Set GOOGLE_SHEETS_TEST_SPREADSHEET_ID or GOOGLE_SHEETS_PROVISION_DISPOSABLE=1." >&2
  exit 1
else
  echo "Using Google Sheets target: $(redact_id "$SPREADSHEET_ID")"
fi

if [[ -z "${GOOGLE_SHEETS_TEST_ACCOUNT_ID:-${GOOGLE_ACCOUNT_ID:-}}" ]]; then
  GOOGLE_ACCOUNT_ID="$(GOOGLE_SHEETS_ACCESS_TOKEN="$GOOGLE_SHEETS_ACCESS_TOKEN" python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request('https://openidconnect.googleapis.com/v1/userinfo', headers={'Authorization': 'Bearer ' + os.environ['GOOGLE_SHEETS_ACCESS_TOKEN']})
with urllib.request.urlopen(req, timeout=30) as response:
    print(json.load(response)['sub'])
PY
)"
fi

GOOGLE_SHEETS_TEST_ACCOUNT_ID="${GOOGLE_SHEETS_TEST_ACCOUNT_ID:-${GOOGLE_ACCOUNT_ID:-}}"
if [[ -z "${WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS:-}" ]]; then
  WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS="$(GOOGLE_SHEETS_TEST_SPREADSHEET_ID="$SPREADSHEET_ID" GOOGLE_SHEETS_TEST_ACCOUNT_ID="$GOOGLE_SHEETS_TEST_ACCOUNT_ID" WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY="$WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY" node --input-type=module - <<'NODE'
import { providerAuthorizationDigest } from './scripts/quality/require-disposable-lane.mjs';
console.log(`DISPOSABLE_PROVIDER_ONLY:hmac-sha256:${providerAuthorizationDigest('sheets', process.env.GOOGLE_SHEETS_TEST_SPREADSHEET_ID, process.env.GOOGLE_SHEETS_TEST_ACCOUNT_ID, process.env.WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY)}`);
NODE
)"
fi

GOOGLE_SHEETS_TEST_SPREADSHEET_ID="$SPREADSHEET_ID" \
GOOGLE_SHEETS_TEST_ACCOUNT_ID="$GOOGLE_SHEETS_TEST_ACCOUNT_ID" \
WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY="$WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY" \
WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS="$WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS" \
node "$ROOT_DIR/scripts/quality/require-disposable-lane.mjs" provider sheets

if [[ "$PROVISIONED_DISPOSABLE_SHEET" == "1" ]]; then
  (
    cd "$ROOT_DIR"
    GOOGLE_SHEETS_ACCESS_TOKEN="$GOOGLE_SHEETS_ACCESS_TOKEN" \
    GOOGLE_SHEETS_TEST_SPREADSHEET_ID="$SPREADSHEET_ID" \
    WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS="$WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS" \
    "$GOOGLE_SHEETS_SCENARIO_COMMAND"
  )
else
  cd "$ROOT_DIR"
  GOOGLE_SHEETS_ACCESS_TOKEN="$GOOGLE_SHEETS_ACCESS_TOKEN" \
  GOOGLE_SHEETS_TEST_SPREADSHEET_ID="$SPREADSHEET_ID" \
  ./gradlew :app:testPlayDebugUnitTest --tests 'app.utopia.sync.UtopiaLiveWorkspaceProofTest.liveGoogleSheetsWorkspaceExportsSeedRowsAndReadsThemBack'
fi
