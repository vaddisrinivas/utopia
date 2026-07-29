#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  [
    '--yes',
    'tsx',
    '--tsconfig',
    'tsconfig.json',
    'scripts/factory/generate-app-from-prompt.ts',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
