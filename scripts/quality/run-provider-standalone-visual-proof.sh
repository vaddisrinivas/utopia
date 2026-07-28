#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
STAMP="$(date +%s)"
OUT_DIR="${PROVIDER_VISUAL_OUT:-app/build/evidence/live-workspace/provider-standalone-authority-$STAMP}"
mkdir -p "$OUT_DIR"

AGENT_ENV_WRAPPER="$HOME/.codex/skills/agent-env/scripts/run-with-agent-env.sh"
if [[ "${WONDERFOOD_LIVE_PROOF_SKIP_AGENT_ENV:-0}" != "1" &&
      -x "$AGENT_ENV_WRAPPER" &&
      -f "$HOME/.config/agent-secrets/agent.env" ]]; then
  WONDERFOOD_LIVE_PROOF_SKIP_AGENT_ENV=1 exec "$AGENT_ENV_WRAPPER" "$0" "$@"
fi

node scripts/quality/require-disposable-lane.mjs provider notion
node scripts/quality/require-disposable-lane.mjs provider sheets

NOTION_SCENARIO_OUT="$OUT_DIR" ./scripts/quality/run-notion-scenario-proof.sh >/dev/null
GOOGLE_SHEETS_SCENARIO_OUT="$OUT_DIR" ./scripts/quality/run-google-sheets-scenario-proof.sh >/dev/null
PROVIDER_WRITEBACK_OUT="$OUT_DIR" NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/tmp/utopia-npm-cache}" npm run check:live-provider-writeback >/dev/null

PROVIDER_VISUAL_OUT="$OUT_DIR" python3 - <<'PY'
import glob
import hashlib
import html
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

out_dir = Path(os.environ["PROVIDER_VISUAL_OUT"])

def latest(pattern):
    matches = list(out_dir.glob(pattern))
    if not matches:
        raise SystemExit(f"missing evidence {pattern}")
    return max(matches, key=lambda path: path.stat().st_mtime)

def load(path):
    with open(path) as handle:
        return json.load(handle)

notion_path = latest("notion_scenarios-*.json")
sheets_path = latest("google_sheets_scenarios-*.json")
writeback_path = latest("direct_provider_writeback-*.json")
notion = load(notion_path)
sheets = load(sheets_path)
writeback = load(writeback_path)

writeback_results = {item.get("provider"): item for item in writeback.get("results", [])}
notion_write = writeback_results.get("notion", {})
sheets_write = writeback_results.get("google_sheets", {})
secret_visible = not (
    notion.get("no_token_or_secret_visible")
    and sheets.get("no_token_or_secret_visible")
    and writeback.get("no_token_or_secret_visible")
)

checks = {
    "notion_scenario_passed": bool(notion.get("all_scenarios_passed")),
    "notion_seed_exported": bool(notion.get("app_create_exported_seed")),
    "notion_edit_pull_read_back": bool(notion.get("notion_edit_pull_read_back")),
    "notion_archive_read_back": bool(notion.get("archive_read_back")),
    "notion_undo_archive_read_back": bool(notion.get("undo_archive_read_back")),
    "notion_repair_verified": bool(notion.get("repair_verified")),
    "notion_cleanup_done": bool(notion.get("cleanup_scenario_page_trashed")),
    "sheets_scenario_passed": bool(sheets.get("all_scenarios_passed")),
    "sheets_seed_exported": bool(sheets.get("app_create_exported_seed")),
    "sheets_edit_read_back": bool(sheets.get("live_edit_row")),
    "sheets_archive_read_back": bool(sheets.get("live_archive_status_read_back")),
    "sheets_undo_archive_read_back": bool(sheets.get("live_undo_archive_read_back")),
    "sheets_repair_verified": bool(sheets.get("repair_header_restored")),
    "writeback_live_passed": bool(writeback.get("all_passed")),
    "notion_create_update_archive_delivered": (
        notion_write.get("delivery_status") == "delivered"
        and notion_write.get("update_delivery_status") == "delivered"
        and notion_write.get("archive_delivery_status") == "delivered"
    ),
    "notion_restore_delivered": (
        notion_write.get("restore_delivery_status") == "delivered"
        and bool(notion_write.get("restore_read_back_visible"))
    ),
    "sheets_create_update_archive_delivered": (
        sheets_write.get("delivery_status") == "delivered"
        and sheets_write.get("update_delivery_status") == "delivered"
        and sheets_write.get("archive_delivery_status") == "delivered"
        and bool(sheets_write.get("archive_read_back_found"))
    ),
    "sheets_restore_delivered": (
        sheets_write.get("restore_delivery_status") == "delivered"
        and bool(sheets_write.get("restore_read_back_found"))
    ),
    "no_token_or_secret_visible": not secret_visible,
}

