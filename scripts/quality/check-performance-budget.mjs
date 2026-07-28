#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { currentGit } from './evidence-provenance.mjs';

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'performance');
const outPath = join(outDir, 'performance-budget.json');

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function findFirst(dir, predicate) {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFirst(path, predicate);
      if (found) return found;
    } else if (predicate(path)) {
      return path;
    }
  }
  return null;
}

function sizeOf(path) {
  return path && existsSync(path) ? statSync(path).size : null;
}

function rel(path) {
  return path ? path.slice(root.length + 1) : null;
}

const webEntry = findFirst(join(root, 'dist', 'web'), (path) => /\/entry-[^/]+\.js$/.test(path));
const webWorker = findFirst(join(root, 'dist', 'web'), (path) => /\/worker-[^/]+\.js$/.test(path));
const androidEntry = findFirst(join(root, 'dist', 'android'), (path) => /\/entry-[^/]+\.hbc$/.test(path));
const iosEntry = findFirst(join(root, 'dist', 'ios'), (path) => /\/entry-[^/]+\.hbc$/.test(path));

const budgets = {
  web_entry_bytes: 2_200_000,
  web_worker_bytes: 300_000,
  android_hbc_bytes: 4_500_000,
  ios_hbc_bytes: 4_500_000,
};

const measured = {
  web_entry_bytes: sizeOf(webEntry),
  web_worker_bytes: sizeOf(webWorker),
  android_hbc_bytes: sizeOf(androidEntry),
  ios_hbc_bytes: sizeOf(iosEntry),
};

const checks = Object.fromEntries(Object.entries(budgets).map(([key, budget]) => [
  key,
  measured[key] != null && measured[key] <= budget,
]));
const missing = Object.entries(measured).filter(([, value]) => value == null).map(([key]) => key);
const overBudget = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
const passed = missing.length === 0 && overBudget.length === 0;

const payload = {
  proof: 'utopia_performance_budget',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  status: passed ? 'passed' : 'failed',
  budgets,
  measured,
  checks,
  artifacts: {
    web_entry: rel(webEntry),
    web_worker: rel(webWorker),
    android_entry: rel(androidEntry),
    ios_entry: rel(iosEntry),
  },
  missing,
  over_budget: overBudget,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2));

console.log(`Performance budget: ${passed ? 'PASS' : 'FAIL'} (evidence: ${outPath})`);
if (!passed) {
  process.exit(1);
}
