import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const root = resolve(process.cwd());
const baselinePath = resolve(root, 'scripts/quality/dependency-dead-code-ownership-baseline.json');
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx']);

function blocked(message) {
  console.error(`BLOCKED dependency/dead-code ownership: ${message}`);
  return 2;
}

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function relativeImportTargets(filePath, source) {
  const targets = [];
  const pattern = /(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const candidate = resolve(dirname(filePath), match[1]);
    targets.push(candidate);
  }
  return targets;
}

function resolveSourceImport(candidate) {
  const suffixes = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];
  return suffixes.map((suffix) => `${candidate}${suffix}`).find((path) => existsSync(path));
}

export function inspectDependencyDeadCodeOwnership(rootDir = root) {
  const errors = [];
  const baselineFile = resolve(rootDir, 'scripts/quality/dependency-dead-code-ownership-baseline.json');
  const packageFile = resolve(rootDir, 'package.json');
  const lockFile = resolve(rootDir, 'package-lock.json');
  if (!existsSync(baselineFile)) return { status: 'BLOCKED', errors: ['ownership baseline is missing'] };
  if (!existsSync(packageFile)) return { status: 'BLOCKED', errors: ['package.json is missing'] };

  let baseline;
  let packageJson;
  try {
    baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
    packageJson = JSON.parse(readFileSync(packageFile, 'utf8'));
  } catch (error) {
    return { status: 'BLOCKED', errors: [`invalid policy JSON: ${error.message}`] };
  }
  if (baseline.tool !== 'utopia-local-ownership-v1' || !Array.isArray(baseline.sourceRoots)) {
    return { status: 'BLOCKED', errors: ['baseline tool/version or sourceRoots is invalid'] };
  }
  if (baseline.requireLockfile && !existsSync(lockFile)) {
    return { status: 'BLOCKED', errors: ['package-lock.json is required by the baseline'] };
  }

  const roots = baseline.sourceRoots;
  const owners = new Set();
  for (const rule of roots) {
    if (!rule || typeof rule.owner !== 'string' || typeof rule.prefix !== 'string' || owners.has(rule.owner)) {
      errors.push('baseline has duplicate or malformed ownership rules');
    }
    owners.add(rule.owner);
    if (!existsSync(resolve(rootDir, rule.prefix))) errors.push(`owned source root is missing: ${rule.prefix}`);
  }
  const files = roots.flatMap((rule) => sourceFiles(resolve(rootDir, rule.prefix)));
  const relativeFiles = files.map((file) => file.slice(rootDir.length + 1));
  for (const relative of relativeFiles) {
    const matches = roots.filter((rule) => relative.startsWith(rule.prefix));
    if (matches.length !== 1) errors.push(`${relative}: expected exactly one owner, found ${matches.length}`);
  }

  const allowMissing = new Set(Array.isArray(baseline.allowMissingRelativeImports) ? baseline.allowMissingRelativeImports : []);
  for (const file of files) {
    const relative = file.slice(rootDir.length + 1);
    const source = readFileSync(file, 'utf8');
    for (const target of relativeImportTargets(file, source)) {
      if (!resolveSourceImport(target) && !allowMissing.has(`${relative}:${target}`)) {
        errors.push(`${relative}: unresolved relative import ${target}`);
      }
    }
  }

  if (baseline.requireLockfile) {
    let lock;
    try { lock = JSON.parse(readFileSync(lockFile, 'utf8')); }
    catch (error) { return { status: 'BLOCKED', errors: [`invalid package-lock.json: ${error.message}`] }; }
    const directDependencies = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
    for (const name of Object.keys(directDependencies)) {
      if (!lock.packages?.[`node_modules/${name}`] && !lock.packages?.['']?.dependencies?.[name]) {
        errors.push(`direct dependency is missing from package-lock.json: ${name}`);
      }
    }
  }
  return { status: errors.length ? 'FAIL' : 'PASS', errors, fileCount: relativeFiles.length };
}

const result = inspectDependencyDeadCodeOwnership();
if (result.status === 'BLOCKED') process.exitCode = blocked(result.errors.join('; '));
else if (result.status === 'FAIL') {
  console.error(`FAIL dependency/dead-code ownership (${result.errors.length})`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS dependency/dead-code ownership (${result.fileCount} owned source files; lockfile complete)`);
}
