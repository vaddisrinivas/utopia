import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const errors = [];

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function assertNotRegex(filePath, regex, message) {
  const content = readFileSync(filePath, 'utf8');
  assert(!regex.test(content), message);
}

function assertContains(filePath, regex, message) {
  const content = readFileSync(filePath, 'utf8');
  assert(regex.test(content), message);
}

const widgetNativeBridgePath = resolve(root, 'src/presentation/widget-native-bridges.ts');
const widgetSourceRoot = resolve(root, 'src/presentation/widgets');
const widgetRendererPath = resolve(root, 'src/presentation/json-render-widgets.tsx');

function sourceFilesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFilesUnder(entryPath));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

/**
 * Widget code may use the native bridge facade, but native modules must not
 * leak into package widgets or be loaded before the broker grants access.
 * The facade itself is the only allowlisted concrete-native adapter.
 */
export function collectWidgetCapabilityBoundaryViolations(rootDir = root) {
  const widgetRoot = resolve(rootDir, 'src/presentation/widgets');
  const renderer = resolve(rootDir, 'src/presentation/json-render-widgets.tsx');
  const sources = [...sourceFilesUnder(widgetRoot), renderer];
  const violations = [];
  const directNativeImport = /(?:from\s+['"](?:expo-(?:audio|camera|calendar|contacts|document-picker|file-system|image-picker|local-authentication|location|notifications|sensors|sharing|speech|video)(?:\/[^'"]*)?)['"]|import\(\s*['"](?:expo-(?:audio|camera|calendar|contacts|document-picker|file-system|image-picker|local-authentication|location|notifications|sensors|sharing|speech|video)(?:\/[^'"]*)?)['"]\s*\))/;
  const bridgeImport = /from\s+['"][^'"]*widget-native-bridges['"]/;

  for (const filePath of sources) {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = filePath.slice(rootDir.length + 1);
    if (directNativeImport.test(source)) {
      violations.push(`${relativePath}: direct Expo capability import; use widget-native-bridges and the broker`);
    }
    if (bridgeImport.test(source) && !/requestWidgetCapability|requireWidgetCapability/.test(source)) {
      violations.push(`${relativePath}: native bridge consumer has no capability broker call`);
    }
  }

  const rendererSource = readFileSync(renderer, 'utf8');
  const preloadBoundaries = [
    {
      loader: 'loadExpoCamera',
      guard: /if\s*\(!cameraCapability\.ok\)[\s\S]{0,260}loadExpoCamera\(\)/,
      message: 'camera module must load only after the camera-scanner broker decision',
    },
    {
      loader: 'loadExpoVideo',
      guard: /if\s*\(!videoCapability\.ok\)[\s\S]{0,260}loadExpoVideo\(\)/,
      message: 'video module must load only after the video-player broker decision',
    },
    {
      loader: 'loadExpoSensors',
      guard: /if\s*\(!sensorCapability\.ok\)[\s\S]{0,260}loadExpoSensors\(\)/,
      message: 'sensor module must load only after the sensor broker decision',
    },
    {
      loader: 'loadExpoFileSystem',
      guard: /if\s*\(!audioFileCapability\.ok\)[\s\S]{0,260}loadExpoFileSystem\(\)/,
      message: 'Audio Loop durable-file module must load only after the audio-file broker decision',
    },
  ];
  for (const { loader, guard, message } of preloadBoundaries) {
    if (rendererSource.includes(`${loader}()` ) && !guard.test(rendererSource)) {
      violations.push(`src/presentation/json-render-widgets.tsx: ${message}`);
    }
  }
  return violations;
}

const runtimeContextPath = resolve(root, 'src/domain/runtime-context.tsx');
const runtimeContextPortsPath = resolve(root, 'src/domain/runtime-context.ports.ts');
const runtimeContextAdapterPath = resolve(root, 'adapters/runtime-context-provider.tsx');
const runtimeContextPortsAdapterPath = resolve(root, 'adapters/runtime-context-ports.ts');
const healthConnectPath = resolve(root, 'src/health/connect.ts');
const healthConnectPortsPath = resolve(root, 'src/health/connect.ports.ts');
const healthConnectPortsAdapterPath = resolve(root, 'adapters/health-connect-ports.ts');
const databasePortPath = resolve(root, 'src/domain/database-port.ts');
const cryptoPortPath = resolve(root, 'src/domain/crypto-port.ts');
const cryptoAdapterPath = resolve(root, 'adapters/core-crypto.ts');
const schemaValidatorPath = resolve(root, 'packages/shared/contracts/schema/ajv-authority.ts');
const packageValidationPath = resolve(root, 'packages/schemas/src/package-validation.ts');
const portableCoreFiles = [
  'src/domain/package-migrations.ts',
  'src/domain/collaboration.ts',
].map((file) => resolve(root, file));
const portableCryptoFiles = [
  'src/domain/package-sharing.ts',
  'src/domain/cloud-vault.ts',
  'src/domain/cloud-vault-storage.ts',
  'src/domain/runtime-context.ports.ts',
].map((file) => resolve(root, file));

