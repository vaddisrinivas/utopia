import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const roots = ['app', 'src', 'packages', 'server', 'scripts', 'adapters', 'cloudflare', 'macos', 'android', 'ios'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.swift', '.kt', '.java', '.m', '.mm']);
const ignored = new Set(['node_modules', 'Pods', 'build', 'dist', '.expo', '.gradle', 'generated']);
const files = [];

function walk(path) {
  let stat;
  try { stat = statSync(path); } catch { return; }
  if (stat.isFile()) {
    if (extensions.has(extname(path))) files.push(path);
    return;
  }
  for (const name of readdirSync(path)) if (!ignored.has(name)) walk(join(path, name));
}

roots.forEach((path) => walk(join(root, path)));
['tamagui.config.ts', 'metro.config.js', 'vitest.config.ts', '.dependency-cruiser.cjs', 'expo-env.d.ts'].forEach((path) => walk(join(root, path)));
const lines = files.reduce((sum, file) => sum + readFileSync(file, 'utf8').split(/\r?\n/).length, 0);
const budget = 12_000;
console.log(JSON.stringify({ files: files.length, lines, budget }));
if (lines > budget) process.exitCode = 1;
