import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const skippedPrefixes = ['http://', 'https://', 'mailto:', 'tel:', '#', 'javascript:'];
const skippedDirs = new Set(['.git', 'node_modules', '.expo', 'dist', 'Pods', 'pod', 'build', 'ios', 'macos', 'android']);

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirs.has(entry.name)) continue;
      files.push(...walk(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

const linkRegex = /\[[^\]]*\]\(([^)\s]+)\)/g;
const docs = walk(root);
const broken = [];

for (const file of docs) {
  const text = readFileSync(file, 'utf8');
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    const target = match[1] ?? '';
    if (!target || skippedPrefixes.some((prefix) => target.startsWith(prefix))) continue;

    const decoded = target.replace(/[?#].*$/, '');
    if (!decoded) continue;

    const resolved = isAbsolute(decoded)
      ? resolve(root, decoded.replace(/^\//, ''))
      : resolve(dirname(file), decoded);

    if (!existsSync(resolved)) {
      broken.push({ file: file.replace(root + '/', ''), link: target });
    }
  }
}

if (broken.length > 0) {
  console.log('Broken local markdown links:');
  for (const item of broken) {
    console.log(`- ${item.file}: ${item.link}`);
  }
  process.exitCode = 1;
} else {
  console.log(`checked ${docs.length} markdown files, all local links resolve`);
}
