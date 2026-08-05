import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PackageSchema } from '../src/kernel/schema';

const root = resolve(import.meta.dirname, '..');
const configured = process.env.UTOPIA_APPS_DIR?.trim();
const appsDir = configured ? resolve(process.cwd(), configured) : resolve(root, '../utopia-apps/packages');

async function files(dir: string, output: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await files(path, output);
    else if (entry.isFile() && entry.name.endsWith('.v1.json')) output.push(path);
  }
  return output;
}

async function main() {
  try {
    if (!(await lstat(appsDir)).isDirectory()) throw new Error('not a directory');
  } catch {
    console.log(JSON.stringify({ packages: 0, appsDir, present: false, failClosed: true }));
    return;
  }

  const ids = new Set<string>();
  const paths = await files(appsDir);
  for (const path of paths.sort()) {
    const pkg = PackageSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    if (ids.has(pkg.id)) throw new Error(`${path}: duplicate id ${pkg.id}`);
    ids.add(pkg.id);
  }

  console.log(JSON.stringify({ packages: paths.length, appsDir, present: true, valid: true }));
}

void main();
