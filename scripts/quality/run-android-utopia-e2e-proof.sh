#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK_PATH="$PROJECT_DIR/app/build/outputs/apk/play/debug/app-play-debug.apk"
OUT_DIR="$PROJECT_DIR/app/build/evidence/android-utopia-e2e/android-utopia-e2e-$(date +%s)"
DEVICE_SERIAL="${1:-}"
if [[ -n "$DEVICE_SERIAL" ]]; then
  export LIFEOS_ANDROID_SERIAL="$DEVICE_SERIAL"
fi
node "$PROJECT_DIR/scripts/quality/require-disposable-lane.mjs" device
NOTION_URL="${WONDERFOOD_PROOF_NOTION_URL:-}"
SHEETS_URL="${WONDERFOOD_PROOF_SHEETS_URL:-}"

if [[ -z "$NOTION_URL" || -z "$SHEETS_URL" ]]; then
  echo "Set WONDERFOOD_PROOF_NOTION_URL and WONDERFOOD_PROOF_SHEETS_URL." >&2
  exit 2
fi

mkdir -p "$OUT_DIR"

run_limited() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
  else
    "$@"
  fi
}

tap_ui_node() {
  local query="$1"
  local dump_path="$OUT_DIR/tap-window.xml"
  run_limited 10 adb -s "$DEVICE_SERIAL" shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || return 1
  run_limited 10 adb -s "$DEVICE_SERIAL" shell cat /sdcard/window.xml > "$dump_path" 2>/dev/null || return 1
  local coords
  coords="$(python3 - "$dump_path" "$query" <<'PY'
import html
import re
import sys
import xml.etree.ElementTree as ET

path, query = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()
for node in root.iter("node"):
    text = html.unescape(node.attrib.get("text", ""))
    desc = html.unescape(node.attrib.get("content-desc", ""))
    if query not in (text, desc):
        continue
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
    if not match:
        continue
    left, top, right, bottom = map(int, match.groups())
    print((left + right) // 2, (top + bottom) // 2)
    break
PY
)"
  [[ -n "$coords" ]] || return 1
  run_limited 10 adb -s "$DEVICE_SERIAL" shell input tap $coords
}

if [[ -z "$DEVICE_SERIAL" ]]; then
  DEVICE_SERIAL="$(adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')"
fi

adb devices -l > "$OUT_DIR/adb-devices.txt"
adb mdns services > "$OUT_DIR/adb-mdns.txt" || true

if [[ -z "$DEVICE_SERIAL" ]]; then
  echo '{"all_checks_passed":false,"error":"no_adb_device"}' > "$OUT_DIR/android-utopia-e2e-proof.json"
  echo "$OUT_DIR/android-utopia-e2e-proof.json"
  exit 2
fi

(cd "$PROJECT_DIR" && ./gradlew :app:assemblePlayDebug >/dev/null)

encoded_notion="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$NOTION_URL")"
encoded_sheets="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SHEETS_URL")"
proof_uri="utopia://proof-pack?requestId=android-utopia-e2e&notion=${encoded_notion}&sheets=${encoded_sheets}"

run_limited 60 adb -s "$DEVICE_SERIAL" install -r "$APK_PATH" > "$OUT_DIR/install.txt"
run_limited 20 adb -s "$DEVICE_SERIAL" shell dumpsys package app.utopia > "$OUT_DIR/package.txt" || true

if [[ "$DEVICE_SERIAL" == emulator-* ]]; then
  run_limited 15 adb -s "$DEVICE_SERIAL" shell am start -n app.utopia/.MainActivity > "$OUT_DIR/launcher.txt" || true
  sleep 5
  run_limited 10 adb -s "$DEVICE_SERIAL" shell am force-stop app.utopia || true
  run_limited 10 adb -s "$DEVICE_SERIAL" shell "printf '%s\n' '<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\" ?>' '<map>' '</map>' | run-as app.utopia tee shared_prefs/utopia_shell.xml >/dev/null" \
    > "$OUT_DIR/reset-proof-prefs.txt" 2>&1 || true
fi

run_limited 15 adb -s "$DEVICE_SERIAL" shell \
  "am start -a android.intent.action.VIEW -d '$proof_uri' app.utopia/.MainActivity" \
  > "$OUT_DIR/proof-pack-start.txt"

