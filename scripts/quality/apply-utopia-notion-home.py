#!/usr/bin/env python3
"""Install the decision-first Utopia home on the canonical Notion Today page.

The script is intentionally narrow:
- Reuses canonical Utopia databases and their seeded records.
- Creates only missing task records with stable `_ID` values.
- Saves a recursive JSON backup before replacing Today page blocks.
- Leaves explicit anchors for Notion-only linked-view/button setup.
- Never prints or writes secret values.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo


ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "build" / "utopia-notion-home-implementation"
OUT_DIR.mkdir(parents=True, exist_ok=True)

NOTION_VERSION = "2025-09-03"
TODAY_PAGE_ID = os.getenv("LIFEOS_TODAY_PAGE_ID", "3a45dd535a938112ab31f1fee2147d8b")
CONTROL_PLANE_URL = "https://app.notion.com/p/manasa-srinivas/Utopia-2026-Control-Plane-3a45dd535a9381409d0cde69ca18a21a"
FOOD_URL = "https://app.notion.com/p/Food-3a45dd535a9381c8bcc5daaf19dda1cc"
THIS_WEEK_URL = "https://app.notion.com/p/This-Week-3a45dd535a93811e9810cc87b64fda2e"
INBOX_URL = "https://app.notion.com/p/Inbox-3a45dd535a938137acc9eb0c38880e8d"

TASKS_DATABASE_ID = "e716a1f2-eac0-4f36-9d43-439992fdeef3"
TASKS_DATA_SOURCE_ID = "98e64955-dc3d-4c70-9058-72ca3e81932e"
TASKS_URL = "https://app.notion.com/p/e716a1f2eac04f369d43439992fdeef3"
MEALS_URL = "https://app.notion.com/p/ff5845730d9241458c3d3e591f5970d2"
MEAL_PLANS_URL = "https://app.notion.com/p/17e47090c0ee480fbc6780d2590463a4"
INVENTORY_URL = "https://app.notion.com/p/4758caaf3f614f0598508e75f8f26e22"
SHOPPING_URL = "https://app.notion.com/p/b9302602b33b4eec9ecf25f03b97f35b"
HEALTH_URL = "https://app.notion.com/p/723a74e089314c5d976dd001db503246"

PANTRY_TASK_ID = "3a45dd535a93817782fdd2ee9b835e22"
TONIGHT_MEAL_ID = "3a45dd535a9381cb8c8ac4e1216d276b"
HEALTH_TODAY_ID = "3a45dd535a9381ca8329dbff77c2c6b0"
SPINACH_LOT_URL = "https://app.notion.com/p/3a45dd535a9381a48aa1f351cbd6282b"
MILK_LINE_URL = "https://app.notion.com/p/3a45dd535a938137a069e6614d70730f"
TONIGHT_MEAL_URL = "https://app.notion.com/p/3a45dd535a9381cb8c8ac4e1216d276b"
TONIGHT_RECIPE_URL = "https://app.notion.com/p/3a45dd535a9381d0a6e0d43f8735cf9f"

HOME_MARKER = "WF_ANCHOR:LIFEOS_HOME_V2"


def request_json(method: str, url: str, body: object | None = None) -> dict:
    token = os.getenv("NOTION_TOKEN") or os.getenv("NOTION_API_KEY")
    if not token:
        raise RuntimeError("NOTION_TOKEN or NOTION_API_KEY missing")
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise RuntimeError(f"{method} {url} failed: HTTP {error.code}: {detail[:1000]}") from error


def rich_text(content: str, *, bold: bool = False, color: str = "default", link: str | None = None) -> dict:
    text: dict[str, object] = {"content": content}
    if link:
        text["link"] = {"url": link}
    return {
        "type": "text",
        "text": text,
        "annotations": {
            "bold": bold,
            "italic": False,
            "strikethrough": False,
            "underline": False,
            "code": False,
            "color": color,
        },
    }


def paragraph(parts: list[dict], *, color: str = "default") -> dict:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": parts, "color": color}}


def heading(content: str, level: int = 2) -> dict:
    kind = f"heading_{level}"
    return {"object": "block", "type": kind, kind: {"rich_text": [rich_text(content)]}}


def callout(parts: list[dict], icon: str, color: str) -> dict:
    return {
        "object": "block",
        "type": "callout",
        "callout": {"rich_text": parts, "icon": {"type": "emoji", "emoji": icon}, "color": color},
    }


def linked_line(label: str, detail: str, url: str) -> dict:
    return paragraph(
        [
            rich_text("□ ", color="gray"),
            rich_text(label, bold=True, link=url),
            rich_text(f"  ·  {detail}", color="gray"),
        ]
    )


def fetch_children(block_id: str) -> list[dict]:
    results: list[dict] = []
    cursor = ""
    while True:
        query = f"page_size=100{f'&start_cursor={cursor}' if cursor else ''}"
        payload = request_json("GET", f"https://api.notion.com/v1/blocks/{block_id}/children?{query}")
        results.extend(payload.get("results", []))
        if not payload.get("has_more"):
            return results
        cursor = payload.get("next_cursor", "")
        if not cursor:
            return results


def fetch_tree(block_id: str) -> list[dict]:
    tree: list[dict] = []
    for child in fetch_children(block_id):
        item = dict(child)
        if child.get("has_children"):
            item["_children"] = fetch_tree(child["id"])
        tree.append(item)
    return tree


def page_contains_marker() -> bool:
    return HOME_MARKER in json.dumps(fetch_tree(TODAY_PAGE_ID))


def repair_existing_install() -> dict:
    legacy_types = {"link_to_page", "table_of_contents"}
    setup_markers = {"/linked"}
    archived: list[str] = []
    errors: list[str] = []
    pending = list(fetch_tree(TODAY_PAGE_ID))
    while pending:
        child = pending.pop()
        pending.extend(child.get("_children", []))
        child_text = json.dumps(
            {key: value for key, value in child.items() if key != "_children"},
            ensure_ascii=False,
        )
        should_archive = (
            child.get("type") in legacy_types
            or "WF_UI_TODO:" in child_text
            or any(marker in child_text for marker in setup_markers)
        )
        if not should_archive:
            continue
        try:
            request_json("DELETE", f"https://api.notion.com/v1/blocks/{child['id']}")
            archived.append(child["id"])
        except RuntimeError:
            errors.append(child["id"])
        time.sleep(0.34)
    result = {
        "status": "already_installed_cleaned",
        "page_id": TODAY_PAGE_ID,
        "page_url": "https://app.notion.com/p/Today-3a45dd535a938112ab31f1fee2147d8b",
        "marker": HOME_MARKER,
        "archived_legacy_blocks": len(archived),
        "archive_errors": errors,
        "ui_todos": [],
    }
    (OUT_DIR / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def query_task(stable_id: str) -> dict | None:
    payload = request_json(
        "POST",
        f"https://api.notion.com/v1/data_sources/{TASKS_DATA_SOURCE_ID}/query",
        {"filter": {"property": "_ID", "rich_text": {"equals": stable_id}}, "page_size": 1},
    )
    return payload.get("results", [None])[0] if payload.get("results") else None


def upsert_task(*, stable_id: str, name: str, priority: str, context: str, due: str, notes: str) -> dict:
    properties = {
        "Name": {"title": [rich_text(name)]},
        "_ID": {"rich_text": [rich_text(stable_id)]},
        "_Schema": {"select": {"name": "1.0.0"}},
        "Status": {"select": {"name": "Planned"}},
        "Priority": {"select": {"name": priority}},
        "Context": {"multi_select": [{"name": context}]},
        "Due": {"date": {"start": due}},
        "Notes": {"rich_text": [rich_text(notes)]},
    }
    existing = query_task(stable_id)
    if existing:
        updated = request_json("PATCH", f"https://api.notion.com/v1/pages/{existing['id']}", {"properties": properties})
        return {"id": updated["id"], "url": updated.get("url", ""), "status": "updated"}
    created = request_json(
        "POST",
        "https://api.notion.com/v1/pages",
        {"parent": {"database_id": TASKS_DATABASE_ID}, "properties": properties},
    )
    return {"id": created["id"], "url": created.get("url", ""), "status": "created"}


def update_seed_dates(today: str) -> None:
    request_json(
        "PATCH",
        f"https://api.notion.com/v1/pages/{TONIGHT_MEAL_ID}",
        {"properties": {"Date": {"date": {"start": f"{today}T19:00:00.000-04:00"}}}},
    )
    request_json(
        "PATCH",
        f"https://api.notion.com/v1/pages/{HEALTH_TODAY_ID}",
        {"properties": {"Date": {"date": {"start": today}}}},
    )


def home_sections(tasks: dict[str, dict], today: str) -> list[dict]:
    dinner_parts = [
        rich_text("Dinner · Spinach tomato rice bowl\n", bold=True),
        rich_text("35 minutes. Uses the spinach expiring today and fits the active pantry-first plan.\n"),
        rich_text("Open meal", bold=True, link=TONIGHT_MEAL_URL),
        rich_text("  ·  "),
        rich_text("Open recipe", link=TONIGHT_RECIPE_URL),
    ]
    pantry_parts = [
        rich_text("Use first · Spinach expires today\n", bold=True),
        rich_text("200 g in the fridge · $3.49 at risk · already related to tonight’s recipe.\n"),
        rich_text("Open inventory lot", bold=True, link=SPINACH_LOT_URL),
    ]
    shopping_parts = [
        rich_text("Shop today · Milk\n", bold=True),
        rich_text("1 item · estimated $4.29 · needed today because stock is low.\n"),
        rich_text("Open shopping line", bold=True, link=MILK_LINE_URL),
    ]
    task_column = {
        "object": "block",
        "type": "column",
        "column": {
            "width_ratio": 0.62,
            "children": [
                heading("Today’s quests"),
                paragraph([rich_text("Four bounded actions. Open a quest to complete or edit it.", color="gray")]),
                linked_line("Audit fridge and pantry", "P1 · Kitchen", tasks["task.pantry"]["url"]),
                linked_line("Use spinach in dinner", "+ waste prevented", tasks["task.use_spinach_today"]["url"]),
                linked_line("Buy milk", "1 actual gap", tasks["task.buy_milk_today"]["url"]),
                linked_line("Rate dinner", "teach next week’s plan", tasks["task.rate_dinner"]["url"]),
            ],
        },
    }
    pulse_column = {
        "object": "block",
        "type": "column",
        "column": {
            "width_ratio": 0.38,
            "children": [
                heading("Daily pulse"),
                callout([rich_text("Energy\n", bold=True), rich_text("7 / 10 · Good")], "⚡", "blue_background"),
                callout([rich_text("Pantry risk\n", bold=True), rich_text("1 item · $3.49")], "🧊", "red_background"),
                callout([rich_text("Food budget\n", bold=True), rich_text("$4.29 planned today")], "💳", "yellow_background"),
                callout([rich_text("Week plan\n", bold=True), rich_text("1 meal · 430 kcal planned")], "🗓️", "green_background"),
                paragraph([rich_text("Open health log", link=HEALTH_URL)]),
            ],
        },
    }
    quick_column = {
        "object": "block",
        "type": "column",
        "column": {
            "width_ratio": 0.58,
            "children": [
                heading("Quick capture"),
                paragraph([rich_text("Capture first; classify later.", color="gray")]),
                paragraph([rich_text("Inbox", bold=True, link=INBOX_URL), rich_text("  ·  task, thought, receipt, craving")]),
                paragraph([rich_text("Food log", bold=True, link="https://app.notion.com/p/72b6d3d5604149e7a5fdf6bed68a7f7e"), rich_text("  ·  meal or health response")]),
                paragraph([rich_text("Shopping", bold=True, link=SHOPPING_URL), rich_text("  ·  actual grocery gap")]),
            ],
        },
    }
    navigation_column = {
        "object": "block",
        "type": "column",
        "column": {
            "width_ratio": 0.42,
            "children": [
                heading("Keep moving"),
                paragraph([rich_text("This Week", bold=True, link=THIS_WEEK_URL), rich_text("  ·  plan and review")]),
                paragraph([rich_text("Food HQ", bold=True, link=FOOD_URL), rich_text("  ·  kitchen, recipes, meals")]),
                paragraph([rich_text("Meal plan", bold=True, link=MEAL_PLANS_URL), rich_text("  ·  current week")]),
                paragraph([rich_text("Ask Utopia", bold=True), rich_text("  ·  open Android Chat")]),
            ],
        },
    }
    return [
        callout(
            [
                rich_text("Make dinner easy. Protect the evening.\n", bold=True),
                rich_text("One plan, three useful signals. Everything else can wait."),
            ],
            "🌿",
            "green_background",
        ),
        paragraph([rich_text(f"{dt.date.fromisoformat(today).strftime('%A · %B %-d')}  ·  Food is active", color="gray")]),
        heading("What needs your attention"),
        paragraph([rich_text("Ordered by time and consequence.", color="gray")]),
        callout(dinner_parts, "🍽️", "green_background"),
        callout(pantry_parts, "🥬", "red_background"),
        callout(shopping_parts, "🛒", "yellow_background"),
        {"object": "block", "type": "divider", "divider": {}},
        {"object": "block", "type": "column_list", "column_list": {"children": [task_column, pulse_column]}},
        {"object": "block", "type": "divider", "divider": {}},
        heading("Food week"),
        paragraph([rich_text("One glance, not another planner.", color="gray")]),
        callout(
            [
                rich_text("Week 30 · Pantry first\n", bold=True),
                rich_text("Tonight: Spinach tomato rice bowl · Thursday–Sunday remain open for real decisions.\n"),
                rich_text("Open weekly meal plan", bold=True, link=MEAL_PLANS_URL),
                rich_text("  ·  "),
                rich_text("Open meals", link=MEALS_URL),
            ],
            "🗓️",
            "blue_background",
        ),
        {"object": "block", "type": "divider", "divider": {}},
        {"object": "block", "type": "column_list", "column_list": {"children": [quick_column, navigation_column]}},
        {"object": "block", "type": "divider", "divider": {}},
        {
            "object": "block",
            "type": "toggle",
            "toggle": {
                "rich_text": [rich_text("System details", color="gray")],
                "children": [
                    paragraph([rich_text(HOME_MARKER, color="gray")]),
                    paragraph(
                        [
                            rich_text("Schemas, skills, MCP, sync, migrations and template QA live in the "),
                            rich_text("Utopia Control Plane", bold=True, link=CONTROL_PLANE_URL),
                            rich_text("."),
                        ]
                    ),
                    paragraph([rich_text("Canonical sources: Tasks", link=TASKS_URL), rich_text(" · "), rich_text("Inventory", link=INVENTORY_URL), rich_text(" · "), rich_text("Shopping", link=SHOPPING_URL)]),
                ],
            },
        },
    ]


def install() -> dict:
    if page_contains_marker():
        return repair_existing_install()

    now = dt.datetime.now(ZoneInfo("America/New_York"))
    today = now.date().isoformat()
    timestamp = now.strftime("%Y%m%d-%H%M%S")
    before = fetch_tree(TODAY_PAGE_ID)
    original_top_level = [
        child
        for child in fetch_children(TODAY_PAGE_ID)
        if child.get("type") not in {"child_page", "child_database"}
    ]
    backup_path = OUT_DIR / f"before-tree-{timestamp}.json"
    backup_path.write_text(json.dumps(before, indent=2), encoding="utf-8")

    update_seed_dates(today)
    tasks = {
        "task.pantry": upsert_task(
            stable_id="task.pantry",
            name="Audit fridge and pantry",
            priority="P1",
            context="Kitchen",
            due=today,
            notes="Find use-first ingredients before planning dinner.",
        ),
        "task.use_spinach_today": upsert_task(
            stable_id="task.use_spinach_today",
            name="Use spinach in dinner",
            priority="P1",
            context="Kitchen",
            due=today,
            notes="Use the expiring spinach in the active pantry-first meal plan.",
        ),
        "task.buy_milk_today": upsert_task(
            stable_id="task.buy_milk_today",
            name="Buy milk",
            priority="P1",
            context="Errand",
            due=today,
            notes="One actual shopping gap; estimated price $4.29.",
        ),
        "task.rate_dinner": upsert_task(
            stable_id="task.rate_dinner",
            name="Rate dinner after eating",
            priority="P2",
            context="Kitchen",
            due=today,
            notes="One-tap feedback should improve next week’s plan.",
        ),
    }

    request_json(
        "PATCH",
        f"https://api.notion.com/v1/pages/{TODAY_PAGE_ID}",
        {
            "icon": {"type": "emoji", "emoji": "☀️"},
            "cover": {
                "type": "external",
                "external": {
                    "url": "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=2400&q=88"
                },
            },
        },
    )
    appended = request_json(
        "PATCH",
        f"https://api.notion.com/v1/blocks/{TODAY_PAGE_ID}/children",
        {"children": home_sections(tasks, today)},
    )

    archived: list[str] = []
    archive_errors: list[str] = []
    for child in original_top_level:
        try:
            request_json("DELETE", f"https://api.notion.com/v1/blocks/{child['id']}")
            archived.append(child["id"])
        except RuntimeError:
            archive_errors.append(child["id"])
        time.sleep(0.34)

    result = {
        "status": "installed",
        "page_id": TODAY_PAGE_ID,
        "page_url": "https://app.notion.com/p/Today-3a45dd535a938112ab31f1fee2147d8b",
        "date": today,
        "archived_top_level_blocks": len(archived),
        "archive_errors": archive_errors,
        "backup": str(backup_path),
        "task_records": tasks,
        "appended_top_level_blocks": len(appended.get("results", [])),
        "ui_todos": ["TODAY_TASKS_VIEW", "MEALS_WEEK_VIEW", "QUICK_CAPTURE_BUTTONS"],
    }
    (OUT_DIR / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    public = install()
    print(json.dumps(public, indent=2))
