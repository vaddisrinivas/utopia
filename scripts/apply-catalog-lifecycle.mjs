import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const appsRepo = path.resolve(process.env.UTOPIA_APPS_REPO ?? path.join(root, '../utopia-apps'));
const reportPath = path.join(appsRepo, 'metadata/catalog-capability-similarity.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const scores = new Map();
for (const pair of report.pairs) {
  scores.set(`${pair.left}|${pair.right}`, pair.score);
  scores.set(`${pair.right}|${pair.left}`, pair.score);
}

const active = [];
for (const candidate of report.edgeLeaders) {
  if (active.every((id) => (scores.get(`${candidate.id}|${id}`) ?? 0) < report.threshold)) {
    active.push(candidate.id);
  }
}
const activeSet = new Set(active);
const lifecycle = {};

for (const candidate of report.edgeLeaders) {
  if (activeSet.has(candidate.id)) {
    lifecycle[candidate.id] = { status: 'active' };
    continue;
  }
  const duplicate = active
    .map((id) => ({ id, score: scores.get(`${candidate.id}|${id}`) ?? 0 }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))[0];
  if (!duplicate || duplicate.score < report.threshold) {
    throw new Error(`${candidate.id}: no active duplicate at threshold`);
  }
  lifecycle[candidate.id] = {
    status: 'inactive',
    duplicateOf: duplicate.id,
    similarity: duplicate.score,
    reason: 'capability-overlap',
  };
}

for (const entry of report.packages) {
  const file = path.join(appsRepo, entry.file);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.catalog = lifecycle[pkg.id];
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

fs.writeFileSync(
  path.join(appsRepo, 'metadata/catalog-lifecycle.json'),
  `${JSON.stringify({
    schemaVersion: 'utopia.catalog-lifecycle.v1',
    generatedAt: new Date().toISOString(),
    threshold: report.threshold,
    active: active.length,
    inactive: report.packageCount - active.length,
    packages: lifecycle,
  }, null, 2)}\n`,
);
console.log(JSON.stringify({ active: active.length, inactive: report.packageCount - active.length }));
