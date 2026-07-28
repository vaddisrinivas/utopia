#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const results = [];

const steps = [
  {
    label: 'config validation',
    command: 'npm',
    args: ['run', 'config:validate'],
  },
  {
    label: 'typecheck',
    command: 'npm',
    args: ['run', 'typecheck'],
  },
  {
    label: 'shared package validation tests',
    command: 'npm',
    args: ['exec', '--', 'vitest', 'run', 'tests/contracts/package-validation.test.ts'],
    requires: ['tests/contracts/package-validation.test.ts'],
  },
  {
    label: 'server package validation fixtures',
    command: tsxCommand(),
    args: tsxArgs('server/test/package-validation.ts'),
    requires: ['server/test/package-validation.ts'],
  },
  {
    label: 'package loader and runtime-context tests',
    command: 'npm',
    args: ['exec', '--', 'vitest', 'run', 'tests/domain/package-loader.test.ts', 'tests/domain/runtime-context.test.ts', 'tests/db/app-package-activation.test.ts'],
    requires: [
      'tests/domain/package-loader.test.ts',
      'tests/domain/runtime-context.test.ts',
      'tests/db/app-package-activation.test.ts',
    ],
  },
  {
    label: 'renderer tests',
    command: 'npm',
    args: ['exec', '--', 'vitest', 'run', 'tests/presentation'],
    requires: ['tests/presentation'],
  },
  {
    label: 'package portability check',
    command: 'node',
    args: ['scripts/quality/check-platform-package-portability.mjs'],
  },
];

for (const step of steps) {
  const missing = (step.requires ?? []).filter((rel) => !exists(rel));
  if (missing.length) {
    results.push({ label: step.label, status: 'blocked', reason: `missing required lane output: ${missing.join(', ')}` });
    continue;
  }

  const outcome = run(step.command, step.args);
  if (outcome.ok) {
    results.push({ label: step.label, status: 'passed' });
  } else {
    results.push({
      label: step.label,
      status: 'failed',
      reason: outcome.reason,
    });
  }
}

const blocked = results.filter((item) => item.status === 'blocked');
const failed = results.filter((item) => item.status === 'failed');

if (blocked.length || failed.length) {
  console.error('Platform day1 gate: BLOCKED');
  for (const item of [...blocked, ...failed]) {
    console.error(`- ${item.label}: ${item.reason}`);
  }
  process.exit(1);
}

console.log('Platform day1 gate: PASS');

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    return { ok: false, reason: `${result.error.code ?? 'spawn_error'}: ${result.error.message}` };
  }

  if (result.status !== 0) {
    return { ok: false, reason: `exited with code ${result.status}` };
  }

  return { ok: true };
}

function tsxCommand() {
  const localServerTsx = path.join(root, 'server', 'node_modules', '.bin', 'tsx');
  const localRootTsx = path.join(root, 'node_modules', '.bin', 'tsx');
  if (fs.existsSync(localServerTsx)) return localServerTsx;
  if (fs.existsSync(localRootTsx)) return localRootTsx;
  return 'npx';
}

function tsxArgs(scriptPath) {
  if (tsxCommand() === 'npx') {
    return ['--yes', 'tsx', '--tsconfig', 'tsconfig.json', scriptPath];
  }
  return ['--tsconfig', 'tsconfig.json', scriptPath];
}
