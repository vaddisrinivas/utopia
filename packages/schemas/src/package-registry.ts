import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_PACKAGE_SCHEMA_DRAFT, APP_PACKAGE_SCHEMA_ID_V2, APP_PACKAGE_SCHEMA_ID_V3, appPackageSchemaV2, appPackageSchemaV3 } from './app-package-schemas';

export type AppPackageSchemaRegistryEntry = Readonly<{
  key: 'app-package-v2' | 'app-package-v3';
  schemaId: string;
  schemaVersion: 'wonder.app-package.v2' | 'wonder.app-package.v3';
  aliases: readonly string[];
  draft: typeof APP_PACKAGE_SCHEMA_DRAFT;
  maturity: 'active';
  schema: typeof appPackageSchemaV2 | typeof appPackageSchemaV3;
}>;

export const APP_PACKAGE_FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/package-validation');
export const APP_PACKAGE_FIXTURE_MANIFEST_PATH = path.join(APP_PACKAGE_FIXTURE_DIR, 'manifest.json');

export const APP_PACKAGE_SCHEMA_REGISTRY: readonly AppPackageSchemaRegistryEntry[] = [
  {
    key: 'app-package-v2',
    schemaId: APP_PACKAGE_SCHEMA_ID_V2,
    schemaVersion: 'wonder.app-package.v2',
    aliases: ['wonder.app-package.v2'],
    draft: APP_PACKAGE_SCHEMA_DRAFT,
    maturity: 'active',
    schema: appPackageSchemaV2,
  },
  {
    key: 'app-package-v3',
    schemaId: APP_PACKAGE_SCHEMA_ID_V3,
    schemaVersion: 'wonder.app-package.v3',
    aliases: ['wonder.app-package.v3'],
    draft: APP_PACKAGE_SCHEMA_DRAFT,
    maturity: 'active',
    schema: appPackageSchemaV3,
  },
] as const;

export type SchemaRegistryDiagnostic = Readonly<{
  code: 'registry.duplicateKey' | 'registry.duplicateSchemaId' | 'registry.duplicateAlias' | 'registry.badSchemaId' | 'registry.badDraft' | 'registry.missingSchema' | 'registry.circularAlias';
  message: string;
}>;

export function getAppPackageSchemaEntry(input: { schemaId?: string; schemaVersion?: string }): AppPackageSchemaRegistryEntry | null {
  const key = input.schemaId ?? input.schemaVersion;
  if (!key) return null;
  return APP_PACKAGE_SCHEMA_REGISTRY.find((entry) => entry.key === key || entry.schemaId === key || entry.schemaVersion === key || entry.aliases.includes(key)) ?? null;
}

export function validateAppPackageSchemaRegistry(): SchemaRegistryDiagnostic[] {
  const issues: SchemaRegistryDiagnostic[] = [];
  const seenKeys = new Set<string>();
  const seenSchemaIds = new Set<string>();
  const seenAliases = new Set<string>();

  for (const entry of APP_PACKAGE_SCHEMA_REGISTRY) {
    if (seenKeys.has(entry.key)) issues.push({ code: 'registry.duplicateKey', message: `duplicate registry key ${entry.key}` });
    seenKeys.add(entry.key);

    if (seenSchemaIds.has(entry.schemaId)) issues.push({ code: 'registry.duplicateSchemaId', message: `duplicate schema id ${entry.schemaId}` });
    seenSchemaIds.add(entry.schemaId);

    if (!entry.schema || typeof entry.schema !== 'object') {
      issues.push({ code: 'registry.missingSchema', message: `registry entry ${entry.key} is missing a schema` });
      continue;
    }
    if (entry.schema.$id !== entry.schemaId) issues.push({ code: 'registry.badSchemaId', message: `registry entry ${entry.key} schema $id mismatch` });
    if (entry.schema.$schema !== entry.draft) issues.push({ code: 'registry.badDraft', message: `registry entry ${entry.key} draft mismatch` });

    for (const alias of entry.aliases) {
      if (alias === entry.key || alias === entry.schemaId) {
        issues.push({ code: 'registry.circularAlias', message: `registry entry ${entry.key} alias ${alias} shadows primary id` });
      }
      if (seenAliases.has(alias)) issues.push({ code: 'registry.duplicateAlias', message: `duplicate registry alias ${alias}` });
      seenAliases.add(alias);
    }
  }

  return issues;
}

export type AppPackageFixtureCase = Readonly<{
  path: string;
  valid: boolean;
  errorCategory?: string;
}>;

export function readAppPackageFixtureManifest(): AppPackageFixtureCase[] {
  return JSON.parse(readFileSync(APP_PACKAGE_FIXTURE_MANIFEST_PATH, 'utf8')) as AppPackageFixtureCase[];
}

export function readAppPackageFixture(caseFile: string): unknown {
  return JSON.parse(readFileSync(path.join(APP_PACKAGE_FIXTURE_DIR, caseFile), 'utf8')) as unknown;
}
