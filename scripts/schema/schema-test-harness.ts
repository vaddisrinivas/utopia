import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getAppPackageSchemaEntry } from '@/packages/schemas/src/package-registry';
import {
  APP_PACKAGE_SCHEMA_ID_V2 as APP_PACKAGE_SCHEMA_ID_V2_CONST,
  APP_PACKAGE_SCHEMA_ID_V3 as APP_PACKAGE_SCHEMA_ID_V3_CONST,
} from '@/packages/schemas/src/app-package-schemas';
import { getSchemaValidator } from '@/packages/shared/contracts/schema/ajv-authority';

export type SchemaSuiteTest = Readonly<{
  description: string;
  data: unknown;
  valid: boolean;
}>;

export type SchemaSuiteCase = Readonly<{
  description: string;
  schemaId?: string;
  schemaVersion?: string;
  schema?: Record<string, unknown>;
  tests: readonly SchemaSuiteTest[];
}>;

export type SchemaSuiteFile = ReadonlyArray<SchemaSuiteCase>;

export { getAppPackageSchemaEntry };

export function readSchemaSuiteFixture(relativePath: string): SchemaSuiteFile {
  const resolved = join(process.cwd(), relativePath);
  const raw = JSON.parse(readFileSync(resolved, 'utf8')) as SchemaSuiteFile;
  return raw;
}

export function resolveSchemaForSuiteCase(suite: SchemaSuiteCase): Record<string, unknown> {
  if (isRecord(suite.schema)) return suite.schema;

  const schemaEntry = getAppPackageSchemaEntry({
    schemaId: suite.schemaId,
    schemaVersion: suite.schemaVersion,
  });
  if (!schemaEntry) throw new Error(`unable to resolve schema for suite: ${suite.description}`);
  return schemaEntry.schema as Record<string, unknown>;
}

export function runSchemaSuite(caseData: SchemaSuiteCase): ReadonlyArray<{
  description: string;
  expected: boolean;
  actual: boolean;
  data: unknown;
  errors: unknown;
}> {
  const schema = resolveSchemaForSuiteCase(caseData);
  const validate = getSchemaValidator(schema);
  return caseData.tests.map((testCase) => {
    const actual = Boolean(validate(testCase.data));
    return {
      description: testCase.description,
      expected: testCase.valid,
      actual,
      data: testCase.data,
      errors: actual ? [] : validate.errors ?? [],
    };
  });
}

export const APP_PACKAGE_V2_SUITE_PATH = 'scripts/schema/fixtures/app-package-schema-suite.json';
export const APP_PACKAGE_SCHEMA_ID_V2 = APP_PACKAGE_SCHEMA_ID_V2_CONST;
export const APP_PACKAGE_SCHEMA_ID_V3 = APP_PACKAGE_SCHEMA_ID_V3_CONST;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
