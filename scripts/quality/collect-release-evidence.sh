#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

STAMP="$(date +"%Y%m%d-%H%M%S")"
OUT_DIR="${1:-build/evidence/release-$STAMP}"
mkdir -p "$OUT_DIR"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

record() {
  printf '%s\n' "$*" | tee -a "$OUT_DIR/release-evidence.txt" >/dev/null
}

gradle_file="android/app/build.gradle"
if [[ ! -f "$gradle_file" && -f "app/build.gradle.kts" ]]; then
  gradle_file="app/build.gradle.kts"
fi
version_name="$(sed -n 's/^[[:space:]]*versionName[[:space:]=]*(\{0,1\}"\([^"]*\)".*/\1/p' "$gradle_file" | head -n 1)"
version_code="$(sed -n 's/^[[:space:]]*versionCode[[:space:]=]*(\{0,1\}\([0-9][0-9]*\).*/\1/p' "$gradle_file" | head -n 1)"
package_name="app.utopia"

test -n "$version_name" || fail "Could not read versionName from $gradle_file"
test -n "$version_code" || fail "Could not read versionCode from $gradle_file"

record "Utopia release evidence"
record "timestamp=$STAMP"
record "version_name=$version_name"
record "version_code=$version_code"
record "package=$package_name"
record "git_head=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
record ""

missing_signing=0
for name in ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    record "missing_env=$name"
    missing_signing=1
  fi
done

if [[ "$missing_signing" -eq 0 ]]; then
  [[ -f "$ANDROID_KEYSTORE_PATH" ]] || fail "ANDROID_KEYSTORE_PATH does not exist: $ANDROID_KEYSTORE_PATH"
  record "signing_env=present"
  keytool -list -v \
    -keystore "$ANDROID_KEYSTORE_PATH" \
    -alias "$ANDROID_KEY_ALIAS" \
    -storepass "$ANDROID_KEYSTORE_PASSWORD" \
    -keypass "$ANDROID_KEY_PASSWORD" \
    > "$OUT_DIR/signing-key.txt"
  awk '/SHA1:|SHA256:|SHA512:/{print}' "$OUT_DIR/signing-key.txt" | tee "$OUT_DIR/signing-fingerprints.txt" >/dev/null
  record "signing_fingerprints=$OUT_DIR/signing-fingerprints.txt"
  (cd android && ./gradlew --no-daemon :app:assembleRelease) | tee "$OUT_DIR/gradle-release-build.log"
else
  record "signing_env=missing"
  record "release_build=skipped_missing_signing_env"
fi

release_apks=()
apk_roots=()
for dir in android/app/build/outputs/apk app/build/outputs/apk; do
  [[ -d "$dir" ]] && apk_roots+=("$dir")
done
while IFS= read -r apk; do
  release_apks+=("$apk")
done < <(
  if [[ "${#apk_roots[@]}" -gt 0 ]]; then
    find "${apk_roots[@]}" -path '*/release/*.apk' ! -name '*unsigned*' -type f 2>/dev/null | sort
  fi
)

if [[ "${#release_apks[@]}" -gt 0 ]]; then
  apksigner="$(find "${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools" -type f -name apksigner 2>/dev/null | sort -V | tail -n 1 || true)"
  [[ -x "$apksigner" ]] || fail "Could not find apksigner under ANDROID_HOME/build-tools"
  : > "$OUT_DIR/SHA256SUMS.txt"
  if [[ "$missing_signing" -eq 0 ]]; then
    for apk in "${release_apks[@]}"; do
      base="$(basename "$apk")"
      cp "$apk" "$OUT_DIR/$base"
      shasum -a 256 "$OUT_DIR/$base" >> "$OUT_DIR/SHA256SUMS.txt"
      "$apksigner" verify --verbose --print-certs "$apk" > "$OUT_DIR/$base.apksigner.txt"
      record "verified_apk=$OUT_DIR/$base"
    done
  else
    for apk in "${release_apks[@]}"; do
      record "release_apk_candidate_ignored_missing_signing_env=$apk"
    done
    record "verified_apk=none_missing_signing_env"
  fi
else
  record "verified_apk=none"
fi

google_auth_file=""
for file in android/app/src/main/res/values/google_auth.xml app/src/main/res/values/google_auth.xml; do
  if [[ -f "$file" ]]; then
    google_auth_file="$file"
    break
  fi
done
client_id=""
if [[ -n "$google_auth_file" ]]; then
  client_id="$(sed -n 's/.*<string name="google_web_client_id">\(.*\)<\/string>.*/\1/p' "$google_auth_file" | head -n 1)"
fi
google_auth_required=0
if rg -q 'google_web_client_id|GoogleSignIn|R\.string\.google' android/app/src app src 2>/dev/null; then
  google_auth_required=1
fi
google_auth_status=""
if [[ -z "$google_auth_file" && "$google_auth_required" -eq 0 ]]; then
  google_auth_status="not_required_direct_settings"
elif [[ -z "$google_auth_file" ]]; then
  google_auth_status="missing_file"
elif [[ -z "$client_id" || "$client_id" == "TODO_ADD_GOOGLE_WEB_CLIENT_ID" ]]; then
  google_auth_status="placeholder"
else
  google_auth_status="configured_public_value"
fi
record "google_web_client_id=$google_auth_status"

if [[ -f .well-known/assetlinks.json ]]; then
  if grep -q 'REPLACE_WITH_RELEASE_SHA256_CERT_FINGERPRINT' .well-known/assetlinks.json; then
    record "assetlinks=placeholder"
  else
    record "assetlinks=configured"
  fi
else
  record "assetlinks=missing"
fi

if command -v adb >/dev/null 2>&1; then
  adb devices -l > "$OUT_DIR/adb-devices.txt" || true
  device_count="$(awk '$2 == "device" { count++ } END { print count + 0 }' "$OUT_DIR/adb-devices.txt")"
  if [[ "$device_count" -eq 1 || -n "${ANDROID_SERIAL:-}" ]]; then
    scripts/quality/collect-device-evidence.sh "${ANDROID_SERIAL:-}" "$OUT_DIR/device" >/dev/null || true
    record "device_evidence=$OUT_DIR/device"
  elif [[ "$device_count" -gt 1 ]]; then
    record "device_evidence=none_multiple_devices_set_ANDROID_SERIAL"
  else
    record "device_evidence=none_no_connected_device"
  fi
else
  record "device_evidence=none_adb_missing"
fi

cat > "$OUT_DIR/manifest.txt" <<MANIFEST
version_name=$version_name
version_code=$version_code
package=$package_name
signing_env=$([[ "$missing_signing" -eq 0 ]] && echo present || echo missing)
google_web_client_id=$google_auth_status
release_apk_count=$([[ "$missing_signing" -eq 0 ]] && echo "${#release_apks[@]}" || echo 0)
MANIFEST

record "manifest=$OUT_DIR/manifest.txt"
record "done=$OUT_DIR"
echo "$OUT_DIR"
