#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
node "$root_dir/scripts/quality/require-disposable-lane.mjs" device
sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
emulator_bin="$sdk_dir/emulator/emulator"
adb_bin="$sdk_dir/platform-tools/adb"
avd_name="${LIFEOS_EMULATOR_AVD:-Pixel_3a_API_34_extension_level_7_arm64-v8a}"
package_name="app.utopia"
apk="$root_dir/android/app/build/outputs/apk/release/app-release.apk"
evidence_dir="$root_dir/app/build/evidence"
mkdir -p "$evidence_dir"

if [[ ! -x "$emulator_bin" || ! -x "$adb_bin" ]]; then
  echo "emulatorx check: Android SDK emulator/adb not found" >&2
  exit 1
fi
if [[ ! -f "$apk" ]]; then
  echo "emulatorx check: release APK missing: $apk" >&2
  exit 1
fi

"$adb_bin" start-server >/dev/null
serial="$("$adb_bin" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"
if [[ -z "$serial" ]]; then
  log_file="$(mktemp -t utopia-emulatorx.XXXXXX)"
  "$emulator_bin" -avd "$avd_name" -no-snapshot -no-boot-anim -no-audio -gpu swiftshader_indirect >"$log_file" 2>&1 &
  for _ in $(seq 1 120); do
    serial="$("$adb_bin" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"
    [[ -n "$serial" ]] && break
    sleep 1
  done
fi
if [[ -z "$serial" ]]; then
  echo "emulatorx check: no emulator device became ready" >&2
  exit 1
fi

for _ in $(seq 1 120); do
  boot="$("$adb_bin" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  [[ "$boot" == "1" ]] && break
  sleep 1
done
[[ "$boot" == "1" ]] || { echo "emulatorx check: boot did not complete" >&2; exit 1; }

"$adb_bin" -s "$serial" install -r "$apk" >/dev/null
for permission in READ_NUTRITION READ_HYDRATION READ_STEPS READ_ACTIVE_CALORIES_BURNED READ_WEIGHT WRITE_HYDRATION; do
  "$adb_bin" -s "$serial" shell pm grant "$package_name" "android.permission.health.$permission"
done

"$adb_bin" -s "$serial" shell monkey -p "$package_name" 1 >/dev/null
sleep 2
"$adb_bin" -s "$serial" shell am start -a android.health.connect.action.MANAGE_HEALTH_PERMISSIONS --es android.intent.extra.PACKAGE_NAME "$package_name" >/dev/null
sleep 2
"$adb_bin" -s "$serial" exec-out screencap -p >"$evidence_dir/emulatorx-healthconnect-script.png"

ui_dump_path="/sdcard/utopia-emulatorx-window.xml"
"$adb_bin" -s "$serial" shell uiautomator dump "$ui_dump_path" >/dev/null 2>&1 || true
ui_dump="$("$adb_bin" -s "$serial" shell cat "$ui_dump_path" 2>/dev/null | tr -d '\r' || true)"
if grep -Eq "isn.t responding|Application Not Responding|aerr_close|aerr_wait" <<<"$ui_dump"; then
  echo "emulatorx check: Android ANR dialog visible" >&2
  exit 1
fi
for label in "Utopia Utopia" "Allow all" "Nutrition" "Hydration" "Steps" "Weight" "Active calories burned"; do
  grep -q "text=\"$label\"" <<<"$ui_dump" || {
    echo "emulatorx check: Health Connect settings missing visible label: $label" >&2
    exit 1
  }
done

grants="$("$adb_bin" -s "$serial" shell dumpsys package "$package_name" | grep -E 'android.permission.health.(READ_NUTRITION|READ_HYDRATION|READ_STEPS|READ_ACTIVE_CALORIES_BURNED|READ_WEIGHT|WRITE_HYDRATION): granted=true' | tr -d '\r' || true)"
for permission in READ_NUTRITION READ_HYDRATION READ_STEPS READ_ACTIVE_CALORIES_BURNED READ_WEIGHT WRITE_HYDRATION; do
  grep -q "android.permission.health.$permission: granted=true" <<<"$grants" || {
    echo "emulatorx check: missing granted scope $permission" >&2
    exit 1
  }
done

"$adb_bin" -s "$serial" shell am force-stop "$package_name" >/dev/null 2>&1 || true
"$adb_bin" -s "$serial" shell am start -a android.intent.action.VIEW -d utopia:///health-diagnostics -n "$package_name/.MainActivity" >/dev/null
roundtrip_dump=""
for _ in $(seq 1 30); do
  "$adb_bin" -s "$serial" shell uiautomator dump "$ui_dump_path" >/dev/null 2>&1 || true
  roundtrip_dump="$("$adb_bin" -s "$serial" shell cat "$ui_dump_path" 2>/dev/null | tr -d '\r' || true)"
  grep -q 'text="PASSED"' <<<"$roundtrip_dump" && break
  sleep 1
done
"$adb_bin" -s "$serial" exec-out screencap -p >"$evidence_dir/emulatorx-healthconnect-roundtrip.png"
grep -q 'text="PASSED"' <<<"$roundtrip_dump" || {
  echo "emulatorx check: Health Connect round trip did not pass" >&2
  exit 1
}
grep -q 'HC_ROUNDTRIP status=passed' <<<"$roundtrip_dump" || {
  echo "emulatorx check: Health Connect proof missing machine-readable pass" >&2
  exit 1
}
grep -q 'before=1' <<<"$roundtrip_dump" || {
  echo "emulatorx check: Health Connect proof did not read inserted record" >&2
  exit 1
}
grep -q 'after=0' <<<"$roundtrip_dump" || {
  echo "emulatorx check: Health Connect proof did not verify delete" >&2
  exit 1
}
printf '{\n  "avd": "%s",\n  "serial": "%s",\n  "package": "%s",\n  "permissions_granted": true,\n  "deep_link": "utopia://health-connect",\n  "round_trip": "passed",\n  "settings_screenshot": "%s",\n  "roundtrip_screenshot": "%s"\n}\n' \
  "$avd_name" "$serial" "$package_name" "$evidence_dir/emulatorx-healthconnect-script.png" "$evidence_dir/emulatorx-healthconnect-roundtrip.png" \
  >"$evidence_dir/emulatorx-healthconnect-script.json"

echo "emulatorx Health Connect script: PASS ($serial; API 34 permissions + write/read/delete round trip)"
