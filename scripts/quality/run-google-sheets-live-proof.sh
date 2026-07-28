#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
node "$ROOT_DIR/scripts/quality/require-disposable-lane.mjs" provider sheets
: "${GOOGLE_SHEETS_TEST_SPREADSHEET_ID:?Set GOOGLE_SHEETS_TEST_SPREADSHEET_ID to an explicit disposable workbook}"
SPREADSHEET_ID="$GOOGLE_SHEETS_TEST_SPREADSHEET_ID"
SCOPE="https://www.googleapis.com/auth/spreadsheets"
REDIRECT_PORT="${GOOGLE_OAUTH_REDIRECT_PORT:-8765}"
REDIRECT_URI="http://127.0.0.1:${REDIRECT_PORT}/callback"
TOKEN_FILE="${GOOGLE_SHEETS_TOKEN_FILE:-${ROOT_DIR}/build/evidence/live-workspace/google-sheets-token.json}"
mkdir -p "$(dirname "$TOKEN_FILE")"

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

if [[ -z "${GOOGLE_SHEETS_ACCESS_TOKEN:-}" ]]; then
  echo "Google Sheets access token is missing after OAuth." >&2
  exit 1
fi

cd "$ROOT_DIR"
GOOGLE_SHEETS_ACCESS_TOKEN="$GOOGLE_SHEETS_ACCESS_TOKEN" \
GOOGLE_SHEETS_TEST_SPREADSHEET_ID="$SPREADSHEET_ID" \
./gradlew :app:testPlayDebugUnitTest --tests 'app.utopia.sync.UtopiaLiveWorkspaceProofTest.liveGoogleSheetsWorkspaceExportsSeedRowsAndReadsThemBack'
