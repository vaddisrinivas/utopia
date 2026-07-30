#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outPath = join(root, 'app', 'build', 'evidence', 'dirty-tree-inventory.json');

export function classifyDirtyPath(path) {
  if (['.dependency-cruiser.cjs', '.spectral.yaml', 'app.json', 'package.json'].includes(path)) return 'project_config';
  if (path.startsWith('tests/') || path.startsWith('server/test/')) return 'test';
  if (path.startsWith('packages/')) return 'core_or_contract';
  if (path.startsWith('app/') || path.startsWith('src/')) return 'shell';
  if (path.startsWith('server/') || path.startsWith('cloudflare/')) return 'service';
  if (path.startsWith('apps/') || path.startsWith('fastlane/')) return 'app';
  if (path.startsWith('agents/') || path.startsWith('scripts/package/') || path.startsWith('.github/actions/')) return 'authoring';
  if (path.startsWith('docs/') || path.startsWith('tasks/')) return 'documentation_or_plan';
  if (path.startsWith('scripts/') || path.startsWith('.github/')) return 'automation_or_ci';
  return 'unclassified';
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function parseStatus(raw) {
  return raw.split('\0').filter(Boolean).map((entry) => {
    const indexStatus = entry.slice(0, 1);
    const worktreeStatus = entry.slice(1, 2);
    const path = entry.slice(3);
    return {
      path,
      index_status: indexStatus,
      worktree_status: worktreeStatus,
      classification: classifyDirtyPath(path),
    };
  });
}

const files = parseStatus(git(['status', '--porcelain=v1', '-z']));
const categories = Object.fromEntries(
  [...new Set(files.map((file) => file.classification))].sort().map((category) => [
    category,
    files.filter((file) => file.classification === category).map((file) => file.path).sort(),
  ]),
);
const inventory = {
  proof: 'utopia_dirty_tree_inventory',
  checked_at: new Date().toISOString(),
  git: {
    head: git(['rev-parse', 'HEAD']).trim(),
    branch: git(['branch', '--show-current']).trim(),
  },
  status: files.length ? 'DIRTY' : 'CLEAN',
  file_count: files.length,
  unclassified_count: categories.unclassified?.length ?? 0,
  files,
  categories,
  next_step: files.length
    ? 'Review each category, then explicitly commit or park it. This script never stages, commits, deletes, or resets files.'
    : 'No dirty paths to review.',
};

mkdirSync(join(root, 'app', 'build', 'evidence'), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`DIRTY_TREE_INVENTORY=${inventory.status} files=${inventory.file_count} unclassified=${inventory.unclassified_count} evidence=${outPath}`);
