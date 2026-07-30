import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const CORE_SCAN_ROOTS = [
  'packages/app-compiler',
  'packages/runtime-kernel',
  'packages/schemas',
  'packages/shared/contracts',
  'packages/domain-config',
  'src/domain',
  'src/ops',
  'src/actions',
  'src/chat',
  'src/ai',
  'src/workflows',
  'src/config',
  'src/health',
];

const BOUNDARY_FILE_EXTENSIONS = ['.ts', '.tsx'];
const SCAN_IGNORE_SEGMENTS = ['node_modules', '.expo', '.git', 'dist', 'coverage'];

const CORE_IMPORT_RULES = [
  {
    rule: 'forbid-react-native-or-ui-frontend',
    check: (specifier) =>
      specifier === 'react' ||
      specifier === 'react-native' ||
      specifier.startsWith('react-native-') ||
      specifier === '@react-native/webview' ||
      specifier.startsWith('@react-native/') ||
      specifier.startsWith('@json-render/react-native'),
  },
  {
    rule: 'forbid-expo-ui-bridges',
    check: (specifier) =>
      specifier === 'expo' ||
      specifier === 'expo-router' ||
      specifier === 'expo-status-bar' ||
      specifier === 'expo-splash-screen' ||
      specifier === 'expo-symbols' ||
      specifier === 'expo-sharing' ||
      specifier === 'expo-secure-store' ||
      specifier === 'expo-linking' ||
      (specifier.startsWith('expo-') && specifier !== 'expo-sqlite') ||
      specifier.startsWith('@expo/'),
  },
  {
    rule: 'forbid-core-import-of-server',
    check: (specifier, fullPath) => isPathImportToLayer(specifier, fullPath, ['server/src']),
  },
  {
    rule: 'forbid-core-import-of-app',
    check: (specifier, fullPath) => isPathImportToLayer(specifier, fullPath, ['app']),
  },
  {
    rule: 'forbid-core-import-of-providers',
    check: (specifier, fullPath) =>
      isPathImportToLayer(specifier, fullPath, ['src/providers', 'server/src/providers']),
  },
  {
    rule: 'forbid-core-import-of-cloudflare',
    check: (specifier, fullPath) =>
      specifier === 'wrangler' ||
      specifier.startsWith('cloudflare') ||
      specifier.startsWith('@cloudflare/'),
  },
];

function isPathImportToLayer(specifier, fullPath, layers) {
  if (specifier.startsWith('.')) {
    const resolved = resolve(dirname(fullPath), specifier);
    return layers.some((layer) => resolved.includes(`/${layer}/`) || resolved.endsWith(`/${layer}`));
  }

  const allowedAliases = layers.map((layer) => [
    `@/${layer}/`,
    `@/app/${layer}/`,
  ]);
  return allowedAliases.flat().some((alias) => specifier.startsWith(alias)) || layers.some((layer) => specifier.startsWith(`${layer}/`));
}

function isBoundaryTarget(filePath) {
  return CORE_SCAN_ROOTS.some((root) => filePath.startsWith(`${root}/`));
}

function listFiles(root, accumulator = []) {
  const items = readdirSync(root);
  for (const item of items) {
    const entry = join(root, item);
    if (SCAN_IGNORE_SEGMENTS.some((segment) => entry.includes(`/${segment}/`))) {
      continue;
    }

    const stat = statSync(entry);
    if (stat.isDirectory()) {
      listFiles(entry, accumulator);
      continue;
    }

    if (
      stat.isFile() &&
      BOUNDARY_FILE_EXTENSIONS.some((ext) => entry.endsWith(ext)) &&
      !SCAN_IGNORE_SEGMENTS.some((segment) => entry.includes(`/${segment}/`))
    ) {
      accumulator.push(entry);
    }
  }
  return accumulator;
}

function parseImports(source) {
  const importRegex = /^\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm;
  const seen = [];
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    seen.push(match[1]);
  }
  return seen;
}

export function collectCoreBoundaryViolationsFromSourceFiles(files, rootDir = process.cwd()) {
  const violations = [];
  for (const { filePath, content } of files) {
    const normalizedFilePath = relative(rootDir, resolve(filePath)).replaceAll('\\', '/');
    if (normalizedFilePath.startsWith('..')) {
      continue;
    }

    if (!isBoundaryTarget(normalizedFilePath)) {
      continue;
    }

    const imports = parseImports(content);
    for (const specifier of imports) {
      const relativePath = relative(rootDir, resolve(filePath));
      for (const rule of CORE_IMPORT_RULES) {
        if (rule.check(specifier, resolve(filePath))) {
          violations.push({
            file: normalizedFilePath,
            import: specifier,
            rule: rule.rule,
          });
          break;
        }
      }
    }
  }
  return violations;
}

export function collectCoreBoundaryViolations(rootDir = process.cwd()) {
  const files = [];
  for (const root of CORE_SCAN_ROOTS) {
    const absoluteRoot = resolve(rootDir, root);
    try {
      files.push(...listFiles(absoluteRoot));
    } catch {
      continue;
    }
  }

  const fileContents = files.map((filePath) => ({
    filePath,
    content: readFileSync(filePath, 'utf8'),
  }));
  return collectCoreBoundaryViolationsFromSourceFiles(fileContents, rootDir);
}

export function formatCoreBoundaryViolations(violations) {
  return violations.map((item) => `${item.file} -> ${item.import} (${item.rule})`);
}

function main() {
  const violations = collectCoreBoundaryViolations();
  if (violations.length === 0) {
    console.log('PASS core boundary source scan');
    return;
  }

  const printable = formatCoreBoundaryViolations(violations);
  console.error(`FAIL core boundary scan found ${violations.length} violations`);
  for (const entry of printable) {
    console.error(`- ${entry}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
