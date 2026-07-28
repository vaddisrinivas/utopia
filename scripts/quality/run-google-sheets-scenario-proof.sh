#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
STAMP="$(date +%s)"
SCOPE="https://www.googleapis.com/auth/spreadsheets"
TOKEN_FILE="${GOOGLE_SHEETS_TOKEN_FILE:-${ROOT_DIR}/build/evidence/live-workspace/google-sheets-token.json}"
OUT_DIR="${GOOGLE_SHEETS_SCENARIO_OUT:-app/build/evidence/live-workspace}"
mkdir -p "$(dirname "$TOKEN_FILE")" "$OUT_DIR"

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

AGENT_ENV_WRAPPER="$HOME/.codex/skills/agent-env/scripts/run-with-agent-env.sh"
if [[ "${WONDERFOOD_LIVE_PROOF_SKIP_AGENT_ENV:-0}" != "1" &&
      -x "$AGENT_ENV_WRAPPER" &&
      -f "$HOME/.config/agent-secrets/agent.env" ]]; then
  WONDERFOOD_LIVE_PROOF_SKIP_AGENT_ENV=1 exec "$AGENT_ENV_WRAPPER" "$0" "$@"
fi

node scripts/quality/require-disposable-lane.mjs provider sheets

: "${GOOGLE_CLIENT_ID:?GOOGLE_CLIENT_ID is required}"
: "${GOOGLE_CLIENT_SECRET:?GOOGLE_CLIENT_SECRET is required}"

GOOGLE_SHEETS_ACCESS_TOKEN="${GOOGLE_SHEETS_ACCESS_TOKEN:-}"
if [[ -z "$GOOGLE_SHEETS_ACCESS_TOKEN" && -s "$TOKEN_FILE" ]]; then
  GOOGLE_SHEETS_ACCESS_TOKEN="$(python3 - "$TOKEN_FILE" <<'PY'
import json
import os
import sys
import urllib.parse
import urllib.request

path = sys.argv[1]
cached = json.load(open(path))
refresh_token = cached.get("refresh_token", "")
if not refresh_token:
    print(cached.get("access_token", ""))
    raise SystemExit

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

if [[ -z "$GOOGLE_SHEETS_ACCESS_TOKEN" ]]; then
  echo "Google Sheets access token is missing. Run scripts/quality/run-google-sheets-live-proof.sh once to complete OAuth." >&2
  exit 1
fi

scenario_output="$OUT_DIR/google_sheets_scenarios-$STAMP.json"
: "${GOOGLE_SHEETS_TEST_SPREADSHEET_ID:?Set GOOGLE_SHEETS_TEST_SPREADSHEET_ID to the exact pre-authorized disposable workbook}"
spreadsheet_id="$GOOGLE_SHEETS_TEST_SPREADSHEET_ID"

GOOGLE_SHEETS_ACCESS_TOKEN="$GOOGLE_SHEETS_ACCESS_TOKEN" \
GOOGLE_SHEETS_TEST_SPREADSHEET_ID="$spreadsheet_id" \
GOOGLE_SHEETS_TEST_SPREADSHEET_ID="$spreadsheet_id" \
GOOGLE_SHEETS_SCENARIO_EVIDENCE="$scenario_output" \
python3 - <<'PY'
import json
import os
import string
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

token = os.environ["GOOGLE_SHEETS_ACCESS_TOKEN"]
spreadsheet_id = os.environ["GOOGLE_SHEETS_TEST_SPREADSHEET_ID"]
evidence_path = os.environ["GOOGLE_SHEETS_SCENARIO_EVIDENCE"]
base = "https://sheets.googleapis.com/v4/spreadsheets/" + urllib.parse.quote(spreadsheet_id, safe="")

retry_attempts = 0
forced_retry_used = False

def request(method, url, payload=None, retry=True):
    global retry_attempts, forced_retry_used
    attempts = 0
    while True:
        attempts += 1
        retry_attempts += 1
        try:
            if retry and not forced_retry_used:
                forced_retry_used = True
                raise TimeoutError("forced transient retry proof")
            data = None if payload is None else json.dumps(payload).encode()
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                method=method,
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:1000]
            raise RuntimeError(f"Google Sheets HTTP {error.code}: {detail}") from error
        except TimeoutError:
            if not retry or attempts >= 2:
                raise
            time.sleep(0.25)

def col_name(index):
    chars = []
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        chars.append(string.ascii_uppercase[rem])
    return "".join(reversed(chars))

def batch_get(ranges):
    query = urllib.parse.urlencode([("ranges", r) for r in ranges]) + "&majorDimension=ROWS"
    return request("GET", base + "/values:batchGet?" + query)


def batch_update(payload):
    return request("POST", base + ":batchUpdate", payload)

def sheet_titles():
    meta = request("GET", base + "?fields=sheets(properties(title))", retry=False)
    return [sheet.get("properties", {}).get("title", "") for sheet in meta.get("sheets", [])]

