#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const sourcePath = join(root, 'tests/fixtures/golden-loop/shared-household-board.source.json');
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));

const allowedGenericWidgets = new Set([
  'kanbanBoard',
  'formCard',
  'dataTable',
  'chartBlock',
  'checklistCard',
]);

const violations = [];
for (const screen of source.screens ?? []) {
  for (const component of screen.components ?? []) {
    if (component?.kind !== 'widget') continue;
    const widget = component.widget;
    if (typeof widget !== 'string' || !allowedGenericWidgets.has(widget)) {
      violations.push(`screen ${screen.id}: unsupported widget '${String(widget)}'`);
    }
  }
}

const appSpecificPatterns = [
  /shared[-_ ]household/i,
  /household[-_ ]board/i,
  /sharedHousehold/,
  /householdBoard/,
];
for (const directory of ['src', 'packages', 'server/src']) {
  for (const filePath of sourceFiles(join(root, directory))) {
    const sourceText = readFileSync(filePath, 'utf8');
    if (appSpecificPatterns.some((pattern) => pattern.test(sourceText))) {
      violations.push(`app-specific runtime reference: ${filePath.slice(root.length + 1)}`);
    }
  }
}

if (violations.length) {
  console.error('Golden runtime includes app-specific widget/runtime code:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Golden runtime widget set is generic (${allowedGenericWidgets.size} allowed widgets).`);

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'build' || entry.name === 'dist') continue;
      files.push(...sourceFiles(path));
      continue;
    }
    if (/\.(?:c|m)?(?:j|t)sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}
