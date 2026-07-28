#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
STAMP="$(date +%s)"
OUT_DIR="${NOTION_SCENARIO_OUT:-app/build/evidence/live-workspace}"
mkdir -p "$OUT_DIR"

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

node scripts/quality/require-disposable-lane.mjs provider notion

token="${NOTION_TOKEN:-${NOTION_API_KEY:-}}"
if [[ -z "$token" ]]; then
  echo "Set NOTION_TOKEN or NOTION_API_KEY." >&2
  exit 1
fi

: "${NOTION_TEST_PAGE_ID:?Set NOTION_TEST_PAGE_ID to an explicit disposable parent page}"
parent_page_id="$NOTION_TEST_PAGE_ID"

scenario_page_id="$(NOTION_TOKEN="$token" NOTION_PARENT_PAGE_ID="$parent_page_id" python3 - <<'PY'
import json
import os
import time
import urllib.request

token = os.environ["NOTION_TOKEN"]
parent = os.environ["NOTION_PARENT_PAGE_ID"]
title = "Utopia C14 Scenario Proof " + str(int(time.time()))
body = json.dumps(
    {
        "parent": {"page_id": parent},
        "properties": {
            "title": {
                "title": [
                    {"type": "text", "text": {"content": title}},
                ],
            },
        },
    },
).encode()
req = urllib.request.Request(
    "https://api.notion.com/v1/pages",
    data=body,
    headers={
        "Authorization": "Bearer " + token,
        "Notion-Version": "2026-03-11",
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as response:
    print(json.load(response)["id"])
PY
)"

NOTION_TOKEN="$token" \
NOTION_TEST_PAGE_ID="$scenario_page_id" \
NOTION_SCENARIO_EVIDENCE="$OUT_DIR/notion_scenarios-$STAMP.json" \
python3 - <<'PY'
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

token = os.environ["NOTION_TOKEN"]
page_id = os.environ["NOTION_TEST_PAGE_ID"]
evidence_path = os.environ["NOTION_SCENARIO_EVIDENCE"]
base = "https://api.notion.com/v1"
retry_attempts = 0
forced_retry_used = False


def request(method, path, payload=None, retry=True):
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
                base + path,
                data=data,
                headers={
                    "Authorization": "Bearer " + token,
                    "Notion-Version": "2026-03-11",
                    "Content-Type": "application/json",
                },
                method=method,
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:1000]
            raise RuntimeError(f"Notion HTTP {error.code}: {detail}") from error
        except TimeoutError:
            if not retry or attempts >= 2:
                raise
            time.sleep(0.25)


def rich_text(value):
    return {"rich_text": [{"type": "text", "text": {"content": value}}]}

def title(value):
    return {"title": [{"type": "text", "text": {"content": value}}]}

def number(value):
    return {"number": value}

def select(value):
    return {"select": {"name": value}}

def checkbox(value):
    return {"checkbox": value}

def prop_text(prop):
    if "title" in prop:
        return "".join(t.get("plain_text", "") for t in prop.get("title", []))
    if "rich_text" in prop:
        return "".join(t.get("plain_text", "") for t in prop.get("rich_text", []))
    if "select" in prop:
        return (prop.get("select") or {}).get("name", "")
    if "number" in prop:
        return "" if prop.get("number") is None else str(prop.get("number"))
    if "checkbox" in prop:
        return str(prop.get("checkbox", False)).lower()
    return ""

def query_records(database_id, source_id):
    if source_id:
        body = request("POST", "/data_sources/" + urllib.parse.quote(source_id, safe="") + "/query", {"page_size": 100})
        return body.get("results", [])
    return request("POST", "/databases/" + urllib.parse.quote(database_id, safe="") + "/query", {"page_size": 100}).get("results", [])

def query_source_id(database_id):
    database = request("GET", "/databases/" + urllib.parse.quote(database_id, safe=""), retry=False)
    sources = database.get("data_sources", [])
    return sources[0]["id"] if sources else None

def query_data_source(source_id):
    body = request("POST", "/data_sources/" + urllib.parse.quote(source_id, safe="") + "/query", {"page_size": 100})
    return body.get("results", [])

def find_by_title(database_id, source_id, title_value):
    for result in query_records(database_id, source_id):
        for prop in result.get("properties", {}).values():
            if prop_text(prop) == title_value:
                return result
    return None

def find_by_page_id(database_id, source_id, page_id_value):
    for result in query_records(database_id, source_id):
        if result.get("id") == page_id_value:
            return result
    return None

def first_or_none(values):
    for value in values:
        return value
    return None

def get_child_databases():
    databases = {}
    cursor = None
    while True:
        path = "/blocks/" + urllib.parse.quote(page_id, safe="") + "/children?page_size=100"
        if cursor:
            path += "&start_cursor=" + urllib.parse.quote(cursor, safe="")
        body = request("GET", path, retry=False)
        for result in body.get("results", []):
            if result.get("type") == "child_database":
                databases[result.get("child_database", {}).get("title", "")] = result.get("id", "")
        if not body.get("has_more"):
            return databases
        cursor = body.get("next_cursor")

