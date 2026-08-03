#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const paths = [
  'package.json',
  'scripts/gates',
  'scripts/quality/run-golden-loop-proof.mjs',
  'scripts/quality/run-clean-checkout-proof.mjs',
  'scripts/quality/run-launch-proof.mjs',
  '.github/workflows',
];
const mutableNpx = /\bnpx\s+--yes\b/;
const documentedNonblocking = /mutable-npx-allowed:\s*nonblocking\b/;

function filesFor(path) {
  const absolute = join(root, path);
  try {
    const stat = readFileSync(absolute, 'utf8');
    return [[path, stat]];
  } catch {
    return [];
  }
}

async function collect(path) {
  const { readdir } = await import('node:fs/promises');
  const absolute = join(root, path);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await collect(child));
    else files.push(...filesFor(child));
  }
  return files;
}

const files = [];
for (const path of paths) {
  files.push(...(path.endsWith('.mjs') || path === 'package.json' ? filesFor(path) : await collect(path)));
}

const violations = [];
for (const [path, content] of files) {
  content.split('\n').forEach((line, index) => {
    if (mutableNpx.test(line) && !documentedNonblocking.test(line)) {
      violations.push(`${path}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length) {
  console.error('Mutable npx --yes is forbidden in blocking gates:');
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Mutable npx check: PASS (${files.length} blocking files scanned)`);
}