payload = {
    "proof": "provider_standalone_authority_receipt",
    "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "git": {
        "branch": subprocess.check_output(["git", "branch", "--show-current"], text=True).strip(),
        "head": subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip(),
        "tree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip(),
        "dirty": bool(subprocess.check_output(["git", "status", "--porcelain=v1"], text=True).strip()),
        "dirty_diff_hash": subprocess.check_output(["node", "--input-type=module", "-e", "import { currentDirtyDiffHash } from './scripts/quality/evidence-provenance.mjs'; process.stdout.write(currentDirtyDiffHash(process.cwd()));"], text=True).strip(),
    },
    "captured_at": writeback.get("captured_at") or sheets.get("captured_at") or notion.get("captured_at"),
    "notion_evidence": notion_path.name,
    "sheets_evidence": sheets_path.name,
    "writeback_evidence": writeback_path.name,
    "notion_page_id": notion.get("page_id"),
    "sheets_spreadsheet_id": sheets.get("spreadsheet_id") or sheets_write.get("spreadsheet_id"),
    "notion_kitchen_properties_seen": notion.get("kitchen_properties_seen", []),
    "notion_shopping_properties_seen": notion.get("shopping_properties_seen", []),
    "sheets_seed_pull_read_tables": sheets.get("seed_pull_read_tables", []),
    "writeback_results": writeback.get("results", []),
    "checks": checks,
    "all_authority_checks_passed": all(checks.values()),
}
payload["failed_checks"] = [key for key, value in checks.items() if not value]

json_path = out_dir / "provider-standalone-authority-proof.json"
with open(json_path, "w") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)

def badge(value):
    return "PASS" if value else "FAIL"

def row(name, value):
    css = "pass" if value else "fail"
    return f"<tr><td>{html.escape(name)}</td><td class='{css}'>{badge(value)}</td></tr>"

rows = "\n".join(row(key, value) for key, value in checks.items())
write_rows = "\n".join(
    f"<tr><td>{html.escape(str(item.get('provider')))}</td><td>{html.escape(str(item.get('delivery_status')))}</td><td>{html.escape(str(item.get('update_delivery_status')))}</td><td>{html.escape(str(item.get('archive_delivery_status')))}</td><td>{html.escape(str(item.get('restore_delivery_status')))}</td></tr>"
    for item in writeback.get("results", [])
)

html_path = out_dir / "provider-standalone-authority-proof.html"
html_doc = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Utopia Provider Authority Receipt</title>
<style>
body {{ margin:0; background:#f6f3ea; color:#1d211a; font:15px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }}
main {{ max-width:1120px; margin:0 auto; padding:32px; }}
h1 {{ margin:0; font-size:34px; }}
h2 {{ margin-top:28px; }}
.summary {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:22px 0; }}
.card {{ background:#fffaf0; border:1px solid #ded5c2; border-radius:18px; padding:16px; box-shadow:0 10px 30px rgba(45,35,20,.08); }}
.big {{ font-size:28px; font-weight:800; }}
.pass {{ color:#23613d; font-weight:800; }}
.fail {{ color:#9b2c24; font-weight:800; }}
table {{ width:100%; border-collapse:collapse; background:#fff; border-radius:16px; overflow:hidden; }}
td,th {{ border-bottom:1px solid #eee4d0; padding:10px 12px; text-align:left; vertical-align:top; }}
th {{ background:#efe7d4; }}
code {{ background:#efe7d4; padding:2px 5px; border-radius:5px; }}
</style>
</head>
<body>
<main>
<h1>Utopia Provider Authority Receipt</h1>
<p>Live user-token Notion and Google Sheets authority proof. This does not depend on the Android app being open.</p>
<div class="summary">
<div class="card"><div class="big {'pass' if payload['all_authority_checks_passed'] else 'fail'}">{badge(payload['all_authority_checks_passed'])}</div><div>overall authority gate</div></div>
<div class="card"><div class="big">{len(payload['notion_kitchen_properties_seen'])}</div><div>Notion Kitchen properties seen</div></div>
<div class="card"><div class="big">{len(payload['sheets_seed_pull_read_tables'])}</div><div>Sheets tables read back</div></div>
<div class="card"><div class="big {'pass' if checks['no_token_or_secret_visible'] else 'fail'}">{badge(checks['no_token_or_secret_visible'])}</div><div>secret visibility</div></div>
</div>
<h2>Checks</h2>
<table><tbody>{rows}</tbody></table>
<h2>Writeback delivery</h2>
<table><thead><tr><th>Provider</th><th>Create</th><th>Update</th><th>Archive</th><th>Restore</th></tr></thead><tbody>{write_rows}</tbody></table>
<h2>Evidence files</h2>
<ul>
<li><code>{html.escape(payload['notion_evidence'])}</code></li>
<li><code>{html.escape(payload['sheets_evidence'])}</code></li>
<li><code>{html.escape(payload['writeback_evidence'])}</code></li>
</ul>
</main>
</body>
</html>"""
with open(html_path, "w") as handle:
    handle.write(html_doc)

print(json_path)
print(html_path)
if not payload["all_authority_checks_passed"]:
    raise SystemExit("failed authority checks: " + ", ".join(payload["failed_checks"]))
PY

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [[ -x "$CHROME" ]]; then
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,1800 \
    --screenshot="$OUT_DIR/provider-standalone-authority-proof.png" \
    "file://$ROOT_DIR/$OUT_DIR/provider-standalone-authority-proof.html" >/dev/null 2>&1 || true
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=390,1800 \
    --screenshot="$OUT_DIR/provider-standalone-authority-proof-mobile.png" \
    "file://$ROOT_DIR/$OUT_DIR/provider-standalone-authority-proof.html" >/dev/null 2>&1 || true
fi

echo "$OUT_DIR/provider-standalone-authority-proof.json"
