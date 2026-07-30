import { readFileSync } from 'node:fs';
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

const runtimeContextPath = resolve(root, 'src/domain/runtime-context.tsx');
const runtimeContextPortsPath = resolve(root, 'src/domain/runtime-context.ports.ts');
const runtimeContextAdapterPath = resolve(root, 'adapters/runtime-context-provider.tsx');
const runtimeContextPortsAdapterPath = resolve(root, 'adapters/runtime-context-ports.ts');
const healthConnectPath = resolve(root, 'src/health/connect.ts');
const healthConnectPortsPath = resolve(root, 'src/health/connect.ports.ts');
const healthConnectPortsAdapterPath = resolve(root, 'adapters/health-connect-ports.ts');

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

if (errors.length > 0) {
  console.error(`FAIL core port-boundary checks (${errors.length})`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('PASS core port-boundary checks');
}
