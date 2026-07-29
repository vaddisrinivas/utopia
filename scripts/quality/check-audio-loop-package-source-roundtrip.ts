import { readFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '@/packages/shared/contracts/canonical-json';
import { compileAppPackageSource, readAppPackageSourceFolder } from '@/packages/app-compiler';

const root = process.cwd();
const sourceDir = path.join(root, 'apps/audio-loop-108/source');
const packagePath = path.join(root, 'apps/audio-loop-108/audio-loop-108.v1.json');
const previewPath = path.join(root, 'apps/audio-loop-108/preview.json');

const source = readAppPackageSourceFolder(sourceDir);
const compilation = compileAppPackageSource({
  ...source,
  capabilities: {
    ...source.capabilities,
    pinnedAt: '2026-07-29T00:00:00.000Z',
  },
});
if (!compilation.valid) {
  throw new Error(compilation.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
}

const compiledPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
const compiledPreview = JSON.parse(readFileSync(previewPath, 'utf8'));

if (canonicalJson(compilation.package) !== canonicalJson(compiledPackage)) {
  throw new Error(`audio loop package source drift: ${packagePath}`);
}

if (canonicalJson(compilation.preview) !== canonicalJson(compiledPreview)) {
  throw new Error(`audio loop package preview drift: ${previewPath}`);
}

const packageChecksum = compilation.checksum ?? 'unknown';
const previewChecksum = typeof compiledPreview.checksum === 'string' ? compiledPreview.checksum : 'unknown';

console.log(`PASS audio-loop-108 source round-trip (${packageChecksum})`);
console.log(`package checksum: ${packageChecksum}`);
console.log(`preview checksum: ${previewChecksum}`);
