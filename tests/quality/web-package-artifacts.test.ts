import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SHARED_HOUSEHOLD_BOARD_ID,
  buildSharedHouseholdBoardWebPackageArtifacts,
  writeSharedHouseholdBoardWebPackageArtifacts,
} from '../../scripts/quality/golden-loop/web-package-artifacts.mjs';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-web-artifacts-'));
  tempRoots.push(root);
  return root;
}

function hasTaskPriorityLaneV2(packageJson: Record<string, unknown>) {
  const collections = packageJson?.collections;
  const taskCollection = typeof collections === 'object' && collections !== null
    ? ((collections as Record<string, unknown>).task as Record<string, unknown> | undefined)
    : Array.isArray(collections)
      ? collections.find((entry) => (entry as { id?: string }).id === 'task')
      : null;

  const taskFields = taskCollection && !Array.isArray(taskCollection)
    ? (taskCollection.fields as Record<string, unknown>)
    : Array.isArray(taskCollection?.fields)
      ? taskCollection.fields
      : [];

  if (Array.isArray(taskFields)) {
    return taskFields.some((field) => (field as { id?: string }).id === 'priority_lane');
  }

  return Boolean(taskFields?.[ 'priority_lane' ]);
}

describe('web package artifacts', () => {
  it('builds deterministic v1/v2 Shared Household Board packages for web proof', () => {
    const first = buildSharedHouseholdBoardWebPackageArtifacts({
      root: process.cwd(),
    });
    const second = buildSharedHouseholdBoardWebPackageArtifacts({
      root: process.cwd(),
    });

    expect(first.id).toBe(SHARED_HOUSEHOLD_BOARD_ID);
    expect(first.v1.checksum).toBe(second.v1.checksum);
    expect(first.v2.checksum).toBe(second.v2.checksum);
    expect(first.v2.checksum).not.toBe(first.v1.checksum);
    expect(first.version.v1).toBe('1.0.0');
    expect(first.version.v2).toBe('1.1.0');
    expect(hasTaskPriorityLaneV2(first.v2.package as Record<string, unknown>)).toBe(true);
    expect(hasTaskPriorityLaneV2(first.v1.package as Record<string, unknown>)).toBe(false);
  });

  it('writes web package artifacts and metadata with stable checksum fields', () => {
    const tempRoot = createTempRoot();
    const artifacts = buildSharedHouseholdBoardWebPackageArtifacts({
      root: process.cwd(),
    });
    const outputDir = join(tempRoot, 'web-packages');
    mkdirSync(outputDir, { recursive: true });

    const written = writeSharedHouseholdBoardWebPackageArtifacts(process.cwd(), outputDir, artifacts);

    const writtenV1 = JSON.parse(readFileSync(written.v1.path, 'utf8')) as Record<string, unknown>;
    const writtenV2 = JSON.parse(readFileSync(written.v2.path, 'utf8')) as Record<string, unknown>;
    const metadata = JSON.parse(readFileSync(written.metadataPath, 'utf8')) as {
      package: { id: string; v1: string; v2: string };
      checksums: { v1: string; v2: string };
    };

    expect(writtenV1.id).toBe(SHARED_HOUSEHOLD_BOARD_ID);
    expect(writtenV2.id).toBe(SHARED_HOUSEHOLD_BOARD_ID);
    expect(metadata.package.id).toBe(SHARED_HOUSEHOLD_BOARD_ID);
    expect(metadata.checksums.v1).toBe(artifacts.v1.checksum);
    expect(metadata.checksums.v2).toBe(artifacts.v2.checksum);
  });
});
