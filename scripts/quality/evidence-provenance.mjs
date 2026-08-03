import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function currentGit(root) {
  const { dirtyStatus, dirtyDiffHash } = currentStableDirtyState(root);
  return {
    branch: git(root, ['branch', '--show-current']),
    head: git(root, ['rev-parse', '--short', 'HEAD']),
    fullHead: git(root, ['rev-parse', 'HEAD']),
    tree: git(root, ['rev-parse', 'HEAD^{tree}']),
    tree_hash: git(root, ['rev-parse', 'HEAD^{tree}']),
    dirty: dirtyStatus.length > 0,
    dirtyDiffHash,
    dirty_diff_hash: dirtyDiffHash,
  };
}

function currentStableDirtyState(root) {
  let dirtyStatus = '';
  let dirtyDiffHash = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    dirtyStatus = git(root, ['status', '--porcelain=v1']) ?? '';
    dirtyDiffHash = currentDirtyDiffHash(root, dirtyStatus);
    const nextStatus = git(root, ['status', '--porcelain=v1']) ?? '';
    const nextHash = currentDirtyDiffHash(root, nextStatus);
    if (nextStatus === dirtyStatus && nextHash === dirtyDiffHash) break;
    dirtyStatus = nextStatus;
    dirtyDiffHash = nextHash;
  }
  return { dirtyStatus, dirtyDiffHash };
}

export function currentDirtyDiffHash(root, dirtyStatus = git(root, ['status', '--porcelain=v1']) ?? '') {
  const hash = createHash('sha256');
  hash.update('utopia-dirty-diff-v2\0');
  hash.update(dirtyStatus);
  hash.update('\0--cached\0');
  hash.update(git(root, ['diff', '--binary', '--cached']) ?? '');
  hash.update('\0--worktree\0');
  hash.update(git(root, ['diff', '--binary']) ?? '');
  hash.update('\0--untracked\0');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']) ?? '';
  for (const relativePath of untracked.split('\n').filter(Boolean).sort()) {
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) continue;
    const stat = statSync(absolutePath);
    if (!stat.isFile()) continue;
    hash.update(relativePath);
    hash.update('\0');
    hash.update(createHash('sha256').update(readFileSync(absolutePath)).digest('hex'));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function readEvidence(root, relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Validate the minimum provenance envelope for a proof artifact.
 * Legacy artifacts are deliberately rejected: a passing flag without source
 * provenance cannot be used as completion evidence.
 */
export function validateEvidenceEnvelope(root, relativePath, value, expected = currentGit(root)) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, issues: ['evidence_missing_or_invalid_json'] };
  }
  if (typeof value.proof !== 'string' || value.proof.length === 0) issues.push('missing:proof');
  if (typeof value.checked_at !== 'string' || Number.isNaN(Date.parse(value.checked_at))) {
    issues.push('missing_or_invalid:checked_at');
  }

  // Accept the two envelopes emitted by existing gates while requiring one
  // canonical commit value everywhere going forward.
  const gitEnvelope = value.git && typeof value.git === 'object' ? value.git : value;
  const artifactHead = typeof gitEnvelope.git_head === 'string'
    ? gitEnvelope.git_head
    : typeof gitEnvelope.head === 'string' ? gitEnvelope.head : null;
  if (!artifactHead) {
    issues.push('missing:git_head');
  } else if (!expected.head || !(expected.head === artifactHead || expected.fullHead === artifactHead || expected.fullHead?.startsWith(artifactHead))) {
    issues.push(`stale:git_head:${artifactHead}:expected:${expected.head ?? 'unknown'}`);
  }

  const artifactBranch = typeof gitEnvelope.branch === 'string' ? gitEnvelope.branch : null;
  if (!artifactBranch) issues.push('missing:branch');
  else if (expected.branch && artifactBranch !== expected.branch) issues.push(`stale:branch:${artifactBranch}:expected:${expected.branch}`);

  const artifactTree = typeof gitEnvelope.tree_hash === 'string'
    ? gitEnvelope.tree_hash
    : typeof gitEnvelope.tree === 'string' ? gitEnvelope.tree : null;
  if (!artifactTree) issues.push('missing:tree_hash');
  else if (expected.tree && artifactTree !== expected.tree) issues.push(`stale:tree_hash:${artifactTree}:expected:${expected.tree}`);

  if (typeof gitEnvelope.dirty !== 'boolean') issues.push('missing:dirty');
  else if (typeof expected.dirty === 'boolean' && gitEnvelope.dirty !== expected.dirty) {
    issues.push(`stale:dirty:${String(gitEnvelope.dirty)}:expected:${String(expected.dirty)}`);
  }
  const artifactDirtyDiffHash = typeof gitEnvelope.dirty_diff_hash === 'string' ? gitEnvelope.dirty_diff_hash : null;
  if (!artifactDirtyDiffHash) issues.push('missing:dirty_diff_hash');
  else if (expected.dirtyDiffHash && artifactDirtyDiffHash !== expected.dirtyDiffHash) {
    issues.push('stale:dirty_diff_hash');
  }

  return {
    valid: issues.length === 0,
    issues,
    relativePath,
    git_head: artifactHead,
    branch: artifactBranch,
  };
}

