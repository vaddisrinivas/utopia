#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ADB="${ADB:-adb}"
SERIAL="${ANDROID_SERIAL:-${1:-}}"
STAMP="$(date +"%Y%m%d-%H%M%S")"
OUT_DIR="${2:-build/evidence/android-$STAMP}"
PACKAGE_NAME="${PACKAGE_NAME:-app.utopia}"
DB_NAME="${DB_NAME:-utopia-v105-household.db}"
mkdir -p "$OUT_DIR"

serial_adb() {
  if [[ -n "$SERIAL" ]]; then
    "$ADB" -s "$SERIAL" "$@"
  else
    "$ADB" "$@"
  fi
}

serial_adb devices -l > "$OUT_DIR/adb-devices.txt"
printf 'package=%s\n' "$PACKAGE_NAME" > "$OUT_DIR/target.txt"
printf 'database=%s\n' "$DB_NAME" >> "$OUT_DIR/target.txt"
serial_adb shell pidof "$PACKAGE_NAME" > "$OUT_DIR/utopia-pid.txt" 2>&1 || true
serial_adb exec-out screencap -p > "$OUT_DIR/screen.png" || true
serial_adb logcat -d -t 1000 > "$OUT_DIR/logcat.txt" || true
serial_adb shell run-as "$PACKAGE_NAME" ls -R databases > "$OUT_DIR/databases.txt" 2> "$OUT_DIR/databases.err" || true
serial_adb exec-out run-as "$PACKAGE_NAME" cat "databases/$DB_NAME" > "$OUT_DIR/utopia.db" 2> "$OUT_DIR/db-pull.err" || true
if [[ -s "$OUT_DIR/utopia.db" ]]; then
  shasum -a 256 "$OUT_DIR/utopia.db" > "$OUT_DIR/utopia-db.sha256"
fi

echo "$OUT_DIR"
