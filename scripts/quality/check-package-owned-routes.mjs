import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const appDir = path.join(root, 'app');
const food = JSON.parse(fs.readFileSync(path.join(root, 'packages/domain-config/domains/food.v1.json'), 'utf8'));
const evidencePath = path.join(root, 'app/build/evidence/package-owned-routes.json');

const packageScreens = new Set(Object.keys(food.ui?.screens ?? {}));
const routeScreens = [];
const problems = [];

for (const file of walk(appDir).filter((item) => /\.[jt]sx$/.test(item))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<JsonRenderRoute\b[^>]*\bscreen="([^"]+)"/g)) {
    const screen = match[1];
    routeScreens.push({ file: path.relative(root, file), screen });
    if (!packageScreens.has(screen)) problems.push(`${path.relative(root, file)}: screen "${screen}" missing from active package ui.screens`);
  }
}

for (const required of ['home', 'overview', 'chat', 'settings', 'sources', 'capture', 'search', 'config', 'health', 'record', 'collection', 'system', 'notFound']) {
  if (!packageScreens.has(required)) problems.push(`food.v1.json: required app shell screen "${required}" missing`);
}

const routeSource = fs.readFileSync(path.join(root, 'src/presentation/json-render-route.tsx'), 'utf8');
if (/ROUTE_SHELL_UI|a2ui-route-surfaces/.test(routeSource)) {
  problems.push('json-render-route.tsx still imports or references TS route shell fallback');
}
if (fs.existsSync(path.join(root, 'src/presentation/a2ui-route-surfaces.ts'))) {
  problems.push('src/presentation/a2ui-route-surfaces.ts still exists');
}

if (problems.length) {
  console.error('Package-owned route check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify({
  status: 'PASS',
  commit: currentCommit(),
  checkedAt: new Date().toISOString(),
  routeScreens: routeScreens.sort((left, right) => `${left.file}:${left.screen}`.localeCompare(`${right.file}:${right.screen}`)),
}, null, 2)}\n`);

console.log(`Package-owned route check: PASS (${routeScreens.length} routes, evidence: ${path.relative(root, evidencePath)})`);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
