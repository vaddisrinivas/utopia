import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('core port boundaries', () => {
  it('keeps runtime context facade free of React/native concrete imports', () => {
    const runtimeContext = readFileSync(resolve(root, 'src/domain/runtime-context.tsx'), 'utf8');
    expect(runtimeContext).not.toMatch(/from ['"]react['"]|from ['"]react-native|react-native-/);
    expect(runtimeContext).toMatch(/\.\.\/\.\.\/adapters\/runtime-context-provider/);
  });

  it('moves Health Connect concrete sdk dependencies to adapter layer', () => {
    const connectPorts = readFileSync(resolve(root, 'src/health/connect.ports.ts'), 'utf8');
    const connect = readFileSync(resolve(root, 'src/health/connect.ts'), 'utf8');

    expect(connect).not.toMatch(/from ['"]react-native|from ['"]react-native-health-connect/);
    expect(connectPorts).toMatch(/\.\.\/\.\.\/adapters\/health-connect-ports/);
    const connectPortsAdapter = readFileSync(resolve(root, 'adapters/health-connect-ports.ts'), 'utf8');
    expect(connectPortsAdapter).toMatch(/react-native-health-connect|react-native/);
  });
});