export function validateSha256Artifact(root, artifact) {
  const issues = [];
  if (!artifact || typeof artifact !== 'object') return ['artifact_missing'];
  if (typeof artifact.path !== 'string' || !artifact.path) return ['artifact_missing:path'];
  if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    return [`artifact_invalid:sha256:${artifact.path}`];
  }
  const path = join(root, artifact.path);
  if (!existsSync(path)) return [`artifact_missing:file:${artifact.path}`];
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual.toLowerCase() !== artifact.sha256.toLowerCase()) issues.push(`artifact_stale:sha256:${artifact.path}`);
  if (typeof artifact.bytes === 'number' && statSync(path).size !== artifact.bytes) {
    issues.push(`artifact_stale:bytes:${artifact.path}`);
  }
  return issues;
}

export function validateSourceArtifactReceipt(root, receipt, artifacts, expected = currentGit(root)) {
  const issues = [];
  const envelope = validateEvidenceEnvelope(root, 'source-artifact-receipt', receipt, expected);
  issues.push(...envelope.issues);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return ['receipt_missing_or_invalid_json'];
  }
  if (receipt.status !== 'passed') issues.push(`receipt_status:${String(receipt.status)}`);
  if (typeof receipt.build_command !== 'string' || receipt.build_command.length === 0) {
    issues.push('missing:build_command');
  }
  if (!receipt.artifacts || typeof receipt.artifacts !== 'object' || Array.isArray(receipt.artifacts)) {
    issues.push('missing:receipt_artifacts');
    return issues;
  }
  for (const [name, artifact] of Object.entries(artifacts)) {
    const receiptArtifact = receipt.artifacts[name];
    if (!receiptArtifact || typeof receiptArtifact !== 'object') {
      issues.push(`missing:receipt_artifact:${name}`);
      continue;
    }
    for (const field of ['path', 'sha256', 'bytes']) {
      if (receiptArtifact[field] !== artifact[field]) issues.push(`stale:receipt_artifact:${name}:${field}`);
    }
    issues.push(...validateSha256Artifact(root, receiptArtifact).map((issue) => `receipt_${name}:${issue}`));
  }
  return issues;
}

function validateSha256AndSize(root, artifact, prefix) {
  return validateSha256Artifact(root, artifact).map((issue) => `${prefix}:${issue}`);
}

function ensureString(value, path, issues, prefix, minLength = 1) {
  if (typeof value !== 'string' || value.length < minLength) issues.push(`${prefix}:${path}`);
}

function ensurePositiveInteger(value, path, issues, prefix) {
  if (!Number.isInteger(value) || value <= 0) issues.push(`${prefix}:${path}`);
}

function validateEvidenceFreshness(checkedAt, referenceCheckedAt, maxAgeMs, now) {
  const checked = Date.parse(checkedAt);
  if (Number.isNaN(checked)) return null;

  const age = now - checked;
  if (age < -5 * 60 * 1000) {
    return `stale:checked_at_future:${checkedAt}`;
  }
  if (age > maxAgeMs) {
    return `stale:checked_at_too_old:${checkedAt}`;
  }
  if (referenceCheckedAt) {
    const reference = Date.parse(referenceCheckedAt);
    if (!Number.isNaN(reference) && checked < reference) {
      return `stale:checked_at_older_than_reference:${checkedAt}:${referenceCheckedAt}`;
    }
  }
  return null;
}

