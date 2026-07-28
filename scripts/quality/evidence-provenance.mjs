import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function currentGit(root) {
  const dirtyStatus = git(root, ['status', '--porcelain=v1']) ?? '';
  const dirtyDiffHash = currentDirtyDiffHash(root, dirtyStatus);
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
