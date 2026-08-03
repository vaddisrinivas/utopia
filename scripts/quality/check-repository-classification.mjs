import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const repositoryClassificationPath = path.join(root, 'docs/repository-classification.md');
const platformScorecardPath = path.join(root, 'docs/platform-scorecard.md');

const allowedCategories = new Set(['Core', 'shell', 'authoring', 'service', 'app', 'test', 'generated', 'tooling']);
const allowedScorecardStatuses = new Set(['PROVEN', 'PARTIAL', 'BLOCKED', 'PARKED', 'UNPROVEN']);
const ignoredRootDirectories = new Set(['.expo', 'node_modules']);
const optionalRootDirectories = new Set(['research']);

const classificationRows = parseClassificationMarkdown(readText(repositoryClassificationPath));
const scorecardRows = parseScorecardMarkdown(readText(platformScorecardPath));

const problems = [];
validateClassificationRows(classificationRows, problems);
validateScorecardRows(scorecardRows, problems);

if (problems.length > 0) {
  console.error('Repository classification check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('Repository classification check: PASS');
console.log(`- Classified root directories: ${countRootDirectoryEntries(classificationRows, root)}`);
console.log(`- Scorecard aspects checked: ${scorecardRows.length}`);

function validateClassificationRows(rows, problems) {
  const seen = new Map();
  let hasGenerated = false;
  let rootDirsSeen = new Set();

  for (const { directory, category, note } of rows) {
    if (!allowedCategories.has(category)) {
      problems.push(`invalid category for ${directory}: ${category}`);
    }
    if (!directory || !note) {
      problems.push(`missing directory or note fields: ${directory ?? '<missing>'}`);
      continue;
    }

    const exists = fs.existsSync(path.join(root, directory));
    const isDirectory = exists ? fs.statSync(path.join(root, directory)).isDirectory() : false;

    if (category === 'generated') {
      hasGenerated = true;
      if (!directory.includes('/')) rootDirsSeen.add(directory);
      continue;
    }
    if (!exists && !directory.includes('/') && optionalRootDirectories.has(directory)) {
      rootDirsSeen.add(directory);
      continue;
    }
    if (!exists) {
      problems.push(`classified path does not exist: ${directory}`);
      continue;
    }
    if (!isDirectory) {
      problems.push(`classified path is not a directory: ${directory}`);
      continue;
    }
    if (!directory.includes('/')) {
      rootDirsSeen.add(directory);
    }

    if (seen.has(directory)) {
      problems.push(`duplicate classification row for ${directory}`);
    }
    seen.set(directory, category);
  }

  if (!hasGenerated) {
    problems.push('at least one generated directory must be classified as "generated"');
  }
  validateRootCoverage(rootDirsSeen, problems);
}

function validateRootCoverage(classifiedRoots, problems) {
  const requiredRoots = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '.git' && !ignoredRootDirectories.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const dir of requiredRoots) {
    if (!classifiedRoots.has(dir)) {
      problems.push(`missing root directory classification: ${dir}`);
    }
  }
}

function parseClassificationMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().startsWith('| Directory | Category |'));
  if (headerIndex === -1) {
    throw new Error('repository_classification_table_missing');
  }

  const rows = [];
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || line.startsWith('|---')) {
      continue;
    }
    const cells = splitTableLine(line);
    if (cells.length < 3) continue;
    rows.push({
      directory: cells[0],
      category: cells[1],
      note: cells[2],
    });
  }
  return rows;
}

function validateScorecardRows(rows, problems) {
  if (rows.length === 0) {
    problems.push('platform scorecard table is empty');
    return;
  }
  const seenAspects = new Set();
  for (const row of rows) {
    if (!row.aspect) {
      problems.push('scorecard row has missing aspect');
      continue;
    }
    if (seenAspects.has(row.aspect)) {
      problems.push(`duplicate scorecard aspect: ${row.aspect}`);
      continue;
    }
    seenAspects.add(row.aspect);

    if (!allowedScorecardStatuses.has(row.status)) {
      problems.push(`invalid scorecard status for "${row.aspect}": ${row.status}`);
    }
    if (!row.evidence) {
      problems.push(`missing evidence text for scorecard aspect: ${row.aspect}`);
      continue;
    }
    if (
      row.status === 'BLOCKED'
      ? !row.evidence.includes('BLOCKED:')
      : !(row.evidence.includes('NEXT-GATE:') || row.evidence.includes('PASS:') || row.evidence.includes('PROVEN'))
    ) {
      problems.push(`scorecard aspect ${row.aspect} must include explicit gate status text: ${row.evidence}`);
    }
  }
}

function parseScorecardMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().startsWith('| Aspect | Status |'));
  if (headerIndex === -1) {
    throw new Error('platform_scorecard_table_missing');
  }
  const rows = [];
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || line.startsWith('|---')) {
      continue;
    }
    const cells = splitTableLine(line);
    if (cells.length < 3) continue;
    rows.push({
      aspect: cells[0],
      status: cells[1],
      evidence: cells[2],
    });
  }
  return rows;
}

function splitTableLine(line) {
  const raw = line
    .replace(/^\|\s*/, '')
    .replace(/\s*\|$/, '')
    .split('|')
    .map((part) => part.trim());
  return raw;
}

function countRootDirectoryEntries(rows) {
  return rows.filter((row) => !row.directory.includes('/')).length;
}

function readText(absolutePath) {
  return fs.readFileSync(absolutePath, 'utf8');
}