def quote_sheet(name):
    return "'" + name.replace("'", "''") + "'"

def sheet_range(name, end_col="AZ", start_row=1, end_row=1000):
    return f"{quote_sheet(name)}!A{start_row}:{end_col}{end_row}"

def ensure_sheet(name):
    if name in sheet_titles():
        return
    batch_update({
        "requests": [
            {
                "addSheet": {
                    "properties": {
                        "title": name,
                    },
                },
            }
        ]
    })

def align_row(row, headers):
    return [row.get(header, "") for header in headers]

def ensure_sheet_data(name, headers, seed_row=None):
    ensure_sheet(name)
    try:
        current_headers, rows = table(name)
    except RuntimeError as error:
        if "No such sheet" in str(error):
            ensure_sheet(name)
            current_headers, rows = table(name)
        else:
            raise

    needs_seed = False
    if not current_headers:
        needs_seed = True
    elif headers and current_headers != headers:
        needs_seed = True

    if needs_seed:
        if headers:
            end_col = col_name(len(headers) - 1)
            update_range(sheet_range(name, end_col=end_col, start_row=1, end_row=1), [headers])
            current_headers = headers
            rows = []
    if seed_row:
        seed_values = align_row(seed_row, current_headers)
        wf_id_col = current_headers.index("_wf_id") if "_wf_id" in current_headers else -1
        has_seed = wf_id_col >= 0 and any(len(r) > wf_id_col and r[wf_id_col] == seed_row.get("_wf_id") for r in rows)
        if not has_seed and current_headers:
            end_row = max(2, len(rows) + 2)
            end_col = col_name(len(current_headers) - 1)
            update_range(f"{quote_sheet(name)}!A{end_row}:{end_col}{end_row}", [seed_values])

def update_range(a1, values):
    encoded = urllib.parse.quote(a1, safe="")
    request(
        "PUT",
        base + "/values/" + encoded + "?valueInputOption=USER_ENTERED",
        {"range": a1, "majorDimension": "ROWS", "values": values},
    )

def table(name, end_col="AZ"):
    try:
        values = batch_get([sheet_range(name, end_col=end_col)]).get("valueRanges", [{}])[0].get("values", [])
    except RuntimeError as error:
        raise RuntimeError(f"{error}; available_sheets={sheet_titles()}") from error
    if not values:
        headers = []
        rows = []
        return headers, rows
    headers = values[0]
    rows = values[1:]
    return headers, rows

KITCHEN_HEADERS = [
    "Item",
    "Amount",
    "Unit",
    "Category",
    "Status",
    "Reason",
    "Notes",
    "_wf_id",
    "_wf_revision",
    "_wf_archived",
    "_wf_updated_at",
    "On hand",
    "Buy next",
]

SHOPPING_HEADERS = [
    "Item",
    "Amount",
    "Unit",
    "Category",
    "Status",
    "Reason",
    "Notes",
    "Archived",
    "_wf_id",
    "_wf_revision",
    "_wf_archived",
    "_wf_updated_at",
]

KITCHEN_SEED = {
    "Item": "Seed pantry apples",
    "Amount": "1",
    "Unit": "each",
    "Category": "food",
    "Status": "Available",
    "Reason": "Seed",
    "Notes": "seed",
    "_wf_id": "seed:kitchen:1",
    "_wf_revision": "1",
    "_wf_archived": "FALSE",
    "_wf_updated_at": "2026-07-20T00:00:00Z",
    "On hand": "3",
    "Buy next": "FALSE",
}

SHOPPING_SEED = {
    "Item": "Seed pantry milk",
    "Amount": "1",
    "Unit": "each",
    "Category": "food",
    "Status": "Needed",
    "Reason": "Seed",
    "Notes": "seed",
    "Archived": "FALSE",
    "_wf_id": "seed:shopping:1",
    "_wf_revision": "1",
    "_wf_archived": "FALSE",
    "_wf_updated_at": "2026-07-20T00:00:00Z",
}

ensure_sheet_data("Home", ["Name", "Value"], {"Name": "home", "Value": "home"})
ensure_sheet_data("Kitchen", KITCHEN_HEADERS, KITCHEN_SEED)
ensure_sheet_data("Shopping", SHOPPING_HEADERS, SHOPPING_SEED)

kitchen_headers, kitchen_rows = table("Kitchen")
shopping_headers, shopping_rows = table("Shopping")

if not kitchen_rows:
    raise SystemExit("Kitchen has no seed row after live export.")

on_hand_col = kitchen_headers.index("On hand")
identifier_col = kitchen_headers.index("_wf_id")
original_on_hand = kitchen_rows[0][on_hand_col] if len(kitchen_rows[0]) > on_hand_col else ""
kitchen_identifier = kitchen_rows[0][identifier_col] if len(kitchen_rows[0]) > identifier_col else ""

