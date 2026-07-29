import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourcePath = path.join(root, 'apps/food/food.v1.json');
const outDir = path.join(root, 'apps/food/source');
const chunksDir = path.join(outDir, 'chunks');

const manifest = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const keys = Object.keys(manifest);

await fs.mkdir(chunksDir, { recursive: true });

const index = {
  source: 'apps/food/food.v1.json',
  strategy: 'top-level-key split',
  chunks: [],
};

for (const [position, key] of keys.entries()) {
  const fileName = `${String(position).padStart(2, '0')}-${slugify(key)}.json`;
  const relativePath = `chunks/${fileName}`;
  const chunkPath = path.join(chunksDir, fileName);
  const value = manifest[key];
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  await fs.writeFile(chunkPath, serialized);

  index.chunks.push({
    key,
    file: relativePath,
    kind: describeKind(value),
    entries: countEntries(value),
  });
}

await fs.writeFile(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const reassembled = {};
for (const chunk of index.chunks) {
  reassembled[chunk.key] = JSON.parse(await fs.readFile(path.join(outDir, chunk.file), 'utf8'));
}

const original = JSON.stringify(manifest);
const roundTrip = JSON.stringify(reassembled);
if (original !== roundTrip) {
  throw new Error('food package source split did not round-trip cleanly');
}

console.log(`Wrote ${index.chunks.length} food source chunks to apps/food/source/chunks`);

function slugify(value) {
  return String(value)
    .replace(/^\$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'chunk';
}

function describeKind(value) {
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object') return 'object';
  return typeof value;
}

function countEntries(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}
