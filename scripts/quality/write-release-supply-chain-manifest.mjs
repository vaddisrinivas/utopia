#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { currentGit, validateSha256Artifact, validateSourceArtifactReceipt } from './evidence-provenance.mjs';

const root = process.cwd();
const evidenceDir = join(root, 'app', 'build', 'evidence');
const manifestPath = join(evidenceDir, 'release-supply-chain.json');

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function artifact(path) {
  if (!path) return null;
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) return null;
  return {
    path: relative(root, absolutePath),
    bytes: statSync(absolutePath).size,
    sha256: createHash('sha256').update(readFileSync(absolutePath)).digest('hex'),
  };
}

function companion(name, path) {
  const value = artifact(path);
  return {
    name,
    path: path ? relative(root, resolve(root, path)) : null,
    present: Boolean(value),
    ...(value ? value : {}),
  };
}

mkdirSync(evidenceDir, { recursive: true });

const androidArtifacts = readJson(join(evidenceDir, 'android-release-artifacts.json'));
const androidBuildReceipt = readJson(join(evidenceDir, 'android-release-build-receipt.json'));
const iosExport = readJson(join(evidenceDir, 'ios-export.json'));
const releaseSbomPath = process.env.RELEASE_SBOM_PATH?.trim() || '';
const releaseProvenancePath = process.env.RELEASE_PROVENANCE_PATH?.trim() || '';
const migrationNotesPath = process.env.RELEASE_MIGRATION_NOTES_PATH?.trim() || 'docs/release-migration-notes.md';

const releaseSbom = artifact(releaseSbomPath);
const releaseProvenance = artifact(releaseProvenancePath);
const migrationNotes = companion('migration_notes', migrationNotesPath);

const blockerSet = new Set();
const receiptIssues = validateAndroidBuildReceipt();
for (const issue of receiptIssues) blockerSet.add(issue);

const androidArtifactChecks = [
  androidArtifacts?.apk ? validateSha256Artifact(root, androidArtifacts.apk) : ['missing:android_release_apk'],
  androidArtifacts?.aab ? validateSha256Artifact(root, androidArtifacts.aab) : ['missing:android_release_aab'],
];
for (const issue of androidArtifactChecks.flat()) blockerSet.add(issue);

if (!androidArtifacts?.status) blockerSet.add('missing:android_release_artifacts');
if (!iosExport?.status) blockerSet.add('missing:ios_export');

const companionDocs = [
  companion('changelog', 'CHANGELOG.md'),
  companion('privacy_notes', 'PRIVACY.md'),
  migrationNotes,
];

for (const doc of companionDocs) {
  if (!doc.present) blockerSet.add(`missing:${doc.name}`);
}

const optionalProofs = {
  sbom: releaseSbom ? { ...releaseSbom, provided: true } : { provided: false, path: releaseSbomPath || null },
  provenance: releaseProvenance ? { ...releaseProvenance, provided: true } : { provided: false, path: releaseProvenancePath || null },
};

const payload = {
  proof: 'utopia_release_supply_chain',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  release_ready: blockerSet.size === 0,
  blockers: [...blockerSet].sort(),
  android: {
    artifacts: androidArtifacts ? 'app/build/evidence/android-release-artifacts.json' : null,
    build_receipt: androidBuildReceipt ? 'app/build/evidence/android-release-build-receipt.json' : null,
    checksums: androidArtifacts?.apk && androidArtifacts?.aab ? {
      apk: androidArtifacts.apk.sha256,
      aab: androidArtifacts.aab.sha256,
    } : null,
  },
  ios_export: iosExport ? 'app/build/evidence/ios-export.json' : null,
  companions: companionDocs,
  optional_proofs: optionalProofs,
  evidence: {
    android_release_artifacts: 'app/build/evidence/android-release-artifacts.json',
    android_release_build_receipt: 'app/build/evidence/android-release-build-receipt.json',
    ios_export: 'app/build/evidence/ios-export.json',
  },
  no_secret_values_written: true,
};

writeFileSync(manifestPath, JSON.stringify(payload, null, 2));
console.log(`Release supply chain: ${payload.release_ready ? 'PASS' : 'BLOCKED'} (${payload.blockers.join(', ') || 'none'}; evidence: ${manifestPath})`);

if (process.env.REQUIRE_RELEASE_SUPPLY_CHAIN === '1' && !payload.release_ready) {
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
