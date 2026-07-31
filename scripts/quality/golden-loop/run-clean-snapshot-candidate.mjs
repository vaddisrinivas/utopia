#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { currentGit } from '../evidence-provenance.mjs';

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'golden-loop', 'clean-snapshot');
const outPath = process.env.UTOPIA_CLEAN_SNAPSHOT_CANDIDATE_PATH
  || join(outDir, 'clean-snapshot-candidate.json');

const tempRoot = mkdtempSync(join(tmpdir(), 'utopia-clean-snapshot-'));
const tempIndex = join(tempRoot, 'index');
const sourceRoot = root;
const STDOUT_TAIL_BYTES = 4000;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactText(value) {
  return String(value ?? '').replace(new RegExp(escapeRegExp(sourceRoot), 'g'), '<workspace>');
}

function tail(value) {
  return String(value ?? '').slice(-STDOUT_TAIL_BYTES);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: STDOUT_TAIL_BYTES * 8,
    ...options,
  });
}

function statFile(path) {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  return {
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
  };
}

function buildGitEnvironment() {
  return {
    ...process.env,
    GIT_INDEX_FILE: tempIndex,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Utopia Golden Loop',
    GIT_AUTHOR_EMAIL: 'golden-loop@example.invalid',
    GIT_COMMITTER_NAME: 'Utopia Golden Loop',
    GIT_COMMITTER_EMAIL: 'golden-loop@example.invalid',
  };
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const checkedAt = new Date().toISOString();
  const beforeMainIndex = statFile(join(root, '.git', 'index'));

  const evidence = {
    proof: 'utopia_golden_loop_clean_snapshot_candidate',
    checked_at: checkedAt,
    status: 'RUNNING',
    git: currentGit(root),
    source_git: currentGit(root),
    snapshot: {
      mode: 'temporary_git_index',
      touches_main_index: false,
      commit: null,
      tree: null,
      tree_reproducible: false,
      temp_index_path: tempIndex,
    },
    blockers: [],
    failures: [],
    commands: [],
  };

  const record = (id, command, args, result) => {
    evidence.commands.push({
      id,
      command: [command, ...args],
      status: result.status ?? 1,
      exit_code: result.status ?? 1,
      result: result.status === 0 ? 'PASS' : 'FAIL',
      stdout_tail: redactText(tail(result.stdout)),
      stderr_tail: redactText(tail(result.stderr)),
      error: result.error ? {
        code: result.error.code,
        message: redactText(String(result.error.message ?? '')),
      } : null,
    });
    if (result.status !== 0) evidence.failures.push(id);
  };

  const command = (id, args) => {
    const result = run(args[0], args.slice(1), {
      env: buildGitEnvironment(),
    });
    record(id, args[0], args.slice(1), result);
    return result;
  };

  try {
    command('read_tree_head', ['git', 'read-tree', 'HEAD']);
    if (evidence.failures.length === 0) command('add_current_filesystem', ['git', 'add', '-A']);

    if (evidence.failures.length === 0) {
      const tree = command('write_tree', ['git', 'write-tree']);
      evidence.snapshot.tree = tree.stdout.trim() || null;
    }
    if (evidence.failures.length === 0) {
      const repeat = command('write_tree_reproducibility', ['git', 'write-tree']);
      evidence.snapshot.tree_reproducible = (repeat.status ?? 1) === 0 && (repeat.stdout.trim() || null) === evidence.snapshot.tree;
    }

    const afterMainIndex = statFile(join(root, '.git', 'index'));
    evidence.snapshot.touches_main_index = !!(afterMainIndex && beforeMainIndex
      ? (afterMainIndex.size !== beforeMainIndex.size || afterMainIndex.mtimeMs !== beforeMainIndex.mtimeMs)
      : false);

    if (evidence.snapshot.tree_reproducible !== true) {
      evidence.failures.push('snapshot_tree_not_reproducible');
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
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