export function validateAndroidReleaseArtifactsEvidence(
  root,
  evidence,
  {
    expected = currentGit(root),
    enforceEnvelope = true,
  } = {},
) {
  const issues = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['android_artifacts_missing_or_invalid_json'];
  }
  if (typeof evidence.checked_at !== 'string' || Number.isNaN(Date.parse(evidence.checked_at))) {
    issues.push('missing_or_invalid:checked_at');
  }
  if (enforceEnvelope) {
    issues.push(...validateEvidenceEnvelope(root, 'app/build/evidence/android-release-artifacts.json', evidence, expected).issues);
  }

  if (evidence.proof !== 'utopia_android_release_artifacts') issues.push('android_artifacts_proof_mismatch');
  if (evidence.status !== 'passed') issues.push(`android_artifacts_status_${String(evidence.status)}`);
  ensureString(evidence.package, 'package', issues, 'android_artifacts');
  if (evidence.package !== 'app.utopia') issues.push(`android_artifacts_package_mismatch:${evidence.package}`);
  ensureString(evidence.version_name, 'version_name', issues, 'android_artifacts');
  ensurePositiveInteger(evidence.version_code, 'version_code', issues, 'android_artifacts');

  if (!evidence.apk || typeof evidence.apk !== 'object' || Array.isArray(evidence.apk)) {
    issues.push('android_artifacts_missing_apk');
  } else {
    if (evidence.apk.signing !== 'release') issues.push(`android_apk_signing_${String(evidence.apk.signing)}`);
    ensurePositiveInteger(evidence.apk.bytes, 'bytes', issues, 'android_apk');
    ensureString(evidence.apk.certificate_sha256, 'certificate_sha256', issues, 'android_apk', 32);
    issues.push(...validateSha256AndSize(root, evidence.apk, 'android_apk').filter(Boolean));
  }

  if (!evidence.aab || typeof evidence.aab !== 'object' || Array.isArray(evidence.aab)) {
    issues.push('android_artifacts_missing_aab');
  } else {
    if (evidence.aab.signed !== true) issues.push('android_aab_not_signed');
    ensurePositiveInteger(evidence.aab.bytes, 'bytes', issues, 'android_aab');
    issues.push(...validateSha256AndSize(root, evidence.aab, 'android_aab').filter(Boolean));
  }

  return issues;
}