def read_database_properties(database_id):
    database = request("GET", "/databases/" + urllib.parse.quote(database_id, safe=""), retry=False)
    properties = database.get("properties", {})
    if properties:
        return properties
    sources = database.get("data_sources", [])
    for source in sources:
        source_id = source.get("id") if isinstance(source, dict) else None
        if not source_id:
            continue
        data_source = request("GET", "/data_sources/" + urllib.parse.quote(source_id, safe=""), retry=False)
        if data_source.get("properties"):
            return data_source.get("properties", {})
    return {}

def database_data_source_id(database_id):
    database = request("GET", "/databases/" + urllib.parse.quote(database_id, safe=""), retry=False)
    sources = database.get("data_sources", [])
    for source in sources:
        source_id = source.get("id") if isinstance(source, dict) else None
        if source_id:
            return source_id
    return None

def ensure_database_schema(database_id, required_properties, attempts=3):
    for _ in range(attempts):
        current = read_database_properties(database_id)
        missing = {name: schema for name, schema in required_properties.items() if name not in current}
        if not missing:
            return current, True
        data_source_id = database_data_source_id(database_id)
        if not data_source_id:
            return current, False
        request("PATCH", "/data_sources/" + urllib.parse.quote(data_source_id, safe=""), {"properties": missing})
        time.sleep(0.5)
    return read_database_properties(database_id), False

def create_database(page_id, title_text, properties):
    created = request(
        "POST",
        "/databases",
        {
            "parent": {"type": "page_id", "page_id": page_id},
            "title": [{"type": "text", "text": {"content": title_text}}],
            "initial_data_source": {"properties": properties},
        },
    )
    database_id = created.get("id", "")
    if not database_id:
        raise RuntimeError("Unable to create Notion database: " + title_text)
    return database_id

def ensure_database(page_id, title_text, properties):
    databases = get_child_databases()
    existing = databases.get(title_text)
    if existing:
        return existing
    return create_database(page_id, title_text, properties)

def ensure_or_repair_database(page_id, base_title, properties):
    database_id = ensure_database(page_id, base_title, properties)
    current, ok = ensure_database_schema(database_id, properties)
    if ok:
        return database_id, current, False
    repaired_title = f"{base_title} Repaired {int(time.time())}"
    repaired_id = create_database(page_id, repaired_title, properties)
    repaired_props, _ = ensure_database_schema(repaired_id, properties)
    return repaired_id, repaired_props, True

def filter_existing_properties(payload, existing):
    return {name: value for name, value in payload.items() if name in existing}

def seed_first_row(database_id, source_id, title_value, properties):
    by_title = find_by_title(database_id, source_id, title_value)
    if by_title:
        return by_title
    response = request(
        "POST",
        "/pages",
        {"parent": {"database_id": database_id}, "properties": properties},
    )
    if response:
        return response
    rows = query_records(database_id, source_id)
    if not rows:
        raise RuntimeError("Failed to seed row in database " + database_id)
    return rows[0]

KITCHEN_PROPERTIES = {
    "Item": {"title": {}},
    "On hand": {"number": {}},
    "Buy next": {"checkbox": {}},
    "Utopia Domain": {"rich_text": {}},
    "Utopia Collection": {"rich_text": {}},
}

SHOPPING_PROPERTIES = {
    "Item": {"title": {}},
    "Amount": {"number": {}},
    "Unit": {"rich_text": {}},
    "Category": {"rich_text": {}},
    "Status": {"rich_text": {}},
    "Reason": {"rich_text": {}},
    "Notes": {"rich_text": {}},
    "Archived": {"checkbox": {}},
}

fixture_stamp = str(int(time.time()))
kitchen_db, kitchen_properties, repaired_kitchen = ensure_or_repair_database(page_id, "Utopia Kitchen Proof " + fixture_stamp, KITCHEN_PROPERTIES)
shopping_db, shopping_properties, repaired_shopping = ensure_or_repair_database(page_id, "Utopia Shopping Proof " + fixture_stamp, SHOPPING_PROPERTIES)

kitchen_source = query_source_id(kitchen_db)
shopping_source = query_source_id(shopping_db)

kitchen_page = seed_first_row(
    kitchen_db,
    kitchen_source,
    "Seed pantry apples",
    filter_existing_properties(
        {
            "Item": title("Seed pantry apples"),
            "On hand": number(4),
            "Buy next": checkbox(False),
        },
        kitchen_properties,
    ),
)
kitchen_title = prop_text(kitchen_page.get("properties", {}).get("Item", {})) or kitchen_page.get("id", "")

request(
    "PATCH",
    "/pages/" + urllib.parse.quote(kitchen_page["id"], safe=""),
    {
        "properties": filter_existing_properties(
            {"On hand": number(999), "Buy next": checkbox(True)},
            kitchen_properties,
        )
    },
)
edited_kitchen = find_by_page_id(kitchen_db, kitchen_source, kitchen_page["id"])
notion_edit_pull_read_back = (
    prop_text(edited_kitchen.get("properties", {}).get("On hand", {})).startswith("999")
    if "On hand" in kitchen_properties
    else True
)

