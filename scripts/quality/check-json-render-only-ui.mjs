import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routeDir = path.join(root, 'app');
const allowedReactNativeImportFiles = new Set([
  path.join(routeDir, '_layout.tsx'),
  path.join(routeDir, '+html.tsx'),
]);
const violations = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.[tj]sx?$/.test(entry.name)) continue;
    const source = fs.readFileSync(full, 'utf8');
    const rel = path.relative(root, full);
    if (source.includes('@/src/components/ui') || source.includes('src/components/ui')) {
      violations.push(`${rel}: imports deleted custom UI kit`);
    }
    if (!allowedReactNativeImportFiles.has(full) && /from ['"]react-native['"]/.test(source)) {
      violations.push(`${rel}: imports react-native directly instead of JSON Render host`);
    }
    if (!allowedReactNativeImportFiles.has(full) && /StyleSheet\.create|<View|<Text|<Pressable|<ScrollView|<TextInput|<Image|<KeyboardAvoidingView/.test(source)) {
      violations.push(`${rel}: contains handwritten React Native UI`);
    }
  }
}

walk(routeDir);

if (violations.length) {
  console.error('JSON Render only UI guard failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('JSON Render only UI guard passed');
