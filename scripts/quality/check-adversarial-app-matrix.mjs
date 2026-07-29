import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const matrixPath = path.join(root, 'docs/adversarial-app-matrix.json');
const fixturesRoot = path.join(root, 'tests/fixtures/adversarial-apps');
const evidencePath = path.join(root, 'app/build/evidence/adversarial-app-matrix.json');
const expectedAxes = new Set([
  'real_time_loop',
  'aggregate_expression',
  'temporal_rules',
  'native_stream',
  'multi_writer',
  'weird_shape',
  'self_hosting',
]);
const expectedTopFive = [5, 9, 22, 36, 49];
const allowedStatuses = new Set(['not_started', 'partial', 'boundary_expected', 'proven']);

const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const problems = [];

if (matrix.schemaVersion !== 'utopia.adversarial-app-matrix.v1') {
  problems.push('schemaVersion must be utopia.adversarial-app-matrix.v1');
}
if (!Array.isArray(matrix.entries) || matrix.entries.length !== 50) {
  problems.push(`expected exactly 50 adversarial entries, found ${Array.isArray(matrix.entries) ? matrix.entries.length : 'non-array'}`);
}

const entries = Array.isArray(matrix.entries) ? matrix.entries : [];
const numbers = new Set();
const ids = new Set();
const axes = new Set();
const topFive = [];
const statusCounts = {};
const axisCounts = {};
const fixturePackages = [];

for (const entry of entries) {
  if (!Number.isInteger(entry.number) || entry.number < 1 || entry.number > 50) problems.push(`${entry.id ?? '<unknown>'}: number must be 1..50`);
  if (numbers.has(entry.number)) problems.push(`${entry.id ?? '<unknown>'}: duplicate number ${entry.number}`);
  numbers.add(entry.number);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id ?? '')) problems.push(`${entry.number}: id must be kebab-case`);
  if (ids.has(entry.id)) problems.push(`${entry.number}: duplicate id ${entry.id}`);
  ids.add(entry.id);
  if (!entry.title || typeof entry.title !== 'string') problems.push(`${entry.id}: title required`);
  if (!expectedAxes.has(entry.axis)) problems.push(`${entry.id}: unsupported axis ${entry.axis}`);
  axes.add(entry.axis);
  if (!entry.attacks || typeof entry.attacks !== 'string') problems.push(`${entry.id}: attacks required`);
  if (!entry.expectedFailSignal || typeof entry.expectedFailSignal !== 'string') problems.push(`${entry.id}: expectedFailSignal required`);
  if (!allowedStatuses.has(entry.currentStatus)) problems.push(`${entry.id}: unsupported currentStatus ${entry.currentStatus}`);
  if (!entry.missingPrimitive || typeof entry.missingPrimitive !== 'string') problems.push(`${entry.id}: missingPrimitive required`);
  if (!entry.fixturePackage || typeof entry.fixturePackage !== 'string') problems.push(`${entry.id}: fixturePackage required`);
  if (entry.topFive === true) topFive.push(entry.number);
  statusCounts[entry.currentStatus] = (statusCounts[entry.currentStatus] ?? 0) + 1;
  axisCounts[entry.axis] = (axisCounts[entry.axis] ?? 0) + 1;
  if (entry.fixturePackage) {
    const packagePath = path.join(fixturesRoot, entry.fixturePackage, `${entry.fixturePackage}.v1.json`);
    if (!fs.existsSync(packagePath)) problems.push(`${entry.id}: fixturePackage missing ${path.relative(root, packagePath)}`);
    if (fs.existsSync(packagePath)) {
      const appPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      if (appPackage.id !== entry.fixturePackage) problems.push(`${entry.id}: app package id must be ${entry.fixturePackage}`);
      if (!['wonder.app-package.v2', 'wonder.app-package.v3'].includes(appPackage.schemaVersion)) problems.push(`${entry.id}: app package schemaVersion must be v2 or v3`);
      if (!appPackage.collections || typeof appPackage.collections !== 'object') problems.push(`${entry.id}: app package collections required`);
      if (!appPackage.presentation?.ui?.screens || typeof appPackage.presentation.ui.screens !== 'object') problems.push(`${entry.id}: app package UI screens required`);
    }
    if (entry.currentStatus === 'not_started') problems.push(`${entry.id}: fixturePackage cannot be not_started`);
    fixturePackages.push(entry.fixturePackage);
  }
}

for (let number = 1; number <= 50; number += 1) {
  if (!numbers.has(number)) problems.push(`missing entry number ${number}`);
}
for (const axis of expectedAxes) {
  if (!axes.has(axis)) problems.push(`missing axis ${axis}`);
}
if (JSON.stringify([...topFive].sort((a, b) => a - b)) !== JSON.stringify(expectedTopFive)) {
  problems.push(`top five mismatch: expected ${expectedTopFive.join(',')}, found ${topFive.sort((a, b) => a - b).join(',')}`);
}
if (JSON.stringify(matrix.topFive) !== JSON.stringify(expectedTopFive)) {
  problems.push('matrix.topFive must match 5,9,22,36,49');
}
if (new Set(fixturePackages).size !== 50) {
  problems.push(`expected 50 unique materialized fixtures, found ${new Set(fixturePackages).size}`);
}

const evidence = {
  status: problems.length ? 'FAIL' : 'PASS',
  commit: currentCommit(),
  checkedAt: new Date().toISOString(),
  matrix: path.relative(root, matrixPath),
  totals: {
    entries: entries.length,
    axes: Object.fromEntries(Object.entries(axisCounts).sort(([left], [right]) => left.localeCompare(right))),
    statuses: Object.fromEntries(Object.entries(statusCounts).sort(([left], [right]) => left.localeCompare(right))),
    fixturePackages: fixturePackages.sort(),
    topFive: expectedTopFive,
  },
  problems,
};

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (problems.length) {
  console.error('Adversarial app matrix check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Adversarial app matrix check: PASS (${entries.length} entries, ${fixturePackages.length} materialized fixtures; evidence: ${path.relative(root, evidencePath)})`);

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
