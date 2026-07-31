#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const artifactRoots = ['dist/web', 'dist/android'];
const forbiddenMarkers = [
  'GoldenLoopDebugBridge',
  'golden-loop-debug',
  'goldenLoopDebug',
  '__UTOPIA_GOLDEN_LOOP_DEBUG__',
  'UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN',
];
const violations = [];
const missing = [];

for (const relativeRoot of artifactRoots) {
  const artifactRoot = join(root, relativeRoot);
  if (!existsSync(artifactRoot)) {
    missing.push(relativeRoot);
    continue;
  }
  for (const filePath of walk(artifactRoot)) {
    const contents = readFileSync(filePath);
    for (const marker of forbiddenMarkers) {
      if (contents.includes(marker)) {
        violations.push(`${relative(root, filePath)}:${marker}`);
      }
    }
  }
}

if (missing.length || violations.length) {
  console.error('Release debug bridge exclusion: BLOCKED');
  for (const path of missing) console.error(`- missing release artifact root: ${path}`);
  for (const violation of violations) console.error(`- forbidden debug marker: ${violation}`);
  process.exit(1);
}

console.log(`Release debug bridge exclusion: PASS (${artifactRoots.join(', ')})`);

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(filePath);
    else if (statSync(filePath).isFile()) yield filePath;
  }
}
