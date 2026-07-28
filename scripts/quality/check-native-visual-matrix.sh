#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
node "$root_dir/scripts/quality/require-disposable-lane.mjs" device
sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
emulator_bin="$sdk_dir/emulator/emulator"
adb_bin="$sdk_dir/platform-tools/adb"
avd_name="${LIFEOS_EMULATOR_AVD:-Pixel_3a_API_34_extension_level_7_arm64-v8a}"
requested_serial="${LIFEOS_ANDROID_SERIAL:-${ANDROID_SERIAL:-}}"
package_name="app.utopia"
activity="$package_name/.MainActivity"
debug_apk="$root_dir/android/app/build/outputs/apk/debug/app-debug.apk"
apk="$debug_apk"
evidence_dir="$root_dir/app/build/evidence/native-visual-matrix"
json="$evidence_dir/native-visual-matrix.json"
metro_port="${LIFEOS_METRO_PORT:-8081}"
expo_bin="$root_dir/node_modules/.bin/expo"
magick_bin="$(command -v magick || true)"
metro_pid=""
mkdir -p "$evidence_dir"

cleanup() {
  if [[ -n "$metro_pid" ]] && kill -0 "$metro_pid" >/dev/null 2>&1; then
    kill "$metro_pid" >/dev/null 2>&1 || true
    wait "$metro_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

fail() {
  echo "Native visual matrix: FAIL ($*)" >&2
  exit 1
}

[[ -x "$emulator_bin" ]] || fail "Android emulator not found at $emulator_bin"
[[ -x "$adb_bin" ]] || fail "adb not found at $adb_bin"
[[ -x "$expo_bin" ]] || fail "Expo CLI not found at $expo_bin"
[[ -n "$magick_bin" ]] || fail "ImageMagick is required for black-screen detection"
[[ "$metro_port" == "8081" ]] || fail "debug native acceptance requires Metro on the app's configured port 8081"

echo "Native visual matrix: building current debug APK"
build_log="$evidence_dir/android-debug-build.log"
if ! (cd "$root_dir/android" && timeout 900 ./gradlew :app:assembleDebug >"$build_log" 2>&1); then
  fail "current debug APK build failed: $(tail -n 12 "$build_log" | tr '\n' ' ')"
fi
[[ -f "$apk" ]] || fail "current debug APK missing after build: $debug_apk"

if lsof -nP -iTCP:"$metro_port" -sTCP:LISTEN -t 2>/dev/null | grep -q .; then
  fail "Metro port $metro_port is already in use; choose a free LIFEOS_METRO_PORT"
fi
metro_log="$evidence_dir/metro.log"
echo "Native visual matrix: starting current Metro bundle on $metro_port"
(
  cd "$root_dir"
  CI=1 "$expo_bin" start --dev-client --port "$metro_port" --clear
) >"$metro_log" 2>&1 &
metro_pid="$!"
metro_ready=""
for _ in $(seq 1 120); do
  if ! kill -0 "$metro_pid" >/dev/null 2>&1; then
    fail "Metro exited before becoming ready: $(tail -n 12 "$metro_log" | tr '\n' ' ')"
  fi
  metro_ready="$(curl -fsS "http://127.0.0.1:$metro_port/status" 2>/dev/null || true)"
  [[ "$metro_ready" == "packager-status:running" ]] && break
  sleep 1
done
[[ "$metro_ready" == "packager-status:running" ]] || fail "Metro did not become ready on $metro_port"

"$adb_bin" start-server >/dev/null
serial=""
if [[ -n "$requested_serial" ]]; then
  state="$("$adb_bin" -s "$requested_serial" get-state 2>/dev/null || true)"
  [[ "$state" == "device" ]] || fail "requested Android device is not connected and ready: $requested_serial"
  serial="$requested_serial"
else
  serial="$("$adb_bin" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"
fi
if [[ -z "$serial" && -z "$requested_serial" ]]; then
  echo "Native visual matrix: starting emulator $avd_name"
  log_file="$(mktemp -t utopia-native-visual.XXXXXX)"
  wipe_arg=()
  if [[ "${LIFEOS_EMULATOR_WIPE_DATA:-0}" == "1" ]]; then
    wipe_arg=(-wipe-data)
  fi
  if [[ "${#wipe_arg[@]}" -gt 0 ]]; then
    "$emulator_bin" -avd "$avd_name" "${wipe_arg[@]}" -no-snapshot -no-boot-anim -no-audio -gpu swiftshader_indirect >"$log_file" 2>&1 &
  else
    "$emulator_bin" -avd "$avd_name" -no-snapshot -no-boot-anim -no-audio -gpu swiftshader_indirect >"$log_file" 2>&1 &
  fi
  for _ in $(seq 1 240); do
    serial="$("$adb_bin" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"
    [[ -n "$serial" ]] && break
    sleep 1
  done
fi
[[ -n "$serial" ]] || fail "no emulator became ready"
[[ "$serial" == emulator-* ]] || fail "native visual acceptance is emulator-only; got $serial"
echo "Native visual matrix: using device $serial"

boot=""
for _ in $(seq 1 300); do
  boot="$("$adb_bin" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  [[ "$boot" == "1" ]] && break
  sleep 1
done
[[ "$boot" == "1" ]] || fail "emulator boot did not complete"
echo "Native visual matrix: device booted"
"$adb_bin" -s "$serial" wait-for-device >/dev/null 2>&1 || true
"$adb_bin" -s "$serial" reverse tcp:8081 "tcp:$metro_port" >/dev/null \
  || fail "could not connect emulator Metro port 8081 to host $metro_port"

"$adb_bin" -s "$serial" uninstall "$package_name" >/dev/null 2>&1 || true
"$adb_bin" -s "$serial" wait-for-device >/dev/null 2>&1 || true
echo "Native visual matrix: installing $(basename "$apk")"
device_apk="/data/local/tmp/utopia-native-visual.apk"
push_log="$(mktemp -t utopia-native-push.XXXXXX)"
pm_log="$(mktemp -t utopia-native-pm-install.XXXXXX)"
if ! timeout 240 "$adb_bin" -s "$serial" push "$apk" "$device_apk" >"$push_log" 2>&1; then
  fail "APK push failed on $serial: $(tail -n 8 "$push_log" | tr '\n' ' ')"
fi
if ! timeout 420 "$adb_bin" -s "$serial" shell pm install -r "$device_apk" >"$pm_log" 2>&1; then
  fail "pm install failed on $serial: $(tail -n 8 "$pm_log" | tr '\n' ' ')"
fi
"$adb_bin" -s "$serial" shell rm -f "$device_apk" >/dev/null 2>&1 || true
echo "Native visual matrix: install complete"

routes=(
  "home|utopia:///|LIFEOS / HOME|Ask with context"
  "food|utopia:///food|Food, gently|Tonight"
  "record-green-dal|utopia:///record/meal-green-dal|Record|Green dal + rice"
  "chat|utopia:///chat|Chat|Settings"
  "sources|utopia:///sources|LIFEOS / SOURCES|Your food data homes."
  "settings|utopia:///settings|LIFEOS / CONNECTIONS|Configure food, sources, and app preferences."
  "capture|utopia:///capture|LIFEOS / ADD|Save capture"
)

passed=0
route_json=""
for entry in "${routes[@]}"; do
  IFS='|' read -r name uri label_one label_two <<<"$entry"
  echo "Native visual matrix: checking $name"
  "$adb_bin" -s "$serial" shell am force-stop "$package_name" >/dev/null 2>&1 || true
  "$adb_bin" -s "$serial" logcat -c >/dev/null 2>&1 || true
  start_log="$evidence_dir/$name.start.txt"
  timeout 45 "$adb_bin" -s "$serial" shell am start -W -a android.intent.action.VIEW -d "$uri" -n "$activity" >"$start_log" 2>&1 || fail "$name did not start"
  if [[ "$name" == "chat" ]]; then
    sleep 2
    for _ in 1 2 3 4; do
      "$adb_bin" -s "$serial" shell input swipe 540 1750 540 350 500 >/dev/null 2>&1 || true
    done
  fi
  app_pid=""
  for attempt in $(seq 1 12); do
    app_pid="$("$adb_bin" -s "$serial" shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
    [[ -n "$app_pid" ]] && break
    echo "Native visual matrix: waiting for $name app process ($attempt/12)"
    sleep 1
  done
  [[ -n "$app_pid" ]] || fail "$name app process not alive"

  ui_dump="$evidence_dir/$name.xml"
  device_ui_dump="/sdcard/utopia-native-$name.xml"
  labels_found="false"
  for attempt in $(seq 1 45); do
    timeout 12 "$adb_bin" -s "$serial" shell uiautomator dump "$device_ui_dump" >/dev/null 2>&1 || true
    timeout 12 "$adb_bin" -s "$serial" exec-out cat "$device_ui_dump" >"$ui_dump" 2>/dev/null || true
    if grep -Eqi 'Unable to load script|Requiring unknown module|Could not connect to development server|Invariant Violation|React Native version mismatch|TypeError:|ReferenceError:|SyntaxError:' "$ui_dump"; then
      fail "$name rendered a React Native error screen"
    fi
    if grep -Fq "$label_one" "$ui_dump" && grep -Fq "$label_two" "$ui_dump"; then
      labels_found="true"
      break
    fi
    sleep 1
  done
  [[ "$labels_found" == "true" ]] \
    || fail "$name never rendered expected labels '$label_one' and '$label_two'"

  route_log="$evidence_dir/$name.logcat.txt"
  "$adb_bin" -s "$serial" logcat -d -v brief >"$route_log" 2>/dev/null || true
  if grep -Eqi 'FATAL EXCEPTION|Unable to load script|Requiring unknown module|Could not connect to development server|Unhandled JS Exception|ReactNativeJS.*(TypeError|ReferenceError|SyntaxError|Invariant Violation)' "$route_log"; then
    fail "$name emitted a fatal native or JavaScript runtime error"
  fi

  screenshot="$evidence_dir/$name.png"
  timeout 20 "$adb_bin" -s "$serial" exec-out screencap -p >"$screenshot" || fail "$name screenshot timed out"
  file "$screenshot" | grep -q "PNG image data" || fail "$name screenshot is not a PNG"
  byte_count="$(wc -c <"$screenshot" | tr -d ' ')"
  [[ "$byte_count" -gt 10000 ]] || fail "$name screenshot is too small: $byte_count bytes"
  pixel_stats="$("$magick_bin" "$screenshot" -colorspace Gray -format '%[fx:mean] %[fx:standard_deviation]' info:)"
  read -r pixel_mean pixel_stddev <<<"$pixel_stats"
  awk -v mean="$pixel_mean" -v stddev="$pixel_stddev" 'BEGIN { exit !(mean >= 0.02 && stddev >= 0.02) }' \
    || fail "$name screenshot is blank/black (mean=$pixel_mean, stddev=$pixel_stddev)"
  passed=$((passed + 1))
  route_json="$route_json
    { \"name\": \"$name\", \"uri\": \"$uri\", \"screenshot\": \"app/build/evidence/native-visual-matrix/$name.png\", \"ui_dump\": \"app/build/evidence/native-visual-matrix/$name.xml\", \"logcat\": \"app/build/evidence/native-visual-matrix/$name.logcat.txt\", \"start_log\": \"app/build/evidence/native-visual-matrix/$name.start.txt\", \"expected_visual_labels\": [\"$label_one\", \"$label_two\"], \"labels_verified\": true, \"pixel_mean\": $pixel_mean, \"pixel_stddev\": $pixel_stddev, \"app_pid\": \"$app_pid\" },"
done

apk_sha256="$(shasum -a 256 "$apk" | awk '{print $1}')"
git_head="$(git -C "$root_dir" rev-parse --short HEAD 2>/dev/null || echo unknown)"
git_tree="$(git -C "$root_dir" rev-parse 'HEAD^{tree}' 2>/dev/null || echo unknown)"
git_branch="$(git -C "$root_dir" branch --show-current 2>/dev/null || echo unknown)"
dirty_status="$(git -C "$root_dir" status --porcelain=v1 2>/dev/null || true)"
dirty="false"; [[ -n "$dirty_status" ]] && dirty="true"
dirty_diff_hash="$(node --input-type=module -e "import { currentDirtyDiffHash } from './scripts/quality/evidence-provenance.mjs'; process.stdout.write(currentDirtyDiffHash(process.cwd()));")"
checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
route_json="${route_json%,}"
cat >"$json" <<JSON
{
  "proof": "utopia_native_visual_matrix",
  "checked_at": "$checked_at",
  "git": { "branch": "$git_branch", "head": "$git_head", "tree": "$git_tree", "dirty": $dirty, "dirty_diff_hash": "$dirty_diff_hash" },
  "avd": "$avd_name",
  "serial": "$serial",
  "package": "$package_name",
  "runtime": { "variant": "debug", "metro": "owned_current_process", "metro_port": $metro_port, "apk_sha256": "$apk_sha256" },
  "status": "passed",
  "routes_checked": $passed,
  "routes_required": ${#routes[@]},
  "routes": [
$route_json
  ]
}
JSON

echo "Native visual matrix: PASS ($passed/${#routes[@]} routes; evidence: $json)"
