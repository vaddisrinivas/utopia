#!/usr/bin/env bash
set -euo pipefail

ADB="${ADB:-adb}"
PKG="${1:-app.utopia}"
SERIAL_ARGS=()
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  SERIAL_ARGS=(-s "$ANDROID_SERIAL")
fi

start_link() {
  local uri="$1"
  echo "Launching $uri"
  "$ADB" "${SERIAL_ARGS[@]}" shell \
    "am start -W -a android.intent.action.VIEW -d '$uri' -p '$PKG'" >/dev/null
}

start_link "utopia://open/today"
start_link "utopia://open/numbers"
start_link "utopia://open/kitchen"
start_link "utopia://voice/water?ml=250&requestId=adb-water-250"
start_link "utopia://voice/grocery/add?item=oats&quantity=1%20bag&requestId=adb-grocery-oats"
start_link "utopia://voice/meal/log?meal=chicken%20rice&calories=520&requestId=adb-meal-chicken-rice"
start_link "utopia://voice/shopping/start?requestId=adb-shopping-start"
start_link "utopia://quick?text=need%20Greek%20yogurt%20this%20week&requestId=adb-ai-note-yogurt"

echo "Utopia direct-action deep links launched."
