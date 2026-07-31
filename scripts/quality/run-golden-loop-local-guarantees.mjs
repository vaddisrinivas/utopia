#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const result = spawnSync('./node_modules/.bin/vitest', ['run', 'tests/quality/golden-loop-local-guarantees.test.ts'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: 'inherit',
  env: {
    ...process.env,
    NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || '/tmp/utopia-npm-cache',
  },
});

process.exitCode = result.status ?? 1;