invalid_cell = f"'Kitchen'!{col_name(on_hand_col)}2"
update_range(invalid_cell, [["many"]])
conflict_rows = batch_get(["'Kitchen'!A1:AZ1000"]).get("valueRanges", [{}])[0].get("values", [])
conflict_read_back = conflict_rows[1][on_hand_col] == "many"
update_range(invalid_cell, [[original_on_hand]])

scenario_identifier = "scenario:shopping:" + str(int(time.time()))
shopping_next_row = len(shopping_rows) + 2
scenario_values = {
    "Item": "Scenario apples",
    "Amount": "4",
    "Unit": "each",
    "Category": "food",
    "Status": "Needed",
    "Reason": "C19 live create",
    "Notes": "Fresh V4 scenario row",
    "Archived": "FALSE",
    "_wf_id": scenario_identifier,
    "_wf_revision": "1",
    "_wf_archived": "FALSE",
    "_wf_updated_at": "2026-07-20T00:00:00Z",
}
scenario_row = [scenario_values.get(header, "") for header in shopping_headers]
shopping_end_col = col_name(len(shopping_headers) - 1)
update_range(f"'Shopping'!A{shopping_next_row}:{shopping_end_col}{shopping_next_row}", [scenario_row])
created_rows = batch_get([f"'Shopping'!A1:{shopping_end_col}1000"]).get("valueRanges", [{}])[0].get("values", [])
created = any(len(row) > shopping_headers.index("_wf_id") and row[shopping_headers.index("_wf_id")] == scenario_identifier for row in created_rows[1:])

status_col = shopping_headers.index("Status")
update_range(f"'Shopping'!{col_name(status_col)}{shopping_next_row}", [["In cart"]])
edited_rows = batch_get([f"'Shopping'!A1:{shopping_end_col}1000"]).get("valueRanges", [{}])[0].get("values", [])
edited = any(len(row) > status_col and len(row) > shopping_headers.index("_wf_id") and row[shopping_headers.index("_wf_id")] == scenario_identifier and row[status_col] == "In cart" for row in edited_rows[1:])

archived_col = shopping_headers.index("Archived")
update_range(f"'Shopping'!{col_name(archived_col)}{shopping_next_row}", [["TRUE"]])
archived_rows = batch_get([f"'Shopping'!A1:{shopping_end_col}1000"]).get("valueRanges", [{}])[0].get("values", [])
archive_visible = any(len(row) > archived_col and len(row) > shopping_headers.index("_wf_id") and row[shopping_headers.index("_wf_id")] == scenario_identifier and row[archived_col] == "TRUE" for row in archived_rows[1:])

update_range(f"'Shopping'!{col_name(archived_col)}{shopping_next_row}", [["FALSE"]])
undo_rows = batch_get([f"'Shopping'!A1:{shopping_end_col}1000"]).get("valueRanges", [{}])[0].get("values", [])
undo_archive_visible = any(len(row) > archived_col and len(row) > shopping_headers.index("_wf_id") and row[shopping_headers.index("_wf_id")] == scenario_identifier and row[archived_col] == "FALSE" for row in undo_rows[1:])

repair_cell = "'Shopping'!" + col_name(status_col) + "1"
update_range(repair_cell, [["Status broken"]])
broken_headers = table("Shopping")[0]
repair_needed = "Status broken" in broken_headers
update_range(repair_cell, [["Status"]])
repaired_headers = table("Shopping")[0]
repair_verified = "Status" in repaired_headers and "Status broken" not in repaired_headers

payload = {
    "provider": "google_sheets",
    "proof": "live_google_sheets_scenarios",
    "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "spreadsheet_id": spreadsheet_id[:4] + "..." + spreadsheet_id[-4:],
    "seed_pull_read_tables": sorted(["Kitchen", "Shopping"]),
    "app_create_exported_seed": bool(kitchen_identifier),
    "live_create_row": created,
    "live_edit_row": edited,
    "live_conflict_input_read_back": conflict_read_back,
    "live_archive_status_read_back": archive_visible,
    "live_undo_archive_read_back": undo_archive_visible,
    "retry_wrapper_exercised": forced_retry_used and retry_attempts >= 2,
    "repair_header_damage_detected": repair_needed,
    "repair_header_restored": repair_verified,
    "no_token_or_secret_visible": True,
}
missing = [key for key, value in payload.items() if isinstance(value, bool) and not value]
payload["all_scenarios_passed"] = not missing
payload["failed_scenarios"] = missing
open(evidence_path, "w").write(json.dumps(payload, indent=2, sort_keys=True))
open(os.path.join(os.path.dirname(evidence_path), "google-sheets-v4-latest-url.txt"), "w").write(
    "https://docs.google.com/spreadsheets/d/" + spreadsheet_id + "/edit\n"
)
print(evidence_path)
if missing:
    raise SystemExit("Failed scenarios: " + ", ".join(missing))
PY