export function validatePhysicalDeviceReleaseEvidence(
  root,
  evidence,
  {
    expected = currentGit(root),
    enforceEnvelope = true,
    androidArtifacts = /** @type {Record<string, any> | null} */ (null),
  } = {},
) {
  const issues = [];
  const defaultFreshnessHours = Number.parseInt(process.env.PHYSICAL_DEVICE_PROOF_MAX_AGE_HOURS ?? '24', 10);
  const maxFreshnessMs = Number.isFinite(defaultFreshnessHours) && defaultFreshnessHours > 0
    ? defaultFreshnessHours * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    issues.push('physical_device_evidence_missing_or_invalid_json');
    return issues;
  }
  if (typeof evidence.checked_at !== 'string' || Number.isNaN(Date.parse(evidence.checked_at))) {
    issues.push('missing_or_invalid:checked_at');
  }
  if (evidence.proof !== 'utopia_physical_device_release') issues.push('physical_device_proof_mismatch');
  if (evidence.status !== 'passed') issues.push(`physical_device_status_${String(evidence.status)}`);

  if (enforceEnvelope) {
    issues.push(...validateEvidenceEnvelope(root, 'app/build/evidence/physical-device-release.json', evidence, expected).issues);
  }
  if (typeof evidence.checked_at === 'string') {
    const freshnessIssue = validateEvidenceFreshness(
      evidence.checked_at,
      androidArtifacts?.checked_at,
      maxFreshnessMs,
      now,
    );
    if (freshnessIssue) issues.push(`physical_device_${freshnessIssue}`);
  }

  if (!evidence.device || typeof evidence.device !== 'object' || Array.isArray(evidence.device)) {
    issues.push('physical_device_missing_device');
  } else {
    if (!evidence.device.manufacturer) issues.push('physical_device_manufacturer_missing');
    if (!evidence.device.model) issues.push('physical_device_model_missing');
    if (!evidence.device.sdk) issues.push('physical_device_sdk_missing');
    if (!/^[a-f0-9]{64}$/i.test(String(evidence.device.build_fingerprint_sha256 ?? ''))) {
      issues.push('physical_device_fingerprint_missing_or_invalid');
    }
  }

  if (evidence.app?.device_id !== undefined) issues.push('physical_device_raw_serial_written');
  if (evidence.device_serial) issues.push('physical_device_serial_written');
  if (evidence.no_device_serial_written !== true) issues.push('physical_device_no_device_serial_guard_missing');

  if (!evidence.app || typeof evidence.app !== 'object' || Array.isArray(evidence.app)) {
    issues.push('physical_device_missing_app_summary');
  } else {
    if (evidence.app.installed !== true) issues.push('physical_device_not_installed');
    if (evidence.app.launch_verified !== true) issues.push('physical_device_not_launch_verified');
    if (evidence.app.basic_flow_verified !== true) issues.push('physical_device_basic_flow_missing');
    if (!evidence.app.package_name) issues.push('physical_device_package_name_missing');
    if (!evidence.app.version_name) issues.push('physical_device_app_version_name_missing');
    if (!Number.isInteger(evidence.app.version_code) || evidence.app.version_code <= 0) {
      issues.push('physical_device_app_version_code_missing');
    }
  }

  if (!evidence.artifact || typeof evidence.artifact !== 'object' || Array.isArray(evidence.artifact)) {
    issues.push('physical_device_artifact_binding_missing');
  } else {
    if (!evidence.artifact.path) issues.push('physical_device_artifact_path_missing');
    if (!evidence.artifact.sha256) issues.push('physical_device_artifact_sha256_missing');
    if (!Number.isInteger(evidence.artifact.bytes) || evidence.artifact.bytes <= 0) {
      issues.push('physical_device_artifact_bytes_missing');
    }
    issues.push(...validateSha256AndSize(root, evidence.artifact, 'physical_device_artifact').filter(Boolean));
  }

  if (androidArtifacts && typeof androidArtifacts === 'object' && !Array.isArray(androidArtifacts)) {
    if (androidArtifacts.checked_at && typeof androidArtifacts.checked_at === 'string') {
      const referencedArtifactChecked = Date.parse(androidArtifacts.checked_at);
      if (Number.isNaN(referencedArtifactChecked)) {
        issues.push('physical_device_android_artifacts_checked_at_invalid');
      }
    }
    if (androidArtifacts.package && evidence.app?.package_name !== androidArtifacts.package) {
      issues.push(`physical_device_package_mismatch:${evidence.app?.package_name}`);
    }
    if (androidArtifacts.version_name && evidence.app?.version_name !== androidArtifacts.version_name) {
      issues.push(`physical_device_version_name_mismatch:${evidence.app?.version_name}`);
    }
    if (androidArtifacts.version_code && evidence.app?.version_code !== androidArtifacts.version_code) {
      issues.push(`physical_device_version_code_mismatch:${evidence.app?.version_code}`);
    }
    if (androidArtifacts.apk) {
      if (!evidence.artifact || evidence.artifact.path !== androidArtifacts.apk.path) {
        issues.push(`physical_device_artifact_path_mismatch:${evidence.artifact?.path}`);
      }
      if (evidence.artifact?.sha256 && evidence.artifact.sha256 !== androidArtifacts.apk.sha256) {
        issues.push('physical_device_artifact_sha256_mismatch');
      }
      if (typeof evidence.artifact?.bytes === 'number' && evidence.artifact.bytes !== androidArtifacts.apk.bytes) {
        issues.push('physical_device_artifact_bytes_mismatch');
      }
    }
  }

  return issues;
}
