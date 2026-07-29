import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const widgetFiles = [
  path.join(root, 'src/presentation/json-render-widgets.tsx'),
  path.join(root, 'src/presentation/json-render-domain-widgets.tsx'),
  ...walk(path.join(root, 'src/presentation/widgets')),
].filter((file) => /\.(ts|tsx)$/.test(file));

const forbiddenPackages = [
  'expo-audio',
  'expo-calendar',
  'expo-camera',
  'expo-contacts',
  'expo-document-picker',
  'expo-file-system',
  'expo-image-picker',
  'expo-local-authentication',
  'expo-location',
  'expo-notifications',
  'expo-sensors',
  'expo-sharing',
  'expo-speech',
  'expo-video',
];

const violations = [];

for (const file of widgetFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  for (const pkg of forbiddenPackages) {
    if (containsStaticExpoImport(source, pkg)) {
      violations.push(`${rel}: imports ${pkg} directly`);
    }
  }
}

if (violations.length) {
  console.error('Widget capability broker gate failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Widget capability broker gate passed (${widgetFiles.length} files)`);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walk(full));
      continue;
    }
    entries.push(full);
  }
  return entries;
}

function containsStaticExpoImport(source, packageName) {
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      !trimmed.startsWith('import ')
      && !trimmed.includes('import(')
      && !trimmed.includes('require(')
    ) continue;
    if (trimmed.includes(`'${packageName}'`) || trimmed.includes(`"${packageName}"`)) {
      return true;
    }
  }
  return false;
}
