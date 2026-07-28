#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ADB="${ADB:-adb}"
PKG="${PKG:-app.utopia}"
OUT_DIR_DEFAULT="build/evidence/external-automation-$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${1:-$OUT_DIR_DEFAULT}"
mkdir -p "$OUT_DIR"

serial_adb() {
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    "$ADB" -s "$ANDROID_SERIAL" "$@"
  else
    "$ADB" "$@"
  fi
}

log_command() {
  printf "%s\n" "$*" | tee -a "$OUT_DIR/commands.log"
  "$@"
}

run_with_delay() {
  log_command "$@"
  sleep 2
}

collect_route_evidence() {
  local route_label="$1"
  local dir="$OUT_DIR/${route_label}"
  mkdir -p "$dir"
  "$ROOT_DIR/scripts/quality/collect-device-evidence.sh" "${ANDROID_SERIAL:-}" "$dir"
}

cat > "$OUT_DIR/validation-plan.txt" <<'EOF_PLAN'
Manual validation required for issue #5:

- Validate share intake from messaging apps
- Validate explicit command intent from automation/routine tools
- Validate app shortcuts / Assistant-like handoffs
- Validate Google Assistant/App Actions and Samsung Routine/notification variants

This script only triggers generic Android intent paths on-device.
Capture screenshots and logcat around each route and verify that every route opens a
review proposal/form before persistence.
EOF_PLAN

cat > "$OUT_DIR/commands.log" <<'EOF_LOG'
External automation validation commands
EOF_LOG

if ! serial_adb shell pm list packages "$PKG" | grep -q "$PKG"; then
  echo "Package $PKG not installed on target." | tee -a "$OUT_DIR/commands.log"
  exit 1
fi

run_with_delay serial_adb shell am force-stop "$PKG"
run_with_delay serial_adb shell am start -W \
  -a android.intent.action.VIEW \
  -d "utopia://open/today" \
  -p "$PKG"
collect_route_evidence "open-today"

run_with_delay serial_adb shell am start -W \
  -a android.intent.action.VIEW \
  -d "utopia://voice/grocery/add?item=oats" \
  -p "$PKG"
collect_route_evidence "voice-shortcut"

run_with_delay serial_adb shell am start -W \
  -a app.utopia.action.COMMAND \
  --es requestId "wf-val-intent-command" \
  --es request_id "wf-val-intent-command-2" \
  --es type inventory.add \
  --es name "Validation_Apple" \
  --es quantity "2" \
  --es zone fridge \
  --es category dairy \
  -n "$PKG/.MainActivity"
collect_route_evidence "explicit-intent"

run_with_delay serial_adb shell am start -W \
  -a app.utopia.action.COMMAND \
  --es android.intent.extra.TEXT "Need%20oats,%20bananas,%20and%20chicken%20thighs" \
  --es requestId "wf-val-command-text" \
  -n "$PKG/.MainActivity"
collect_route_evidence "command-text"

run_with_delay serial_adb shell am start -W \
  -a android.intent.action.SEND \
  -t "text/plain" \
  --es android.intent.extra.TEXT "WhatsApp:%20bought%20rice,%20dal,%20yogurt" \
  -n "$PKG/.MainActivity"
collect_route_evidence "share-intent"

run_with_delay serial_adb shell am start -W \
  -a android.intent.action.VIEW \
  -d "https://utopia.app/action?type=grocery.add" \
  "$PKG"
collect_route_evidence "deeplink"

"$ROOT_DIR/scripts/quality/collect-device-evidence.sh" "${ANDROID_SERIAL:-}" "$OUT_DIR/summary"
run_with_delay serial_adb shell am force-stop "$PKG"

printf "Validation run complete. Evidence in: %s\n" "$OUT_DIR"
printf "Manual follow-up still needed for: Google Assistant, App Actions, and Samsung Routine/notification bridge paths.\n"
printf "Route evidence folders are in: %s/open-today, ... /summary\n" "$OUT_DIR"
