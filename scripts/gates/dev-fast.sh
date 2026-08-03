#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

echo "dev-fast: npm run typecheck"
npm run typecheck

echo "dev-fast: npm run check:audio-loop-source-roundtrip"
npm run check:audio-loop-source-roundtrip

echo "dev-fast: npm run check:widget-catalog"
npm run check:widget-catalog

echo "dev-fast: npm run check:widget-catalog-env-assertions"
npm run check:widget-catalog-env-assertions

echo "dev-fast: npm run check:package-compiler"
npm run check:package-compiler

echo "dev-fast: npm run check:audio-loop"
npm run check:audio-loop

echo "dev-fast: npm run phase3:check:chat-send"
npm run phase3:check:chat-send

echo "dev-fast: npm run phase3:check:chat-rollback-idempotency"
npm run phase3:check:chat-rollback-idempotency

echo "dev-fast: PASS"