proof_saved=false
for _ in $(seq 1 25); do
  run_limited 10 adb -s "$DEVICE_SERIAL" shell run-as app.utopia cat shared_prefs/utopia_shell.xml \
    > "$OUT_DIR/utopia_shell.xml" 2>/dev/null || true
  if grep -q "Utopia-2026" "$OUT_DIR/utopia_shell.xml" &&
     grep -q "docs.google.com/spreadsheets" "$OUT_DIR/utopia_shell.xml"; then
    proof_saved=true
    break
  fi
  sleep 1
done

run_limited 20 adb -s "$DEVICE_SERIAL" shell appops get app.utopia > "$OUT_DIR/appops.txt" 2>&1 || true
run_limited 20 adb -s "$DEVICE_SERIAL" exec-out screencap -p > "$OUT_DIR/current-screen.png" 2>/dev/null || true
run_limited 20 adb -s "$DEVICE_SERIAL" shell uiautomator dump /sdcard/window.xml > "$OUT_DIR/uiautomator-dump-status.txt" 2>&1 || true
run_limited 20 adb -s "$DEVICE_SERIAL" shell cat /sdcard/window.xml > "$OUT_DIR/window.xml" 2>/dev/null || true

if [[ "$DEVICE_SERIAL" == emulator-* ]]; then
  tap_ui_node "Open settings" || run_limited 10 adb -s "$DEVICE_SERIAL" shell input tap 976 169 || true
  sleep 1
  tap_ui_node "Data home" || run_limited 10 adb -s "$DEVICE_SERIAL" shell input tap 300 2052 || true
  sleep 1
  run_limited 10 adb -s "$DEVICE_SERIAL" shell input swipe 520 1780 520 1220 400 || true
  sleep 1
  run_limited 10 adb -s "$DEVICE_SERIAL" shell input swipe 520 1780 520 1220 400 || true
  sleep 1
  run_limited 20 adb -s "$DEVICE_SERIAL" exec-out screencap -p > "$OUT_DIR/data-home-proof-pack.png" 2>/dev/null || true
  run_limited 20 adb -s "$DEVICE_SERIAL" shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
  run_limited 20 adb -s "$DEVICE_SERIAL" shell cat /sdcard/window.xml > "$OUT_DIR/data-home-window.xml" 2>/dev/null || true
fi

health_declared=false
health_appops=false
grep -q "android.permission.health.READ_STEPS" "$OUT_DIR/package.txt" && health_declared=true
grep -q "READ_WRITE_HEALTH_DATA: allow" "$OUT_DIR/appops.txt" && health_appops=true

proof_ui=false
if [[ -f "$OUT_DIR/data-home-window.xml" ]] &&
   grep -q "Template model" "$OUT_DIR/data-home-window.xml" &&
   grep -q "Open Sheets workbook" "$OUT_DIR/data-home-window.xml"; then
  proof_ui=true
fi

python3 - "$OUT_DIR" "$DEVICE_SERIAL" "$proof_saved" "$proof_ui" "$health_declared" "$health_appops" "$NOTION_URL" "$SHEETS_URL" <<'PY'
import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
data = {
    "device_serial": sys.argv[2],
    "device_is_emulator": sys.argv[2].startswith("emulator-"),
    "proof_pack_saved": sys.argv[3] == "true",
    "proof_pack_ui_visible": sys.argv[4] == "true",
    "health_permissions_declared": sys.argv[5] == "true",
    "health_appops_allow": sys.argv[6] == "true",
    "notion_url": sys.argv[7],
    "sheets_url": sys.argv[8],
    "artifacts": {
        "prefs": str(out / "utopia_shell.xml"),
        "current_screen": str(out / "current-screen.png"),
        "data_home_screen": str(out / "data-home-proof-pack.png"),
        "window": str(out / "data-home-window.xml"),
        "adb_devices": str(out / "adb-devices.txt"),
        "adb_mdns": str(out / "adb-mdns.txt"),
        "package": str(out / "package.txt"),
        "appops": str(out / "appops.txt"),
    },
}
data["all_checks_passed"] = (
    data["proof_pack_saved"]
    and data["health_permissions_declared"]
    and data["health_appops_allow"]
    and (data["proof_pack_ui_visible"] if data["device_is_emulator"] else True)
)
(out / "android-utopia-e2e-proof.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
print(out / "android-utopia-e2e-proof.json")
PY
