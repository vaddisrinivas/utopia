import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const generatedCatalogPath = resolve(root, 'src/generated/catalog.ts');
mkdirSync(resolve(root, 'src/generated'), { recursive: true });
const configuredAppsDir = process.env.UTOPIA_APPS_DIR?.trim();
const defaultAppsDir = resolve(root, '../utopia-apps/packages');
const appsDir = configuredAppsDir ? resolve(process.cwd(), configuredAppsDir) : defaultAppsDir;

function isDirectory(path) {
  return existsSync(path) && lstatSync(path).isDirectory();
}

function collectPackageFiles(dir, files = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      collectPackageFiles(full, files);
    }
    if (entry.isFile() && entry.name.endsWith('.v1.json')) {
      files.push(full);
    }
  }
  return files;
}

const packageFiles = isDirectory(appsDir)
  ? collectPackageFiles(appsDir).sort()
  : [];

const ids = new Set();
const entries = [];
for (const file of packageFiles) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.schemaVersion !== 'wonder.app-package.v3') {
    throw new Error(`${file}: V3 required`);
  }
  if (ids.has(pkg.id)) {
    throw new Error(`${file}: duplicate id ${pkg.id}`);
  }
  ids.add(pkg.id);
  const visual = pkg.presentation?.visualIdentity ?? {};
  entries.push({
    id: pkg.id,
    version: pkg.version,
    catalog: pkg.catalog,
    presentation: {
      label: pkg.presentation.label,
      visualIdentity: {
        icon: visual.icon ?? null,
        accent: visual.accent ?? null,
        canvas: visual.canvas ?? null,
        tone: visual.tone ?? null,
        secondary: visual.secondary ?? null,
        highlight: visual.highlight ?? null,
        emoji: visual.emoji ?? null,
      },
    },
  });
}

const entryType =
  'export type BundledCatalogEntry = { id: string; version: string; catalog: { status: "active" } | { status: "inactive"; duplicateOf: string; similarity: number; reason: "capability-overlap" }; presentation: { label: string; visualIdentity: { icon: string | null; accent: string | null; canvas: string | null; tone: string | null; secondary: string | null; highlight: string | null; emoji: string | null; }; }; };';

if (entries.length === 0) {
  writeFileSync(
    generatedCatalogPath,
    `${entryType}\n\nexport const bundledEntries: BundledCatalogEntry[] = [] as BundledCatalogEntry[];\n\nexport const bundledLoaders: Record<string, () => unknown> = {};\n`
  );
  console.log(JSON.stringify({ packages: 0, appsDir, present: isDirectory(appsDir), failClosed: true }));
  process.exit(0);
}

const loaders = packageFiles
  .map((file, index) => {
    const target = relative(resolve(root, 'src/generated'), file).replaceAll('\\', '/');
    return `${JSON.stringify(entries[index].id)}: () => require(${JSON.stringify(target)})`;
  })
  .join(',\n  ');

writeFileSync(
  generatedCatalogPath,
  `${entryType}\n\nexport const bundledEntries: BundledCatalogEntry[] = ${JSON.stringify(entries)};\n\nexport const bundledLoaders: Record<string, () => unknown> = {\n  ${loaders}\n};\n`
);

console.log(JSON.stringify({ packages: packageFiles.length, appsDir, present: isDirectory(appsDir), failClosed: false }));
