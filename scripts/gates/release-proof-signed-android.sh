#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

echo "release-proof-signed-android: require real release-signed APK and signed AAB"
REQUIRE_RELEASE_SIGNING=1 ./scripts/quality/check-android-release-artifacts.sh

echo "release-proof-signed-android: PASS"