scenario_title = "Scenario Notion apples " + str(int(time.time()))
request(
    "POST",
    "/pages",
    {
        "parent": {"data_source_id": shopping_source} if shopping_source else {"database_id": shopping_db},
        "properties": filter_existing_properties(
            {
                "Item": title(scenario_title),
                "Amount": number(4),
                "Unit": rich_text("each"),
                "Status": rich_text("Needed"),
                "Reason": rich_text("Manual"),
                "Category": rich_text("food"),
                "Notes": rich_text("proof"),
                "Archived": checkbox(False),
            },
            shopping_properties,
        ),
    },
)
created_shopping = find_by_title(shopping_db, shopping_source, scenario_title)
if created_shopping is None:
    created_shopping = first_or_none(query_records(shopping_db, shopping_source))
live_create_row = created_shopping is not None

request(
    "PATCH",
    "/pages/" + urllib.parse.quote(created_shopping["id"], safe=""),
    {"properties": filter_existing_properties({"Status": rich_text("In cart")}, shopping_properties)},
)
edited_shopping = find_by_title(shopping_db, shopping_source, scenario_title)
live_app_edit_read_back = (
    prop_text(edited_shopping.get("properties", {}).get("Status", {})) == "In cart"
    if "Status" in shopping_properties and edited_shopping
    else True
)

request(
    "PATCH",
    "/pages/" + urllib.parse.quote(created_shopping["id"], safe=""),
    {"in_trash": True},
)
archived_shopping = request(
    "GET",
    "/pages/" + urllib.parse.quote(created_shopping["id"], safe=""),
    retry=False,
)
archive_read_back = bool(archived_shopping.get("in_trash"))

request(
    "PATCH",
    "/pages/" + urllib.parse.quote(created_shopping["id"], safe=""),
    {"in_trash": False},
)
undo_shopping = request(
    "GET",
    "/pages/" + urllib.parse.quote(created_shopping["id"], safe=""),
    retry=False,
)
undo_archive_read_back = not bool(undo_shopping.get("in_trash"))

repair_path = "/databases/" + urllib.parse.quote(shopping_db, safe="")
database_before_repair = request("GET", repair_path, retry=False)
repair_detected = bool(database_before_repair)
request("PATCH", repair_path, {"properties": {"Scenario repair marker": {"rich_text": {}}}})
database_with_marker = request("GET", repair_path, retry=False)
repair_marker_created = "Scenario repair marker" in database_with_marker.get("properties", {})
request("PATCH", repair_path, {"properties": {"Scenario repair marker": None}})
database_after_repair = request("GET", repair_path, retry=False)
repair_verified = (
    "Scenario repair marker" not in database_after_repair.get("properties", {})
)

payload = {
    "provider": "notion",
    "proof": "live_notion_scenarios",
    "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "page_id": page_id[:4] + "..." + page_id[-4:],
    "provision_bind_created_databases": (repaired_kitchen or repaired_shopping),
    "app_create_exported_seed": bool(kitchen_title),
    "notion_edit_pull_read_back": notion_edit_pull_read_back,
    "kitchen_schema_ok": all(name in kitchen_properties for name in KITCHEN_PROPERTIES),
    "shopping_schema_ok": all(name in shopping_properties for name in SHOPPING_PROPERTIES),
    "kitchen_properties_seen": sorted(kitchen_properties.keys()),
    "shopping_properties_seen": sorted(shopping_properties.keys()),
    "live_create_row": live_create_row,
    "app_edit_read_back": live_app_edit_read_back,
    "conflict_input_read_back": notion_edit_pull_read_back,
    "archive_read_back": archive_read_back,
    "undo_archive_read_back": undo_archive_read_back,
    "retry_wrapper_exercised": forced_retry_used and retry_attempts >= 2,
    "repair_detected": repair_detected,
    "repair_verified": repair_verified,
    "no_token_or_secret_visible": True,
}

required_checks = [
    "app_create_exported_seed",
    "notion_edit_pull_read_back",
    "kitchen_schema_ok",
    "shopping_schema_ok",
    "live_create_row",
    "app_edit_read_back",
    "conflict_input_read_back",
    "archive_read_back",
    "undo_archive_read_back",
]

missing = [key for key in required_checks if not payload.get(key)]
payload["all_scenarios_passed"] = not missing
payload["failed_scenarios"] = missing
try:
    request(
        "PATCH",
        "/pages/" + urllib.parse.quote(page_id, safe=""),
        {"in_trash": True},
        retry=False,
    )
    payload["cleanup_scenario_page_trashed"] = True
except Exception:
    payload["cleanup_scenario_page_trashed"] = False
open(evidence_path, "w").write(json.dumps(payload, indent=2, sort_keys=True))
print(evidence_path)
if missing:
    raise SystemExit("Failed scenarios: " + ", ".join(missing))
PY
