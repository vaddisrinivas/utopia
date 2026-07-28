#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ASSET_LINKS="${ROOT_DIR}/.well-known/assetlinks.json"
PKG_NAME="${ASSETLINKS_PACKAGE:-app.utopia}"
REMOTE_ASSET_LINKS_URL="${ASSETLINKS_URL:-https://utopia.app/.well-known/assetlinks.json}"
PLACEHOLDER="REPLACE_WITH_RELEASE_SHA256_CERT_FINGERPRINT"

if [[ ! -f "$ASSET_LINKS" ]]; then
  echo "assetlinks file not found: $ASSET_LINKS"
  exit 1
fi

stored_fingerprint=$(grep -oE '"[0-9A-F:]{59,}"' "$ASSET_LINKS" | tr -d '"' | head -n 1 || true)
if [[ -z "$stored_fingerprint" || "$stored_fingerprint" == "$PLACEHOLDER" ]]; then
  echo "assetlinks still contains placeholder fingerprint. populate .well-known/assetlinks.json before release"
  exit 1
fi

if [[ ! "$stored_fingerprint" =~ ^[0-9A-F:]{59,}$ ]]; then
  echo "assetlinks file does not contain a valid SHA-256 fingerprint: $stored_fingerprint"
  exit 1
fi

if [[ "${ANDROID_KEYSTORE_PATH:-}" != "" && "${ANDROID_KEY_ALIAS:-}" != "" && "${ANDROID_KEYSTORE_PASSWORD:-}" != "" && "${ANDROID_KEY_PASSWORD:-}" != "" ]]; then
  computed_fingerprint=$(keytool -list -v \
    -keystore "$ANDROID_KEYSTORE_PATH" \
    -alias "$ANDROID_KEY_ALIAS" \
    -storepass "$ANDROID_KEYSTORE_PASSWORD" \
    -keypass "$ANDROID_KEY_PASSWORD" \
    | awk '/SHA256:/{print $2; exit}')
  if [[ -z "$computed_fingerprint" ]]; then
    echo "Unable to read SHA-256 fingerprint from provided keystore. Check toolchain and secret inputs."
    exit 1
  fi

  if [[ "$computed_fingerprint" != "$stored_fingerprint" ]]; then
    echo "assetlinks fingerprint mismatch"
    echo "  stored:  $stored_fingerprint"
    echo "  computed: $computed_fingerprint"
    exit 1
  fi

  echo "assetlinks SHA-256 fingerprint matches signing key: $stored_fingerprint"
else
  echo "Keystore environment variables are not set. Skipping computed-signature match check."
  echo "Stored assetlinks fingerprint: $stored_fingerprint"
fi

if ! grep -q "$PKG_NAME" "$ASSET_LINKS"; then
  echo "assetlinks is missing expected package: $PKG_NAME"
  exit 1
fi

if [[ -n "${REMOTE_ASSET_LINKS_URL:-}" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to verify remote assetlinks. Install curl or set ASSETLINKS_URL empty to skip."
    exit 1
  fi

  remote_asset_links="$(mktemp)"
  if ! curl -fsSL "$REMOTE_ASSET_LINKS_URL" > "$remote_asset_links"; then
    rm -f "$remote_asset_links"
    echo "failed to fetch remote app links file from $REMOTE_ASSET_LINKS_URL"
    exit 1
  fi

  if ! grep -q "$PKG_NAME" "$remote_asset_links" || ! grep -q "$stored_fingerprint" "$remote_asset_links"; then
    echo "remote assetlinks verification failed for $REMOTE_ASSET_LINKS_URL"
    echo "expected package: $PKG_NAME and fingerprint: $stored_fingerprint"
    rm -f "$remote_asset_links"
    exit 1
  fi

  if grep -q "$PLACEHOLDER" "$remote_asset_links"; then
    echo "remote assetlinks still contains placeholder fingerprint."
    rm -f "$remote_asset_links"
    exit 1
  fi

  rm -f "$remote_asset_links"
  echo "remote assetlinks verified: $REMOTE_ASSET_LINKS_URL"
fi

for domain in utopia.app www.utopia.app; do
  if ! curl -fsSI "https://$domain" >/dev/null 2>&1; then
    echo "HTTPS verification failed for https://$domain"
    exit 1
  fi
  echo "HTTPS verification passed for https://$domain"
done

echo "assetlinks manifest verified: $ASSET_LINKS"
