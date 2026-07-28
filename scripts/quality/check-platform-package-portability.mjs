#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredArtifacts = [
  'tests/fixtures/app-packages/reference-app/compiled/reference-app-1.0.0.package.json',
  'tests/fixtures/app-packages/reference-app/compiled/reference-app-1.1.0.package.json',
];
const scanRoots = [
  'src/domain/catalog.ts',
  'src/presentation',
  'app',
];
const ignorePrefixes = [
  'docs/',
  'tests/',
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  '.expo/',
  'android/build/',
  'server/node_modules/',
];
const bannedTokens = [
  'reference-app',
  'tests/fixtures/app-packages/reference-app',
  'compiled/reference-app-1.0.0.package.json',
  'compiled/reference-app-1.1.0.package.json',
];

const problems = [];

for (const artifact of requiredArtifacts) {
  if (!fs.existsSync(path.join(root, artifact))) {
    problems.push(`missing required compiled package artifact: ${artifact}`);
  }
}

for (const scanRoot of scanRoots) {
  const full = path.join(root, scanRoot);
  if (!fs.existsSync(full)) {
    problems.push(`missing scan target: ${scanRoot}`);
    continue;
  }

  const stat = fs.statSync(full);
  if (stat.isFile()) {
    scanFile(full);
  } else {
    walk(full);
  }
}

if (problems.length) {
  console.error('Platform day1 portability check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('Platform day1 portability check passed');

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll(path.sep, '/');
    if (ignorePrefixes.some((prefix) => rel.startsWith(prefix))) continue;
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    scanFile(full);
  }
}

function scanFile(full) {
  const rel = path.relative(root, full).replaceAll(path.sep, '/');
  if (ignorePrefixes.some((prefix) => rel.startsWith(prefix))) return;
  if (!/\.[tj]sx?$/.test(rel)) return;
  const source = fs.readFileSync(full, 'utf8');
  for (const token of bannedTokens) {
    if (source.includes(token)) {
      problems.push(`${rel}: banned reference "${token}"`);
    }
  }
}
