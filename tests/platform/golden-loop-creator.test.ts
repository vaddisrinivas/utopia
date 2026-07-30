import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

import { compileAppPackageSource } from '@/packages/app-compiler';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import {
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
  parsePackageInstallTarget,
} from '@/packages/shared/contracts/package-install';
import { validateArtifact } from '@/packages/schemas/src';
import { runMigrations } from '@/src/db/migrations';
import { installApprovedAppPackage } from '@/src/db/app-package-registry';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';
import {
  assessFactoryPrompt,
  normalizeModelSource,
  writeFactoryArtifact,
} from '@/scripts/factory/generate-app-from-prompt';

const prompt = [
  'Build a shared household board with tasks, routines, members, and expenses.',
  'It must work offline, preserve data through updates, and use only generic Utopia widgets.',
].join(' ');
const fixturePath = path.resolve('tests/fixtures/golden-loop/shared-household-board.source.json');
const rawSource = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;
const allowedGenericWidgets = new Set([
  'kanbanBoard',
  'formCard',
  'dataTable',
  'chartBlock',
  'checklistCard',
]);

type PipelineStep = {
  stage: string;
  elapsedMs: number;
};

describe('Golden Loop creator-path proxy', () => {
  const databases: NodeSqliteDb[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('normalizes a natural-language fixture through factory artifact and installs review target', async () => {
    const pipeline: PipelineStep[] = [];
    const withTiming = <T>(stage: string, run: () => T): T => {
      const start = performance.now();
      const value = run();
      pipeline.push({ stage, elapsedMs: Number((performance.now() - start).toFixed(3)) });
      return value;
    };
    const withAsyncTiming = async <T>(stage: string, run: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      const value = await run();
      pipeline.push({ stage, elapsedMs: Number((performance.now() - start).toFixed(3)) });
      return value;
    };

    expect(assessFactoryPrompt(prompt)).toEqual({ allowed: true });

    const source = withTiming('normalize-source', () => normalizeModelSource(rawSource, prompt));

    const compile = withTiming('compile-source', () => compileAppPackageSource(source));
    expect(compile.valid).toBe(true);
    if (!compile.valid) throw new Error('golden_loop_creator_compile_failed');
    expect(compile.package.id).toBe('shared-household-board');
    expect(compile.preview.widgets.length).toBeGreaterThan(0);
    expect(compile.preview.widgets.every((widget) => allowedGenericWidgets.has(widget))).toBe(true);

    const artifactValidation = validateArtifact({ value: compile.package });
    expect(artifactValidation.ok).toBe(true);

    const root = mkdtempSync(path.join(tmpdir(), 'utopia-golden-loop-creator-'));
    tempDirs.push(root);
    const artifact = withTiming('write-artifact', () => writeFactoryArtifact({
      outputDir: path.join(root, 'artifact'),
      promptPath: 'requests/app-idea.md',
      prompt,
      model: 'gpt-5.4-mini',
      rawModelOutput: rawSource,
      source,
      force: true,
    }));

    expect(artifact.packageId).toBe(compile.package.id);
    expect(artifact.packageChecksum).toBe(sha256Canonical(compile.package));

    const packageUrl = 'https://utoia.thetechcruise.com/p/shared-household-board.json';
    const installUrl = `utopia://install?url=${encodeURIComponent(packageUrl)}`;
    expect(parsePackageInstallTarget(installUrl)).toEqual({
      source: 'deep_link',
      packageUrl,
    });

    const preview = withTiming('build-review-preview', () => buildPackageInstallPreview(compile.package, {
      sourceUrl: packageUrl,
      expectedChecksum: sha256Canonical(compile.package),
    }));
    expect(preview.status).toBe('ready_for_review');

    const database = new NodeSqliteDb();
    databases.push(database);
    await runMigrations(database as never);

    const approval = withTiming('build-install-approval', () => buildPackageInstallApprovalReceipt(
      preview,
      'golden-loop-user',
      '2026-07-30T00:00:00.000Z',
    ));
    const installationId = 'golden-loop-creator-install';
    const installation = await withAsyncTiming('install-target', () => installApprovedAppPackage(database as never, {
      packageJson: compile.package,
      preview,
      approval,
      installationId,
      now: '2026-07-30T00:00:01.000Z',
    }));

    expect(installation.id).toBe(installationId);
    const elapsedMs = pipeline.reduce((total, step) => total + step.elapsedMs, 0);
    expect(elapsedMs).toBeGreaterThan(0);
    expect(pipeline).toHaveLength(6);
  });
});
