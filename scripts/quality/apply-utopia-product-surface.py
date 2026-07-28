#!/usr/bin/env python3
"""Apply product-facing Utopia labels/sections to live Notion + Google Sheets.

No secret values are printed. The script writes a compact evidence JSON.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "app/build/evidence/utopia-product-surface"
OUT_DIR.mkdir(parents=True, exist_ok=True)

NOTION_PAGE_ID = os.getenv("LIFEOS_NOTION_PAGE_ID", "").replace("-", "")
SPREADSHEET_ID = os.getenv("LIFEOS_SHEETS_ID", "")
TOKEN_FILE = pathlib.Path(os.getenv("GOOGLE_SHEETS_TOKEN_FILE", str(ROOT / "build/evidence/live-workspace/google-sheets-token.json")))
MARKER = "Utopia product surface installed by Utopia Android"
LIFERPG_MARKER = "Utopia benchmark folded into Utopia Utopia"
SYNC_LOOP_MARKER = "Utopia source sync loop installed by Utopia"
SOURCE_PACK_MARKER = "Utopia chat source pack installed by Utopia"
SKILL_ARCH_MARKER = "Utopia skill architecture installed by Utopia"
NOTION_VERSION = "2026-03-11"
OWNED_NOTION_MARKERS = [MARKER, LIFERPG_MARKER, SYNC_LOOP_MARKER, SOURCE_PACK_MARKER, SKILL_ARCH_MARKER]

if not NOTION_PAGE_ID or not SPREADSHEET_ID:
    raise RuntimeError("Set LIFEOS_NOTION_PAGE_ID and LIFEOS_SHEETS_ID explicitly.")


def request_json(method: str, url: str, headers: dict[str, str], body: object | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise RuntimeError(f"{method} {url} failed: HTTP {error.code}: {detail[:800]}") from error


def notion_headers() -> dict[str, str]:
    token = os.getenv("NOTION_TOKEN") or os.getenv("NOTION_API_KEY")
    if not token:
        raise RuntimeError("NOTION_TOKEN or NOTION_API_KEY missing")
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def fetch_notion_children(headers: dict[str, str], block_id: str = NOTION_PAGE_ID) -> list[dict]:
    children: list[dict] = []
    cursor = ""
    while True:
        query = f"page_size=100{f'&start_cursor={cursor}' if cursor else ''}"
        payload = request_json(
            "GET",
            f"https://api.notion.com/v1/blocks/{block_id}/children?{query}",
            headers,
        )
        children.extend(payload.get("results", []))
        if not payload.get("has_more"):
            return children
        cursor = payload.get("next_cursor", "")
        if not cursor:
            return children


def append_utopia_notion_section() -> dict:
    headers = notion_headers()
    children = fetch_notion_children(headers)
    existing_text = json.dumps(children)
    if MARKER in existing_text:
        return {"status": "already_present", "page_id": NOTION_PAGE_ID}

    blocks = [
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": "📱 Android product surface"}}]},
        },
        {
            "object": "block",
            "type": "callout",
            "callout": {
                "icon": {"emoji": "🧬"},
                "rich_text": [
                    {
                        "type": "text",
                        "text": {
                            "content": f"{MARKER}. Food is the active Day 0 domain; Health is a companion through Health Connect; package runtime comes from the domain catalog."
                        },
                    }
                ],
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "App: full-screen multi-turn Chat, source cards, markdown tables, draft review, Data Home links, Utopia control center."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Data planes: Notion, Google Sheets, SQLite/Postgres, Health Connect, and MCP all map to schema surfaces instead of proof-only pages."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Config source: app/src/main/assets/utopia/domain-catalog.v1.json controls active package metadata."}}]
            },
        },
    ]
    request_json(
        "PATCH",
        f"https://api.notion.com/v1/blocks/{NOTION_PAGE_ID}/children",
        headers,
        {"children": blocks},
    )
    return {"status": "appended", "page_id": NOTION_PAGE_ID}


def append_utopia_benchmark_section() -> dict:
    headers = notion_headers()
    children = fetch_notion_children(headers)
    existing_text = json.dumps(children)
    if LIFERPG_MARKER in existing_text:
        return {"status": "already_present", "page_id": NOTION_PAGE_ID}

    blocks = [
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": "🎮 Utopia benchmark upgrades"}}]},
        },
        {
            "object": "block",
            "type": "callout",
            "callout": {
                "icon": {"emoji": "🧭"},
                "rich_text": [
                    {
                        "type": "text",
                        "text": {
                            "content": f"{LIFERPG_MARKER}. Borrow the useful structure, not the toy skin: quests, habits, boss fights, P.A.R.A., daily journal, RPGenie-style assistant posture, sample/empty parity, and template health checks."
                        },
                    }
                ],
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Food quests: weekly cook/shop/clean/eat objectives linked to meals, groceries, recipes, spend, and Health Connect context."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Habit loops: water/protein/home-cooked/prep as positive loops; waste/overspend/duplicate-buying as review loops."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Template health: avoid frozen @now after duplication; keep sample and empty templates equivalent; surface relation/rollup/schema checks visibly."}}]
            },
        },
    ]
    request_json(
        "PATCH",
        f"https://api.notion.com/v1/blocks/{NOTION_PAGE_ID}/children",
        headers,
        {"children": blocks},
    )
    return {"status": "appended", "page_id": NOTION_PAGE_ID}


def append_sync_loop_section() -> dict:
    headers = notion_headers()
    children = fetch_notion_children(headers)
    existing_text = json.dumps(children)
    if SYNC_LOOP_MARKER in existing_text:
        return {"status": "already_present", "page_id": NOTION_PAGE_ID}

    blocks = [
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": "🔁 Source sync loop"}}]},
        },
        {
            "object": "block",
            "type": "callout",
            "callout": {
                "icon": {"emoji": "🔁"},
                "rich_text": [
                    {
                        "type": "text",
                        "text": {
                            "content": f"{SYNC_LOOP_MARKER}. Notion, Google Sheets, Android, and MCP/GPT now expose the same domain catalog, source cards, template health checks, and review-only command loop."
                        },
                    }
                ],
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Notion: human dashboard, relations, rollups, template health, and presentation layer."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Google Sheets: auditable workbook mirror with Utopia Runtime and Utopia Sync Loop tabs."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Android + MCP/GPT: native Food surface, source-quoting chat, schema/catalog resource, and review-only proposals."}}]
            },
        },
    ]
    request_json(
        "PATCH",
        f"https://api.notion.com/v1/blocks/{NOTION_PAGE_ID}/children",
        headers,
        {"children": blocks},
    )
    return {"status": "appended", "page_id": NOTION_PAGE_ID}


def append_source_pack_section() -> dict:
    headers = notion_headers()
    children = fetch_notion_children(headers)
    existing_text = json.dumps(children)
    if SOURCE_PACK_MARKER in existing_text:
        return {"status": "already_present", "page_id": NOTION_PAGE_ID}

    blocks = [
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": "📚 Chat source pack"}}]},
        },
        {
            "object": "block",
            "type": "callout",
            "callout": {
                "icon": {"emoji": "📚"},
                "rich_text": [
                    {
                        "type": "text",
                        "text": {
                            "content": f"{SOURCE_PACK_MARKER}. Android Chat should cite one compact source pack that points to app/local state, this Notion dashboard, the Google Sheets workbook, MCP schema resources, and template-health checks."
                        },
                    }
                ],
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "[App snapshot] Kitchen, shopping, recipes, meals, receipts, preferences, and Health Connect context visible to Chat."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "[Utopia Notion] Human dashboard: pretty presentation, relations, rollups, quests, habits, journal, financial/food vaults, and template health."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "[Utopia Sheets] Workbook mirror: schema rows, sync loop, source-pack handles, import/export checks, and conflict inbox model."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "[MCP schema] utopia://domain-catalog-v1 exposes package metadata for GPT/plugin parity."}}]
            },
        },
    ]
    request_json(
        "PATCH",
        f"https://api.notion.com/v1/blocks/{NOTION_PAGE_ID}/children",
        headers,
        {"children": blocks},
    )
    return {"status": "appended", "page_id": NOTION_PAGE_ID}


def append_skill_architecture_section() -> dict:
    headers = notion_headers()
    children = fetch_notion_children(headers)
    existing_text = json.dumps(children)
    if SKILL_ARCH_MARKER in existing_text:
        return {"status": "already_present", "page_id": NOTION_PAGE_ID}

    blocks = [
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": "🧠 Skill architecture + Notion UI installer"}}]},
        },
        {
            "object": "block",
            "type": "callout",
            "callout": {
                "icon": {"emoji": "🧠"},
                "rich_text": [
                    {
                        "type": "text",
                        "text": {
                            "content": f"{SKILL_ARCH_MARKER}. Use one domain skill per domain, workflow skills for reusable operating loops, and schemas as shared versioned contracts. Notion UI automation should target anchors, not screen coordinates."
                        },
                    }
                ],
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Domain skill: Food, Health, Plants, Finance. Owns tone, user goals, defaults, and domain vocabulary."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Workflow skill: weekly reset, grocery rescue, pantry boss fight, health export, template-health audit. Owns steps, gates, and review rules."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "Schema: command envelope, Notion/Sheets graph, Room tables, MCP resources. Validate and expose; do not create one top-level skill per table unless the table has behavior."}}]
            },
        },
        {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": "UI installer stance: API creates WF_ANCHOR and WF_UI_TODO blocks; Chrome/Playwright can finish native buttons, page templates, property order, and layout polish near those anchors."}}]
            },
        },
    ]
    request_json(
        "PATCH",
        f"https://api.notion.com/v1/blocks/{NOTION_PAGE_ID}/children",
        headers,
        {"children": blocks},
    )
    return {"status": "appended", "page_id": NOTION_PAGE_ID}


def cleanup_duplicate_owned_notion_sections() -> dict:
    headers = notion_headers()
    children = fetch_notion_children(headers)
    archived: list[str] = []
    kept: dict[str, int] = {}
    for marker in OWNED_NOTION_MARKERS:
        sections: list[list[str]] = []
        for index, block in enumerate(children):
            if marker not in json.dumps(block):
                continue
            start = index - 1 if index > 0 and children[index - 1].get("type") == "heading_2" else index
            end = start + 1
            while end < len(children) and (end == start or children[end].get("type") not in {"heading_1", "heading_2"}):
                end += 1
            sections.append([item["id"] for item in children[start:end] if item.get("id")])
        kept[marker] = 1 if sections else 0
        for duplicate_section in sections[1:]:
            for block_id in duplicate_section:
                request_json("DELETE", f"https://api.notion.com/v1/blocks/{block_id}", headers)
                archived.append(block_id)
    return {"status": "cleaned", "archived_blocks": len(archived), "markers_seen": kept}


def google_access_token() -> str:
    direct = os.getenv("GOOGLE_SHEETS_ACCESS_TOKEN", "")
    if direct:
        return direct
    if not TOKEN_FILE.exists():
        raise RuntimeError(f"Google Sheets token file missing: {TOKEN_FILE}")
    cached = json.loads(TOKEN_FILE.read_text())
    refresh = cached.get("refresh_token", "")
    if not refresh:
        token = cached.get("access_token", "")
        if token:
            return token
        raise RuntimeError("Google Sheets token cache has no refresh_token/access_token")
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise RuntimeError("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing")
    data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as response:
        refreshed = json.loads(response.read().decode("utf-8"))
    cached.update(refreshed)
    cached["refresh_token"] = refresh
    TOKEN_FILE.write_text(json.dumps(cached))
    return cached.get("access_token", "")


def sheets_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def update_utopia_sheet() -> dict:
    token = google_access_token()
    if not token:
        raise RuntimeError("Google Sheets access token missing")
    headers = sheets_headers(token)
    metadata = request_json("GET", f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}", headers)
    sheets = metadata.get("sheets", [])
    existing = {sheet["properties"]["title"]: sheet["properties"]["sheetId"] for sheet in sheets}
    requests: list[dict] = [
        {"updateSpreadsheetProperties": {"properties": {"title": "Utopia 2026 — Utopia Product Runtime"}, "fields": "title"}}
    ]
    runtime_sheet_id = existing.get("Utopia Runtime")
    sync_loop_sheet_id = existing.get("Utopia Sync Loop")
    source_pack_sheet_id = existing.get("Utopia Source Pack")
    skill_map_sheet_id = existing.get("Utopia Skill Map")
    if runtime_sheet_id is None:
        requests.append(
            {
                "addSheet": {
                    "properties": {
                        "title": "Utopia Runtime",
                        "gridProperties": {"rowCount": 80, "columnCount": 10},
                        "tabColor": {"red": 0.18, "green": 0.38, "blue": 0.27},
                    }
                }
            }
        )
    if sync_loop_sheet_id is None:
        requests.append(
            {
                "addSheet": {
                    "properties": {
                        "title": "Utopia Sync Loop",
                        "gridProperties": {"rowCount": 80, "columnCount": 8},
                        "tabColor": {"red": 0.37, "green": 0.24, "blue": 0.70},
                    }
                }
            }
        )
    if source_pack_sheet_id is None:
        requests.append(
            {
                "addSheet": {
                    "properties": {
                        "title": "Utopia Source Pack",
                        "gridProperties": {"rowCount": 80, "columnCount": 8},
                        "tabColor": {"red": 0.12, "green": 0.50, "blue": 0.75},
                    }
                }
            }
        )
    if skill_map_sheet_id is None:
        requests.append(
            {
                "addSheet": {
                    "properties": {
                        "title": "Utopia Skill Map",
                        "gridProperties": {"rowCount": 80, "columnCount": 8},
                        "tabColor": {"red": 0.62, "green": 0.34, "blue": 0.12},
                    }
                }
            }
        )
    request_json(
        "POST",
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
        headers,
        {"requests": requests},
    )
    metadata = request_json("GET", f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}", headers)
    existing = {sheet["properties"]["title"]: sheet["properties"]["sheetId"] for sheet in metadata.get("sheets", [])}
    runtime_sheet_id = existing["Utopia Runtime"]
    sync_loop_sheet_id = existing["Utopia Sync Loop"]
    source_pack_sheet_id = existing["Utopia Source Pack"]
    skill_map_sheet_id = existing["Utopia Skill Map"]

    values = [
        ["Utopia 2026 — Product Runtime", "", "", ""],
        ["Marker", MARKER, "", ""],
        ["Active domain", "Food", "Day 0 native app surface", "Configured"],
        ["Companion domain", "Health", "Health Connect granted/read/write where available", "Configured"],
        ["Template domain", "Plants", "Zero-code package sanity check", "Template-ready"],
        ["Source model", "domain-catalog.v1.json", "Tabs, skills, schema surfaces, data planes", "Packaged in APK"],
        ["Data plane", "Notion", "Utopia 2026 dashboard + linked databases", "Primary presentation"],
        ["Data plane", "Google Sheets", "Workbook tabs mirror schema surfaces", "Spreadsheet-primary"],
        ["Data plane", "SQLite/Postgres", "Canonical store + hosted snapshot route", "Runtime"],
        ["AI/MCP", "Utopia Chat", "Multi-turn, sources, markdown tables, proposal review", "Runtime"],
        ["MCP", "Official MCP SDK /mcp endpoint", "Scoped resources, tools, validation, proposals, workflows", "Ready"],
        ["Benchmark", "Utopia 2.0", "Quests, habits, boss fights, P.A.R.A., RPGenie, sample/empty parity", "Borrowed"],
        ["Food loop", "Food quests", "Weekly cook/shop/clean/eat objectives", "Config"],
        ["Food loop", "Good habits", "Water, protein, home-cooked meals, prep blocks", "Config"],
        ["Food loop", "Bad-habit reviews", "Waste, missed meals, overspend, duplicate buying", "Config"],
        ["Template health", "@now duplication risk", "Prefer explicit dynamic date buttons/checks and visible health checklist", "Required"],
        ["Template health", "Source quoting", "App/local, Notion, Sheets, MCP, and web/file sources visible in chat", "Required"],
    ]
    value_url = f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/{urllib.parse.quote('Utopia Runtime!A1:D40')}"
    request_json("PUT", value_url + "?valueInputOption=RAW", headers, {"values": values})
    sync_values = [
        ["Utopia 2026 — Source Sync Loop", "", "", "", ""],
        ["Hop", "Surface", "Role", "Current evidence", "Next product bar"],
        ["1", "Notion", "Human data plane: dashboards, relations, rollups, template health", "Utopia 2026 page updated", "Bidirectional schema diff + source snippets for chat"],
        ["2", "Google Sheets", "Spreadsheet-primary mirror: auditable rows, formulas, imports/exports", "Utopia Runtime + Sync Loop tabs updated", "Formula-backed schema health + conflict inbox"],
        ["3", "Android", "Native Food app: review queue, local canonical store, Health Connect context", "S23U installed and screenshots captured", "Background sync jobs + source cards from active data home"],
        ["4", "MCP/GPT", "Skills, schemas, validation, review-only command envelopes", "domain-catalog resource exposed", "GPT/plugin parity with Android chat behavior"],
        ["Template health", "@now risk", "Avoid frozen duplication timestamps", "Utopia benchmark added", "Visible checks in every domain template"],
        ["Source quoting", "Chat", "Answers receive source-pack prompt context and show app/local, Notion, Sheets, MCP, web/file source cards", "S23U source-card screenshot captured", "Live Notion/Sheets snippet retrieval"],
    ]
    sync_value_url = f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/{urllib.parse.quote('Utopia Sync Loop!A1:E40')}"
    request_json("PUT", sync_value_url + "?valueInputOption=RAW", headers, {"values": sync_values})
    source_values = [
        ["Utopia 2026 — Chat Source Pack", "", "", "", ""],
        ["Marker", SOURCE_PACK_MARKER, "", "", ""],
        ["Citation handle", "Surface", "What Chat can quote", "Pointer", "Borrowed benchmark idea"],
        ["[App snapshot]", "Android", "Kitchen, shopping, recipes, meal logs/plans, receipts, preferences, Health Connect context injected into Chat prompt", "On-device canonical store", "Native first, not toy page"],
        ["[Utopia Notion]", "Notion", "Dashboards, relations, rollups, quests, habits, journal, vaults, template health", f"https://app.notion.com/p/manasa-srinivas/Utopia-2026-{NOTION_PAGE_ID}", "Pretty + interconnected dashboard"],
        ["[Utopia Sheets]", "Google Sheets", "Schema rows, imports/exports, formula checks, conflict inbox, source handles", f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit", "Spreadsheet-primary operating mode"],
        ["[MCP schema]", "MCP/GPT", "Domain catalog, skills, command schemas, validation, review-only links", "utopia://domain-catalog-v1", "GPT/plugin parity"],
        ["[Template health]", "Notion + Sheets + App", "@now duplication risk, sample/empty parity, relation/rollup checks, source visibility", "Utopia Runtime + Sync Loop tabs", "Utopia quality gate"],
        ["[Food domain]", "Day 0 package", "Food quests, good/bad habits, boss fights, meal plans, inventory, grocery spend", "assets/utopia/domain-catalog.v1.json", "Food-centered Utopia"],
        ["[Skill map]", "App + Notion + Sheets + MCP", "Domain skill + workflow skill + schema contract rule", "Utopia Skill Map", "GPT/plugin parity"],
    ]
    source_value_url = f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/{urllib.parse.quote('Utopia Source Pack!A1:E40')}"
    request_json("PUT", source_value_url + "?valueInputOption=RAW", headers, {"values": source_values})
    skill_values = [
        ["Utopia 2026 — Skill Architecture", "", "", "", ""],
        ["Marker", SKILL_ARCH_MARKER, "", "", ""],
        ["Layer", "Granularity", "Examples", "Owns", "Why"],
        ["Domain skill", "One per domain package", "Food, Health, Plants, Finance", "Tone, goals, vocabulary, defaults, safety", "User-facing brain for a Utopia area"],
        ["Workflow skill", "One per repeated operating loop", "Weekly reset, Grocery rescue, Pantry boss fight, Health export, Template audit", "Steps, gates, review rules, acceptance criteria", "Reusable playbook across app, Notion, Sheets, GPT/MCP"],
        ["Schema contract", "Versioned file/resource, not usually a skill", "Command envelope, Room tables, Notion/Sheets graph, MCP resources", "Fields, validation, migrations, sync parity", "Shared contract clients can execute against"],
        ["UI installer anchor", "One stable anchor per Notion UI-only task", "WF_ANCHOR: Grocery Button Slot, WF_UI_TODO: create native button", "Browser automation target and QA proof", "Avoid brittle raw coordinates"],
        ["Runtime rule", "Compose layers", "Food domain skill + grocery rescue workflow + command envelope schema", "GPT-like answer, review-only write, source cards", "Same behavior in Android and GPT/plugin/MCP"],
    ]
    skill_value_url = f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/{urllib.parse.quote('Utopia Skill Map!A1:E40')}"
    request_json("PUT", skill_value_url + "?valueInputOption=RAW", headers, {"values": skill_values})
    request_json(
        "POST",
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
        headers,
        {
            "requests": [
                {
                    "repeatCell": {
                        "range": {"sheetId": existing.get("Utopia Runtime", runtime_sheet_id or 0), "startRowIndex": 0, "endRowIndex": 1},
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True, "fontSize": 14}}},
                        "fields": "userEnteredFormat.textFormat",
                    }
                },
                {
                    "autoResizeDimensions": {
                        "dimensions": {"sheetId": runtime_sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 4}
                    }
                },
                {
                    "repeatCell": {
                        "range": {"sheetId": sync_loop_sheet_id, "startRowIndex": 0, "endRowIndex": 2},
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                        "fields": "userEnteredFormat.textFormat",
                    }
                },
                {
                    "autoResizeDimensions": {
                        "dimensions": {"sheetId": sync_loop_sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 5}
                    }
                },
                {
                    "repeatCell": {
                        "range": {"sheetId": source_pack_sheet_id, "startRowIndex": 0, "endRowIndex": 3},
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                        "fields": "userEnteredFormat.textFormat",
                    }
                },
                {
                    "autoResizeDimensions": {
                        "dimensions": {"sheetId": source_pack_sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 5}
                    }
                },
                {
                    "repeatCell": {
                        "range": {"sheetId": skill_map_sheet_id, "startRowIndex": 0, "endRowIndex": 3},
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                        "fields": "userEnteredFormat.textFormat",
                    }
                },
                {
                    "autoResizeDimensions": {
                        "dimensions": {"sheetId": skill_map_sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 5}
                    }
                },
            ]
        },
    )
    return {"status": "updated", "spreadsheet_id": SPREADSHEET_ID, "sheets": ["Utopia Runtime", "Utopia Sync Loop", "Utopia Source Pack", "Utopia Skill Map"]}


def main() -> int:
    result: dict[str, object] = {"captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    errors: list[str] = []
    try:
        result["notion"] = append_utopia_notion_section()
    except Exception as error:  # noqa: BLE001
        errors.append(f"notion: {error}")
    try:
        result["notion_utopia"] = append_utopia_benchmark_section()
    except Exception as error:  # noqa: BLE001
        errors.append(f"notion_utopia: {error}")
    try:
        result["notion_sync_loop"] = append_sync_loop_section()
    except Exception as error:  # noqa: BLE001
        errors.append(f"notion_sync_loop: {error}")
    try:
        result["notion_source_pack"] = append_source_pack_section()
    except Exception as error:  # noqa: BLE001
        errors.append(f"notion_source_pack: {error}")
    try:
        result["notion_skill_architecture"] = append_skill_architecture_section()
    except Exception as error:  # noqa: BLE001
        errors.append(f"notion_skill_architecture: {error}")
    try:
        result["notion_duplicate_cleanup"] = cleanup_duplicate_owned_notion_sections()
    except Exception as error:  # noqa: BLE001
        errors.append(f"notion_duplicate_cleanup: {error}")
    try:
        result["google_sheets"] = update_utopia_sheet()
    except Exception as error:  # noqa: BLE001
        errors.append(f"google_sheets: {error}")
    result["errors"] = errors
    result["ok"] = not errors
    out = OUT_DIR / f"utopia-product-surface-{int(time.time())}.json"
    out.write_text(json.dumps(result, indent=2))
    print(out)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
