#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  currentDirtyDiffHash,
  currentGit,
  validateEvidenceEnvelope,
  validateSha256Artifact,
  validateSourceArtifactReceipt,
} from './evidence-provenance.mjs';

const root = process.cwd();
const current = currentGit(root);
assert.ok(current.head, 'test requires a git HEAD');
const envelope = {
  proof: 'fixture', checked_at: new Date().toISOString(),
  git_head: current.head, branch: current.branch,
  tree_hash: current.tree, dirty: current.dirty, dirty_diff_hash: current.dirtyDiffHash,
};
assert.equal(validateEvidenceEnvelope(root, 'fixture.json', {
  ...envelope,
}, current).valid, true);
assert.deepEqual(validateEvidenceEnvelope(root, 'fixture.json', {
  ...envelope, git_head: 'stale',
}, current).issues, [`stale:git_head:stale:expected:${current.head}`]);
assert.ok(validateEvidenceEnvelope(root, 'fixture.json', {
  ...envelope, git_head: undefined,
}, current).issues.includes('missing:git_head'));
assert.ok(validateEvidenceEnvelope(root, 'fixture.json', null, current).issues.includes('evidence_missing_or_invalid_json'));
assert.equal(validateEvidenceEnvelope(root, 'fixture.json', {
  proof: 'fixture', checked_at: new Date().toISOString(),
  git: { head: current.head, branch: current.branch, tree: current.tree, dirty: current.dirty, dirty_diff_hash: current.dirtyDiffHash },
}, current).valid, true);
assert.deepEqual(validateSha256Artifact(root, { path: 'missing.apk', sha256: '0'.repeat(64) }), ['artifact_missing:file:missing.apk']);

const tempRoot = mkdtempSync(join(tmpdir(), 'utopia-evidence-'));
spawnSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });
writeFileSync(join(tempRoot, 'tracked.txt'), 'base\n');
spawnSync('git', ['add', 'tracked.txt'], { cwd: tempRoot, stdio: 'ignore' });
spawnSync('git', ['commit', '-m', 'base'], {
  cwd: tempRoot,
  stdio: 'ignore',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'Utopia Proof',
    GIT_AUTHOR_EMAIL: 'proof@example.invalid',
    GIT_COMMITTER_NAME: 'Utopia Proof',
    GIT_COMMITTER_EMAIL: 'proof@example.invalid',
  },
});
writeFileSync(join(tempRoot, 'tracked.txt'), 'changed-one\n');
const changedOneHash = currentDirtyDiffHash(tempRoot);
writeFileSync(join(tempRoot, 'tracked.txt'), 'changed-two\n');
assert.notEqual(currentDirtyDiffHash(tempRoot), changedOneHash, 'dirty hash must include changed file content');
writeFileSync(join(tempRoot, 'untracked.txt'), 'first\n');
const untrackedOneHash = currentDirtyDiffHash(tempRoot);
writeFileSync(join(tempRoot, 'untracked.txt'), 'second\n');
assert.notEqual(currentDirtyDiffHash(tempRoot), untrackedOneHash, 'dirty hash must include untracked file content');

const receiptArtifactPath = 'artifact.txt';
writeFileSync(join(tempRoot, receiptArtifactPath), 'artifact\n');
const receiptGit = currentGit(tempRoot);
const receiptArtifact = {
  path: receiptArtifactPath,
  bytes: 9,
  sha256: '5b3513f580c8397212ff2c8f459c199efc0c90e4354a5f3533adf0a3fff3a530',
};
assert.deepEqual(validateSourceArtifactReceipt(tempRoot, {
  proof: 'receipt',
  status: 'passed',
  checked_at: new Date().toISOString(),
  git: receiptGit,
  build_command: 'build',
  artifacts: { artifact: receiptArtifact },
}, { artifact: receiptArtifact }, receiptGit), []);
assert.ok(validateSourceArtifactReceipt(tempRoot, {
  proof: 'receipt',
  status: 'passed',
  checked_at: new Date().toISOString(),
  git: receiptGit,
  build_command: 'build',
  artifacts: { artifact: { ...receiptArtifact, sha256: '0'.repeat(64) } },
}, { artifact: receiptArtifact }, receiptGit).includes('stale:receipt_artifact:artifact:sha256'));
console.log('Evidence provenance validation: PASS');
