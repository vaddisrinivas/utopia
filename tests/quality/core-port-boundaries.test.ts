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

  it('keeps runtime context ports adapter-free', () => {
    const runtimeContextPorts = readFileSync(resolve(root, 'src/domain/runtime-context.ports.ts'), 'utf8');
    expect(runtimeContextPorts).not.toMatch(/from ['"][^'"]*adapters|from ['"][^'"]*runtime-context-ports/);
    expect(runtimeContextPorts).toMatch(/interface RuntimePackageRegistryPort/);
    expect(runtimeContextPorts).toMatch(/interface RuntimeContextPorts/);
    expect(runtimeContextPorts).not.toMatch(/from ['"]expo-sqlite['"]/);
  });

  it('moves Health Connect concrete sdk dependencies to adapter layer', () => {
    const connectPorts = readFileSync(resolve(root, 'src/health/connect.ports.ts'), 'utf8');
    const connect = readFileSync(resolve(root, 'src/health/connect.ts'), 'utf8');

    expect(connect).not.toMatch(/from ['"]react-native|from ['"]react-native-health-connect/);
    expect(connectPorts).toMatch(/\.\.\/\.\.\/adapters\/health-connect-ports/);
    const connectPortsAdapter = readFileSync(resolve(root, 'adapters/health-connect-ports.ts'), 'utf8');
    expect(connectPortsAdapter).toMatch(/react-native-health-connect|react-native/);
  });

  it('keeps portable database consumers free of concrete Expo SQLite', () => {
    const files = [
      'src/domain/package-migrations.ts',
      'src/domain/collaboration.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/from ['"]expo-sqlite['"]/);
      expect(source).toMatch(/database-port/);
    }
  });

  it('keeps package validation behind the shared AJV factory', () => {
    const packageValidation = readFileSync(resolve(root, 'packages/schemas/src/package-validation.ts'), 'utf8');
    expect(packageValidation).toMatch(/getSchemaValidator/);
    expect(packageValidation).not.toMatch(/new Ajv2020|new AjvDraft07/);
  });

  it('keeps portable Core crypto and database contracts adapter-backed', () => {
    const coreFiles = [
      'src/domain/package-sharing.ts',
      'src/domain/cloud-vault.ts',
      'src/domain/cloud-vault-storage.ts',
      'src/domain/runtime-context.ports.ts',
    ];
    for (const file of coreFiles) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/from ['"]node:crypto['"]|from ['"]expo-sqlite['"]/);
      expect(source).not.toMatch(/\bBuffer\b/);
    }
    expect(readFileSync(resolve(root, 'src/domain/crypto-port.ts'), 'utf8')).toMatch(/interface CoreCryptoPort/);
    expect(readFileSync(resolve(root, 'adapters/core-crypto.ts'), 'utf8')).toMatch(/from ['"]node:crypto['"]/);
  });
});
