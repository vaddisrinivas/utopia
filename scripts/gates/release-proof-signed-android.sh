#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

echo "release-proof-signed-android: require real release-signed APK and signed AAB"

precheck_status=0
if ! REQUIRE_RELEASE_SIGNING=1 ./scripts/quality/check-android-release-artifacts.sh; then
  precheck_status=1
fi

RELEASE_PRECHECK_STATUS="$precheck_status" node --input-type=module <<'NODE'
import {
  currentGit,
  readEvidence,
  validateAndroidReleaseArtifactsEvidence,
  validateSourceArtifactReceipt,
} from './scripts/quality/evidence-provenance.mjs';

const root = process.cwd();
const evidencePath = 'app/build/evidence/android-release-artifacts.json';
const receiptDefaultPath = 'app/build/evidence/android-release-build-receipt.json';
const evidence = readEvidence(root, evidencePath);
const expected = currentGit(root);
const issues = [];

function validateBuildReceipt(candidateEvidence) {
  const receiptPath = candidateEvidence?.build_receipt && typeof candidateEvidence.build_receipt === 'string'
    ? candidateEvidence.build_receipt
    : receiptDefaultPath;
  const receipt = readEvidence(root, receiptPath);
  if (!receipt) {
    return [`android_build_receipt_missing:${receiptPath}`];
  }

  const receiptArtifacts = {};
  if (candidateEvidence?.apk && typeof candidateEvidence.apk === 'object' && !Array.isArray(candidateEvidence.apk)) {
    receiptArtifacts.apk = {
      path: candidateEvidence.apk.path,
      sha256: candidateEvidence.apk.sha256,
      bytes: candidateEvidence.apk.bytes,
    };
  }
  if (candidateEvidence?.aab && typeof candidateEvidence.aab === 'object' && !Array.isArray(candidateEvidence.aab)) {
    receiptArtifacts.aab = {
      path: candidateEvidence.aab.path,
      sha256: candidateEvidence.aab.sha256,
      bytes: candidateEvidence.aab.bytes,
    };
  }

  return validateSourceArtifactReceipt(root, receipt, receiptArtifacts, expected).map(
    (issue) => `android_build_receipt_${issue}`,
  );
}

if (!evidence) {
  issues.push(`android_release_artifacts_missing_or_invalid_json:${evidencePath}`);
  issues.push(...validateBuildReceipt(null));
} else {
  issues.push(...validateAndroidReleaseArtifactsEvidence(root, evidence, { expected }));
  issues.push(...validateBuildReceipt(evidence));
}

if (process.env.RELEASE_PRECHECK_STATUS === '1' && issues.length === 0) {
  issues.push('check_android_release_artifacts_script_failed_without_payload');
}

if (issues.length > 0) {
  const linkedReceipt = evidence?.build_receipt && typeof evidence.build_receipt === 'string'
    ? evidence.build_receipt
    : receiptDefaultPath;
  const blockers = issues.join(', ');
  console.error(
    `release-proof-signed-android: BLOCKED (${blockers}; required_files: app/build/evidence/android-release-artifacts.json + app/build/evidence/android-release-build-receipt.json; expected ${evidencePath} (release proof) and ${linkedReceipt} (build receipt); required: proof envelope + checked_at + git/tree/dirty, package, version, release-signed APK, signed AAB, build receipt with envelope and matching artifact hashes; next command: npm run release:proof:signed-android)`,
  );
  process.exit(1);
}

console.log(`release-proof-signed-android: PASS (${evidencePath} and linked receipt)`);
NODE
