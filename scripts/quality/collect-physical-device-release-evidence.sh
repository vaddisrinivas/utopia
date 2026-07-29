#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

adb_bin="${ADB:-adb}"
serial="${ANDROID_SERIAL:-${1:-}}"
apk="${ANDROID_RELEASE_APK:-android/app/build/outputs/apk/release/app-release.apk}"
evidence_dir="app/build/evidence"
artifact_dir="$evidence_dir/physical-device-release"
evidence="$evidence_dir/physical-device-release.json"
package_name="app.utopia"
artifact_evidence_path="${PHYSICAL_DEVICE_ARTIFACT_EVIDENCE:-app/build/evidence/android-release-artifacts.json}"
activity="$package_name/.MainActivity"
mkdir -p "$artifact_dir"

run_adb() {
  if [[ -n "$serial" ]]; then
    "$adb_bin" -s "$serial" "$@"
  else
    "$adb_bin" "$@"
  fi
}

if [[ ! -f "$apk" ]]; then
  echo "physical-device-release: release APK missing at $apk; run BUILD_RELEASE_ARTIFACTS=1 npm run release:proof:signed-android first." >&2
  exit 2
fi

if [[ -z "$serial" ]]; then
  serial="$("$adb_bin" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')"
fi
if [[ -z "$serial" ]]; then
  echo "physical-device-release: no adb device attached" >&2
  exit 2
fi
if [[ "$serial" == emulator-* ]]; then
  echo "physical-device-release: emulator is not accepted for physical release proof" >&2
  exit 2
fi

"$adb_bin" devices -l | awk 'NR == 1 { print; next } NF > 0 { $1 = "<redacted-device>"; print }' > "$artifact_dir/adb-devices.txt"
model="$(run_adb shell getprop ro.product.model | tr -d '\r' | head -n 1)"
manufacturer="$(run_adb shell getprop ro.product.manufacturer | tr -d '\r' | head -n 1)"
sdk="$(run_adb shell getprop ro.build.version.sdk | tr -d '\r' | head -n 1)"
fingerprint_hash="$(run_adb shell getprop ro.build.fingerprint | tr -d '\r' | shasum -a 256 | awk '{print $1}')"

set +e
run_adb install -r "$apk" > "$artifact_dir/install.txt" 2>&1
install_status="$?"
set -e
run_adb shell dumpsys package "$package_name" > "$artifact_dir/package.txt" 2>&1 || true
if [[ "$install_status" == "0" ]]; then
  run_adb shell am force-stop "$package_name" >/dev/null 2>&1 || true
  run_adb shell am start -W -n "$activity" > "$artifact_dir/launch-main.txt" 2>&1
  sleep 3
  run_adb shell am start -W -a android.intent.action.VIEW -d "utopia://install" "$activity" > "$artifact_dir/launch-install.txt" 2>&1 || true
  sleep 3
  run_adb exec-out screencap -p > "$artifact_dir/install-screen.png" || true
  run_adb shell uiautomator dump /sdcard/window.xml > "$artifact_dir/uiautomator-status.txt" 2>&1 || true
  run_adb shell cat /sdcard/window.xml > "$artifact_dir/window.xml" 2>/dev/null || true
  run_adb shell pidof "$package_name" > "$artifact_dir/pid.txt" 2>&1 || true
else
  : > "$artifact_dir/launch-main.txt"
  : > "$artifact_dir/launch-install.txt"
  : > "$artifact_dir/window.xml"
  : > "$artifact_dir/pid.txt"
fi

DEVICE_MANUFACTURER="$manufacturer" \
DEVICE_MODEL="$model" \
DEVICE_SDK="$sdk" \
DEVICE_FINGERPRINT_HASH="$fingerprint_hash" \
ARTIFACT_EVIDENCE_PATH="$artifact_evidence_path" \
INSTALL_STATUS="$install_status" \
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
import { buildPhysicalDeviceReleaseEvidence } from './scripts/quality/physical-device-release-evidence.mjs';

const env = process.env;
const evidencePath = 'app/build/evidence/physical-device-release.json';
const payload = buildPhysicalDeviceReleaseEvidence({
  root: process.cwd(),
  installStatus: env.INSTALL_STATUS,
  device: {
    manufacturer: env.DEVICE_MANUFACTURER,
    model: env.DEVICE_MODEL,
    sdk: env.DEVICE_SDK,
    buildFingerprintSha256: env.DEVICE_FINGERPRINT_HASH,
  },
  artifactEvidence: env.ARTIFACT_EVIDENCE_PATH,
});

writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`);
if (payload.status !== 'passed') {
  console.error(`physical-device-release: BLOCKED (${evidencePath})`);
  console.error(`  status: ${payload.status}`);
  console.error(`  app: ${JSON.stringify(payload.app)}`);
  console.error(`  artifact: ${JSON.stringify(payload.artifact || null)}`);
  console.error('  run npm run release:proof:physical-device for explicit blockers');
  process.exit(1);
}
console.log(`physical-device-release: PASS (${evidencePath})`);
NODE
