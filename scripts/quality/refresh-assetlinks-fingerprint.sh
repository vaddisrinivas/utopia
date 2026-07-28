#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ASSET_LINKS="${ROOT_DIR}/.well-known/assetlinks.json"
PLACEHOLDER="REPLACE_WITH_RELEASE_SHA256_CERT_FINGERPRINT"

if [[ -z "${ANDROID_KEYSTORE_PATH:-}" || -z "${ANDROID_KEY_ALIAS:-}" || -z "${ANDROID_KEYSTORE_PASSWORD:-}" || -z "${ANDROID_KEY_PASSWORD:-}" ]]; then
  echo "Set ANDROID_KEYSTORE_PATH, ANDROID_KEY_ALIAS, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD before running."
  exit 1
fi

if [[ ! -f "$ASSET_LINKS" ]]; then
  echo "assetlinks file not found: $ASSET_LINKS"
  exit 1
fi

if ! grep -q "$PLACEHOLDER" "$ASSET_LINKS"; then
  echo "No placeholder found in $ASSET_LINKS. Refusing to overwrite without intent."
  exit 1
fi

computed_fingerprint=$(keytool -list -v \
  -keystore "$ANDROID_KEYSTORE_PATH" \
  -alias "$ANDROID_KEY_ALIAS" \
  -storepass "$ANDROID_KEYSTORE_PASSWORD" \
  -keypass "$ANDROID_KEY_PASSWORD" \
  | awk '/SHA256:/{print $2; exit}')

if [[ -z "$computed_fingerprint" ]]; then
  echo "Unable to read SHA-256 fingerprint from keystore."
  exit 1
fi

cp "$ASSET_LINKS" "$ASSET_LINKS.bak"
perl -pi -e "s/$PLACEHOLDER/$computed_fingerprint/" "$ASSET_LINKS"

echo "Updated $ASSET_LINKS with fingerprint: $computed_fingerprint"
echo "Backup saved at: $ASSET_LINKS.bak"
