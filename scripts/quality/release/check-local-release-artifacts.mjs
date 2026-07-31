#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentGit } from '../evidence-provenance.mjs';

export const RELEASE_ARTIFACTS = {
  apk: 'android/app/build/outputs/apk/release/app-release.apk',
  aab: 'android/app/build/outputs/bundle/release/app-release.aab',
};
export const RECEIPT_PATH = 'app/build/evidence/local-release-artifact-receipt.json';
export const BUILD_RECEIPT_PATH = 'app/build/evidence/android-release-build-receipt.json';
export const DEBUG_MARKERS = [
  'GoldenLoopDebugBridge',
  'golden-loop-debug',
  'goldenLoopDebug',
  '__UTOPIA_GOLDEN_LOOP_DEBUG__',
  'UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN',
];

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function artifact(root, path) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    return { path, issues: [`missing:${path}`] };
  }
  return {
    path,
    bytes: statSync(absolutePath).size,
    sha256: hashFile(absolutePath),
    absolutePath,
    issues: [],
  };
}

function executable(name, root) {
  if (process.env[name]) return process.env[name];
  if (name === 'APKSIGNER_PATH') {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.HOME || '', 'Library/Android/sdk');
    const buildTools = join(sdk, 'build-tools');
    if (!existsSync(buildTools)) return null;
    const versions = readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = join(buildTools, version, 'apksigner');
      if (existsSync(candidate)) return candidate;
    }
  }
  const result = spawnSync('which', [name === 'APKSIGNER_PATH' ? 'apksigner' : 'jarsigner'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function verifySignatures(root, artifacts) {
  const issues = [];
  const apksigner = executable('APKSIGNER_PATH', root);
  const jarsigner = executable('JARSIGNER_PATH', root);
  if (!apksigner) issues.push('missing:apksigner');
  if (!jarsigner) issues.push('missing:jarsigner');

  let apk = { signing: 'unsigned', certificate_dn: '', certificate_sha256: '' };
  if (apksigner && !artifacts.apk.issues.length) {
    const result = spawnSync(apksigner, ['verify', '--verbose', '--print-certs', artifacts.apk.absolutePath], { encoding: 'utf8' });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const verifies = /^Verifies$/m.test(output) && result.status === 0;
    apk = {
      signing: verifies && !/CN=Android Debug/i.test(output) ? 'release' : verifies ? 'debug' : 'unsigned',
      certificate_dn: output.match(/^Signer #1 certificate DN: (.+)$/m)?.[1] || '',
      certificate_sha256: output.match(/^Signer #1 certificate SHA-256 digest: (.+)$/m)?.[1] || '',
    };
  }
  if (apk.signing !== 'release') issues.push(`apk_unsigned_or_debug:${apk.signing}`);

  let aabSigned = false;
  if (jarsigner && !artifacts.aab.issues.length) {
    const result = spawnSync(jarsigner, ['-verify', '-verbose', '-certs', artifacts.aab.absolutePath], { encoding: 'utf8' });
    aabSigned = result.status === 0 && /jar verified\./i.test(`${result.stdout || ''}\n${result.stderr || ''}`);
  }
  if (!aabSigned) issues.push('aab_unsigned');
  return { issues, apk, aabSigned };
}

export function findDebugMarkers(root, artifacts) {
  const violations = [];
  for (const [name, value] of Object.entries(artifacts)) {
    if (value.issues.length) continue;
    const bytes = readFileSync(value.absolutePath);
    for (const marker of DEBUG_MARKERS) {
      if (bytes.includes(Buffer.from(marker))) violations.push(`${value.path}:${marker}`);
    }
  }
  for (const rootPath of ['dist/web', 'dist/android']) {
    const absoluteRoot = resolve(root, rootPath);
    if (!existsSync(absoluteRoot)) continue;
    for (const path of walk(absoluteRoot)) {
      const bytes = readFileSync(path);
      for (const marker of DEBUG_MARKERS) {
        if (bytes.includes(Buffer.from(marker))) violations.push(`${relative(root, path)}:${marker}`);
      }
    }
  }
  return violations;
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

export function inspectArtifacts(root = process.cwd()) {
  const artifacts = Object.fromEntries(Object.entries(RELEASE_ARTIFACTS).map(([name, path]) => [name, artifact(root, path)]));
  const issues = Object.values(artifacts).flatMap((value) => value.issues);
  if (issues.length) return { issues, artifacts, signatures: null, debugMarkers: [] };
  const signatures = verifySignatures(root, artifacts);
  issues.push(...signatures.issues);
  const debugMarkers = findDebugMarkers(root, artifacts);
  if (debugMarkers.length) issues.push(...debugMarkers.map((entry) => `debug_marker:${entry}`));
  return { issues, artifacts, signatures, debugMarkers };
}

function receiptArtifacts(inspected) {
  return Object.fromEntries(Object.entries(inspected.artifacts).map(([name, value]) => [name, {
    path: value.path,
    bytes: value.bytes,
    sha256: value.sha256,
    ...(name === 'apk' ? {
      signing: inspected.signatures.apk.signing,
      certificate_dn: inspected.signatures.apk.certificate_dn,
      certificate_sha256: inspected.signatures.apk.certificate_sha256,
    } : { signed: inspected.signatures.aabSigned }),
  }]));
}

function buildReceiptIssues(root, expectedGit, inspected) {
  const path = resolve(root, BUILD_RECEIPT_PATH);
  if (!existsSync(path)) return ['missing:android_release_build_receipt'];
  let receipt;
  try { receipt = JSON.parse(readFileSync(path, 'utf8')); } catch { return ['invalid:android_release_build_receipt_json']; }
  const issues = [];
  if (receipt.proof !== 'utopia_android_release_build_receipt' || receipt.status !== 'passed') issues.push('invalid:android_release_build_receipt_status');
  for (const key of ['head', 'tree', 'dirty']) {
    if (receipt.git?.[key] !== expectedGit[key]) issues.push(`stale:build_receipt.git.${key}`);
  }
  if (receipt.git?.dirty_diff_hash !== expectedGit.dirtyDiffHash) issues.push('stale:build_receipt.git.dirty_diff_hash');
  for (const name of ['apk', 'aab']) {
    const expected = inspected.artifacts[name];
    const actual = receipt.artifacts?.[name];
    if (!actual) { issues.push(`missing:build_receipt.${name}`); continue; }
    if (actual.path !== expected.path || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      issues.push(`stale:build_receipt.${name}`);
    }
  }
  return issues;
}

function receiptIssues(root, receipt, expectedGit) {
  const issues = [];
  if (!receipt || receipt.proof !== 'utopia_local_release_artifact_receipt' || receipt.status !== 'passed') issues.push('invalid_receipt_status');
  if (!receipt?.checked_at || Number.isNaN(Date.parse(receipt.checked_at))) issues.push('invalid:checked_at');
  for (const key of ['head', 'tree', 'dirty']) {
    if (receipt?.git?.[key] !== expectedGit[key]) issues.push(`stale:git.${key}`);
  }
  if (receipt?.git?.dirty_diff_hash !== expectedGit.dirtyDiffHash) issues.push('stale:git.dirty_diff_hash');
  for (const [name, expected] of Object.entries(RELEASE_ARTIFACTS)) {
    const actual = receipt?.artifacts?.[name];
    const path = resolve(root, expected);
    if (!actual) { issues.push(`missing:receipt.${name}`); continue; }
    if (actual.path !== expected) issues.push(`stale:${name}.path`);
    if (!existsSync(path)) { issues.push(`missing:${expected}`); continue; }
    if (actual.bytes !== statSync(path).size || actual.sha256 !== hashFile(path)) issues.push(`stale:${name}.sha256_or_bytes`);
  }
  if (receipt?.artifacts?.apk?.signing !== 'release') issues.push('apk_not_release_signed');
  if (receipt?.artifacts?.aab?.signed !== true) issues.push('aab_not_signed');
  return issues;
}

export function writeReceipt(root = process.cwd(), receiptPath = RECEIPT_PATH) {
  const inspected = inspectArtifacts(root);
  if (inspected.issues.length) throw new Error(inspected.issues.join(', '));
  const git = currentGit(root);
  const buildIssues = buildReceiptIssues(root, git, inspected);
  if (buildIssues.length) throw new Error(buildIssues.join(', '));
  const receipt = {
    proof: 'utopia_local_release_artifact_receipt',
    status: 'passed',
    checked_at: new Date().toISOString(),
    git,
    artifacts: receiptArtifacts(inspected),
    debug_markers: [],
    no_signed_proof_fabricated: true,
  };
  const output = resolve(root, receiptPath);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, output };
}

export function checkReceipt(root = process.cwd(), receiptPath = RECEIPT_PATH) {
  const path = resolve(root, receiptPath);
  if (!existsSync(path)) return ['missing:local_release_artifact_receipt'];
  let receipt;
  try { receipt = JSON.parse(readFileSync(path, 'utf8')); } catch { return ['invalid:local_release_artifact_receipt_json']; }
  const inspected = inspectArtifacts(root);
  return [...inspected.issues, ...receiptIssues(root, receipt, currentGit(root))];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || '--check';
  try {
    if (mode === '--write') {
      const result = writeReceipt(process.cwd(), process.env.UTOPIA_RELEASE_ARTIFACT_RECEIPT || RECEIPT_PATH);
      console.log(`Local release artifact receipt: PASS (${relative(process.cwd(), result.output)})`);
    } else if (mode === '--check') {
      const issues = checkReceipt(process.cwd(), process.env.UTOPIA_RELEASE_ARTIFACT_RECEIPT || RECEIPT_PATH);
      if (issues.length) throw new Error(issues.join(', '));
      console.log('Local release artifact receipt: PASS (current signed APK/AAB, hashes, Git, and debug-marker exclusion)');
    } else {
      throw new Error(`usage: ${process.argv[1]} --write|--check`);
    }
  } catch (error) {
    console.error(`Local release artifact receipt: BLOCKED (${error instanceof Error ? error.message : String(error)})`);
    process.exit(1);
  }
}
