import { describe, expect, it } from 'vitest';

import {
  APP_PACKAGE_FIXTURE_MANIFEST_PATH,
  readAppPackageFixtureManifest,
  validateAppPackageSchemaRegistry,
  appPackageSchemaV2,
  appPackageSchemaV3,
} from '@/packages/schemas/src';
import { APP_PACKAGE_BASE_REQUIRED_FIELDS } from '@/packages/shared/contracts/package';

describe('schema registry', () => {
  it('is internally consistent', () => {
    expect(validateAppPackageSchemaRegistry()).toEqual([]);
  });

  it('pins one shared package fixture manifest', () => {
    expect(APP_PACKAGE_FIXTURE_MANIFEST_PATH.endsWith('tests/fixtures/package-validation/manifest.json')).toBe(true);
    expect(readAppPackageFixtureManifest().length).toBeGreaterThan(0);
  });

  it('keeps required fields aligned with the shared contract', () => {
    expect(appPackageSchemaV2.required).toEqual(['schemaVersion', ...APP_PACKAGE_BASE_REQUIRED_FIELDS]);
    expect(appPackageSchemaV3.required).toEqual([
      'schemaVersion',
      ...APP_PACKAGE_BASE_REQUIRED_FIELDS,
      'dependencyPins',
      'nativeCapabilities',
      'contractLock',
    ]);
  });
});