assertNotRegex(
  runtimeContextPath,
  /from ['"]react['"]|from ['"]react-native|react-native-|@react-native\//,
  'runtime-context core facade must not contain concrete React/native imports',
);
assertContains(
  runtimeContextPath,
  /\.\.\/\.\.\/adapters\/runtime-context-provider/,
  'runtime-context should re-export adapter-backed runtime provider',
);
assertNotRegex(
  runtimeContextPortsPath,
  /from\s+['"][^'"]*runtime-context-ports['"]|from\s+['"][^'"]*adapters[^'"]*/,
  'runtime-context ports must stay in domain and must not import concrete adapters',
);
assert(
  readFileSync(runtimeContextAdapterPath, 'utf8').includes('defaultRuntimeContextPorts'),
  'runtime-context adapter should use defaultRuntimeContextPorts',
);
assert(
  readFileSync(runtimeContextPortsAdapterPath, 'utf8').includes('defaultRuntimeContextPorts'),
  'runtime-context adapter ports module should provide defaultRuntimeContextPorts',
);
assert(
  readFileSync(runtimeContextPortsPath, 'utf8').includes('interface RuntimePackageRegistryPort')
    && readFileSync(runtimeContextPortsPath, 'utf8').includes('interface RuntimeContextPorts'),
  'runtime-context ports module must define registry/runtime port interfaces',
);
assertNotRegex(
  runtimeContextPortsPath,
  /from ['"]expo-sqlite['"]/,
  'runtime-context ports must not import expo-sqlite',
);

assertNotRegex(
  healthConnectPath,
  /from ['"]react-native['"]|from ['"]react-native-health-connect['"]/,
  'health/connect should not directly import react-native/react-native-health-connect',
);
assertContains(
  healthConnectPath,
  /defaultHealthConnectPorts/,
  'health/connect should use defaultHealthConnectPorts',
);
assertContains(
  healthConnectPath,
  /ports\.sdk\.|ports\.platform\.|ports\.navigation\.|ports\.http\./,
  'health/connect should use sdk/platform/navigation/http ports',
);
assertContains(
  healthConnectPath,
  /HealthConnectPorts/,
  'health/connect should type-check against HealthConnectPorts',
);
assertNotRegex(
  healthConnectPortsPath,
  /from ['"]react-native|from ['"]react-native-health-connect|\brequire\(\s*['"]react-native/,
  'health/connect ports contract should stay adapter-free',
);
assertContains(
  healthConnectPortsPath,
  /\.{2}\/\.\.\/adapters\/health-connect-ports/,
  'health/connect ports should delegate concrete health implementations',
);
assertContains(
  healthConnectPortsAdapterPath,
  /react-native-health-connect|react-native/,
  'health connect ports adapter should provide concrete react-native dependencies',
);
assertContains(databasePortPath, /interface DatabasePort/, 'portable Core must expose a database port contract');
assertContains(cryptoPortPath, /interface CoreCryptoPort/, 'portable Core must expose a crypto port contract');
assertContains(cryptoAdapterPath, /from ['"]node:crypto['"]/, 'crypto adapter should provide concrete Node crypto');
for (const filePath of portableCoreFiles) {
  assertNotRegex(filePath, /from ['"]expo-sqlite['"]/, `${filePath} must not import concrete Expo SQLite`);
  assertContains(filePath, /database-port/, `${filePath} must consume the portable database port`);
}
for (const filePath of portableCryptoFiles) {
  assertNotRegex(filePath, /from ['"]expo-sqlite['"]|from ['"]node:crypto['"]|\bBuffer\b/, 'portable Core must not import concrete platform dependencies');
}
for (const filePath of portableCryptoFiles.slice(0, 3)) {
  assertContains(filePath, /core-crypto/, 'portable Core crypto consumers must use the crypto adapter');
}
assertContains(portableCryptoFiles[3], /database-port/, 'runtime-context ports must consume the portable database port');
assertContains(schemaValidatorPath, /new Ajv2020|new AjvDraft07/, 'shared schema authority must construct AJV validators');
assertNotRegex(packageValidationPath, /new Ajv2020|new AjvDraft07/, 'package validation must use the shared AJV authority');
assertContains(packageValidationPath, /getSchemaValidator/, 'package validation must consume the shared AJV authority');

for (const violation of collectWidgetCapabilityBoundaryViolations()) {
  errors.push(`widget capability boundary: ${violation}`);
}

if (errors.length > 0) {
  console.error(`FAIL core port-boundary checks (${errors.length})`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('PASS core port-boundary checks');
}
