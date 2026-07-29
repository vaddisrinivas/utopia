#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

if ! REQUIRE_RELEASE_SIGNING=1 ./scripts/quality/check-android-release-artifacts.sh; then
  echo "release-proof-physical-device: BLOCKED (signed Android proof is missing or stale; refresh with BUILD_RELEASE_ARTIFACTS=1 npm run release:proof:signed-android and up-to-date app/build/evidence/android-release-build-receipt.json)" >&2
  exit 1
fi

node --input-type=module <<'NODE'
import {
  currentGit,
  readEvidence,
  validateAndroidReleaseArtifactsEvidence,
  validatePhysicalDeviceReleaseEvidence,
} from './scripts/quality/evidence-provenance.mjs';

const root = process.cwd();
const relativePath = 'app/build/evidence/physical-device-release.json';
const androidPath = 'app/build/evidence/android-release-artifacts.json';
const evidence = readEvidence(root, relativePath);
const androidEvidence = readEvidence(root, androidPath);
const expectedGit = currentGit(root);

const issues = [];
if (!evidence) {
  issues.push(`physical_device_evidence_missing:${relativePath}`);
} else {
  issues.push(...validatePhysicalDeviceReleaseEvidence(root, evidence, {
    expected: expectedGit,
    androidArtifacts: androidEvidence,
  }));
}

if (!androidEvidence) {
  issues.push(`android_artifacts_missing:${androidPath}`);
} else {
  issues.push(...validateAndroidReleaseArtifactsEvidence(root, androidEvidence, { expected: expectedGit, enforceEnvelope: true }));
}

if (issues.length > 0) {
  const issuesText = issues.join(', ');
  console.error('release-proof-physical-device: BLOCKED');
  console.error(`  evidence: ${relativePath}`);
  console.error(`  blockers: ${issuesText}`);
  console.error('  required_device_mode: real physical device only');
  console.error('  required_provenance: proof, checked_at, git.tree_hash, app version/package, artifact path/hash/bytes, device manufacturer/model/sdk/build_fingerprint_sha256');
  console.error(`  freshness_rule: evidence must be <= ${process.env.PHYSICAL_DEVICE_PROOF_MAX_AGE_HOURS || '24'}h and not older than linked android artifact evidence checked_at`);
  console.error('  freshness_guard: if evidence is stale, this gate must remain BLOCKED');
  console.error('  remediation: npm run release:collect:physical-device && npm run release:proof:physical-device');
  process.exit(1);
}

console.log(`release-proof-physical-device: PASS (${relativePath} linked to ${androidPath})`);
NODE
