import { describe, expect, it } from 'vitest';

import {
  APP_PACKAGE_SCHEMA_ID_V2,
  APP_PACKAGE_SCHEMA_ID_V3,
  APP_PACKAGE_V2_SUITE_PATH,
  getAppPackageSchemaEntry,
  readSchemaSuiteFixture,
  resolveSchemaForSuiteCase,
  runSchemaSuite,
} from '@/scripts/schema/schema-test-harness';
import { getSchemaValidator } from '@/packages/shared/contracts/schema/ajv-authority';

describe('schema authority', () => {
  it('uses one shared AJV entrypoint for app package schema validation', () => {
    const v2 = getAppPackageSchemaEntry({ schemaVersion: 'wonder.app-package.v2' });
    const v3 = getAppPackageSchemaEntry({ schemaVersion: 'wonder.app-package.v3' });
    if (!v2 || !v3) {
      throw new Error('expected both app package schemas in registry');
    }

    const v2First = getSchemaValidator(v2.schema);
    const v2Second = getSchemaValidator(v2.schema);
    const v3First = getSchemaValidator(v3.schema);
    const v3Second = getSchemaValidator(v3.schema);

    expect(v2First).toBe(v2Second);
    expect(v3First).toBe(v3Second);
  });

  it('runs JSON schema suite fixtures from scripts/schema', () => {
    const suite = readSchemaSuiteFixture(APP_PACKAGE_V2_SUITE_PATH);
    expect(suite.length).toBeGreaterThan(0);
    expect(suite[0].schemaId).toBe(APP_PACKAGE_SCHEMA_ID_V2);
    expect(suite[1].schemaId).toBe(APP_PACKAGE_SCHEMA_ID_V3);

    for (const suiteCase of suite) {
      const schema = resolveSchemaForSuiteCase(suiteCase);
      for (const result of runSchemaSuite(suiteCase)) {
        if (result.actual !== result.expected) {
          throw new Error(`${suiteCase.description}/${result.description}: expected ${result.expected} got ${result.actual}; ${JSON.stringify(result.errors)}`);
        }
      }
      expect(schema).toBeTruthy();
    }
  });
});
