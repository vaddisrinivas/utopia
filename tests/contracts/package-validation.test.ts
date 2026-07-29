import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  collectAppPackageValidationCategories,
  collectAppPackageValidationIssues,
  type PackageValidationCategory,
} from '@/packages/shared/contracts/package';
import {
  APP_PACKAGE_FIXTURE_MANIFEST_PATH,
  collectArtifactCategories,
  collectArtifactValidationCategories,
  readAppPackageFixture,
  validateArtifact,
} from '@/packages/schemas/src';
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
      const sharedCategories = collectAppPackageValidationCategories(pkg);
      const artifactCategories = collectArtifactValidationCategories({ value: pkg });
      const artifact = validateArtifact({ value: pkg });
      const server = validateAppPackage(pkg);

      expect(artifact.ok).toBe(server.valid);
      expect(artifact.ok).toBe(fixture.valid);

      if (fixture.valid) {
        expect(sharedCategories).toEqual([]);
        expect(artifactCategories).toEqual([]);
        expect(server.valid).toBe(true);
        await expect(activateAppPackage(new MemoryDb() as any, pkg as any)).resolves.toMatchObject({
          id: (pkg as any).id,
          version: (pkg as any).version,
        });
        return;
      }

      expect(sharedCategories).toContain(fixture.errorCategory);
      expect(artifactCategories.length).toBeGreaterThan(0);
      const matchingIssue = issues.find((issue) => issue.category === fixture.errorCategory);
      expect(matchingIssue).toBeDefined();
      expect(artifact.ok).toBe(false);
      if (artifact.ok) {
        throw new Error(`expected invalid artifact result for ${fixture.path}`);
      }
      expect(server.valid).toBe(false);
      if (server.valid) {
        throw new Error(`expected invalid server result for ${fixture.path}`);
      }
      expect(server.errors).toEqual(artifact.issues.map((issue) => issue.message));
      await expect(activateAppPackage(new MemoryDb() as any, pkg as any)).rejects.toThrow(matchingIssue!.message);
    });
  }

  it('rejects unknown widgets with the same server and artifact decision', async () => {
    const pkg = readAppPackageFixture('unknown-widget.json');
    const artifact = validateArtifact({ value: pkg });
    const server = validateAppPackage(pkg);

    expect(artifact.ok).toBe(false);
    expect(server.valid).toBe(false);
    if (artifact.ok) throw new Error('expected unknown widget to fail artifact validation');
    if (server.valid) throw new Error('expected unknown widget to fail server validation');
    expect(collectArtifactCategories({ value: pkg })).toEqual(['structural']);
    expect(artifact.issues.map((issue) => issue.code)).toEqual(['schema.enum']);
    expect(server.errors).toEqual(artifact.issues.map((issue) => issue.message));
  });
});
