#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { currentGit } from '../evidence-provenance.mjs';

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'golden-loop', 'clean-snapshot');
const outPath = process.env.UTOPIA_CLEAN_SNAPSHOT_CANDIDATE_PATH
  || join(outDir, 'clean-snapshot-candidate.json');
const tempIndex = join(tmpdir(), `utopia-clean-snapshot-index-${process.pid}`);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

function tail(value) {
  return String(value ?? '').slice(-4000);
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const checkedAt = new Date().toISOString();
  const evidence = {
    proof: 'utopia_golden_loop_clean_snapshot_candidate',
    checked_at: checkedAt,
    status: 'RUNNING',
    git: currentGit(root),
    snapshot: {
      mode: 'temporary_git_index',
      touches_main_index: false,
      commit: null,
      tree: null,
    },
    blockers: [],
    failures: [],
    commands: [],
  };

  const record = (id, result) => {
    evidence.commands.push({
      id,
      status: result.status ?? 1,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr),
      error: result.error ? { code: result.error.code, message: String(result.error.message ?? '') } : null,
    });
    if (result.status !== 0) evidence.failures.push(id);
  };

  try {
    const env = {
      ...process.env,
      GIT_INDEX_FILE: tempIndex,
      GIT_AUTHOR_NAME: 'Utopia Golden Loop',
      GIT_AUTHOR_EMAIL: 'golden-loop@example.invalid',
      GIT_COMMITTER_NAME: 'Utopia Golden Loop',
      GIT_COMMITTER_EMAIL: 'golden-loop@example.invalid',
    };
    record('read_tree_head', run('git', ['read-tree', 'HEAD'], { env }));
    if (evidence.failures.length === 0) record('add_current_filesystem', run('git', ['add', '-A'], { env }));
    if (evidence.failures.length === 0) {
      const tree = run('git', ['write-tree'], { env });
      record('write_tree', tree);
      evidence.snapshot.tree = tree.stdout.trim() || null;
    }
    if (evidence.failures.length === 0) {
      const commit = run('git', [
        'commit-tree',
        evidence.snapshot.tree,
        '-p',
        'HEAD',
        '-m',
        `utopia clean snapshot candidate ${checkedAt}`,
      ], { env });
      record('commit_tree', commit);
      evidence.snapshot.commit = commit.stdout.trim() || null;
    }
  } finally {
    rmSync(tempIndex, { force: true });
  }

  evidence.status = evidence.failures.length === 0 ? 'CANDIDATE_PASS' : 'FAIL';
  evidence.completed_at = new Date().toISOString();
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`CLEAN_SNAPSHOT_CANDIDATE=${evidence.status} evidence=${outPath}`);
  if (evidence.failures.length) console.log(`FAILURES=${evidence.failures.join(',')}`);
  process.exitCode = evidence.status === 'CANDIDATE_PASS' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
