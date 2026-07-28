#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanRoots = [
  'server/src/kernel',
  'src/actions',
  'src/ai',
  'src/chat',
  'src/config',
  'src/data',
  'src/db',
  'src/domain',
  'src/health',
  'src/ops',
  'src/platform',
  'src/presentation',
  'src/settings',
  'src/workflows',
  'src/theme.ts',
  'app',
];
const ignorePrefixes = [
  '.git/',
  '.expo/',
  'dist/',
  'build/',
  'node_modules/',
  'server/node_modules/',
  'android/build/',
  'ios/build/',
];
const providerSdkPatterns = [
  /['"]@aws-sdk\//,
  /['"]aws-amplify['"]/,
  /['"]firebase(?:\/|['"])/,
  /['"]@google-cloud\//,
  /['"]googleapis['"]/,
  /['"]@azure\//,
  /['"]mongodb['"]/,
  /['"]@planetscale\//,
  /['"]@neondatabase\//,
];
const importPattern = /\b(?:import|export)\b[\s\S]*?\bfrom\s*['"][^'"]+['"]|(?:import|require)\s*\(\s*['"][^'"]+['"]\s*\)/g;
const problems = [];

for (const scanRoot of scanRoots) {
  const full = path.join(root, scanRoot);
  if (!fs.existsSync(full)) {
    problems.push(`missing scan target: ${scanRoot}`);
    continue;
  }
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    walk(full);
    continue;
  }
  scanFile(full);
}

if (problems.length) {
  console.error('Cloud portability check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('Cloud portability check passed');

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = relPath(full);
    if (ignorePrefixes.some((prefix) => rel.startsWith(prefix))) continue;
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.[cm]?[tj]sx?$/.test(rel)) continue;
    scanFile(full);
  }
}

function scanFile(full) {
  const rel = relPath(full);
  const source = fs.readFileSync(full, 'utf8');
  const matches = source.match(importPattern) ?? [];
  for (const statement of matches) {
    for (const pattern of providerSdkPatterns) {
      if (pattern.test(statement)) {
        problems.push(`${rel}: provider SDK import ${statement.trim()}`);
      }
    }
  }
}

function relPath(full) {
  return path.relative(root, full).replaceAll(path.sep, '/');
}
