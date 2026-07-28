import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  collectAppPackageValidationIssues,
  type PackageValidationCategory,
} from '@/packages/shared/contracts/package';
import { APP_PACKAGE_FIXTURE_MANIFEST_PATH, collectArtifactValidationCategories, readAppPackageFixture, validateArtifact } from '@/packages/schemas/src';
import { activateAppPackage } from '@/src/db/app-package-registry';
import { validateAppPackage } from '@/server/src/kernel/package';
import { MemoryDb } from '@/tests/helpers/memory-db';

type FixtureCase = {
  path: string;
  valid: boolean;
  errorCategory?: PackageValidationCategory;
};

const manifest = JSON.parse(readFileSync(APP_PACKAGE_FIXTURE_MANIFEST_PATH, 'utf8')) as FixtureCase[];

describe('package validation parity fixtures', () => {
  for (const fixture of manifest) {
    it(fixture.path, async () => {
      const pkg = readAppPackageFixture(fixture.path);
      const issues = collectAppPackageValidationIssues(pkg);
      const categories = collectArtifactValidationCategories({ value: pkg });
      const artifact = validateArtifact({ value: pkg });
      const server = validateAppPackage(pkg);

      if (fixture.valid) {
        expect(artifact.ok).toBe(true);
        expect(categories).toEqual([]);
        expect(server.valid).toBe(true);
        await expect(activateAppPackage(new MemoryDb() as any, pkg as any)).resolves.toMatchObject({
          id: (pkg as any).id,
          version: (pkg as any).version,
        });
        return;
      }

      expect(categories).toContain(fixture.errorCategory);
      const matchingIssue = issues.find((issue) => issue.category === fixture.errorCategory);
      expect(matchingIssue).toBeDefined();
      expect(artifact.ok).toBe(false);
      expect(server.valid).toBe(false);
      if (server.valid) {
        throw new Error(`expected invalid server result for ${fixture.path}`);
      }
      expect(server.errors).toContain(matchingIssue!.message);
      await expect(activateAppPackage(new MemoryDb() as any, pkg as any)).rejects.toThrow(matchingIssue!.message);
    });
  }
});
