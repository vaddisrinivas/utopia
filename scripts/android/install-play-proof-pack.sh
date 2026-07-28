#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK_PATH="$PROJECT_DIR/app/build/outputs/apk/play/debug/app-play-debug.apk"
DEVICE_SERIAL="${1:-}"
NOTION_URL="${WONDERFOOD_PROOF_NOTION_URL:-}"
SHEETS_URL="${WONDERFOOD_PROOF_SHEETS_URL:-}"

if [[ -z "$NOTION_URL" || -z "$SHEETS_URL" ]]; then
  echo "Set WONDERFOOD_PROOF_NOTION_URL and WONDERFOOD_PROOF_SHEETS_URL." >&2
  exit 2
fi

if [[ -z "$DEVICE_SERIAL" ]]; then
  DEVICE_SERIAL="$(adb devices | awk 'NR > 1 && $2 == "device" && $1 !~ /^emulator-/ { print $1; exit }')"
fi

if [[ -z "$DEVICE_SERIAL" ]]; then
  echo "No physical ADB device found. Connect S23U with USB or wireless debugging, then rerun." >&2
  adb devices -l >&2
  exit 2
fi

if [[ ! -f "$APK_PATH" ]]; then
  (cd "$PROJECT_DIR" && ./gradlew :app:assemblePlayDebug)
fi

encoded_notion="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$NOTION_URL")"
encoded_sheets="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SHEETS_URL")"
proof_uri="utopia://proof-pack?requestId=proof-pack-phone&notion=${encoded_notion}&sheets=${encoded_sheets}"

adb -s "$DEVICE_SERIAL" install -r "$APK_PATH"
adb -s "$DEVICE_SERIAL" shell \
  "am start -a android.intent.action.VIEW -d '$proof_uri' app.utopia/.MainActivity"

echo "Installed playDebug and seeded Utopia template links on $DEVICE_SERIAL"
