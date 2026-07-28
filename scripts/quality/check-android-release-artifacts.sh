#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
signed_apk="$root_dir/android/app/build/outputs/apk/release/app-release.apk"
unsigned_apk="$root_dir/android/app/build/outputs/apk/release/app-release-unsigned.apk"
aab="$root_dir/android/app/build/outputs/bundle/release/app-release.aab"
evidence_dir="$root_dir/app/build/evidence"
evidence="$evidence_dir/android-release-artifacts.json"
build_receipt="$evidence_dir/android-release-build-receipt.json"
mkdir -p "$evidence_dir"

fail() {
  echo "Android release artifact check: FAIL ($*)" >&2
  exit 1
}

if [[ "${BUILD_RELEASE_ARTIFACTS:-0}" == "1" ]]; then
  WF_ANDROID_BUILD_COMMAND="android/gradlew :app:assembleRelease :app:bundleRelease" \
    bash -c 'cd android && ./gradlew --no-daemon :app:assembleRelease :app:bundleRelease'
  if [[ ! -f "$signed_apk" && -f "$unsigned_apk" ]]; then
    debug_keystore="${ANDROID_DEBUG_KEYSTORE:-$HOME/.android/debug.keystore}"
    apksigner_for_debug="$(find "${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools" -type f -name apksigner 2>/dev/null | sort -V | tail -n 1 || true)"
    if [[ -x "$apksigner_for_debug" && -f "$debug_keystore" ]]; then
      cp "$unsigned_apk" "$signed_apk"
      "$apksigner_for_debug" sign \
        --ks "$debug_keystore" \
        --ks-key-alias androiddebugkey \
        --ks-pass pass:android \
        --key-pass pass:android \
        "$signed_apk"
    fi
  fi
fi

apk="$signed_apk"
if [[ ! -f "$apk" && -f "$unsigned_apk" ]]; then
  apk="$unsigned_apk"
fi

if [[ "${BUILD_RELEASE_ARTIFACTS:-0}" == "1" ]]; then
  WF_ANDROID_BUILD_COMMAND="android/gradlew :app:assembleRelease :app:bundleRelease" \
    node scripts/quality/write-android-release-build-receipt.mjs "$apk" "$aab" "$build_receipt"
fi

[[ -f "$apk" ]] || fail "release APK missing: $apk"
[[ -f "$aab" ]] || fail "release AAB missing: $aab"

aapt_path="${ANDROID_BUILD_TOOLS_AAPT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools/36.0.0/aapt}"
[[ -x "$aapt_path" ]] || fail "aapt not found at $aapt_path"

badging="$("$aapt_path" dump badging "$apk")"
grep -q "package: name='app.utopia'" <<<"$badging" || fail "APK package mismatch"
grep -q "versionName='1.0.0'" <<<"$badging" || fail "APK versionName mismatch"
grep -q "sdkVersion:'26'" <<<"$badging" || fail "APK minSdk mismatch"
grep -q "targetSdkVersion:'36'" <<<"$badging" || fail "APK targetSdk mismatch"

permissions="$("$aapt_path" dump permissions "$apk")"
for permission in READ_NUTRITION READ_HYDRATION READ_STEPS READ_ACTIVE_CALORIES_BURNED READ_WEIGHT WRITE_HYDRATION; do
  grep -q "android.permission.health.${permission}" <<<"$permissions" || fail "missing Health Connect permission $permission"
done

zip_listing="$(unzip -l "$aab")"
for entry in base/manifest/AndroidManifest.xml base/assets/index.android.bundle base/assets/app.config base/dex/classes.dex BundleConfig.pb; do
  grep -q "$entry" <<<"$zip_listing" || fail "AAB missing $entry"
done

apksigner_path="$(find "${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools" -type f -name apksigner 2>/dev/null | sort -V | tail -n 1 || true)"
[[ -x "$apksigner_path" ]] || fail "apksigner not found under Android SDK build-tools"
apk_signing_kind="release"
apk_cert_dn=""
apk_cert_sha256=""
apk_signing="$("$apksigner_path" verify --verbose --print-certs "$apk" 2>&1 || true)"
if grep -q '^Verifies$' <<<"$apk_signing"; then
  apk_cert_dn="$(sed -n 's/^Signer #1 certificate DN: //p' <<<"$apk_signing" | head -n 1)"
  apk_cert_sha256="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<<"$apk_signing" | head -n 1)"
  if grep -q 'CN=Android Debug' <<<"$apk_cert_dn"; then
    apk_signing_kind="debug"
  fi
else
  apk_signing_kind="unsigned"
fi

aab_signed="true"
aab_signing="$(jarsigner -verify -verbose -certs "$aab" 2>&1 || true)"
if grep -q 'jar is unsigned' <<<"$aab_signing"; then
  aab_signed="false"
fi

if [[ "${REQUIRE_RELEASE_SIGNING:-0}" == "1" ]]; then
  [[ "$apk_signing_kind" == "release" ]] || fail "APK is debug-signed"
  [[ "$aab_signed" == "true" ]] || fail "AAB is unsigned"
fi

apk_sha="$(shasum -a 256 "$apk" | awk '{print $1}')"
aab_sha="$(shasum -a 256 "$aab" | awk '{print $1}')"
apk_size="$(stat -f%z "$apk")"
aab_size="$(stat -f%z "$aab")"
apk_relative="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], os.getcwd()))' "$apk")"
build_receipt_issues="$(node --input-type=module - "$build_receipt" "$apk_sha" "$apk_size" "$aab_sha" "$aab_size" "$apk_relative" <<'NODE'
import { existsSync, readFileSync } from 'node:fs';
import { validateSourceArtifactReceipt } from './scripts/quality/evidence-provenance.mjs';

const [receiptPath, apkSha, apkBytes, aabSha, aabBytes, apkPath] = process.argv.slice(2);
if (!existsSync(receiptPath)) {
  console.log('missing:android_release_build_receipt');
  process.exit(0);
}
let receipt;
try {
  receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
} catch {
  console.log('invalid:android_release_build_receipt_json');
  process.exit(0);
}
const issues = validateSourceArtifactReceipt(process.cwd(), receipt, {
  apk: {
    path: apkPath,
    sha256: apkSha,
    bytes: Number(apkBytes),
  },
  aab: {
    path: 'android/app/build/outputs/bundle/release/app-release.aab',
    sha256: aabSha,
    bytes: Number(aabBytes),
  },
});
console.log(issues.join('\n'));
NODE
)"
[[ -z "$build_receipt_issues" ]] || fail "build receipt does not prove current artifacts: ${build_receipt_issues//$'\n'/, }"
git_head="$(git -C "$root_dir" rev-parse --short HEAD 2>/dev/null || echo unknown)"
git_tree="$(git -C "$root_dir" rev-parse HEAD^{tree} 2>/dev/null || echo unknown)"
git_branch="$(git -C "$root_dir" branch --show-current 2>/dev/null || echo unknown)"
dirty_status="$(git -C "$root_dir" status --porcelain=v1 2>/dev/null || true)"
dirty="false"; [[ -n "$dirty_status" ]] && dirty="true"
dirty_diff_hash="$(node --input-type=module -e "import { currentDirtyDiffHash } from './scripts/quality/evidence-provenance.mjs'; process.stdout.write(currentDirtyDiffHash(process.cwd()));")"
checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "$evidence" <<JSON
{
  "proof": "utopia_android_release_artifacts",
  "status": "passed",
  "checked_at": "$checked_at",
  "git": { "branch": "$git_branch", "head": "$git_head", "tree": "$git_tree", "dirty": $dirty, "dirty_diff_hash": "$dirty_diff_hash" },
  "build_receipt": "app/build/evidence/android-release-build-receipt.json",
  "package": "app.utopia",
  "version_name": "1.0.0",
  "version_code": 1,
  "min_sdk": 26,
  "target_sdk": 36,
  "apk": {
    "path": "$apk_relative",
    "bytes": $apk_size,
    "sha256": "$apk_sha",
    "signing": "$apk_signing_kind",
    "certificate_dn": "$apk_cert_dn",
    "certificate_sha256": "$apk_cert_sha256"
  },
  "aab": {
    "path": "android/app/build/outputs/bundle/release/app-release.aab",
    "bytes": $aab_size,
    "sha256": "$aab_sha",
    "signed": $aab_signed,
    "contains": [
      "base/manifest/AndroidManifest.xml",
      "base/assets/index.android.bundle",
      "base/assets/app.config",
      "base/dex/classes.dex",
      "BundleConfig.pb"
    ]
  },
  "health_connect_permissions": [
    "READ_NUTRITION",
    "READ_HYDRATION",
    "READ_STEPS",
    "READ_ACTIVE_CALORIES_BURNED",
    "READ_WEIGHT",
    "WRITE_HYDRATION"
  ]
}
JSON

echo "Android release artifact check: PASS (APK + AAB + Health Connect permissions; apk_signing=$apk_signing_kind; aab_signed=$aab_signed; evidence: $evidence)"
