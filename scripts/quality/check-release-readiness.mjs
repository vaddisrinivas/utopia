#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { currentGit, validateSourceArtifactReceipt } from './evidence-provenance.mjs';

const root = process.cwd();
const evidenceDir = join(root, 'app', 'build', 'evidence');
const evidencePath = join(evidenceDir, 'release-readiness.json');
mkdirSync(evidenceDir, { recursive: true });

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function envPresent(names) {
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name]?.trim())]));
}

const androidEnvNames = [
  'ANDROID_KEYSTORE_PATH',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
  'EXPO_TOKEN',
];
const appleEnvNames = [
  'ASC_API_KEY_ID',
  'ASC_API_ISSUER_ID',
  'ASC_API_KEY_PATH',
  'APPLE_TEAM_ID',
];

const androidEnv = envPresent(androidEnvNames);
const appleEnv = envPresent(appleEnvNames);
const androidArtifacts = readJson(join(evidenceDir, 'android-release-artifacts.json'));
const androidBuildReceipt = readJson(join(evidenceDir, 'android-release-build-receipt.json'));
const iosExport = readJson(join(evidenceDir, 'ios-export.json'));
const head = git(['rev-parse', '--short', 'HEAD']) || 'unknown';
const branch = git(['branch', '--show-current']) || 'unknown';
const artifactHead = androidArtifacts?.git?.head || androidArtifacts?.git_head;
const missingAndroidEnv = androidEnvNames.filter((name) => !androidEnv[name]);
const missingAppleEnv = appleEnvNames.filter((name) => !appleEnv[name]);
const keystorePath = process.env.ANDROID_KEYSTORE_PATH?.trim() || '';
const androidBuildReceiptIssues = validateAndroidBuildReceipt();

const checks = {
  android_release_artifacts_present: androidArtifacts?.status === 'passed',
  android_artifacts_current_head: artifactHead === head,
  android_build_receipt_current: androidBuildReceiptIssues.length === 0,
  android_apk_release_signed: androidArtifacts?.apk?.signing === 'release',
  android_aab_signed: androidArtifacts?.aab?.signed === true,
  android_signing_env_present: missingAndroidEnv.length === 0,
  android_keystore_file_present: !keystorePath || existsSync(keystorePath),
  ios_export_present: iosExport?.status === 'passed',
  ios_release_env_present: missingAppleEnv.length === 0,
};

const blockers = [];
if (!checks.android_release_artifacts_present) blockers.push('android_release_artifacts_missing');
if (!checks.android_artifacts_current_head) blockers.push('android_release_artifacts_stale');
if (!checks.android_build_receipt_current) blockers.push('android_release_build_receipt_missing_or_stale');
if (!checks.android_apk_release_signed) blockers.push('android_apk_not_release_signed');
if (!checks.android_aab_signed) blockers.push('android_aab_unsigned');
if (!checks.android_signing_env_present) blockers.push('android_signing_env_missing');
if (!checks.android_keystore_file_present) blockers.push('android_keystore_file_missing');
if (!checks.ios_export_present) blockers.push('ios_export_missing');
if (!checks.ios_release_env_present) blockers.push('ios_release_env_missing');

const payload = {
  proof: 'utopia_release_readiness',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  release_ready: blockers.length === 0,
  blockers,
  checks,
  missing_env: {
    android: missingAndroidEnv,
    apple: missingAppleEnv,
  },
  android_build_receipt_issues: androidBuildReceiptIssues,
  evidence: {
    android_release_artifacts: 'app/build/evidence/android-release-artifacts.json',
    android_release_build_receipt: 'app/build/evidence/android-release-build-receipt.json',
    ios_export: 'app/build/evidence/ios-export.json',
  },
  no_secret_values_written: true,
};

writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
console.log(`Release readiness: ${payload.release_ready ? 'PASS' : 'BLOCKED'} (${blockers.join(', ') || 'none'}; evidence: ${evidencePath})`);

if (process.env.REQUIRE_RELEASE_READY === '1' && !payload.release_ready) {
  process.exit(1);
}

function validateAndroidBuildReceipt() {
  if (!androidBuildReceipt) return ['missing:android_release_build_receipt'];
  if (!androidArtifacts?.apk || !androidArtifacts?.aab) return ['missing:android_release_artifacts_for_receipt'];
  return validateSourceArtifactReceipt(root, androidBuildReceipt, {
    apk: {
      path: androidArtifacts.apk.path,
      sha256: androidArtifacts.apk.sha256,
      bytes: androidArtifacts.apk.bytes,
    },
    aab: {
      path: androidArtifacts.aab.path,
      sha256: androidArtifacts.aab.sha256,
      bytes: androidArtifacts.aab.bytes,
    },
  });
}
