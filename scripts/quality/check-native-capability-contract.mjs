import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const packageJson = readJson('package.json');
const appJson = readJson('app.json');
const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const nativeKindContract = fs.readFileSync(path.join(root, 'packages/shared/contracts/native-capability-kinds.ts'), 'utf8');
const food = readJson('packages/domain-config/domains/food.v1.json');
const domainSchema = readJson('packages/domain-config/schemas/domain.v1.schema.json');
const packageSchemaSource = fs.readFileSync(path.join(root, 'server/src/kernel/package-schema.ts'), 'utf8');
const evidencePath = path.join(root, 'app/build/evidence/native-capability-contract.json');

const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
const plugins = new Set((appJson.expo?.plugins ?? []).map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin));
const native = food.native_capabilities;
const pins = food.dependency_pins ?? [];
const problems = [];
const contractIntentKinds = extractNativeIntentKinds(nativeKindContract);
const domainSchemaIntentKinds = new Set(domainSchema.$defs.native_intent.properties.kind.enum);
const serverSchemaIntentKinds = extractServerPackageSchemaIntentKinds(packageSchemaSource);

for (const kind of new Set([...contractIntentKinds, ...domainSchemaIntentKinds, ...serverSchemaIntentKinds])) {
  if (!contractIntentKinds.has(kind)) problems.push(`${kind}: missing from shared native intent contract`);
  if (!domainSchemaIntentKinds.has(kind)) problems.push(`${kind}: missing from domain native intent schema`);
  if (!serverSchemaIntentKinds.has(kind)) problems.push(`${kind}: missing from server package native intent schema`);
}

if (!native) problems.push('food.native_capabilities missing');
if (!Array.isArray(pins) || pins.length === 0) problems.push('food.dependency_pins missing');

const pinnedPackages = new Set(pins.map((pin) => pin.package));
const nativePackages = new Set(native?.packages ?? []);

for (const pin of pins) {
  if (!deps[pin.package]) problems.push(`${pin.package}: dependency pin has no package.json dependency`);
  if (deps[pin.package] && deps[pin.package] !== pin.version) problems.push(`${pin.package}: pin ${pin.version} does not match package.json ${deps[pin.package]}`);
  if (!nativePackages.has(pin.package)) problems.push(`${pin.package}: pinned but missing from native_capabilities.packages`);
}

for (const pkg of nativePackages) {
  if (!deps[pkg]) problems.push(`${pkg}: native package missing from package.json`);
  if (!pinnedPackages.has(pkg)) problems.push(`${pkg}: native package missing dependency_pins entry`);
}

for (const plugin of ['expo-image-picker', 'expo-sharing', 'react-native-health-connect']) {
  if (nativePackages.has(plugin) && !plugins.has(plugin)) problems.push(`${plugin}: native package missing app.json plugin`);
}

const androidPermissions = normalizedPermissions(native?.permissions).filter((permission) => permission.platform === 'android');
for (const permission of androidPermissions) {
  if (!manifest.includes(`android:name="${permission.permission}"`)) problems.push(`${permission.id}: Android manifest missing ${permission.permission}`);
}

const packageHealthPermissions = new Set(androidPermissions
  .map((permission) => permission.permission)
  .filter((permission) => permission.startsWith('android.permission.health.')));
const manifestHealthPermissions = new Set([...manifest.matchAll(/android:name="(android\.permission\.health\.[^"]+)"/g)].map((match) => match[1]));
for (const permission of manifestHealthPermissions) {
  if (!packageHealthPermissions.has(permission)) problems.push(`${permission}: declared in Android manifest but missing from package native capabilities`);
}

for (const permission of normalizedPermissions(native?.permissions).filter((permission) => permission.platform === 'expo')) {
  if (permission.permission.startsWith('expo-image-picker') && !plugins.has('expo-image-picker')) problems.push(`${permission.id}: expo-image-picker permission without plugin`);
  if (permission.permission === 'expo-sharing' && !plugins.has('expo-sharing')) problems.push(`${permission.id}: expo-sharing permission without plugin`);
}

for (const intent of native?.intents ?? []) {
  if (intent.kind === 'share') {
    if (!plugins.has('expo-sharing')) problems.push(`${intent.id}: share intent without expo-sharing plugin`);
    if (!manifest.includes('android.intent.action.SEND')) problems.push(`${intent.id}: share intent without Android SEND filter`);
  }
  if (intent.kind === 'deep_link') {
    const scheme = intent.payload?.scheme ?? appJson.expo?.scheme;
    if (!scheme || appJson.expo?.scheme !== scheme) problems.push(`${intent.id}: deep link scheme ${String(scheme)} does not match app.json`);
    if (!manifest.includes(`android:scheme="${scheme}"`)) problems.push(`${intent.id}: Android manifest missing scheme ${String(scheme)}`);
  }
  if (intent.kind === 'background_task') {
    problems.push(`${intent.id}: background_task declared but no runtime package/gate is installed`);
  }
  if (intent.kind === 'shortcut') {
    problems.push(`${intent.id}: shortcut declared but no generated shortcut/runtime proof exists`);
  }
  if (intent.kind === 'voice') {
    problems.push(`${intent.id}: voice declared but no Assistant/App Actions proof exists`);
  }
}

if (problems.length) {
  console.error('Native capability contract check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify({
  status: 'PASS',
  commit: currentCommit(),
  checkedAt: new Date().toISOString(),
  packages: [...nativePackages].sort(),
  androidPermissions: [...packageHealthPermissions].sort(),
  intentKinds: [...contractIntentKinds].sort(),
  intents: (native?.intents ?? []).map((intent) => `${intent.kind}:${intent.id}`).sort(),
}, null, 2)}\n`);

console.log(`Native capability contract check: PASS (${nativePackages.size} packages, ${packageHealthPermissions.size} Health permissions, evidence: ${path.relative(root, evidencePath)})`);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function normalizedPermissions(permissions) {
  return (permissions ?? []).map((permission, index) => {
    if (typeof permission === 'string') {
      return {
        id: `permission-${index}`,
        platform: permission.startsWith('android.') ? 'android' : 'expo',
        permission,
      };
    }
    return permission;
  });
}

function extractNativeIntentKinds(source) {
  const block = source.match(/APP_PACKAGE_NATIVE_INTENT_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!block) throw new Error('Unable to find shared native intent kind contract.');
  return new Set([...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

function extractServerPackageSchemaIntentKinds(source) {
  const block = source.match(/nativeIntent:[\s\S]*?kind:\s*\{\s*enum:\s*\[([^\]]+)\]/);
  if (!block) throw new Error('Unable to find server native intent schema enum.');
  return new Set([...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
