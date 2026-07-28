import { describe, expect, it } from 'vitest';

import {
  APP_PACKAGE_FIXTURE_MANIFEST_PATH,
  readAppPackageFixtureManifest,
  validateAppPackageSchemaRegistry,
} from '@/packages/schemas/src';

describe('schema registry', () => {
  it('is internally consistent', () => {
    expect(validateAppPackageSchemaRegistry()).toEqual([]);
  });

  it('pins one shared package fixture manifest', () => {
    expect(APP_PACKAGE_FIXTURE_MANIFEST_PATH.endsWith('tests/fixtures/package-validation/manifest.json')).toBe(true);
    expect(readAppPackageFixtureManifest().length).toBeGreaterThan(0);
  });
});
