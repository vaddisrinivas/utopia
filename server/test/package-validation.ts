import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  collectAppPackageValidationCategories,
  collectAppPackageValidationIssues,
  type PackageValidationCategory,
} from '@/packages/shared/contracts/package';
import {
  APP_PACKAGE_FIXTURE_MANIFEST_PATH,
  readAppPackageFixture,
} from '@/packages/schemas/src';
import { validateAppPackage } from '../src/kernel/package';

type FixtureCase = {
  path: string;
  valid: boolean;
  errorCategory?: PackageValidationCategory;
};

const manifest = JSON.parse(readFileSync(APP_PACKAGE_FIXTURE_MANIFEST_PATH, 'utf8')) as FixtureCase[];

for (const fixture of manifest) {
  const pkg = readAppPackageFixture(fixture.path);
  const issues = collectAppPackageValidationIssues(pkg);
  const categories = collectAppPackageValidationCategories(pkg);
  const result = validateAppPackage(pkg);

  assert.equal(result.valid, fixture.valid, `${fixture.path} valid mismatch`);
  if (fixture.valid) {
    assert.deepEqual(categories, [], `${fixture.path} should have no shared issues`);
    continue;
  }

  assert.ok(fixture.errorCategory, `${fixture.path} missing expected category`);
  assert.ok(categories.includes(fixture.errorCategory), `${fixture.path} missing category ${fixture.errorCategory}`);
  const matchingIssue = issues.find((issue) => issue.category === fixture.errorCategory);
  assert.ok(matchingIssue, `${fixture.path} missing issue for ${fixture.errorCategory}`);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes(matchingIssue.message), `${fixture.path} missing server error ${matchingIssue.message}`);
}

console.log(`package-validation fixtures passed: ${manifest.length}`);
